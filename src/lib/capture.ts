/**
 * Turning raw capture into a structured idea.
 *
 * The premise of this app is that a thought arrives in about thirty seconds, in
 * whatever form it happens to take: half a sentence, a dictated ramble, or a
 * bullet list. Two rules, and only two:
 *
 *   1. Nothing is ever thrown away.
 *   2. The title is the shortest prefix that still identifies the idea.
 *
 * Rule 1 is not a nicety. The whole reason someone writes an idea down is that
 * they cannot trust their memory to keep it, so a parser that quietly discards
 * the tail of a long capture is worse than no parser at all.
 */

export type CaptureSource = 'typed' | 'dictated';

export type ParsedCapture = {
	title: string;
	/** Everything that was not the title. Never silently dropped. */
	description?: string;
	source: CaptureSource;
	/**
	 * The utterance exactly as it arrived, for dictation. Kept verbatim so a
	 * later pass can re-parse it without having lost anything.
	 */
	transcript?: string;
};

/** Mirrors `TITLE_MAX` in src/lib/convex/validation.ts. */
export const TITLE_MAX = 300;

/** A title longer than this stops being scannable, so prefer to split instead. */
const SOFT_TITLE_MAX = 220;

export function parseCapture(raw: string, source: CaptureSource): ParsedCapture | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const newline = trimmed.search(/\n/);

	const head = newline === -1 ? trimmed : trimmed.slice(0, newline).trim();
	const tail = newline === -1 ? '' : trimmed.slice(newline + 1).trim();

	// No line break: the thought is one run-on blob, which is the normal shape of a
	// dictated utterance. Split at the first sentence boundary if there is a
	// usable one.
	const { title: rawTitle, rest } = head.length > SOFT_TITLE_MAX ? splitAtSentence(head) : { title: head, rest: '' };

	const title = clampTitle(rawTitle);
	const description = [rest, tail].filter(Boolean).join('\n').trim() || undefined;

	return {
		title,
		description,
		source,
		...(source === 'dictated' ? { transcript: trimmed } : {})
	};
}

/**
 * Cut at the first sentence boundary that leaves a title worth reading.
 *
 * The previous version required the candidate to be at least 12 characters, so a
 * short opener like "Ok." or "Yeah." discarded the boundary and fell through to a
 * hard character cut - producing a title of mid-word ramble and throwing the
 * rest away. Any real sentence boundary is now accepted.
 */
function splitAtSentence(text: string): { title: string; rest: string } {
	const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);

	if (!match) {
		// No punctuation at all - a dictated fragment. Hard-cut, keeping the tail.
		return { title: text.slice(0, SOFT_TITLE_MAX), rest: text.slice(SOFT_TITLE_MAX) };
	}

	const title = match[0].trim();
	return { title, rest: text.slice(match[0].length).trim() };
}

/**
 * Hard cap to the server's limit.
 *
 * A single 400-character first line used to be rejected outright with "Title must
 * be 300 characters or fewer", leaving the user to hand-delete 100+ characters
 * before they could save at all.
 */
function clampTitle(title: string): string {
	const trimmed = title.trim();
	return trimmed.length <= TITLE_MAX ? trimmed : trimmed.slice(0, TITLE_MAX).trim();
}

/**
 * Was this text dictated rather than typed?
 *
 * Wispr Flow (and every other system-wide dictation tool) injects finished text
 * in one shot. The tell is the gap between `input` events: a human types at a
 * median of roughly 150-250ms, a dictation engine emits well under 60ms.
 *
 * We deliberately do not compare the *first* gap, only the median across the
 * burst, because a single fast burst while genuinely typing is normal and should
 * not relabel a typed thought as dictated. The median is the true median (the two
 * middle values are averaged for an even-length burst), not just the upper middle.
 */
export function looksDictated(gapsMs: number[]): boolean {
	// A short burst is not enough evidence either way. At fewer than 6 samples the
	// median is dominated by noise, and forcing a guess here would mark ordinary
	// quick typing as dictated.
	if (gapsMs.length < 6) return false;

	const sorted = [...gapsMs].sort((a, b) => a - b);
	const mid = sorted.length >> 1;

	// True median: average the two middle values for an even-length burst. Taking
	// only the upper middle meant a burst that started fast and ended in long
	// pauses (exactly what dictation followed by a think-pause looks like)
	// classified as typed.
	const median =
		sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

	return median < 60;
}

/** Drafts longer than this are almost certainly a note, not a title. */
export const DRAFT_LIMIT = 4000;