/**
 * Personal analytics, computed from rows the client already holds.
 *
 * Everything here folds `ideas:list` output (plus the bounded `analytics:events`
 * query on web) into sentences. No new subscriptions, no new writes, no
 * cross-user reads: a user's numbers derive only from their own rows, which is
 * the privacy story, and the cost story is that analytics is pure arithmetic on
 * data already paid for.
 *
 * Days are UTC buckets, matching the server's `utcDay`. A streak is consecutive
 * UTC days with ≥1 capture - coarse by design; timezone-true streaks would need
 * a stored timezone, which is data collected for cosmetics.
 */

export type AnalyticsIdea = {
	_id: string;
	title: string;
	status: string;
	archived: boolean;
	favorite: boolean;
	source: 'typed' | 'dictated';
	createdAt: number;
	updatedAt: number;
	impact?: number;
	effort?: number;
	confidence?: number;
	letGoAt?: number;
	hasTranscript?: boolean;
};

export type AnalyticsEvent = {
	ideaId: string;
	kind: string;
	detail?: string | null;
	createdAt: number;
};

export type PersonalAnalytics = {
	streak: { current: number; best: number };
	voice: { dictated30d: number; total30d: number; dictatedAll: number; totalAll: number };
	scoring: { scored: number; open: number };
	oldestUntouched: { days: number; id: string; title: string } | null;
	decisionLatencyMedianDays: number | null;
	decisionMix30d: { try: number; park: number; letGo: number; skip: number };
	/** Weeks (Mon-Sun UTC) with at least one let-go. Task completions are not
	 * dated in the schema, so they cannot weekly-bucket - this counts what can
	 * be counted rather than guessing. */
	letGoWeeks4: number;
	parkToBuild: { everParked: number; nowBuilt: number };
	finishVsLetGo: { done: number; letGo: number };
	verbatimKept: { dictated: number; withTranscript: number };
	favoritesActedOn: { total: number; active: number };
	tasks: { done: number; total: number; truncated: boolean };
};

const DAY_MS = 86_400_000;

/**
 * UTC day bucket. Exported because the telemetry heartbeat needs the exact same
 * day string on the client (to guard "once per day") that the server computes -
 * and duplicating the one-liner in two places is how they drift apart.
 */
export function dayBucket(at: number): string {
	return new Date(at).toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const m = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	return Math.round(m * 10) / 10;
}

const BUILT = new Set(['ready', 'building', 'done']);

export function computePersonal(
	ideas: AnalyticsIdea[],
	events: AnalyticsEvent[] = [],
	tasks: { done: number; total: number; truncated: boolean } = { done: 0, total: 0, truncated: false },
	now = Date.now()
): PersonalAnalytics {
	const active = ideas.filter((i) => !i.archived);
	const byId = new Map(ideas.map((i) => [String(i._id), i]));

	// Streak over capture days (UTC), current + best.
	const days = [...new Set(ideas.map((i) => dayBucket(i.createdAt)))].sort();
	let best = 0;
	let run = 0;
	let prev = '';
	for (const d of days) {
		const diff = prev ? Math.round((Date.parse(d) - Date.parse(prev)) / DAY_MS) : 1;
		run = diff === 1 ? run + 1 : 1;
		prev = d;
		if (run > best) best = run;
	}
	const today = dayBucket(now);
	const yesterday = dayBucket(now - DAY_MS);
	const current = days.includes(today) || days.includes(yesterday) ? run : 0;

	// Voice share, trailing 30d + all time.
	const all = ideas;
	const recent = ideas.filter((i) => i.createdAt >= now - 30 * DAY_MS);
	const dictated = (list: AnalyticsIdea[]) => list.filter((i) => i.source === 'dictated').length;

	// Scoring coverage over open ideas.
	const open = active.filter((i) => i.status !== 'done');
	const scored = open.filter(
		(i) => i.impact !== undefined && i.effort !== undefined && i.confidence !== undefined
	).length;

	// Oldest untouched inbox idea.
	let oldestUntouched: PersonalAnalytics['oldestUntouched'] = null;
	for (const i of active) {
		if (i.status !== 'inbox') continue;
		const days = Math.floor((now - i.updatedAt) / DAY_MS);
		if (!oldestUntouched || days > oldestUntouched.days) {
			oldestUntouched = { days, id: String(i._id), title: i.title };
		}
	}

	// Decision latency: capture → first status/letGo/reviewed event, median days.
	const firstDecision = new Map<string, number>();
	for (const e of events) {
		if (e.kind !== 'status' && e.kind !== 'letGo' && e.kind !== 'reviewed') continue;
		const prev = firstDecision.get(e.ideaId);
		if (prev === undefined || e.createdAt < prev) firstDecision.set(e.ideaId, e.createdAt);
	}
	const latencies: number[] = [];
	for (const [ideaId, at] of firstDecision) {
		const idea = byId.get(ideaId);
		if (!idea) continue;
		latencies.push((at - idea.createdAt) / DAY_MS);
	}

	// Decision mix, trailing 30d. Narratives are the shared vocabulary from
	// `review.ts effectOf`: `committed…` = try, `parked for…` = park,
	// `left for later` = skip, and letGo has its own event kind.
	const mix = { try: 0, park: 0, letGo: 0, skip: 0 };
	const cutoff = now - 30 * DAY_MS;
	for (const e of events) {
		if (e.createdAt < cutoff) continue;
		if (e.kind === 'letGo') mix.letGo++;
		else if (e.kind === 'reviewed' && typeof e.detail === 'string') {
			if (e.detail.startsWith('committed')) mix.try++;
			else if (e.detail.startsWith('parked for')) mix.park++;
			else if (e.detail === 'left for later') mix.skip++;
		}
	}

	// Let-go weeks, trailing 4 UTC weeks (Mon-Sun).
	const weekStart = (at: number) => {
		const d = new Date(at);
		const dow = (d.getUTCDay() + 6) % 7;
		return dayBucket(at - dow * DAY_MS);
	};
	const weeks = new Set<string>();
	for (const e of events) {
		if (e.kind !== 'letGo' || e.createdAt < now - 28 * DAY_MS) continue;
		weeks.add(weekStart(e.createdAt));
	}

	// Park-to-build: ever parked (event detail ends in "→ parked", or parked now)
	// and currently in a built stage.
	let everParked = 0;
	let nowBuilt = 0;
	for (const idea of active) {
		const parkedEvent = events.some(
			(e) => String(e.ideaId) === String(idea._id) && e.kind === 'status' && (e.detail ?? '').endsWith('→ parked')
		);
		const wasParked = parkedEvent || idea.status === 'parked';
		if (!wasParked) continue;
		everParked++;
		if (BUILT.has(idea.status)) nowBuilt++;
	}

	const done = active.filter((i) => i.status === 'done').length;
	const letGo = ideas.filter((i) => !i.archived && i.letGoAt !== undefined).length
		+ ideas.filter((i) => i.archived && i.letGoAt !== undefined).length;

	const dictatedAll = all.filter((i) => i.source === 'dictated');
	const favs = active.filter((i) => i.favorite);

	return {
		streak: { current, best },
		voice: {
			dictated30d: dictated(recent),
			total30d: recent.length,
			dictatedAll: dictatedAll.length,
			totalAll: all.length
		},
		scoring: { scored, open: open.length },
		oldestUntouched,
		decisionLatencyMedianDays: median(latencies),
		decisionMix30d: mix,
		letGoWeeks4: weeks.size,
		parkToBuild: { everParked, nowBuilt },
		finishVsLetGo: { done, letGo },
		verbatimKept: {
			dictated: dictatedAll.length,
			withTranscript: dictatedAll.filter((i) => i.hasTranscript).length
		},
		favoritesActedOn: {
			total: favs.length,
			active: favs.filter((i) => BUILT.has(i.status)).length
		},
		tasks
	};
}
