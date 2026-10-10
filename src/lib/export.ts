/**
 * Getting ideas OUT, in the shapes other tools want to import back in.
 *
 * ## Why this is not the same as a Notion paste
 *
 * The Notion Markdown export exists because the founder's workflow is pasting an idea
 * into a planning doc. That is a one-way, one-off, read-by-a-human act, and its format
 * freedom is wide.
 *
 * This is the other direction: a product manager selecting ideas and pushing them into
 * the tools they already use. Those tools IMPORT with rules. Jira's CSV importer
 * documents a minimum contract explicitly - a header row, and the header **must**
 * contain a `Summary` column, with commas separating fields and quotes around any
 * content containing a comma or a newline. Linear and Trello have theirs.
 *
 * Get it wrong and the tool does not say "malformed"; it fails on the row, or imports
 * a title cut at the first embedded comma, or silently drops the labels. So this
 * module is written to the documented import contract of each destination rather than
 * to what looks like a reasonable CSV.
 *
 * ## What it deliberately does not do
 *
 * It does not push. No API call to Jira or Linear - the user exports a file and
 * imports it there. For the same reason import does not sync: one-way file transfer
 * that works today beats an integration needing credentials and a decision about what
 * happens when the two sides disagree.
 *
 * Pure and offline, so both clients share it and the output can be asserted exactly.
 */

import type { PortableIdea } from './portability';
import { toCsv as toSpreadsheetCsv } from './portability';
import type { IdeaStatus } from './types';

export type ExportTargetId = 'jira' | 'linear' | 'notion' | 'obsidian' | 'csv';

export type ExportTarget = {
	id: ExportTargetId;
	label: string;
	/** Where the result goes, in the user's words. */
	destination: string;
	/** The exact import steps, because the tool's own docs are the spec. */
	howTo: string;
	filename: (at?: number) => string;
	mime: string;
};

export const EXPORT_TARGETS: ExportTarget[] = [
	{
		id: 'jira',
		label: 'Jira',
		destination: 'A Jira backlog',
		howTo: 'Issues → Import issues from CSV. Map Summary, Status, Labels and Description.',
		filename: (at = Date.now()) => `thinklot-jira-${stamp(at)}.csv`,
		mime: 'text/csv'
	},
	{
		id: 'linear',
		label: 'Linear',
		destination: 'A Linear team',
		howTo: 'Settings → Import → CSV. Map Title, Description and Labels.',
		filename: (at = Date.now()) => `thinklot-linear-${stamp(at)}.csv`,
		mime: 'text/csv'
	},
	{
		id: 'notion',
		label: 'Notion',
		destination: 'A Notion page',
		howTo: 'Drag the file into Notion, or paste the text. Notion imports Markdown.',
		filename: (at = Date.now()) => `thinklot-notion-${stamp(at)}.md`,
		mime: 'text/markdown'
	},
	{
		id: 'obsidian',
		label: 'Obsidian',
		destination: 'An Obsidian vault',
		howTo: 'Copy the file into the vault folder. Tags become #tags you can search.',
		filename: (at = Date.now()) => `thinklot-obsidian-${stamp(at)}.md`,
		mime: 'text/markdown'
	},
	{
		id: 'csv',
		label: 'A spreadsheet',
		destination: 'Excel or Sheets',
		howTo: 'Open the file directly.',
		filename: (at = Date.now()) => `thinklot-${stamp(at)}.csv`,
		mime: 'text/csv'
	}
];

function stamp(at: number): string {
	return new Date(at).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// The one true CSV cell encoder
// ---------------------------------------------------------------------------

/**
 * Escape a CSV value per RFC 4180, which is what Jira's importer documents.
 *
 * The rules from the Jira docs, applied exactly rather than approximately:
 *   - commas separate fields, always;
 *   - a double quote is escaped by doubling it, not with a backslash;
 *   - any value containing a comma, a quote or a newline is wrapped in quotes.
 *
 * The last rule is the one that matters most in practice: a title containing a comma
 * unquoted ends the field, and the rest of the title becomes the `Status` column.
 * Every export therefore quotes defensively rather than only when required - the
 * cost is two bytes and the failure mode it removes is silently wrong columns.
 */
function csvCell(value: unknown): string {
	if (value === undefined || value === null) return '';
	return `"${String(value).replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

/**
 * ThinkLot's lifecycle to Jira's workflow statuses.
 *
 * Not an identity mapping. Jira's documented import contract says a `Status` column
 * is mapped to an EXISTING workflow status, and creating new ones needs explicit
 * configuration - so the values here are written to be ones a default Jira workflow
 * already has. An unmapped value becomes "To Do", which is the correct import
 * outcome rather than a failed row.
 *
 * This is deliberately a lossy mapping in one direction - ThinkLot has stages Jira
 * has no workflow status for - and that direction is chosen because a failed import
 * is worse than an imprecise column.
 */
const JIRA_STATUS: Record<IdeaStatus, string> = {
	inbox: 'To Do',
	parked: 'Backlog',
	reviewing: 'In Progress',
	ready: 'To Do',
	building: 'In Progress',
	done: 'Done'
};

/**
 * ThinkLot's lifecycle to Linear's team states.
 *
 * Linear's CSV import maps a `State` column onto the team's existing workflow states.
 * Its defaults are Backlog / Todo / In Progress / Done, and again a new value needs
 * creating, so the mapping targets those.
 */
const LINEAR_STATUS: Record<IdeaStatus, string> = {
	inbox: 'Backlog',
	parked: 'Backlog',
	reviewing: 'Todo',
	ready: 'Todo',
	building: 'In Progress',
	done: 'Done'
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportDoc = {
	targetId: ExportTargetId;
	filename: string;
	mime: string;
	contents: string;
};

/**
 * Export selected ideas for one destination.
 *
 * Never throws, and never returns a partial file: an unsupported target comes back as
 * an error the UI shows, because a silently-empty download is the failure this whole
 * module exists to prevent.
 */
export function exportFor(targetId: ExportTargetId, ideas: PortableIdea[], at = Date.now()): ExportDoc {
	const target = EXPORT_TARGETS.find((entry) => entry.id === targetId);
	if (!target) {
		throw new Error(`No export target called "${targetId}".`);
	}

	let contents: string;
	switch (targetId) {
		case 'jira':
		case 'linear':
			contents = toToolCsv(ideas, targetId);
			break;
		case 'notion':
		case 'obsidian':
			contents = toVaultMarkdown(ideas, targetId, at);
			break;
		case 'csv':
			contents = toSpreadsheetCsv(ideas);
			break;
	}

	return {
		targetId,
		filename: target.filename(at),
		mime: target.mime,
		contents
	};
}

/**
 * A CSV that Jira's and Linear's importers will accept.
 *
 * Header first, always, because both importers read the header row to map the
 * columns - and an empty export still needs one, or the importer reports a file with
 * no rows rather than a file with no ideas.
 */
export function toToolCsv(ideas: PortableIdea[], tool: 'jira' | 'linear'): string {
	const status = tool === 'jira' ? JIRA_STATUS : LINEAR_STATUS;
	const titleColumn = tool === 'jira' ? 'Summary' : 'Title';
	const stateColumn = tool === 'jira' ? 'Status' : 'State';

	const rows = [[titleColumn, stateColumn, 'Priority', 'Labels', 'Description']];

	for (const idea of ideas) {
		rows.push([
			idea.title,
			status[idea.status] ?? 'To Do',
			// Both tools import a Priority column. ThinkLot has a score, not a
			// priority, so the mapping is a judgement and is labelled at the call.
			priorityWord(idea),
			(idea.tags ?? []).join(' '),
			descriptionOf(idea)
		]);
	}

	return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * A ThinkLot score to a priority word.
 *
 * Both tools import a priority as a value from their own list. Mapping a 0-100 score
 * onto Highest/High/Medium/Low is approximate by construction and is labelled
 * wherever it is used - better than a raw score the tool will not accept, and worse
 * than nothing is not an option because a blank priority is a valid import.
 */
export function priorityWord(idea: PortableIdea): string {
	if (typeof idea.impact !== 'number' || typeof idea.effort !== 'number' || typeof idea.confidence !== 'number') {
		return '';
	}
	if (idea.effort <= 0) return '';
	const score = (idea.impact * idea.confidence) / idea.effort;
	// Two bands, matching scoreBand: strong at 24 and over, solid from 10.
	if (score >= 24) return 'Highest';
	if (score >= 10) return 'High';
	return 'Low';
}

/**
 * Every idea's body, for a tool that has one Description column.
 *
 * Labels and structure are kept, because a destination ticket with only the title is
 * a ticket that has lost the point of writing the idea down.
 */
function descriptionOf(idea: PortableIdea): string {
	const parts: string[] = [];
	for (const [label, value] of [
		['Problem', idea.problem],
		['Audience', idea.audience],
		['Outcome', idea.outcome],
		['Trigger', idea.trigger],
		['Notes', idea.description]
	] as const) {
		if (value?.trim()) parts.push(`${label}: ${value.trim()}`);
	}
	if ((idea.tasks?.length ?? 0) > 0) {
		parts.push(
			`Checklist:\n${(idea.tasks ?? [])
				.map((task) => `- [${task.completed ? 'x' : ' '}] ${task.title}`)
				.join('\n')}`
		);
	}
	return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Markdown, for the tools that read it
// ---------------------------------------------------------------------------

/**
 * One idea as an Obsidian-friendly note.
 *
 * Obsidian reads YAML frontmatter and `#tags`, and its wiki-links are `[[Title]]`. The
 * Notion variant omits the frontmatter, because Notion's Markdown importer does not
 * read it - it would appear as a code block at the top of the page.
 *
 * The dictation transcript is quoted rather than inlined, so it reads as speech rather
 * than as the user's own considered prose.
 */
export function toVaultMarkdown(
	ideas: PortableIdea[],
	flavour: 'notion' | 'obsidian',
	at = Date.now()
): string {
	const target = EXPORT_TARGETS.find((entry) => entry.id === flavour)!;
	const blocks: string[] = [`# ${target.destination} — ${stamp(at)}`, ''];

	for (const idea of ideas) {
		blocks.push(...ideaToMarkdown(idea, flavour));
	}

	return `${blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function ideaToMarkdown(idea: PortableIdea, flavour: 'notion' | 'obsidian'): string[] {
	/*
	 * Obsidian frontmatter goes BEFORE the heading, per note.
	 *
	 * The first version put the document title first and each note's frontmatter
	 * after its heading, which is valid YAML but useless in Obsidian: frontmatter
	 * attaches to the top of a note, and tags only register when the block is at
	 * the very start. A vault import with tags that never register is worse than
	 * no tags at all.
	 */
	const out: string[] = [];

	if (flavour === 'obsidian') {
		const facts: string[] = [`status: ${idea.status}`];
		if (idea.impact !== undefined || idea.effort !== undefined || idea.confidence !== undefined) {
			facts.push(`impact: ${idea.impact ?? '-'}`);
			facts.push(`effort: ${idea.effort ?? '-'}`);
			facts.push(`confidence: ${idea.confidence ?? '-'}`);
		}
		facts.push(`created: ${new Date(idea.createdAt).toISOString().slice(0, 10)}`);
		// The closing `---` is always emitted. YAML frontmatter is delimited on BOTH
		// sides; without it Obsidian renders the whole block as literal text and the
		// tags never register. The original version put the closing `---` on the same
		// conditional as the tags line, so an untagged idea produced frontmatter that
		// never closed.
		out.push('---', ...facts, ...(idea.tags?.length ? [`tags: [${idea.tags.join(', ')}]`] : []), '---', '');
	}

	out.push(`## ${idea.title}`, '');
	for (const [label, value] of [
		['Problem', idea.problem],
		['Audience', idea.audience],
		['Outcome', idea.outcome],
		['Trigger', idea.trigger],
		['Notes', idea.description]
	] as const) {
		if (value?.trim()) out.push(`**${label}:** ${value.trim()}`, '');
	}

	if (idea.transcript) {
		out.push('> **Verbatim dictation**', ...idea.transcript.split('\n').map((line) => `> ${line}`), '');
	}

	if ((idea.tasks?.length ?? 0) > 0) {
		out.push('**Checklist**', '');
		for (const task of idea.tasks ?? []) out.push(`- [${task.completed ? 'x' : ' '}] ${task.title}`);
		out.push('');
	}

	if (flavour === 'notion' && (idea.tags ?? []).length) {
		out.push(`#${(idea.tags ?? []).join(' #')}`, '');
	}

	return out;
}

// The spreadsheet target keeps its own shape: the six columns this app's own CSV
// importer reads back, which is what a round trip needs and what a person opening it
// in a spreadsheet expects.
function toCsv(ideas: PortableIdea[]): string {
	return toSpreadsheetCsv(ideas);
}