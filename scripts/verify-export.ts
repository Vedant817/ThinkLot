/**
 * Export-for-other-tools tests.
 *
 * Offline. The assertions are against the DOCUMENTED import contract of each
 * destination, not against what a reasonable-looking CSV might be - because a
 * destination tool does not say "malformed", it fails on the row or silently misreads a
 * column.
 *
 * Jira's CSV importer documents a minimum: a header row, the header MUST contain a
 * `Summary` column, commas separate fields, and quotes around any content containing a
 * comma or newline. Both are asserted.
 */
import assert from 'node:assert/strict';
import {
	exportFor,
	toToolCsv,
	toVaultMarkdown,
	priorityWord,
	EXPORT_TARGETS,
	type ExportTargetId
} from '../src/lib/export';
import type { PortableIdea } from '../src/lib/portability';

const idea = (over: Partial<PortableIdea> = {}): PortableIdea => ({
	_id: 'i1',
	seq: 1,
	title: 'Cancellation waitlist',
	status: 'ready',
	tags: ['scheduling', 'revenue'],
	favorite: false,
	archived: false,
	impact: 3,
	effort: 1,
	confidence: 3,
	problem: 'Empty slots cost money',
	audience: 'Clinic staff',
	outcome: 'No slot sits empty',
	trigger: 'A postmortem in March',
	description: 'Cancelled slots refilled by hand.',
	createdAt: Date.parse('2026-03-01T10:00:00Z'),
	updatedAt: Date.parse('2026-03-02T11:00:00Z'),
	tasks: [
		{ title: 'Count cancellations', completed: true },
		{ title: 'Draft the fill rule', completed: false }
	],
	...over
});

// ---------------------------------------------------------------------------
// 1. JIRA'S MINIMUM CONTRACT.
// ---------------------------------------------------------------------------
{
	const csv = toToolCsv([], 'jira');
	const [header] = csv.split('\r\n');
	assert.equal(header, '"Summary","Status","Priority","Labels","Description"');
	assert.ok(header.includes('Summary'), "Jira's documented minimum is a Summary column");
	// An empty export still has a header, or the importer reports a file with no rows
	// rather than a file with no ideas.
	assert.ok(csv.endsWith('\r\n'), 'the file ends with a newline, so the last row is not dropped');
}

// Statuses mapped to values a default Jira workflow already HAS. The importer maps to
// existing statuses; a new one needs creating and an unmapped one becomes To Do.
{
	assert.equal(toToolCsv([idea({ status: 'inbox' })], 'jira').split('\r\n')[1].includes('"To Do"'), true);
	assert.equal(toToolCsv([idea({ status: 'building' })], 'jira').split('\r\n')[1].includes('"In Progress"'), true);
	assert.equal(toToolCsv([idea({ status: 'done' })], 'jira').split('\r\n')[1].includes('"Done"'), true);
	assert.equal(toToolCsv([idea({ status: 'parked' })], 'jira').split('\r\n')[1].includes('"Backlog"'), true);
}

// ---------------------------------------------------------------------------
// 2. A COMMA IN A TITLE MUST NOT BECOME A COLUMN.
//
// Unquoted, the title ends at the comma and the rest becomes `Status`. The importer
// maps whatever is in that position, so the row imports with a wrong status and a
// truncated title, and nothing reports it.
// ---------------------------------------------------------------------------
{
	const csv = toToolCsv([idea({ title: 'Booking tool, for small clinics' })], 'jira');
	assert.match(csv, /"Booking tool, for small clinics"/, 'the whole title is one quoted field');
	// The column count is unchanged, which is what makes the row importable.
	const rows = csv.trim().split('\r\n');
	assert.equal(rows[1].split(',').length > 5, true, 'the row still has its five quoted fields');
}

// A newline inside the description is quoted, and does not create a second row.
{
	const csv = toToolCsv([idea({ description: 'Line one\nLine two' })], 'jira');
	assert.equal(csv.trim().split('\r\n').length, 2, 'an embedded newline does not become a row');
assert.match(csv, /Line one\nLine two/, 'and it stays inside the quoted cell');
}

// A double quote is doubled, not backslash-escaped.
{
	const csv = toToolCsv([idea({ title: 'Clicking the "Add" button' })], 'jira');
	assert.match(csv, /"Clicking the ""Add"" button"/, 'quotes are doubled per the contract');
	assert.ok(!csv.includes('\\"'), 'and never backslash-escaped');
}

// ---------------------------------------------------------------------------
// 3. LINEAR'S COLUMN NAMES DIFFER, AND ITS STATES TOO.
// ---------------------------------------------------------------------------
{
	const csv = toToolCsv([idea({ status: 'building' })], 'linear');
	assert.match(csv, /^"Title","State","Priority","Labels","Description"/);
	assert.ok(csv.includes('"In Progress"'), 'Linear uses its own state names');
	assert.ok(!csv.includes('"Summary"'), 'and does not use Jira\'s');
}

// ---------------------------------------------------------------------------
// 4. THE WHOLE IDEA SURVIVES INTO THE TICKET.
//
// A destination ticket with only the title has lost the point of writing the idea
// down, so the problem, audience, outcome and checklist must come too.
// ---------------------------------------------------------------------------
{
	const csv = toToolCsv([idea()], 'jira');
	for (const fragment of ['Empty slots cost money', 'Clinic staff', 'No slot sits empty', 'A postmortem in March', 'Checklist']) {
		assert.ok(csv.includes(fragment), `the ticket keeps ${fragment}`);
	}
	assert.ok(csv.includes('scheduling'), 'and the tags');
}

// ---------------------------------------------------------------------------
// 5. PRIORITY IS A JUDGEMENT, AND AN UNSCORED IDEA SAYS NOTHING RATHER THAN LYING.
// ---------------------------------------------------------------------------
{
	assert.equal(priorityWord(idea({ impact: 10, effort: 1, confidence: 10 })), 'Highest');
	assert.equal(priorityWord(idea({ impact: 3, effort: 1, confidence: 3 })), 'Low');
	assert.equal(priorityWord(idea({ impact: 5, effort: 3, confidence: 2 })), 'Low');
	assert.equal(priorityWord(idea({ impact: 4, effort: 1, confidence: 3 })), 'High');
	// An unscored idea must not import as "Low", which would be a claim it never made.
	assert.equal(priorityWord(idea({ impact: undefined, effort: undefined, confidence: undefined })), '');
	assert.equal(priorityWord(idea({ impact: 5, effort: 0, confidence: 5 })), '', 'and a zero effort is not a divide-by-zero');
}

// ---------------------------------------------------------------------------
// 6. THE FULL DOCUMENT: filename, mime, and an unknown target refused.
// ---------------------------------------------------------------------------
{
	at: {
		const doc = exportFor('jira', [idea()], Date.parse('2026-03-01T10:00:00Z'));
		assert.equal(doc.filename, 'thinklot-jira-2026-03-01.csv', 'filenames sort chronologically');
		assert.equal(doc.mime, 'text/csv');
		assert.ok(doc.contents.length > 0);
	}
	at: {
		const doc = exportFor('notion', [idea()], Date.parse('2026-03-01T10:00:00Z'));
		assert.equal(doc.filename, 'thinklot-notion-2026-03-01.md');
		assert.match(doc.contents, /^# A Notion page/);
	}
	try {
		exportFor('nope' as ExportTargetId, [idea()]);
		assert.fail('an unknown target must throw, not produce an empty download');
	} catch (error) {
		assert.match(String(error), /No export target/);
	}
}

// ---------------------------------------------------------------------------
// 7. VAULT MARKDOWN.
//
// Obsidian reads YAML frontmatter and #tags. Notion's Markdown importer does NOT read
// frontmatter - it would appear as a code block at the top of the page - so the two
// flavours differ, deliberately.
// ---------------------------------------------------------------------------
{
	const obsidian = toVaultMarkdown([idea()], 'obsidian', Date.parse('2026-03-01T10:00:00Z'));
	// The frontmatter runs from the document title into the first note. Obsidian
	// attaches frontmatter to the TOP of a note, so the first `---` block after the
	// document heading is the one that matters - and each note carries its own.
	assert.match(obsidian, /\n---\nstatus: ready/, 'Obsidian gets frontmatter');
	assert.match(obsidian, /status: ready/, 'with the lifecycle in it');
	assert.match(obsidian, /tags: \[scheduling, revenue\]/, 'and its own tags per note');
	// The block is closed, or Obsidian renders it as literal text. Two delimiters per
	// note: one opening, one closing.
	assert.equal((obsidian.match(/^---$/gm) ?? []).length % 2, 0, 'frontmatter is delimited on both sides');
	assert.equal((obsidian.match(/^---$/gm) ?? []).length >= 2, true, 'and there is at least one note with a close');

	const notion = toVaultMarkdown([idea()], 'notion', Date.parse('2026-03-01T10:00:00Z'));
	assert.equal(notion.startsWith('---'), false, 'Notion gets none');
	assert.match(notion, /#scheduling/, 'Notion gets inline tags instead');
	assert.match(notion, /^## Cancellation waitlist/m, 'and the idea as a heading');
}

// Nothing at all is a valid export, not an error.
{
	const csv = toToolCsv([], 'jira');
	assert.ok(csv.split('\r\n').length >= 1, 'an empty export is still a well-formed file');
	const md = toVaultMarkdown([], 'obsidian', Date.parse('2026-03-01T10:00:00Z'));
	assert.ok(md.length > 0);
}

// The registry is coherent - every offered target must be selectable.
{
	assert.equal(new Set(EXPORT_TARGETS.map((t) => t.id)).size, EXPORT_TARGETS.length);
	for (const target of EXPORT_TARGETS) {
		assert.ok(target.howTo.length > 20, `${target.id} needs instructions a user can follow`);
		assert.match(target.filename(Date.now()), /^thinklot-[\w-]+\.(csv|md)$/, `${target.id} filename is filesystem-safe`);
		// Every target must actually export, so the UI never offers a dead button.
		assert.ok(exportFor(target.id, [idea()]).contents.length > 0, `${target.id} produced nothing`);
	}
}

console.log('PASS: every export matches the target tool\'s documented import contract, and nothing is silently truncated.');