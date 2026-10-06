/**
 * Turning raw capture into a structured idea.
 *
 * The premise of this app is that a thought arrives in about thirty seconds, in
 * whatever form it happens to take: half a sentence, a dictated ramble, or a
 * bullet list. So the only rule here is that the first line is the thing, and
 * everything after it is context.
 */

export type CaptureSource = 'typed' | 'dictated';

export type ParsedCapture = {
	title: string;
	/** The remainder, kept as a note. Empty string when there was nothing else. */
	description?: string;
	source: CaptureSource;
	/**
	 * The utterance exactly as it arrived, for dictation. Kept verbatim so a
	 * later pass can re-parse it without having thrown anything away.
	 */
	transcript?: string;
};

/**
 * Split a capture blob into title and description.
 *
 * A dictated thought almost always arrives as one long run-on sentence, so the
 * first line alone is rarely the whole point. When there is no line break we
 * fall back to the first sentence, capped so the title stays scannable.
 */
export function parseCapture(raw: string, source: CaptureSource): ParsedCapture | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const firstNewline = trimmed.search(/\n/);

	if (firstNewline === -1) {
		const title = firstSentence(trimmed);
		return {
			title: title || trimmed,
			source,
			...(source === 'dictated' ? { transcript: trimmed } : {})
		};
	}

	const title = trimmed.slice(0, firstNewline).trim();
	const rest = trimmed.slice(firstNewline + 1).trim();

	return {
		title: title || trimmed,
		description: rest || undefined,
		source,
		...(source === 'dictated' ? { transcript: trimmed } : {})
	};
}

function firstSentence(text: string): string {
	const match = text.match(/^.*?[.!?](\s|$)/);
	const sentence = match ? match[0].trim() : '';
	if (sentence.length >= 12 && sentence.length <= 220) return sentence;
	return text.slice(0, 220).trim();
}

/**
 * Was this text dictated rather than typed?
 *
 * Wispr Flow (and every other system-wide dictation tool) injects finished text
 * in one shot. The tell is the gap between `input` events: a human types at a
 * median of roughly 150-250ms, a dictation engine emits at well under 30ms.
 *
 * We deliberately do not compare the *first* gap, only the median across the
 * burst, because a single fast burst while genuinely typing is normal and
 * should not relabel a typed thought as dictated.
 */
export function looksDictated(gapsMs: number[]): boolean {
	if (gapsMs.length < 6) return false;

	const sorted = [...gapsMs].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];

	return median < 60;
}

/** Milliseconds of silence after which an open draft is worth keeping. */
export const CAPTURE_DEBOUNCE_MS = 900;

/** Drafts longer than this are almost certainly a note, not a title. */
export const DRAFT_LIMIT = 4000;