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
	const overflow = rawTitle.trim().slice(TITLE_MAX);
	const description = [overflow, rest, tail].filter(Boolean).join('\n').trim() || undefined;

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

/**
 * How many characters in ONE event means "injected", not "typed".
 *
 * The first version of this used 200, and a test fixture caught the flaw immediately:
 * a real dictated sentence is often shorter than that, and Wispr injects a 25-character
 * phrase exactly as readily as a 400-character paragraph. A bar set that high misses
 * more dictated captures than it catches, which defeats the purpose.
 *
 * Set low enough that a short injection is caught, while still above anything a
 * keyboard does on its own. Autocorrect inserting a completed word is a handful of
 * characters; an IME committing a multi-character suggestion is well under twenty.
 *
 * 24 is about three words: comfortably above both, comfortably below a spoken phrase.
 */
const INJECTED_BLOCK_CHARS = 24;

/**
 * Did text arrive in one block rather than typed?
 *
 * `looksDictated` is a TIMING heuristic and it cannot see the case that matters most.
 * Wispr Flow - and every paste, and the Android keyboard's own dictation - injects the
 * finished text in a single input event. That is ONE event, so zero or one gap, and
 * `looksDictated` returns false below its six-sample floor. The consequence was not
 * cosmetic: `parseCapture` keeps a verbatim transcript only when the source is
 * `dictated`, so a Wispr-captured idea had its title and body split correctly while its
 * original wording was silently discarded. The one input path the feature exists for
 * was the one it failed on.
 *
 * Shape catches what timing cannot: no human types three words between two events.
 *
 * Being wrong in this direction only means the verbatim copy of what the user already
 * typed is also stored beside the parsed title and body - nothing is invented, and
 * nothing is lost. Being wrong the other way loses the original.
 */
export function looksInjected(addedChars: number, threshold = INJECTED_BLOCK_CHARS): boolean {
	return addedChars >= threshold;
}

/**
 * The "… Trigger: …" convention, for dictated context.
 *
 * Someone dictating a thought usually also says WHY it occurred, because that is the
 * part they cannot reconstruct later: "idea, a waitlist for cancellations. Trigger,
 * walking with Priya, she said empty slots cost her money."
 *
 * Asking for that in a form field at capture time is the fastest way to lose the idea
 * entirely. Accepting it inline costs nothing - the user already said it out loud.
 *
 * The rule is deliberately simple and deliberately narrow: a literal `trigger`
 * followed by a colon, case-insensitive, taking the rest of that line. Anything more
 * ambitious would start mangling dictated prose, and this text is the one thing the
 * user cannot afford to have rewritten.
 *
 * Returns undefined when there is no such clause, so a caller can distinguish "no
 * trigger" from "an empty trigger".
 */
export function extractTrigger(raw: string): { text: string; trigger: string | undefined } {
	const trimmed = raw.trim();

	// Only a single-line clause is read. Multi-line capture is usually structured
	// notes, where the word "trigger" means something else entirely.
	//
	// Not an `^...$` multiline regex, which is what the first version used and which
	// matched NOTHING - the clause is spoken mid-sentence ("… a waitlist. Trigger,
	// walking with Priya …"), so it is never at the start of a line. Verified directly
	// rather than assumed: the anchored form returns null on the very input it was
	// written for.
	const match = /(?:^|[.!?\n]\s*|,\s+)[ \t]*trigger\s*[:：,]\s*(.+)$/i.exec(trimmed);
	if (!match) return { text: trimmed, trigger: undefined };

	const trigger = match[1].trim();

	// A colon with nothing after it is not a trigger, it is a typo.
	if (!trigger) return { text: trimmed, trigger: undefined };

	// Remove the clause from the body so it is not stored twice, and so the parsed
	// title is not a title about the trigger.
	//
	// Sliced by index rather than `.replace(match[0], '')`: the leading context group
	// means `match[0]` starts at the preceding sentence boundary, so a replace would
	// also swallow the full stop that ends the idea's own sentence. Removing that
	// punctuation left `parseCapture` cutting the title at "money" instead of at
	// "waitlist", because there was no longer a sentence boundary to find.
	const text = (trimmed.slice(0, match.index) + trimmed.slice(match.index + match[0].length)).trim();

	return { text: text || trimmed, trigger };
}
