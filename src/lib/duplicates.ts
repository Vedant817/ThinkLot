/**
 * Choosing which ideas are worth asking a model about.
 *
 * ## Why a shortlist at all
 *
 * Two reasons, and the second is the one that bites.
 *
 * 1. Cost and time: comparing every pair is O(n²). Four hundred ideas is 79,800 pairs -
 *    unaffordable even on the user's own card, and slow enough that they will abandon
 *    the feature.
 * 2. **Retrieval is not judgement.** This module is retrieval and is allowed to be
 *    wrong; the model's verdict is judgement. Sending everything to a model invites it
 *    to invent relationships between unrelated ideas just because they were in the
 *    batch. Sending only plausible pairs keeps the model doing the one job it is good
 *    at.
 *
 * ## Shared tags are supporting evidence, never sufficient
 *
 * Two postmortems can both be tagged `#handover` and describe entirely different
 * incidents. That is the single most reliable way to invent a false duplicate, so a
 * candidate must clear a floor on TEXTUAL similarity. Tags can raise a candidate's
 * score, but cannot create one. This mirrors `clustering.ts`, which refuses to cluster
 * on tags carried by a majority of the lot, for the same reason.
 *
 * ## Scores are shown to the user
 *
 * `lexical` and `tagOverlap` are returned separately rather than pre-mixed, so the UI can
 * say *why* something was offered for judgement instead of presenting an opaque rank.
 *
 * Pure and offline. Nothing here calls a model or a database.
 */

export type DuplicateCandidateInput = {
	_id: string;
	title: string;
	tags: string[];
	preview?: string;
};

/** Words carrying no discriminating power in an idea title. */
const STOPWORDS = new Set([
	'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is',
	'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with'
]);

/**
 * Lowercase, strip punctuation, drop stopwords, collapse whitespace.
 *
 * Stopwords go because "notes" vs "field notes" should look close, and "the" vs
 * nothing should not count as similarity on its own.
 */
export function normaliseTitle(title: string): string {
	return title
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((word) => word.length > 0 && !STOPWORDS.has(word))
		.join(' ');
}

/**
 * Character trigrams, which survive the typos and rewordings that whole-word overlap
 * misses: "handover" and "hand-over" share more than they differ by.
 */
function trigrams(text: string): Set<string> {
	const padded = ` ${text} `;
	const out = new Set<string>();
	for (let i = 0; i < padded.length - 2; i++) {
		const slice = padded.slice(i, i + 3);
		if (slice.trim().length > 0) out.add(slice);
	}
	return out;
}

/**
 * Dice coefficient over trigrams: 2·|intersection| / (|a| + |b|).
 *
 * Chosen over Jaccard because it does not punish a short string against a long one as
 * harshly, and idea titles vary wildly in length for no good reason.
 */
export function titleSimilarity(a: string, b: string): number {
	const left = normaliseTitle(a);
	const right = normaliseTitle(b);
	if (left === '' || right === '') return 0;
	if (left === right) return 1;

	const ta = trigrams(left);
	const tb = trigrams(right);
	let shared = 0;
	for (const gram of ta) if (tb.has(gram)) shared++;
	const total = ta.size + tb.size;
	return total === 0 ? 0 : (2 * shared) / total;
}

/**
 * How many of the target's tags the candidate shares.
 *
 * Capped at 1 for a single shared tag: sharing `#handover` is not evidence of anything
 * beyond both ideas mentioning handover.
 */
function tagOverlap(target: string[], candidate: string[]): number {
	const mine = new Set(target.map((t) => t.trim().toLowerCase()).filter(Boolean));
	if (mine.size === 0) return 0;
	const theirs = candidate.map((t) => t.trim().toLowerCase());
	let shared = 0;
	for (const tag of new Set(theirs)) if (mine.has(tag)) shared++;
	// Diminishing returns: one shared tag is weak, two is better, ten is not ten times
	// better.
	return Math.min(1, shared / 2);
}

export type DuplicateCandidate = {
	idea: DuplicateCandidateInput;
	/** 0-1, lexical only. What actually qualified it. */
	lexical: number;
	/** 0-1. Shown for context; never sufficient on its own. */
	tagOverlap: number;
};

export type CandidateOptions = {
	/** How many to send for judgement. Five is a shortlist, not a search result. */
	limit?: number;
	/**
	 * Minimum lexical similarity to be considered at all. Below this, shared tags
	 * cannot rescue a candidate.
	 */
	floor?: number;
};

const DEFAULTS = { limit: 5, floor: 0.18 } as const;

/**
 * The ideas worth asking about, best first.
 *
 * Returns nothing rather than a weak guess when nothing clears the floor - and callers
 * must say "no candidates" rather than "no duplicates", because this has only ever
 * looked at the ones it shortlisted.
 */
export function duplicateCandidates(
	target: DuplicateCandidateInput,
	all: DuplicateCandidateInput[],
	options: CandidateOptions = {}
): DuplicateCandidate[] {
	const { limit, floor } = { ...DEFAULTS, ...options };

	// No guard on `all.length` here, and there used to be one that returned early
	// below two. That meant a lot of exactly TWO ideas could never be checked - the
	// smallest lot where the question is most obviously worth asking. The loop skips
	// the target itself, so an empty list simply produces an empty result.
	const scored: DuplicateCandidate[] = [];
	for (const idea of all) {
		if (idea._id === target._id) continue;

		const lexical = titleSimilarity(target.title, idea.title);
		// The floor is on TEXTUAL similarity. A candidate that matches only on tags is
		// not a duplicate candidate, it is a coincidence with a label on it.
		if (lexical < floor) continue;

		scored.push({ idea, lexical, tagOverlap: tagOverlap(target.tags, idea.tags) });
	}

	// Rank on lexical first, then tags. Deliberately NOT a blended score: a candidate
	// with strong tags and weak words must not outrank one that is nearly the same
	// sentence, because that is the inversion that produces false duplicates.
	return scored
		.sort(
			(a, b) =>
				b.lexical - a.lexical ||
				b.tagOverlap - a.tagOverlap ||
				a.idea._id.localeCompare(b.idea._id)
		)
		.slice(0, limit);
}

/**
 * A short, plain reason for a candidate.
 *
 * Never "87% similar" - a similarity figure implies a confidence the lexical method has
 * no basis for, which is the exact failure mode the model's judgement exists to catch.
 */
export function candidateReason(candidate: DuplicateCandidate): string {
	if (candidate.lexical >= 0.8) return 'Nearly the same words in the title';
	if (candidate.lexical >= 0.5) return 'Overlapping title wording';
	if (candidate.tagOverlap > 0) return 'Similar wording, and shares a tag';
	return 'Similar wording';
}