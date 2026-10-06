/**
 * Priority scoring.
 *
 *   Priority = (Impact x Confidence) / Effort
 *
 * All three inputs are 1..10 whole numbers. Effort sits in the denominator, so
 * a high-impact idea that is cheap to build outranks one that needs a month.
 */

export type Scored = {
	impact?: number;
	effort?: number;
	confidence?: number;
};

export type ScoreInput = Scored & { favorite?: boolean; archived?: boolean };

export function priorityScore(idea: Scored): number | null {
	const { impact, effort, confidence } = idea;
	if (impact === undefined || effort === undefined || confidence === undefined) return null;

	// Guard on finiteness, not just `> 0`. `NaN <= 0` is false, so an `effort` of
	// NaN used to sail through and produce `scoreBand(NaN) === 'low'` with
	// `displayScore(NaN) === "NaN"` painted into the plate.
	if (!Number.isFinite(impact) || !Number.isFinite(effort) || !Number.isFinite(confidence)) {
		return null;
	}
	if (effort <= 0) return null;

	return (impact * confidence) / effort;
}

/**
 * Score band, used for the one place colour carries meaning.
 *
 * Deliberately three bands rather than a continuous gradient: a continuous
 * scale invites people to agonise over 7.2 vs 7.4, which is the opposite of what
 * a capture tool is for.
 */
export type Band = 'unscored' | 'low' | 'solid' | 'strong';

export function scoreBand(score: number | null): Band {
	if (score === null) return 'unscored';
	if (score >= 24) return 'strong';
	if (score >= 10) return 'solid';
	return 'low';
}

/**
 * Sort by priority, strongest first.
 *
 * Unscored ideas sink to the bottom rather than being treated as zero: a blank
 * score means "not yet judged", not "worthless", and mixing the two hides the
 * ideas that still need a decision.
 */
export function byPriority<T extends ScoreInput>(a: T, b: T): number {
	const sa = priorityScore(a);
	const sb = priorityScore(b);
	if (sa === null && sb === null) return 0;
	if (sa === null) return 1;
	if (sb === null) return -1;
	return sb - sa;
}

/** Round for display so the plate never shows 16.6666666. */
export function displayScore(score: number | null): string {
	if (score === null) return '--';
	return score >= 100 ? String(Math.round(score)) : score.toFixed(1);
}

/**
 * `LOT-0042` — zero padded to four so plates line up in a fixed-width column and
 * sort the same whether compared as text or as a number. The counter behind it is
 * monotonic (see `counters` in the Convex schema), so a plate is never handed to
 * two different ideas.
 */
export function lotPlate(seq: number): string {
	return `LOT-${String(seq).padStart(4, '0')}`;
}