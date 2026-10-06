/**
 * Server-side validation and normalisation shared by every idea mutation.
 *
 * These live behind `_` so Convex does not treat them as function modules.
 *
 * Deliberately imports nothing from `_generated`: keeping this module free of
 * the data-model graph means the Convex bundler only ever compiles it once.
 */

/** Deliberately generous: a capture bar must never block a thought mid-sentence. */
export const TITLE_MAX = 300;
export const BODY_MAX = 20_000;
export const TAG_MAX = 40;
export const TAGS_MAX = 24;

export class ValidationError extends Error {}

function cleanText(value: string, field: string, max: number) {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new ValidationError(`${field} cannot be empty.`);
	}
	if (trimmed.length > max) {
		throw new ValidationError(`${field} must be ${max} characters or fewer.`);
	}
	return trimmed;
}

/**
 * Validate an idea title. Empty is allowed ONLY as `undefined` (absent field),
 * never as an empty string — otherwise an edit could silently blank an idea.
 */
export function normaliseTitle(title: string | undefined | null) {
	if (title === undefined || title === null) return undefined;
	return cleanText(title, 'Title', TITLE_MAX);
}

export function normaliseBody(body: string | undefined | null) {
	if (body === undefined || body === null) return undefined;
	const trimmed = body.trim();
	if (!trimmed) return undefined;
	if (trimmed.length > BODY_MAX) {
		throw new ValidationError(`That note must be ${BODY_MAX} characters or fewer.`);
	}
	return trimmed;
}

/**
 * Tags are matched case-insensitively, so normalise to lowercase. Storing
 * "Mobile" and "mobile" as two tags would fragment every tag filter.
 */
export function normaliseTags(tags: string[] | undefined | null) {
	if (!tags) return undefined;
	if (tags.length > TAGS_MAX) {
		throw new ValidationError(`An idea can have at most ${TAGS_MAX} tags.`);
	}

	const seen = new Set<string>();
	const out: string[] = [];

	for (const raw of tags) {
		const tag = raw.trim().toLowerCase();
		if (!tag) continue;
		if (tag.length > TAG_MAX) {
			throw new ValidationError(`Tags must be ${TAG_MAX} characters or fewer.`);
		}
		if (seen.has(tag)) continue;
		seen.add(tag);
		out.push(tag);
	}

	return out;
}

/** Scores are 1..10 whole numbers. `undefined` clears the score. */
export function normaliseScore(score: number | undefined | null, field: string) {
	if (score === undefined || score === null) return undefined;
	if (!Number.isFinite(score)) {
		throw new ValidationError(`${field} must be a number.`);
	}
	if (!Number.isInteger(score) || score < 1 || score > 10) {
		throw new ValidationError(`${field} must be a whole number between 1 and 10.`);
	}
	return score;
}

/**
 * Milliseconds since the epoch, the unit every timestamp in this app uses.
 *
 * Named `nowMs` rather than `nowSeconds` on purpose. The previous name said
 * "whole second" while returning `Date.now()`, and the consumers (7-day review
 * rule, relative dates) correctly divide by 86_400_000. Anyone "fixing" the
 * function to match its old name would silently break every date in the app.
 */
export function nowMs() {
	return Date.now();
}

/**
 * `revisitAt` is the one numeric field that had no validation while all of its
 * siblings were range-checked, so `revisitAt: -1e308`, `1e308` and `0.5` all
 * persisted. The field is indexed by `by_user_revisit`, so junk in it poisons
 * index scans as well as whatever reads it.
 *
 * Constrained to a whole millisecond timestamp inside a human-plausible window
 * rather than merely "finite": `1e308` and `0.5` are both finite numbers, which
 * is exactly the gap a finiteness check leaves open.
 */
const REVISIT_MIN = Date.UTC(2000, 0, 1);
const REVISIT_MAX = Date.UTC(2100, 0, 1);

export function normaliseRevisitAt(revisitAt: number | null | undefined): number | undefined {
	if (revisitAt === undefined || revisitAt === null) return undefined;

	if (typeof revisitAt !== 'number' || !Number.isFinite(revisitAt)) {
		throw new ValidationError('Revisit date must be a real date.');
	}
	if (!Number.isInteger(revisitAt)) {
		throw new ValidationError('Revisit date must be a whole timestamp.');
	}
	if (revisitAt < REVISIT_MIN || revisitAt > REVISIT_MAX) {
		throw new ValidationError('Revisit date must be between 2000 and 2100.');
	}

	return revisitAt;
}