/**
 * Analytics accuracy: the math is proven on fixtures, and the capture paths are
 * proven present and bounded.
 *
 * Analytics that is wrong is worse than none - a streak that miscounts teaches
 * the user the numbers are decorative, and an owner dashboard that double-counts
 * teaches the builder to ignore it. So this file does two jobs: it hand-computes
 * known histories through `computePersonal` and asserts exact answers, and it
 * asserts the server code has the properties the design depends on (bounded
 * reads, gated owner query, no content in telemetry, opt-out honored).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computePersonal, type AnalyticsIdea, type AnalyticsEvent } from '../src/lib/analytics';

const DAY = 86_400_000;
// Fixed clock: 2026-10-10T12:00:00Z. Every date below is derived from it so the
// expectations cannot rot when the suite runs on another day.
const NOW = Date.parse('2026-10-10T12:00:00Z');

const idea = (over: Partial<AnalyticsIdea> & { _id: string; title: string }): AnalyticsIdea => ({
	status: 'inbox',
	archived: false,
	favorite: false,
	source: 'typed',
	createdAt: NOW - 3 * DAY,
	updatedAt: NOW - 3 * DAY,
	...over
});

const ev = (over: Partial<AnalyticsEvent> & { ideaId: string; kind: string }): AnalyticsEvent => ({
	createdAt: NOW - DAY,
	...over
});

// ------------------------------------------------------------------ streaks

{
	// Captures on Oct 8, 9, 10 UTC: current streak 3, best 3.
	const ideas = [8, 9, 10].map((d) =>
		idea({ _id: `s${d}`, title: `day ${d}`, createdAt: Date.parse(`2026-10-${String(d).padStart(2, '0')}T08:00:00Z`) })
	);
	const a = computePersonal(ideas, [], undefined, NOW);
	assert.deepEqual(a.streak, { current: 3, best: 3 }, 'three consecutive days is a 3-streak');
}

{
	// Oct 6, 7, then a gap, then Oct 10: best 2, current 1 (today counts).
	const ideas = [6, 7, 10].map((d) =>
		idea({ _id: `g${d}`, title: `day ${d}`, createdAt: Date.parse(`2026-10-${String(d).padStart(2, '0')}T08:00:00Z`) })
	);
	const a = computePersonal(ideas, [], undefined, NOW);
	assert.deepEqual(a.streak, { current: 1, best: 2 }, 'a gap resets the run but not the best');
}

{
	// Last capture Oct 8 (two days ago): streak dead, best preserved.
	const ideas = [7, 8].map((d) =>
		idea({ _id: `o${d}`, title: `day ${d}`, createdAt: Date.parse(`2026-10-${String(d).padStart(2, '0')}T08:00:00Z`) })
	);
	const a = computePersonal(ideas, [], undefined, NOW);
	assert.deepEqual(a.streak, { current: 0, best: 2 }, 'yesterday without today still counts as current');
	const older = [5, 6].map((d) =>
		idea({ _id: `x${d}`, title: `day ${d}`, createdAt: Date.parse(`2026-10-${String(d).padStart(2, '0')}T08:00:00Z`) })
	);
	const b = computePersonal(older, [], undefined, NOW);
	assert.deepEqual(b.streak, { current: 0, best: 2 }, 'a lapsed streak reads 0, best kept');
}

// --------------------------------------------------------------------- voice

{
	const ideas = [
		idea({ _id: 'v1', title: 'typed old', createdAt: NOW - 40 * DAY }),
		idea({ _id: 'v2', title: 'said one', source: 'dictated', createdAt: NOW - 5 * DAY, hasTranscript: true }),
		idea({ _id: 'v3', title: 'said two', source: 'dictated', createdAt: NOW - 2 * DAY }),
		idea({ _id: 'v4', title: 'typed new', createdAt: NOW - DAY })
	];
	const a = computePersonal(ideas, [], undefined, NOW);
	assert.deepEqual(
		a.voice,
		{ dictated30d: 2, total30d: 3, dictatedAll: 2, totalAll: 4 },
		'the 40-day-old capture is outside the 30d window but inside all-time'
	);
	assert.deepEqual(a.verbatimKept, { dictated: 2, withTranscript: 1 }, 'only the transcripted one counts as kept');
}

// ------------------------------------------------------- decisions + latency

{
	const ideas = [
		idea({ _id: 'd1', title: 'decided fast', createdAt: NOW - 10 * DAY }),
		idea({ _id: 'd2', title: 'decided slow', createdAt: NOW - 10 * DAY }),
		idea({ _id: 'd3', title: 'undecided', createdAt: NOW - 10 * DAY })
	];
	const events = [
		// try narrative, 2 days after capture.
		ev({ ideaId: 'd1', kind: 'reviewed', detail: 'committed to this week', createdAt: NOW - 8 * DAY }),
		// park narrative, 6 days after capture.
		ev({ ideaId: 'd2', kind: 'reviewed', detail: 'parked for 7 days', createdAt: NOW - 4 * DAY }),
		// skip narrative, recent enough for the mix.
		ev({ ideaId: 'd3', kind: 'reviewed', detail: 'left for later', createdAt: NOW - DAY }),
		// letGo last week (inside 4 UTC weeks).
		ev({ ideaId: 'd1', kind: 'letGo', detail: 'let go: duplicate', createdAt: NOW - 3 * DAY })
	];
	const a = computePersonal(ideas, events, undefined, NOW);
	assert.equal(a.decisionLatencyMedianDays, 6, 'median of [2d, 6d, 9d] latencies is 6');
}

{
	// Isolated mix check: exact narrative prefixes from review.ts effectOf.
	const ideas = [idea({ _id: 'm1', title: 'm' })];
	const events = [
		ev({ ideaId: 'm1', kind: 'reviewed', detail: 'committed to this week: ship it', createdAt: NOW - DAY }),
		ev({ ideaId: 'm1', kind: 'reviewed', detail: 'parked for 30 days', createdAt: NOW - DAY }),
		ev({ ideaId: 'm1', kind: 'reviewed', detail: 'left for later', createdAt: NOW - DAY }),
		ev({ ideaId: 'm1', kind: 'letGo', detail: 'let go: done before', createdAt: NOW - DAY }),
		// Stale event outside the window: must not count.
		ev({ ideaId: 'm1', kind: 'reviewed', detail: 'committed to this week', createdAt: NOW - 40 * DAY })
	];
	const a = computePersonal(ideas, events, undefined, NOW);
	assert.deepEqual(a.decisionMix30d, { try: 1, park: 1, letGo: 1, skip: 1 }, 'each narrative maps to exactly one decision');
	assert.equal(a.letGoWeeks4, 1, 'one let-go week in range');
}

// ------------------------------------------------- conversion + outcomes

{
	const ideas = [
		idea({ _id: 'c1', title: 'parked then built', status: 'building' }),
		idea({ _id: 'c2', title: 'parked still', status: 'parked' }),
		idea({ _id: 'c3', title: 'never parked', status: 'ready' }),
		idea({ _id: 'c4', title: 'finished', status: 'done' }),
		idea({ _id: 'c5', title: 'abandoned', status: 'parked', letGoAt: NOW - DAY })
	];
	const events = [
		ev({ ideaId: 'c1', kind: 'status', detail: 'inbox → parked', createdAt: NOW - 5 * DAY }),
		ev({ ideaId: 'c1', kind: 'status', detail: 'parked → ready', createdAt: NOW - 2 * DAY })
	];
	const a = computePersonal(ideas, events, undefined, NOW);
	assert.deepEqual(a.parkToBuild, { everParked: 3, nowBuilt: 1 }, 'c1 (event), c2 + c5 (status now); c3 never parked, c4 done without parking');
	assert.deepEqual(a.finishVsLetGo, { done: 1, letGo: 1 }, 'done counts, letGo counts via letGoAt');
	assert.deepEqual(a.favoritesActedOn, { total: 0, active: 0 }, 'no favorites here');
}

{
	const ideas = [
		idea({ _id: 'f1', title: 'starred building', status: 'building', favorite: true }),
		idea({ _id: 'f2', title: 'starred inbox', status: 'inbox', favorite: true })
	];
	const a = computePersonal(ideas, [], undefined, NOW);
	assert.deepEqual(a.favoritesActedOn, { total: 2, active: 1 }, 'only the building favorite counts as acted on');
	assert.deepEqual(a.scoring, { scored: 0, open: 2 }, 'neither is scored');
	const scored = [
		idea({ _id: 's1', title: 'scored', impact: 8, effort: 2, confidence: 7 }),
		idea({ _id: 's2', title: 'half', impact: 8 })
	];
	const b = computePersonal(scored, [], undefined, NOW);
	assert.deepEqual(b.scoring, { scored: 1, open: 2 }, 'partial scores do not count');
}

// ------------------------------------------------------------------ server

const strip = (src: string) =>
	src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

{
	// Owner query: env-gated, fail-closed, aggregates only.
	const owner = strip(readFileSync('src/convex/owner.ts', 'utf8'));
	assert.match(owner, /process\.env\.OWNER_EMAIL/, 'owner gate reads the deployment variable');
	assert.match(owner, /Not available\./, 'wrong user and unconfigured share one message');
	assert.doesNotMatch(owner, /user\.email(?!\s*\))/, 'no email leaves the gate comparison');
	const schema = strip(readFileSync('src/convex/schema.ts', 'utf8'));
	const statsBlock = schema.slice(schema.indexOf('dailyOwnerStats'), schema.indexOf('}).index', schema.indexOf('dailyOwnerStats')));
	for (const forbidden of ['email', 'title', 'transcript', 'ip', 'key', 'prompt', 'userId']) {
		assert.doesNotMatch(
			statsBlock,
			new RegExp(`\\b${forbidden}\\b`),
			`dailyOwnerStats must not contain ${forbidden}`
		);
	}

	// Heartbeat: enums + boolean in, nothing else out.
	const telemetry = strip(readFileSync('src/convex/telemetry.ts', 'utf8'));
	assert.match(telemetry, /v\.union\(v\.literal\('web'\), v\.literal\('android'\), v\.literal\('ios'\)\)/, 'platform is a closed enum');
	assert.match(telemetry, /aiConfigured: v\.boolean/, 'only a boolean about AI setup');
	assert.match(telemetry, /telemetryPrefs/, 'opt-out is checked server-side');
	assert.doesNotMatch(telemetry, /title|transcript|prompt|key[^I]/, 'heartbeat carries no content or secrets');

	// Events query is bounded and own-data-only.
	const analytics = strip(readFileSync('src/convex/analytics.ts', 'utf8'));
	assert.match(analytics, /\.take\(/, 'events query caps its read');
	assert.match(analytics, /getAuthUserId/, 'events query is authenticated');
	assert.match(analytics, /by_user_created/, 'events query reads via the user index, never a scan');

	// Rollup: one row per day, idempotent, prunes, reconciles.
	const rollup = owner;
	assert.match(rollup, /rollupDay = internalMutation/, 'rollup is internal, never HTTP-reachable');
	assert.match(rollup, /unique\(\)/, 'same day rewrites the same row');
	assert.match(rollup, /db\.delete/, 'old heartbeats are pruned');
	assert.match(rollup, /captures === capturesCheck/, 'captures reconciles two independent counts');
	assert.match(rollup, /verified/, 'reconciliation result is stored, not just logged');

	// Overview: counts for the bloat question, gated like stats, no addresses.
	assert.match(rollup, /overview = query/, 'overview is a gated query, not a public dump');
	assert.match(rollup, /requireOwner\(ctx\)/, 'overview enforces the owner gate');
	assert.match(rollup, /testUsers/, 'overview splits fixtures from other accounts');
	assert.doesNotMatch(
		rollup.replace(/user\.email/g, '').replace(/email\.toLowerCase/g, ''),
		/return[^;]*\bemail\b/,
		'overview must not return addresses'
	);

	// Cron registered daily.
	const crons = strip(readFileSync('src/convex/crons.ts', 'utf8'));
	assert.match(crons, /internal\.owner\.rollupDay/, 'rollup is on the schedule');
	assert.match(crons, /0 8 \* \* \*/, 'rollup runs daily at 08:00 UTC');
}

// ------------------------------------------------------------------ clients

{
	const web = strip(readFileSync('src/routes/+layout.svelte', 'utf8'));
	assert.match(web, /api\.telemetry\.heartbeat/, 'web sends the heartbeat');
	assert.match(web, /telemetry:heartbeat/, 'web guards once-per-day locally');
	assert.match(web, /storedKeyIds/, 'web derives AI setup from stored keys, never asks');

	const mobileLayout = strip(readFileSync('apps/mobile/src/app/_layout.tsx', 'utf8'));
	assert.match(mobileLayout, /api\.telemetry\.heartbeat/, 'mobile sends the heartbeat');
	assert.match(mobileLayout, /telemetry:heartbeat/, 'mobile guards once-per-day locally');
	assert.match(mobileLayout, /storedKeyIds/, 'mobile derives AI setup from the keychain');

	const account = strip(readFileSync('apps/mobile/src/components/your-numbers.tsx', 'utf8'));
	assert.match(account, /computePersonal/, 'mobile numbers use the shared module');
	assert.match(account, /setOptOut/, 'mobile offers the opt-out');

	const analyticsPage = strip(readFileSync('src/routes/(app)/settings/analytics/+page.svelte', 'utf8'));
	assert.match(analyticsPage, /computePersonal/, 'web numbers use the shared module');
	assert.match(analyticsPage, /api\.analytics\.events/, 'web reads bounded own events');
	assert.match(analyticsPage, /truncated/, 'web states the 250-row cap honestly');
	assert.match(analyticsPage, /setOptOut/, 'web offers the opt-out');

	const ownerPage = strip(readFileSync('src/routes/(app)/owner/+page.svelte', 'utf8'));
	assert.match(ownerPage, /api\.owner\.stats/, 'owner page reads precomputed rows');
	assert.doesNotMatch(ownerPage, /\/settings|\(tabs\)/, 'owner page is not in any nav');
	assert.match(ownerPage, /dau < 5/, 'tiny cohorts suppress percentages');
}

console.log('PASS: personal math is exact on fixtures, and the capture paths are bounded, gated, and content-free.');
