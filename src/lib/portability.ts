/**
 * Getting ideas out of ThinkLot, and getting them back in.
 *
 * Two directions, both pure and offline, so both clients share one implementation and
 * neither can drift from the other.
 *
 * ## What an export MUST be
 *
 * **A real backup is lossless.** A JSON export that omits archived ideas, or drops the
 * dictated transcript, or forgets the checklist, is not a backup - it is a summary that
 * gives someone false confidence. Someone who trusts it and then loses an idea has been
 * worse off than if no export existed. So the JSON carries every field and says what
 * version produced it, and `ideas:exportAll` returns archived rows too.
 *
 * **Notion-pasteable Markdown is the founder's actual workflow**, so that is the default
 * format, not an afterthought. It is written to paste cleanly: real headings, real
 * checklists, no HTML, no code fences around the whole thing.
 *
 * ## What an import MUST be
 *
 * **Refuse to guess destructively.** Markdown and CSV from Notion, Obsidian and Apple
 * Notes all look similar but differ in where the title lives and whether tags are real.
 * Parsing is tolerant; anything ambiguous is dropped with a reason rather than imported
 * as something the user did not say. An import that silently invents structure is worse
 * than one that refuses and explains.
 *
 * **Duplicates are the user's call.** Re-importing the same file twice must not silently
 * double the lot, but skipping a genuinely new idea that happens to share a title is
 * data loss. So near-matches are REPORTED for review, not auto-decided.
 */

import type { IdeaStatus } from './types';

/** What an export/import cycle needs to know about one idea. */
export type PortableIdea = {
	_id: string;
	seq: number;
	title: string;
	status: IdeaStatus;
	tags: string[];
	impact?: number;
	effort?: number;
	confidence?: number;
	favorite: boolean;
	archived: boolean;
	description?: string;
	problem?: string;
	audience?: string;
	outcome?: string;
	trigger?: string;
	/** Kept verbatim: a dictated idea's original wording is not reproducible. */
	transcript?: string;
	revisitAt?: number;
	createdAt: number;
	updatedAt: number;
	/** How the text arrived. Kept so a backup can tell dictated from typed. */
	source?: string;
	/** When the user let it go, and why. The reason is the point of the field. */
	letGoAt?: number;
	letGoReason?: string;
	/** Checklist rows, because an export that forgets them is not a backup. */
	tasks?: { title: string; completed: boolean }[];
};

export const EXPORT_FORMAT_VERSION = 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoOrBlank(ms: number | undefined): string {
	if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
	return new Date(ms).toISOString();
}

function score(idea: PortableIdea): string {
	if (typeof idea.impact !== 'number' || typeof idea.effort !== 'number' || typeof idea.confidence !== 'number') {
		return '';
	}
	if (idea.effort <= 0) return '';
	// Mirrors scoring.ts, and rounds the same way.
	return String(Math.round(((idea.impact * idea.confidence) / idea.effort) * 10));
}

// ---------------------------------------------------------------------------
// MARKDOWN - the Notion paste target
// ---------------------------------------------------------------------------

/**
 * One idea as Markdown.
 *
 * Heading levels step down for nested ideas so a paste into Notion produces a readable
 * outline rather than a wall of H1s.
 *
 * `**Problem**` rather than `## Problem` for the inner fields: inside a Notion page a
 * second-level heading for "Problem" would sit above the notes text visually, and the
 * label needs to read as a field, not a section.
 */
function ideaToMarkdown(idea: PortableIdea, depth: number): string {
	const h = Math.min(Math.max(depth, 1), 6);
	const lines: string[] = [];

	const plate = typeof idea.seq === 'number' ? `LOT-${String(idea.seq).padStart(4, '0')}` : '';
	lines.push(`${'#'.repeat(h)} ${idea.title}${plate ? `  ·  ${plate}` : ''}`);
	lines.push('');

	// Status, in plain words. Archived and completed are called out because someone
	// pasting this into a planning doc needs to know which of these is already done.
	const facts: string[] = [`Status: ${idea.status}`];
	if (idea.archived) facts.push('Archived');
	if (idea.favorite) facts.push('Favourite');
	const value = score(idea);
	if (value) facts.push(`Priority: ${value}`);
	if (idea.tags.length) facts.push(`Tags: ${idea.tags.map((t) => `#${t}`).join(' ')}`);
	lines.push(facts.join(' · '));
	lines.push('');

	const field = (label: string, text: string | undefined) => {
		if (!text?.trim()) return;
		lines.push(`**${label}:** ${text.trim()}`);
		lines.push('');
	};

	field('Problem', idea.problem);
	field('Audience', idea.audience);
	field('Outcome', idea.outcome);
	field('Trigger', idea.trigger);
	field('Notes', idea.description);

	if (idea.transcript) {
		// Quoted, because this is verbatim speech and should not read as the user's own
		// considered prose when it lands in another tool.
		lines.push('> **Verbatim dictation**');
		for (const line of idea.transcript.split('\n')) lines.push(`> ${line}`);
		lines.push('');
	}

	if (idea.tasks?.length) {
		lines.push('**Checklist**');
		lines.push('');
		for (const task of idea.tasks) lines.push(`- [${task.completed ? 'x' : ' '}] ${task.title}`);
		lines.push('');
	}

	const stamp = isoOrBlank(idea.createdAt);
	if (stamp) {
		lines.push(`<sub>Captured ${stamp.slice(0, 10)}${idea.updatedAt > idea.createdAt ? ` · updated ${isoOrBlank(idea.updatedAt).slice(0, 10)}` : ''}</sub>`);
		lines.push('');
	}

	return lines.join('\n');
}

/**
 * The whole lot as one Markdown document.
 *
 * Newest idea last, so a pasted outline reads chronologically and the most recent
 * thought ends up where the reader's eye finishes. Grouped under a single H1.
 */
export function toNotionMarkdown(ideas: PortableIdea[], exportedAt = Date.now()): string {
	const parts: string[] = [
		'# ThinkLot',
		'',
		`<sub>${ideas.length} idea${ideas.length === 1 ? '' : 's'} · exported ${isoOrBlank(exportedAt).slice(0, 10)}</sub>`,
		''
	];

	// Archived last, under their own heading, so a working document stays readable.
	const active = ideas.filter((i) => !i.archived).sort((a, b) => a.seq - b.seq);
	const archived = ideas.filter((i) => i.archived).sort((a, b) => a.seq - b.seq);

	for (const idea of active) parts.push(ideaToMarkdown(idea, 2));

	if (archived.length > 0) {
		parts.push('---');
		parts.push('');
		parts.push('## Archived');
		parts.push('');
		for (const idea of archived) parts.push(ideaToMarkdown(idea, 3));
	}

	return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

// ---------------------------------------------------------------------------
// CSV - for spreadsheets, and a format every import understands
// ---------------------------------------------------------------------------

/** RFC 4180: quote when the value contains a quote, comma or newline; double quotes. */
/**
 * Tags in a CSV cell, joined so a tag containing a comma or space survives.
 *
 * The naive `tags.join(' ')` cannot round-trip: the tag `c,d` reads back as two tags.
 * Semicolon-joined and re-split on `;` only fixes commas; a space inside a tag still
 * breaks. So tags are JSON-encoded into the cell, and `parseCsvImport` tries JSON first
 * and falls back to separator-splitting for the plain `a b c` a human would type.
 *
 * The cost is a cell that reads as `["a b","c,d"]` in a spreadsheet. That is a far
 * smaller price than an export that silently mangles a tag on every round trip, and a
 * user reading tags in a CSV is reading a machine-generated backup anyway.
 */
function csvTags(tags: string[]): string {
	return JSON.stringify(tags);
}

/** Read a tags cell: JSON if it parses, otherwise split on whitespace and commas. */
function readTags(raw: string): string[] {
	const trimmed = raw.trim();
	if (!trimmed) return [];

	if (trimmed.startsWith('[')) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			if (Array.isArray(parsed)) {
				return parsed
					.filter((t): t is string => typeof t === 'string')
					.map((t) => t.trim().replace(/^#/, '').toLowerCase())
					.filter(Boolean);
			}
		} catch {
			// Not JSON after all - fall through to the human-typed form.
		}
	}
	return trimmed
		.split(/[\s,;]+/)
		.map((t) => t.replace(/^#/, '').toLowerCase())
		.filter(Boolean);
}

function csvCell(value: unknown): string {
	if (value === undefined || value === null) return '';
	const text = String(value);
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(ideas: PortableIdea[]): string {
	const columns = [
		'seq', 'title', 'status', 'archived', 'favorite', 'impact', 'effort', 'confidence',
		'tags', 'problem', 'audience', 'outcome', 'trigger', 'description', 'transcript',
		'tasks', 'createdAt', 'updatedAt'
	] as const;

	const rows = [columns.join(',')];
	for (const idea of [...ideas].sort((a, b) => a.seq - b.seq)) {
		rows.push(
			columns
				.map((column) => {
					switch (column) {
						case 'tags':
							return csvCell(csvTags(idea.tags));
						case 'tasks':
							return csvCell((idea.tasks ?? []).map((t) => `${t.completed ? 'x' : ' '}:${t.title}`).join('; '));
						case 'createdAt':
						case 'updatedAt':
							return csvCell(isoOrBlank(idea[column]));
						default:
							return csvCell(idea[column]);
					}
				})
				.join(',')
		);
	}
	// Trailing newline: some tools silently drop the last row without it.
	return `${rows.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------
// JSON - the lossless backup
// ---------------------------------------------------------------------------

/**
 * A backup, not a summary.
 *
 * Every field, plus a version. A future reader can tell what produced it, which is what
 * makes a backup worth keeping: an export whose format silently changes is a backup you
 * cannot restore from.
 */
export function toBackupJson(ideas: PortableIdea[], exportedAt = Date.now()): string {
	return JSON.stringify(
		{
			format: 'thinklot-export',
			version: EXPORT_FORMAT_VERSION,
			exportedAt,
			ideaCount: ideas.length,
			ideas
		},
		null,
		2
	);
}

/** Filenames sort chronologically and never contain characters a filesystem rejects. */
export function exportFilename(kind: 'markdown' | 'csv' | 'json', at = Date.now()): string {
	const extension = kind === 'markdown' ? 'md' : kind;
	const stamp = isoOrBlank(at).slice(0, 10) || 'export';
	return `thinklot-${stamp}.${extension}`;
}

/**
 * A backup, back into the shape the import endpoint accepts.
 *
 * ## Why this exists
 *
 * Exported and imported are DIFFERENT contracts, and the gap was invisible until
 * someone tried the obvious thing: export your lot, then import that file again. It
 * fails with `Object contains extra field "_id" that is not in the validator`, because
 * the export is a full document - `_id`, `seq`, `status`, `tasks`, `favorite`,
 * `createdAt` - and the import endpoint accepts a writing form. Both clients had their
 * own copy of the mapping and neither projected.
 *
 * So the mapping lives here, once, and both clients use it. The two responsibilities:
 *
 * 1. **Drop every field the import does not accept.** Not `_id`, not `seq`, not
 *    `status`, not `tasks`. Sending an `_id` would also be asking the server to reuse
 *    an id from a different account, which is meaningless.
 * 2. **Preserve the fields the import endpoint restores** - including `letGoAt` and
 *    `letGoReason`, which is how a restored idea keeps the reason that made it
 *    archived, while a foreign import cannot invent one.
 *
 * Returns `null` for an entry that is not a backup of a known shape, so a caller can
 * report it rather than silently dropping a whole idea.
 */
export function backupToImportEntry(idea: PortableIdea): ImportCandidate | null {
	const title = typeof idea.title === 'string' ? idea.title.trim() : '';
	if (!title) return null;

	return {
		title: title.slice(0, 300),
		...(idea.description ? { description: String(idea.description) } : {}),
		...(idea.problem ? { problem: String(idea.problem) } : {}),
		...(idea.audience ? { audience: String(idea.audience) } : {}),
		...(idea.outcome ? { outcome: String(idea.outcome) } : {}),
		...(idea.trigger ? { trigger: String(idea.trigger) } : {}),
		...(idea.transcript ? { transcript: String(idea.transcript) } : {}),
		...(Array.isArray(idea.tags) ? { tags: idea.tags.map(String) } : { tags: [] }),
		/**
		 * The abandonment decision, carried as data rather than re-derived.
		 *
		 * `_id`/`seq`/`status`/`tasks` are deliberately absent: the server re-issues a
		 * plate and re-derives the status, and an import must not re-use a foreign id.
		 */
		...(typeof idea.letGoAt === 'number' && idea.letGoAt > 0
			? {
					letGoAt: idea.letGoAt,
					...(idea.letGoReason ? { letGoReason: String(idea.letGoReason) } : {})
				}
			: {}),
		...(typeof idea.revisitAt === 'number' && idea.revisitAt > 0 ? { revisitAt: idea.revisitAt } : {})
	};
}

// ---------------------------------------------------------------------------
// IMPORT
// ---------------------------------------------------------------------------

export type ImportCandidate = {
	title: string;
	description?: string;
	problem?: string;
	audience?: string;
	outcome?: string;
	trigger?: string;
	tags: string[];
	/** Kept so a dictated import can be re-parsed rather than flattened. */
	transcript?: string;
	/**
	 * Fields a BACKUP restores, which a foreign import never carries. They are what
	 * lets a restored idea keep its abandonment reason while an import of 300 Obsidian
	 * notes cannot invent one.
	 */
	revisitAt?: number;
	letGoAt?: number;
	letGoReason?: string;
};

export type ImportResult = {
	candidates: ImportCandidate[];
	/** Entries that could not be read, with why. Never silently dropped. */
	skipped: { source: string; reason: string }[];
};

/**
 * A Markdown file becomes one candidate per H1/H2/H3.
 *
 * Both levels are treated as idea boundaries on purpose: an Obsidian note per idea is
 * common, but so is a single notebook with one `##` per idea, and guessing one shape
 * would discard half of a real export.
 *
 * Frontmatter and Obsidian `#tags` are read as tags because both are cheap and both are
 * real. YAML block bodies are preserved as the description rather than dropped - they
 * are frequently where a person's actual thinking sits.
 */
export function parseMarkdownImport(raw: string): ImportResult {
	const candidates: ImportCandidate[] = [];
	const skipped: ImportResult['skipped'] = [];

	const lines = raw.replace(/\r\n/g, '\n').split('\n');
	let current: { title: string; body: string[]; level: number } | null = null;
	let inFence = false;

	/**
	 * Leading YAML frontmatter, held aside and given to the FIRST idea.
	 *
	 * An Obsidian note is `---` / `tags: [...]` / `---` and only THEN the `# heading`,
	 * which is the shape every Obsidian vault uses. The first version of this parser
	 * discarded those lines outright, because nothing had been seen yet and lines
	 * outside an idea are dropped - so frontmatter tags and the `title:` key were
	 * silently missing from every imported note while the import reported success.
	 *
	 * Attaching it to the first idea is right rather than merely convenient: frontmatter
	 * describes the file, and a file whose body is one heading is one idea.
	 */
	const frontmatter: string[] = [];
	let sawFrontmatter = false;
	let closingFence = false;
	for (let i = 0; i < lines.length; i++) {
		if (i === 0 && /^---\s*$/.test(lines[i])) {
			sawFrontmatter = true;
			closingFence = false;
			continue;
		}
		if (sawFrontmatter && !closingFence) {
			if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
				closingFence = true;
				continue;
			}
			frontmatter.push(lines[i]);
			continue;
		}
		break;
	}
	if (!closingFence) frontmatter.length = 0; // an unterminated block is not frontmatter

	const flush = () => {
		if (!current) return;
		const body = frontmatter.length && candidates.length === 0 ? [...frontmatter, ...current.body] : current.body;
		const raw = body.join('\n');

		/*
		 * A document heading is not an idea.
		 *
		 * Re-importing this app's own export produced a phantom idea called "ThinkLot",
		 * because the document title is an H1 and both H1 and H2 are idea boundaries. What
		 * separates a container from an idea is that a container has nothing but
		 * FORMATTING under it - the provenance stamp, a rule - so stripping the formatting
		 * leaves nothing.
		 *
		 * Tested HERE rather than inside `parseIdeaBody`, which cannot tell: it sees a
		 * perfectly good non-empty title and returns a candidate. And deliberately not
		 * recorded as skipped, because the user did nothing wrong and a report naming
		 * their own document title as unreadable would be pure noise.
		 */
		if (current.level === 1 && !stripFormatting(raw)) {
			current = null;
			return;
		}

		const parsed = parseIdeaBody(current.title, raw);
		if (!parsed) {
			if (current.level !== 1) skipped.push({ source: current.title, reason: 'no readable title' });
		} else {
			candidates.push(parsed);
		}
		current = null;
	};

	for (const line of lines) {
		// Code fences are preserved verbatim, because a fenced block inside an idea is
		// content and must not be scanned for headings.
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			if (current) current.body.push(line);
			continue;
		}

		const heading = inFence ? null : /^(#{1,3})\s+(.*\S)\s*$/.exec(line);
		if (heading) {
			flush();
			current = { title: heading[2].trim(), body: [], level: heading[1].length };
			continue;
		}
		if (current) current.body.push(line);
	}
	flush();

	// The emptiness check has to be OUTSIDE the `raw.trim()` guard it used to sit
	// inside, where it was unreachable: a genuinely empty file failed the guard, so the
	// "it is empty" explanation could never be produced and the import reported nothing
	// at all. A user who picked the wrong file deserves to be told so.
	if (!raw.trim()) {
		return { candidates, skipped: [{ source: 'the file', reason: 'it is empty' }] };
	}

	if (candidates.length === 0) {
		// No headings at all: the whole file is one idea, provided it has a first line.
		// A plain-text dump from Apple Notes or a voice-memo transcript lands here.
		const firstLine = raw.split('\n').find((line) => line.trim().length > 0);
		if (firstLine) {
			const parsed = parseIdeaBody(firstLine.trim().slice(0, 300), raw);
			if (parsed) candidates.push(parsed);
			else skipped.push({ source: firstLine.trim().slice(0, 60), reason: 'no readable title' });
		}
	}

	return { candidates, skipped };
}

/**
 * Remove document FORMATTING, leaving whatever is actual content.
 *
 * Shared by the container check and `parseIdeaBody` so the two cannot disagree about
 * what counts as content - which is exactly how a heading came to look like an idea
 * with a body when the two had separate rules.
 */
function stripFormatting(text: string): string {
	return text
		.replace(/^[ \t]*<sub>[\s\S]*?<\/sub>[ \t]*$/gm, '')
		.replace(/^[ \t]*---[ \t]*$/gm, '')
		.trim();
}

/**
 * Pull the fields out of one idea's body.
 *
 * `**Problem:** x` and `Problem: x` are both accepted, because both appear in real
 * exports. A blank value is treated as absent rather than stored as an empty string,
 * which is what keeps "no answer" distinguishable from "the answer is empty".
 */
function parseIdeaBody(title: string, body: string): ImportCandidate | null {
	const cleanTitle = title
		// A Notion export puts the plate or a status marker on the title line.
		.replace(/\s*[|·]\s*LOT-\d{4}\s*$/i, '')
		.trim();
	if (!cleanTitle) return null;

	let description = body;
	const tags = new Set<string>();
	const fields: Record<string, string> = {};

	const lines = body.split('\n');
	const kept: string[] = [];

	for (const line of lines) {
		// Obsidian inline tags.
		for (const match of line.matchAll(/(?:^|\s)#([A-Za-z][\w/-]*)/g)) {
			tags.add(match[1].toLowerCase());
		}

		// Frontmatter key: value, optionally bolded, and optionally in a list item.
		//
		// Three small exact patterns rather than one clever one, after two clever ones
		// failed on the same subtlety. **Problem:** value puts the colon INSIDE the bold
		// run, so the marker closes after the colon - and no 'optional marker before the
		// colon' pattern can match it. Allowing the closing run to match zero characters
		// then silently ate half the asterisks, leaving '** Empty slots cost money' as
		// the value. Each of these is individually obvious, which is the point.
		const cleanLine = line.replace(/^\s*(?:[-*]\s+)?/, '').trim();
		// Both `**Problem:** value` and `**Problem**: value` occur in real exports - Notion
		// writes the first, plenty of hand-written Markdown uses the second. Verified
		// against what the exporter actually emits rather than assumed, after a pattern
		// written for only one of them matched nothing at all.
		// The label must be read as a WHOLE WORD with an exact boundary. `\s*(?::|：)` allowed
		// the pattern to match `**Problems:** value` as label `problem` plus the leftover
		// `s`, which is not a field this app has - so a valid file silently imported with
		// the field dropped.
		const boldMatch =
			/^\*\*\s*(problem|audience|outcome|trigger|description|notes|summary)\b\s*(?::|：)\s*\*+\s*(.+?)\s*\*?$/i.exec(
				cleanLine
			);
		if (boldMatch && boldMatch[2].trim()) {
			fields[boldMatch[1].toLowerCase()] = boldMatch[2].trim();
			continue;
		}

		// __Problem:__ value is the same thing in underscores, and appears in HTML-flavoured
		// exports.
		const underscoreMatch = /^__\s*(problem|audience|outcome|trigger|description|notes|summary)\b\s*(?::|：)\s*__\s*(.+?)\s*$/i.exec(cleanLine);
		if (underscoreMatch && underscoreMatch[2].trim()) {
			fields[underscoreMatch[1].toLowerCase()] = underscoreMatch[2].trim();
			continue;
		}

		// Plain Problem: value, and the list-item form - Problem: value.
		const plainMatch = /^(problem|audience|outcome|trigger|description|notes|summary)\b\s*(?::|：)\s*(.+?)\s*$/i.exec(cleanLine);
		if (plainMatch && plainMatch[2].trim()) {
			fields[plainMatch[1].toLowerCase()] = plainMatch[2].trim();
			continue;
		}

		// Frontmatter tags: [a, b] or a: [a, b]
		const tagList = /^\s*tags?\b\s*[:：]\s*\[(.*)\]\s*$/i.exec(line);
		if (tagList) {
			for (const tag of tagList[1].split(',')) {
				const value = tag.trim().replace(/^["']|["']$/g, '');
				if (value) tags.add(value.toLowerCase());
			}
			continue;
		}

		kept.push(line);
	}

	// The provenance stamp and the --- rule are FORMATTING, not idea content, so they
	// Formatting removed by the SAME helper the container check uses, so the two cannot
	// disagree about what counts as content - which is exactly how a heading came to look
	// like an idea with a body when the two had separate rules.
	description = stripFormatting(kept.join('\n'));

	return {
		title: cleanTitle.slice(0, 300),
		...(description ? { description: description.slice(0, 20_000) } : {}),
		...(fields.problem ? { problem: fields.problem } : {}),
		...(fields.audience ? { audience: fields.audience } : {}),
		...(fields.outcome ? { outcome: fields.outcome } : {}),
		...(fields.trigger ? { trigger: fields.trigger } : {}),
		// A file that is nothing but the three core answers has them in fields; keep the
		// body too when it says something different.
		...(fields.notes || fields.summary
			? { description: (fields.notes ?? fields.summary ?? '').slice(0, 20_000) || description }
			: {}),
		tags: [...tags]
	};
}

/**
 * CSV to candidates.
 *
 * Minimal and deliberate: a real RFC 4180 parse, header-driven, no type coercion beyond
 * the numbers the app actually uses. A column this app does not know about is ignored
 * rather than mapped to a field it does not own.
 */
export function parseCsvImport(raw: string): ImportResult {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;

	for (let i = 0; i < raw.length; i++) {
		const char = raw[i];
		if (quoted) {
			if (char === '"') {
				if (raw[i + 1] === '"') {
					cell += '"';
					i++;
				} else quoted = false;
			} else cell += char;
			continue;
		}
		if (char === '"') quoted = true;
		else if (char === ',') {
			row.push(cell);
			cell = '';
		} else if (char === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else if (char !== '\r') cell += char;
	}
	if (cell || row.length) {
		row.push(cell);
		rows.push(row);
	}

	const skipped: ImportResult['skipped'] = [];
	if (rows.length === 0) return { candidates: [], skipped: [{ source: 'the file', reason: 'it is empty' }] };

	const header = rows[0].map((h) => h.trim().toLowerCase());
	if (!header.includes('title')) {
		return {
			candidates: [],
			skipped: [{ source: 'the header row', reason: 'there is no "title" column, so there is nothing to import' }]
		};
	}

	const index = (name: string) => header.indexOf(name);
	const candidates: ImportCandidate[] = [];

	for (let r = 1; r < rows.length; r++) {
		const values = rows[r];
		const title = (values[index('title')] ?? '').trim();
		if (!title) continue;

		const tagsRaw = values[index('tags')] ?? '';
		const candidates2 = {
			title: title.slice(0, 300),
			...(index('description') >= 0 && values[index('description')]?.trim()
				? { description: values[index('description')].trim() }
				: {}),
			...(index('problem') >= 0 && values[index('problem')]?.trim() ? { problem: values[index('problem')].trim() } : {}),
			...(index('audience') >= 0 && values[index('audience')]?.trim() ? { audience: values[index('audience')].trim() } : {}),
			...(index('outcome') >= 0 && values[index('outcome')]?.trim() ? { outcome: values[index('outcome')].trim() } : {}),
			...(index('trigger') >= 0 && values[index('trigger')]?.trim() ? { trigger: values[index('trigger')].trim() } : {}),
			...(index('transcript') >= 0 && values[index('transcript')]?.trim() ? { transcript: values[index('transcript')].trim() } : {}),
			tags: readTags(tagsRaw)
		};
		candidates.push(candidates2);
	}

	return { candidates, skipped };
}

/**
 * Which imports would duplicate something already in the lot.
 *
 * REPORTED, never auto-skipped. A genuine near-match that the user meant to import twice
 * is rare; an idea whose title collides with an existing one and was skipped without
 * asking is a silent loss. The user decides, which is why this returns candidates rather
 * than a filtered list.
 */
export type DuplicateCheck = {
	candidate: ImportCandidate;
	/** An existing idea the candidate resembles, if any. */
	matchesExisting: { id: string; title: string }[];
};

export function findImportDuplicates(candidates: ImportCandidate[], existing: { _id: string; title: string }[]): DuplicateCheck[] {
	const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
	const byTitle = new Map<string, { id: string; title: string }[]>();
	for (const idea of existing) {
		const key = normalise(idea.title);
		const list = byTitle.get(key);
		if (list) list.push({ id: idea._id, title: idea.title });
		else byTitle.set(key, [{ id: idea._id, title: idea.title }]);
	}

	return candidates.map((candidate) => ({
		candidate,
		matchesExisting: byTitle.get(normalise(candidate.title)) ?? []
	}));
}

/** Split a parsed file into the ones the user should look at and the ones to add. */
export function partitionForImport(checks: DuplicateCheck[]): { fresh: ImportCandidate[]; duplicates: DuplicateCheck[] } {
	const fresh: ImportCandidate[] = [];
	const duplicates: DuplicateCheck[] = [];
	for (const check of checks) {
		if (check.matchesExisting.length > 0) duplicates.push(check);
		else fresh.push(check.candidate);
	}
	return { fresh, duplicates };
}
