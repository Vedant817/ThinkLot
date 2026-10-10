/**
 * Getting ideas IN from the tools a product manager actually uses.
 *
 * ## The persona
 *
 * Not someone with one notes app. Someone whose thinking is scattered across Jira,
 * Linear, Trello, Notion, Obsidian, Todoist, Slack and email - who captures a thought
 * wherever they happen to be standing, and cannot tell you which of those places a given
 * idea is in. For them, import is not a backup feature; it is the primary reason to
 * install this app at all.
 *
 * ## Why column-name-driven, never position-driven
 *
 * I read the docs before writing this and the docs told me not to hard-code: Jira's
 * "all fields" export is around 200 columns whose order and membership depend on site
 * configuration and which boxes the user ticked. A parser that expects column 3 to be
 * `Summary` produces 400 confidently imported rows where the titles are timestamps and
 * the notes are empty - and nobody notices until they have lost an afternoon.
 *
 * So: every parser matches on COLUMN NAME with a tolerant alias table, and every parser
 * REPORTS the columns it did not use. Silent omission is the one failure mode that makes
 * an import untrustworthy, and trust is the whole reason this module exists.
 *
 * ## What this deliberately does NOT do
 *
 * It does not sync. No OAuth against Jira, no live Linear feed, no background
 * reconciliation. The user exports a file and imports it. That is a real limitation for
 * someone who wants it automatic - but a one-way import that works today is worth more
 * than a sync needing credentials from six vendors and a decision about what happens
 * when the same ticket is decided differently in both places.
 */

import { parseMarkdownImport } from './portability';
import type { ImportCandidate } from './portability';

export type PmSourceId =
	| 'jira'
	| 'linear'
	| 'trello'
	| 'todoist'
	| 'notion'
	| 'obsidian'
	| 'confluence'
	| 'plain';

export type PmSource = {
	id: PmSourceId;
	label: string;
	/** What the user should export, in their words. */
	howTo: string;
	formats: ('csv' | 'json' | 'markdown')[];
};

export const PM_SOURCES: PmSource[] = [
	{ id: 'jira', label: 'Jira', howTo: 'Issues → Export Excel CSV. Any field selection — this reads by column name.', formats: ['csv'] },
	{ id: 'linear', label: 'Linear', howTo: 'A team or view → CSV export.', formats: ['csv'] },
	{ id: 'trello', label: 'Trello', howTo: 'Board menu → Print and Export → Export JSON.', formats: ['json'] },
	{ id: 'todoist', label: 'Todoist', howTo: 'Settings → Integrations → Export CSV.', formats: ['csv'] },
	{ id: 'notion', label: 'Notion', howTo: 'The page or database → Markdown / CSV export.', formats: ['markdown', 'csv'] },
	{ id: 'obsidian', label: 'Obsidian', howTo: 'Copy the vault folder out, or drag the .md files in.', formats: ['markdown'] },
	{ id: 'confluence', label: 'Confluence', howTo: 'Space → Space settings → Export → Markdown.', formats: ['markdown'] },
	{ id: 'plain', label: 'Anything else', howTo: 'A .md, .csv, .txt or .json file this app has not met before.', formats: ['markdown', 'csv', 'json'] }
];

// ---------------------------------------------------------------------------
// Field aliases
// ---------------------------------------------------------------------------

/**
 * Which source column fills which ThinkLot field.
 *
 * Deliberately wide: `Summary`, `Issue summary`, `Title`, `Name` and `Task` are the same
 * column in five different tools, and real exports carry the user's own custom label on
 * it. Extra aliases are harmless - a collision between two tools is resolved by source
 * detection first, and then by these lists in order.
 *
 * Order matters only within a field, where it is a specificity ranking: the canonical
 * name is first and wins over the aliases after it.
 *
 * Only the TEXT fields appear here. `letGoAt`, `letGoReason` and `revisitAt` are
 * restoration-only, filled from this app's own backup rather than from a foreign export -
 * so the type is narrowed rather than satisfied with empty lists that could never match.
 */
type AliasedField = Exclude<keyof ImportCandidate, 'letGoAt' | 'letGoReason' | 'revisitAt'>;

const ALIASES: Record<AliasedField, string[]> = {
	// Canonical first. `Summary` and `Title` are what the two biggest tools call it.
	title: [
		'summary', 'title', 'name', 'issue summary', 'issue', 'task', 'task name',
		'card', 'card name', 'item', 'headline', 'feature', 'idea', 'ticket',
		// Product-management columns carrying the same thing. A roadmap or bet tracker
		// calls its title column one of these, and missing them meant a real export
		// imported nothing at all.
		'initiative', 'bet', 'hypothesis', 'proposal', 'request', 'opportunity'
	],
	// Canonical first, same rule: a `Description` column must beat `body`.
	description: ['description', 'body', 'notes', 'note', 'content', 'details', 'task description'],
	problem: [
		'problem', 'the problem', 'pain point', 'why', 'why it matters', 'what is broken',
		'motivation', 'challenge', 'objective'
	],
	audience: ['audience', 'who it is for', 'customer', 'persona', 'user', 'users', 'team', 'stakeholder', 'owner', 'assignee', 'reporter', 'requester'],
	outcome: [
		'outcome', 'expected outcome', 'goal', 'acceptance criteria', 'success criteria',
		'result', 'definition of done', 'deliverable', 'done when', 'exit criteria'
	],
	trigger: ['trigger', 'origin', 'context', 'why now', 'where it came from', 'feedback', 'requested by'],
	tags: [
		'tags', 'labels', 'label', 'components', 'component', 'keywords', 'category',
		/*
		 * Only the user's OWN labels of the idea.
		 *
		 * `Sprint`, `Priority` and `Component` were all here once. A real Jira fixture
		 * proved it wrong: an export imported as `#2026-03-s1`, `#high` and `#clinic` -
		 * ticket metadata that is noise on an idea. Those columns are deliberately
		 * unmapped, which puts them in the report where the user can see the tool had
		 * them, rather than polluting the idea's tags.
		 *
		 * Verified against `scripts/verify-jira-fixture.ts`, which parses a real export.
		 */
		'epic', 'epic link', 'milestone', 'version', 'fix version', 'affects version'
	],
	transcript: []
};

// ---------------------------------------------------------------------------
// A tiny CSV reader (RFC 4180)
// ---------------------------------------------------------------------------

type CsvTable = {
	header: string[];
	/**
	 * Row values in header order, INDEXED rather than named.
	 *
	 * A real export has DUPLICATE column names: Jira's `Labels` repeats once per label
	 * on a multi-select field, and its docs say so. A record keyed by column name would
	 * keep only the last of the three, silently losing the others.
	 */
	rows: string[][];
};

function parseCsvTable(text: string): CsvTable {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = '';
	let quoted = false;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i++;
				} else quoted = false;
			} else cell += ch;
			continue;
		}
		if (ch === '"') quoted = true;
		else if (ch === ',') {
			row.push(cell);
			cell = '';
		} else if (ch === '\n') {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = '';
		} else if (ch !== '\r') cell += ch;
	}
	if (cell || row.length) {
		row.push(cell);
		rows.push(row);
	}
	if (rows.length === 0) return { header: [], rows: [] };
	return { header: rows[0].map((h) => h.trim()), rows: rows.slice(1) };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export type Detection = {
	source: PmSource;
	confidence: 'exact' | 'guess' | 'unknown';
	/** The columns that identified it. Shown to the user, so detection is checkable. */
	matched: string[];
	note?: string;
};

/** Columns that only one tool ships. */
const TELLS: Partial<Record<PmSourceId, string[]>> = {
	jira: ['issue key', 'issue type', 'resolved', 'resolution', 'story points'],
	linear: ['issue id', 'team', 'cycle', 'initiative', 'estimate'],
	trello: ['list', 'checklist'],
	todoist: ['type', 'priority']
};

function normaliseColumn(name: string): string {
	return name.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

function looksLikeCsv(text: string): boolean {
	const lines = text.split(/\r?\n/);
	return Boolean(lines[0]?.includes(',')) && lines.length >= 2 && lines.slice(1, 4).some((l) => l.includes(','));
}

export function detectSource(text: string, filename = ''): Detection {
	const byName = (id: PmSourceId) => PM_SOURCES.find((s) => s.id === id)!;
	const trimmed = text.trim();

	// A filename hint is weak but free, and `notion-export.md` is a real signal.
	const nameHint = PM_SOURCES.find((s) => filename.toLowerCase().includes(s.id));

	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			const json = JSON.parse(trimmed);
			const asRecord = json as Record<string, unknown>;
			if (Array.isArray(asRecord.cards) || Array.isArray(json)) return { source: byName('trello'), confidence: 'exact', matched: ['cards'] };
			if (Array.isArray(asRecord.ideas)) return { source: byName('plain'), confidence: 'exact', matched: ['ideas'], note: 'A ThinkLot backup.' };
		} catch {
			// A broken JSON file is still importable as text.
		}
		return { source: byName('plain'), confidence: 'unknown', matched: [], note: 'JSON, but not a shape this app knows.' };
	}

	if (!looksLikeCsv(trimmed)) {
		if (trimmed.startsWith('---')) return { source: byName('obsidian'), confidence: 'exact', matched: ['frontmatter'] };
		const headings = trimmed.split(/\r?\n/).filter((l) => /^#{1,3}\s+\S/.test(l)).length;
		if (headings > 0) {
			return {
				source: byName(nameHint?.id ?? 'notion'),
				confidence: 'guess',
				matched: [`${headings} headings`],
				note: 'Read as Markdown. Obsidian and Notion exports both look like this.'
			};
		}
		return { source: byName('plain'), confidence: 'guess', matched: [], note: 'No headings and no table, so this is read as a plain list of ideas.' };
	}

	const header = trimmed.split(/\r?\n/)[0].split(',').map(normaliseColumn);
	const headerSet = new Set(header);

	for (const [id, tells] of Object.entries(TELLS)) {
		const matched = (tells ?? []).filter((t) => headerSet.has(t));
		if (matched.length >= 2) return { source: byName(id as PmSourceId), confidence: 'exact', matched };
	}
	for (const [id, tells] of Object.entries(TELLS)) {
		const matched = (tells ?? []).filter((t) => headerSet.has(t));
		if (matched.length === 1) return { source: byName(id as PmSourceId), confidence: 'guess', matched };
	}
	return {
		source: byName('plain'),
		confidence: 'guess',
		matched: [],
		note: 'A CSV this app does not recognise. Any column named like a title is used; every other column is listed.'
	};
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type PmImport = {
	entries: ImportCandidate[];
	/**
	 * Columns that were not used, in header order and with their ORIGINAL casing -
	 * that is how the user recognises their own header row.
	 */
	unmappedColumns: string[];
	skipped: { source: string; reason: string }[];
};

/**
 * Which field a column fills, and how specific the match is. Lower rank is better.
 *
 * The rank exists because tools ship SEVERAL columns that map to the same field: Linear's
 * export carries both `Initiative` and `Title`. Without it, whichever came first in the
 * header won, and a Linear import produced `Reduce churn` as the title instead of `Cancel
 * waitlist`. Which column is "the" title is not a question about column position, and a
 * parser that treats it as one will be wrong whenever a tool ships two.
 *
 * Canonical names are ranked by their alias index, so `Summary` beats `Issue summary`
 * beats `Initiative`; the remaining fields have no such conflict and any match wins.
 */
function fieldFor(column: string): { field: keyof ImportCandidate; rank: number } | null {
	const norm = normaliseColumn(column);

	const exactTitle = ALIASES.title.indexOf(norm);
	if (exactTitle >= 0) return { field: 'title', rank: exactTitle };

	const exactDescription = ALIASES.description.indexOf(norm);
	if (exactDescription >= 0) return { field: 'description', rank: exactDescription };

	for (const [field, aliases] of Object.entries(ALIASES) as [keyof ImportCandidate, string[]][]) {
		if (field === 'title' || field === 'transcript' || field === 'description') continue;
		if (aliases.some((alias) => normaliseColumn(alias) === norm)) return { field, rank: 0 };
	}
	return null;
}

/**
 * Every unmapped column, in header order.
 *
 * Nothing is suppressed. The first version skipped the "known unmapped" ones, which made
 * the report permanently empty - so the importer recognised `Created` and `Resolution`,
 * understood they were real Jira columns, and then told the user nothing at all.
 */
function unmappedColumnsOf(table: CsvTable): string[] {
	const out: string[] = [];
	for (const column of table.header) {
		if (!column) continue;
		if (fieldFor(column)) continue;
		out.push(column);
	}
	return out;
}

/**
 * Import a table whose header names the fields.
 *
 * One fix, all tools: Jira, Linear, Todoist and Notion's CSV are all this, and their
 * differences are which columns they ship - which the alias table absorbs.
 */
function importTable(table: CsvTable): PmImport {
	if (table.header.length === 0) {
		return { entries: [], unmappedColumns: [], skipped: [{ source: 'the file', reason: 'no header row' }] };
	}

	const unmapped = unmappedColumnsOf(table);

	// Which column INDEX feeds which field, and how strongly. Several may feed one
	// field; the strongest wins, and the runner-ups still aggregate for tags.
	const mapping = new Map<number, { field: keyof ImportCandidate; rank: number }>();
	for (let index = 0; index < table.header.length; index++) {
		if (!table.header[index]) continue;
		const hit = fieldFor(table.header[index]);
		if (hit) mapping.set(index, hit);
	}

	if (![...mapping.values()].some((hit) => hit.field === 'title')) {
		return {
			entries: [],
			unmappedColumns: unmapped,
			skipped: [
				{
					source: 'the header row',
					reason: 'no column named like a title (Summary, Title, Name, Task). Nothing to import.'
				}
			]
		};
	}

	const entries: ImportCandidate[] = [];
	const skipped: PmImport['skipped'] = [];

	const strongest = strongestByField(mapping);
	for (const row of table.rows) {
		const values: Partial<Record<keyof ImportCandidate, string[]>> = {};
		for (const [index, hit] of mapping) {
			const value = (row[index] ?? '').trim();
			if (!value) continue;
			// Only the strongest alias decides a single-value field's value. Weaker ones still
		// contribute where a field accepts several, which is how Jira's repeated `Labels`
		// columns aggregate into several tags.
		if (hit.field !== 'tags' && strongest.get(hit.field) !== hit.rank) continue;
			const existing = values[hit.field];
			if (existing) existing.push(value);
			else values[hit.field] = [value];
		}

		const title = (values.title ?? [])[0];
		if (!title) {
			skipped.push({ source: 'a row', reason: 'no title' });
			continue;
		}

		entries.push({
			title: title.slice(0, 300),
			...(values.description ? { description: values.description.join('\n\n').slice(0, 20_000) } : {}),
			...(values.problem ? { problem: values.problem.join('\n\n') } : {}),
			...(values.audience ? { audience: values.audience.join(', ') } : {}),
			...(values.outcome ? { outcome: values.outcome.join('\n\n') } : {}),
			...(values.trigger ? { trigger: values.trigger.join(', ') } : {}),
			tags: dedupeTags(values.tags ?? [])
		});
	}

	return { entries, unmappedColumns: unmapped, skipped };
}

/**
 * The strongest alias for each field, so the runner-ups can be dropped.
 *
 * Applied per row rather than once, because the ranking is a property of the ALIAS, not
 * of the data - so it is computed once and cached.
 */
function strongestByField(
	mapping: Map<number, { field: keyof ImportCandidate; rank: number }>
): Map<keyof ImportCandidate, number> {
	const best = new Map<keyof ImportCandidate, number>();
	for (const hit of mapping.values()) {
		const current = best.get(hit.field);
		if (current === undefined || hit.rank < current) best.set(hit.field, hit.rank);
	}
	return best;
}

/**
 * Split a tag cell into tags.
 *
 * The separator is whatever the tool used and they differ: Jira writes `label1, label2`,
 * Obsidian writes `#tag #tag`, Todoist writes `label1,label2`. All are tried rather than
 * assumed, and `#` is stripped because it is Obsidian's syntax, not part of the tag.
 */
function dedupeTags(raw: string[]): string[] {
	const out = new Set<string>();
	for (const cell of raw) {
		const parts = cell.includes('#')
			? (cell.match(/[#＃]([^\s#,;]+)/g) ?? []).map((part) => part.slice(1))
			: cell.split(/[,;]+/).map((part) => part.trim());
		for (const part of parts) {
			const tag = part.trim().replace(/^[#＃]+/, '').toLowerCase();
			if (tag) out.add(tag);
		}
	}
	return [...out].slice(0, 30);
}

/**
 * Import any supported source, detected rather than declared.
 *
 * Never throws: a file it cannot read comes back with an empty list and a reason, so the
 * caller can say what went wrong rather than showing an empty screen with no
 * explanation.
 */
export function importFromPmSource(text: string, filename = ''): PmImport & { detection: Detection } {
	const detection = detectSource(text, filename);
	const trimmed = text.trim();

	if (!trimmed) {
		return { detection, entries: [], unmappedColumns: [], skipped: [{ source: 'the file', reason: 'it is empty' }] };
	}

	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			const json = JSON.parse(trimmed);
			const cards: unknown[] = Array.isArray(json) ? json : ((json as Record<string, unknown>).cards as unknown[] | undefined) ?? [];
			const entries: ImportCandidate[] = [];
			const skipped: PmImport['skipped'] = [];

			for (const card of cards) {
				if (!card || typeof card !== 'object') continue;
				const record = card as Record<string, unknown>;
				const title = String(record.name ?? '').trim();
				if (!title) {
					// Reported, not dropped in silence. "200 cards imported, one skipped" is
					// a different sentence from "201 cards imported".
					skipped.push({ source: 'a card', reason: 'no name' });
					continue;
				}
				entries.push({
					title: title.slice(0, 300),
					...(record.desc ? { description: String(record.desc).slice(0, 20_000) } : {}),
					tags: []
				});
			}

			if (Array.isArray(cards)) {
				return {
					detection,
					entries,
					unmappedColumns: [],
					skipped: entries.length ? skipped : [{ source: 'the file', reason: 'no cards with a name' }]
				};
			}
		} catch {
			// Not JSON after all; fall through to the text paths.
		}
	}

	if (looksLikeCsv(trimmed)) return { detection, ...importTable(parseCsvTable(trimmed)) };

	// Markdown / plain text, reusing `portability.ts` rather than reimplementing it -
	// a second implementation here would be a second thing to drift.
	const text2 = parseMarkdownImport(trimmed);
	return {
		detection,
		entries: text2.candidates,
		skipped: text2.skipped,
		unmappedColumns: []
	};
}
