/**
 * The weekly decision, as four moves and one vocabulary.
 *
 * Twelve product agents and a CEO were asked what this app is missing. Every one of
 * them independently named the same failure, and it is not a missing feature:
 *
 * > Capture is fast. Review never happens. The backlog grows, and an inbox that only
 * > grows is worse than no app - it adds guilt while reassuring you that saving means
 * > you will eventually act.
 *
 * So this module is the smallest thing that makes coming back worth it: at a review,
 * each idea gets exactly one of four outcomes, and every outcome is a DECISION rather
 * than a deferral.
 *
 * ## Why four and not three
 *
 * "Park" and "don't now" are not the same act. Parking is a commitment to come back
 * on a date. The fourth move is declining to start anything new this week, which is a
 * real and common answer that "park" would misreport as progress.
 *
 * ## Why "let go" is separate from archive and from delete
 *
 * All three agents covering abandonment converged on this: archiving an idea you have
 * decided against is indistinguishable from archiving one you finished, and delete is
 * wrong for both. So `let go` records a REASON and keeps the idea. The reason is the
 * entire point - it is what makes the archive readable a year later, and it is what
 * stops "let go" feeling like a failure the app is punishing you for.
 *
 * ## A decision is not a deletion
 *
 * `letGo` is reversible in one tap and says so. An app that makes letting go feel
 * permanent teaches people not to let go at all.
 *
 * Pure and offline: no database, no network. Shared by web and mobile.
 */

export type DecisionOutcome = 'try' | 'park' | 'letGo' | 'skip';

export type Decision = {
	outcome: DecisionOutcome;
	/** One sentence. Required for `letGo`, optional elsewhere. */
	reason: string;
	/** Days until this comes back. Zero for `try` and `letGo`. */
	inDays: number;
};

/** The four moves, with the wording each one earns. */
export const DECISIONS: {
	outcome: DecisionOutcome;
	label: string;
	/** What pressing it means, in one sentence. Never a bare verb. */
	blurb: string;
	/** Whether the app should ask for a reason. */
	asksReason: boolean;
	needsDays: boolean;
}[] = [
	{
		outcome: 'try',
		label: 'Try this week',
		blurb: 'Commit to one small next step, then revisit.',
		asksReason: false,
		needsDays: true
	},
	{
		outcome: 'park',
		label: 'Park it',
		blurb: 'Not now. Bring it back on a date you choose.',
		asksReason: false,
		needsDays: true
	},
	{
		outcome: 'letGo',
		label: 'Let it go',
		blurb: 'Decided against. Kept with your reason, not deleted — and reversible.',
		// The one place a sentence is required, because the reason is the whole value.
		asksReason: true,
		needsDays: false
	},
	{
		outcome: 'skip',
		label: 'Decide later',
		blurb: 'Leave it exactly as it is and come back to it.',
		asksReason: false,
		needsDays: false
	}
];

/** Default windows, in days. Chosen to be short enough to actually be honoured. */
export const DEFAULT_REVISIT_DAYS = 7;

/**
 * Validate a decision before it is sent.
 *
 * Returns a sentence rather than a boolean, because the only question a user can
 * meaningfully be asked here is "what is missing".
 */
export function validateDecision(decision: Decision): string | null {
	if (!DECISIONS.some((d) => d.outcome === decision.outcome)) {
		return 'That is not one of the four decisions.';
	}
	const spec = DECISIONS.find((d) => d.outcome === decision.outcome)!;

	if (spec.asksReason && !decision.reason.trim()) {
		// Not optional. A "let go" with no reason is just an archive with extra steps,
		// which is exactly the confusion this module exists to remove.
		return 'Say why, in a few words. That is the part you will want to read later.';
	}
	if (spec.needsDays) {
		if (!Number.isFinite(decision.inDays) || decision.inDays < 1) {
			return 'Choose how long until you look at it again.';
		}
		/*
		 * A whole number of days, not a decimal, and it matches `review:snooze`.
		 *
		 * The snooze path already refused non-integers for a specific reason: the value
		 * is indexed, and junk in it poisons index scans. `decide` was the inconsistent
		 * one - it rounded, so `1.4` silently became 1 day and the app agreed to
		 * something it did not do. Anyone who wants "a couple of days" can say `2`.
		 */
		if (!Number.isInteger(decision.inDays)) {
			return 'A whole number of days, not a fraction.';
		}
		if (decision.inDays > 365) {
			return 'A year is longer than anyone genuinely plans. Pick something shorter.';
		}
	}
	return null;
}

/**
 * What a decision does to an idea.
 *
 * Returned as DATA, not applied here. The server applies it - this exists so the rule
 * "let go archives but never deletes" is stated once, and testable without a database.
 */
export type DecisionEffect = {
	status?: string;
	archived?: boolean;
	letGoAt?: number;
	letGoReason?: string;
	/**
	 * Clear both let-go fields.
	 *
	 * An EXPLICIT flag rather than writing `null`, because the two mean different
	 * things to a caller building a database patch. `undefined` means "leave it
	 * alone" - the contract the rest of this app uses for updates - and `null`
	 * means "clear the field". Writing `null` directly from here would collide with
	 * that contract and invite a caller that forgets to tell the two apart.
	 *
	 * Only `try` and `park` set this, because committing to an idea that was
	 * previously let go is the one case where forgetting that decision would
	 * genuinely mislead.
	 */
	clearLetGo?: boolean;
	revisitAt?: number | null;
	/**
	 * Record the stage this idea is at now, so a restore can put it back.
	 *
	 * The literal `'keep'` is a REQUEST, not a status: the pure module cannot see the
	 * stored document, so it asks the server to fill it in from the row it has. A
	 * real stage string means "use this one", which is how a restore from a backup
	 * can reinstate a stage the backup recorded.
	 */
	statusBeforeArchive?: 'keep';
	/** A sentence for the timeline, so the history explains itself. */
	narrative: string;
};

export function effectOf(decision: Decision, now: number): DecisionEffect {
	const reason = decision.reason.trim();
	const inDays = Math.max(0, Math.round(decision.inDays));

	switch (decision.outcome) {
		case 'try':
			return {
				status: 'ready',
				archived: false,
				clearLetGo: true,
				revisitAt: now + inDays * 86_400_000,
				narrative: `committed to this week${reason ? `: ${reason}` : ''}`
			};

		case 'park':
			return {
				status: 'parked',
				archived: false,
				clearLetGo: true,
				revisitAt: now + inDays * 86_400_000,
				narrative: `parked for ${inDays} day${inDays === 1 ? '' : 's'}${reason ? `: ${reason}` : ''}`
			};

		case 'letGo':
			return {
				// Archived so it leaves the working surfaces, and KEPT. The reason is
				// what makes that archive readable rather than a graveyard.
				archived: true,
				/*
				 * Parked while away, the same way `ideas:setArchived` parks.
				 *
				 * Without this, an idea the user let go from `building` kept reading
				 * as `building` in the archive while a manually-archived one read as
				 * `parked` - two different descriptions of the same fact, and the one
				 * that mattered (the stage) was only in `statusBeforeArchive`. The
				 * stage is still remembered and restored; this just makes the archived
				 * row read the same way whichever door it came through.
				 */
				status: 'parked',
				letGoAt: now,
				letGoReason: reason,
				revisitAt: null,
				statusBeforeArchive: 'keep',
				narrative: `let go: ${reason}`
			};

		case 'skip':
			// Deliberately touches nothing. A decision to leave something alone must
			// not silently edit the thing being left alone.
			return { narrative: 'left for later' };
	}
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

export type Reviewable = {
	_id: string;
	createdAt: number;
	updatedAt: number;
	score: number | null;
	/** Days since the last time the user actually looked at it. */
	daysUntouched: number;
	/** True when the idea has never been scored, so it cannot be ranked. */
	unscored: boolean;
};

export type SessionOptions = {
	/** Ideas per session. Five is what fits in ten minutes with real attention. */
	size?: number;
	/**
	 * A previous commitment, when one exists. Always first: closing the loop on what
	 * you said you would do is the point of coming back, and burying it under new ideas
	 * is how the same commitment gets rolled over forever.
	 */
	commitmentId?: string | null;
};

const DEFAULTS = { size: 5 } as const;

/**
 * Compose a review session.
 *
 * The ordering is the product decision, so it is stated rather than left to a sort the
 * caller might change:
 *
 * 1. The previous commitment, if there is one.
 * 2. Ideas that are DUE - parked, with the revisit date reached. A date the user chose
 *    and then passed is the single most respectful thing to put in front of them.
 * 3. Old unscored captures. These are the ideas silently consuming attention, and they
 *    are deliberately ahead of high scorers: a high score on something untouched for a
 *    year is not what a person came back to resolve.
 * 4. Everything else, newest touch first.
 *
 * Every category is capped so no single one can crowd out the others - otherwise a
 * backlog of due parks produces a session of nothing but due parks, which is a queue,
 * not a decision.
 */
export function buildSession(ideas: Reviewable[], options: SessionOptions = {}) {
	const { size, commitmentId } = { ...DEFAULTS, ...options };
	const pool = [...ideas];

	const due = pool.filter((i) => i.daysUntouched >= 0 && i.daysUntouched >= 7 && !i.unscored);
	const stale = pool.filter((i) => i.daysUntouched >= 30 && i.unscored);
	const rest = pool.filter((i) => !due.includes(i) && !stale.includes(i));

	const byTouch = (a: Reviewable, b: Reviewable) => b.daysUntouched - a.daysUntouched || b.updatedAt - a.updatedAt;

	const commitment = commitmentId ? pool.find((i) => i._id === commitmentId) ?? null : null;

	const chosen: Reviewable[] = [];
	const seen = new Set<string>();
	const take = (list: Reviewable[], limit: number) => {
		for (const idea of list) {
			if (chosen.length >= size || limit <= 0) break;
			if (seen.has(idea._id)) continue;
			seen.add(idea._id);
			chosen.push(idea);
			limit--;
		}
	};

	// One slot reserved for the commitment, so it cannot be crowded out by a backlog.
	if (commitment) {
		seen.add(commitment._id);
		chosen.push(commitment);
	}
	take([...due].sort(byTouch), 2);
	take([...stale].sort(byTouch), 2);
	take([...rest].sort(byTouch), size - chosen.length);

	return {
		items: chosen,
		commitmentId: commitment?._id ?? null,
		/** Reported so the screen can say "5 of 137" rather than implying it is all. */
		total: pool.length,
		truncated: pool.length > chosen.length
	};
}

/**
 * The one number the CEO recommended, computable from a session.
 *
 * A week counts when the user revisits a previously captured idea and either completes
 * something or explicitly lets it go. Opening the screen is not progress, and neither is
 * changing a score - both are cheap and neither produces an outcome.
 *
 * Exported as a pure function so it is testable without a database, and so the
 * definition lives in one place rather than being re-implemented per client.
 */
export function isUsefulReviewWeek(actions: { outcome: DecisionOutcome; completedSomething?: boolean }[]): boolean {
	return actions.some((action) => action.outcome === 'letGo' || action.completedSomething === true);
}