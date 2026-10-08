/**
 * The two AI features, as prompts plus a validator for whatever comes back.
 *
 * ## Model output is untrusted input
 *
 * A model can return prose where JSON was asked for, wrap JSON in a markdown fence,
 * invent a field, or return an array of objects with the wrong shape. Treating that as
 * data is how a summarisation feature ends up rendering whatever the model felt like
 * emitting - including text that reads like a confident instruction.
 *
 * So every result goes through `parseModelJson`, which:
 *   - strips code fences, which is what models actually emit ~always,
 *   - extracts the outermost JSON value rather than trusting the whole string,
 *   - validates field types and clamps lengths,
 *   - returns `null` rather than a half-parsed guess.
 *
 * Callers must handle `null`. It is a real outcome, not an edge case.
 *
 * ## Consent is per-request and stated in the prompt
 *
 * Only fields the user has already written are sent. Nothing is sent until they press
 * the button, and the UI says what is about to leave the device before they do.
 */

import type { ChatMessage } from './adapters';

/** Cap on what we will render, so one very long model reply cannot wreck the page. */
const MAX_SUMMARY_CHARS = 900;

/** Truncates and tells the user it did, rather than silently clipping. */
function clamp(text: string, max: number): { text: string; truncated: boolean } {
	const trimmed = text.trim();
	if (trimmed.length <= max) return { text: trimmed, truncated: false };
	return { text: `${trimmed.slice(0, max - 1).trimEnd()}…`, truncated: true };
}

/**
 * Pull a JSON value out of a model reply.
 *
 * Handles the three shapes models actually produce: pure JSON, JSON in a ``` fence, and
 * JSON with a sentence of preamble. Falls back to the outermost brace/bracket span
 * rather than a regex, because a regex over model output is a coin flip.
 */
export function parseModelJson<T = unknown>(raw: string): T | null {
	let text = raw.trim();

	// ```json ... ``` or ``` ... ```
	const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
	if (fence) text = fence[1].trim();

	const attempt = (candidate: string): T | null => {
		try {
			return JSON.parse(candidate) as T;
		} catch {
			return null;
		}
	};

	const direct = attempt(text);
	if (direct !== null) return direct;

	// Outermost span. Scan for the first opener and match its closing counterpart,
	// tracking depth and string state so a brace inside a quoted string does not end
	// the span early.
	for (const [open, close] of [
		['{', '}'],
		['[', ']']
	] as const) {
		const start = text.indexOf(open);
		if (start === -1) continue;
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let i = start; i < text.length; i++) {
			const ch = text[i];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === '\\') {
				escaped = true;
				continue;
			}
			if (ch === '"') {
				inString = !inString;
				continue;
			}
			if (inString) continue;
			if (ch === open) depth++;
			else if (ch === close) {
				depth--;
				if (depth === 0) {
					const parsed = attempt(text.slice(start, i + 1));
					if (parsed !== null) return parsed;
					break;
				}
			}
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// SUMMARISATION
// ---------------------------------------------------------------------------

export type IdeaForSummary = {
	title: string;
	problem?: string;
	audience?: string;
	outcome?: string;
	trigger?: string;
	preview?: string;
	tags: string[];
};

/**
 * Only fields the user actually filled in.
 *
 * Sending empty strings would both waste tokens and imply an emptiness that is not
 * there. `trigger` and `tags` are included because they change the meaning of a summary
 * more than most people expect - "why now" is not the same question as "what is it".
 */
export function summariseMessages(idea: IdeaForSummary): ChatMessage[] {
	const facts: string[] = [`Title: ${idea.title}`];
	if (idea.problem?.trim()) facts.push(`Problem it solves: ${idea.problem.trim()}`);
	if (idea.audience?.trim()) facts.push(`Who it is for: ${idea.audience.trim()}`);
	if (idea.outcome?.trim()) facts.push(`Intended outcome: ${idea.outcome.trim()}`);
	if (idea.trigger?.trim()) facts.push(`What prompted it: ${idea.trigger.trim()}`);
	if (idea.preview?.trim()) facts.push(`Notes: ${idea.preview.trim()}`);
	if (idea.tags.length) facts.push(`Tags: ${idea.tags.join(', ')}`);

	return [
		{
			role: 'system',
			content:
				'You summarise a personal idea backlog. Write two or three plain sentences: what problem this addresses, who it is for, and what "done" would look like. Use the facts given and nothing else. If a fact is missing, say so plainly rather than inventing it. No preamble, no bullet points, no heading, no quotation marks.'
		},
		{ role: 'user', content: facts.join('\n') }
	];
}

export type SummaryResult = { summary: string; truncated: boolean } | null;

/** Validate a summary: prose is fine, but not markup pretending to be prose. */
export function parseSummary(raw: string): SummaryResult {
	const cleaned = raw
		.trim()
		// A model that wraps its answer in a fence has not failed; it has formatted.
		.replace(/^```[a-z]*\s*([\s\S]*?)\s*```$/i, '$1')
		// Strip a leading label like "Summary:" - a heading is not part of the answer.
		.replace(/^(summary|tl;dr)\s*:\s*/i, '')
		.trim();

	if (!cleaned) return null;
	// Refuse output that is obviously not prose we asked for.
	if (/^\s*[[{<]/.test(cleaned)) return null;
	// Mapped rather than returned: `clamp` is generic and says `text`, while the caller
	// of a summary should never have to remember which is which.
	const { text, truncated } = clamp(cleaned, MAX_SUMMARY_CHARS);
	return { summary: text, truncated };
}

// ---------------------------------------------------------------------------
// DUPLICATE DETECTION
// ---------------------------------------------------------------------------

export type CandidateForDuplicates = {
	id: string;
	title: string;
	preview?: string;
	tags: string[];
};

export type DuplicatePair = {
	id: string;
	title: string;
	confidence: 'high' | 'medium' | 'low';
	reason: string;
};

/**
 * Judge a SHORTLIST, never the whole lot.
 *
 * Two reasons, both learned the hard way:
 *
 * 1. Comparing every pair is O(n²) in tokens. A personal lot of 400 ideas is 79,800
 *    pairs - unaffordable even on the user's own card, and slow enough to abandon.
 * 2. Retrieval is not judgement. A deterministic lexical pass proposes candidates the
 *    user has never agreed are close; sending those to a model for a verdict is
 *    correct, and sending everything is not.
 *
 * The prompt is explicit that tags are weak evidence, because sharing `#handover` is the
 * single most reliable way to invent a false duplicate.
 */
export function duplicateMessages(target: IdeaForSummary, candidates: CandidateForDuplicates[]): ChatMessage[] {
	const others = candidates
		.map((c) => `- id=${c.id} | title="${c.title}"${c.tags.length ? ` | tags=${c.tags.join(',')}` : ''}${c.preview?.trim() ? ` | notes="${c.preview.trim().slice(0, 240)}"` : ''}`)
		.join('\n');

	return [
		{
			role: 'system',
			content:
				'You judge whether a new idea duplicates any of a shortlist of existing ideas. Reply with JSON only: {"matches":[{"id":"...","confidence":"high|medium|low","reason":"..."}]}. Use confidence "high" only when the two propose essentially the same action. Shared tags are WEAK evidence - two different incidents can both be tagged "handover" - so never report a match on tags alone. Same topic but a different action is NOT a duplicate. Return {"matches":[]} when none. Reason in under 15 words.'
		},
		{
			role: 'user',
			content: `NEW IDEA\nTitle: ${target.title}${target.problem?.trim() ? `\nProblem: ${target.problem.trim()}` : ''}${target.outcome?.trim() ? `\nOutcome: ${target.outcome.trim()}` : ''}\n\nEXISTING IDEAS\n${others}`
		}
	];
}

/**
 * Validate model-reported duplicates against the shortlist.
 *
 * The `id` MUST come back in the candidate set. Without that check a model can invent an
 * id and the UI would link to an idea that does not exist, or - worse - to one the user
 * cannot see.
 */
export function parseDuplicatePairs(raw: string, allowedIds: Set<string>): DuplicatePair[] {
	const parsed = parseModelJson<{ matches?: unknown }>(raw);
	if (!parsed || !Array.isArray(parsed.matches)) return [];

	const out: DuplicatePair[] = [];
	const seen = new Set<string>();

	for (const entry of parsed.matches) {
		if (!entry || typeof entry !== 'object') continue;
		const { id, title, confidence, reason } = entry as Record<string, unknown>;

		if (typeof id !== 'string' || !allowedIds.has(id)) continue;
		if (seen.has(id)) continue;
		seen.add(id);

		const level =
			confidence === 'high' || confidence === 'medium' || confidence === 'low' ? confidence : 'low';

		// A model can put instructions or markup in the reason field. Cap it, and drop
		// it entirely if it is not usable text.
		const reasonText =
			typeof reason === 'string' && reason.trim()
				? clamp(reason.replace(/<[^>]*>/g, '').trim(), 200).text
				: 'Flagged as a possible duplicate';

		out.push({
			id,
			title: typeof title === 'string' && title.trim() ? clamp(title, 160).text : id,
			confidence: level,
			reason: reasonText
		});
	}
	return out;
}