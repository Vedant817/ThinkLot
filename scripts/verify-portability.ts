/**
 * Portability tests: export and import, both directions.
 *
 * Offline, no database. Everything here is a string in and a string out, which is the
 * only reason a lossless-backup claim can be checked at all without an account.
 *
 * The centre of gravity is the property that matters most to a user and is easiest to
 * get quietly wrong: **a round trip must not lose an idea, and must not invent one.**
 */
import assert from 'node:assert/strict';
import {
	toNotionMarkdown,
	toCsv,
	toBackupJson,
	exportFilename,
	parseMarkdownImport,
	parseCsvImport,
	findImportDuplicates,
	partitionForImport,
	type PortableIdea
} from '../src/lib/portability';

const idea = (over: Partial<PortableIdea> = {}): PortableIdea => ({
	_id: 'i1',
	seq: 1,
	title: 'Cancellation waitlist',
	status: 'parked',
	tags: ['scheduling'],
	favorite: false,
	archived: false,
	impact: 3,
	effort: 1,
	confidence: 3,
	problem: 'Empty appointment slots cost money',
	audience: 'Clinic staff',
	outcome: 'No slot sits empty',
	trigger: 'A postmortem in March',
	description: 'Cancelled slots are refilled by hand, which takes ten minutes each time.',
	transcript: 'so I was walking with Priya and she said empty slots cost her money',
	createdAt: Date.parse('2026-03-01T10:00:00Z'),
	updatedAt: Date.parse('2026-03-02T11:00:00Z'),
	tasks: [
		{ title: 'Count cancellations in a week', completed: true },
		{ title: 'Draft the fill rule', completed: false }
	],
	...over
});

const full = idea();
const archived = idea({ _id: 'i2', seq: 2, title: 'Old sync idea', status: 'done', archived: true, transcript: undefined });

// ---------------------------------------------------------------------------
// 1. THE JSON BACKUP IS LOSSLESS. Anything dropped here is data the user cannot get back.
// ---------------------------------------------------------------------------
{
	const backup = JSON.parse(toBackupJson([full, archived]));
	assert.equal(backup.format, 'thinklot-export');
	assert.equal(backup.version, 1, 'a format without a version is a backup nobody can restore from');
	assert.equal(backup.ideaCount, 2);

	// Every field of the input survives, field for field.
	for (const key of Object.keys(full) as (keyof PortableIdea)[]) {
		assert.deepEqual(backup.ideas[0][key], full[key], `backup lost or changed ${key}`);
	}

	// And critically: an ARCHIVED idea is still in there.
	assert.ok(
		backup.ideas.some((i: PortableIdea) => i.title === 'Old sync idea' && i.archived === true),
		'an export without archived ideas is not a backup'
	);
	// A dictated idea keeps its verbatim words.
	assert.match(backup.ideas[0].transcript, /walking with Priya/);
	// Checklist rows survive, because an export that forgets them is a summary.
	assert.equal(backup.ideas[0].tasks.length, 2);
}

// ---------------------------------------------------------------------------
// 2. A ROUND TRIP LOSES NOTHING AND INVENTS NOTHING.
// ---------------------------------------------------------------------------
{
	// Export to JSON, import the JSON back, compare.
	const json = toBackupJson([full, archived]);
	const reparsed = JSON.parse(json);
	const round: PortableIdea[] = reparsed.ideas;
	assert.equal(round.length, 2);
	for (const original of [full, archived]) {
		const found = round.find((i) => i._id === original._id)!;
		assert.ok(found, 'an idea vanished across a round trip');
		for (const key of Object.keys(original) as (keyof PortableIdea)[]) {
			assert.deepEqual(found[key], original[key], `${original.title}: ${key} changed across the round trip`);
		}
	}
}

// ---------------------------------------------------------------------------
// 3. THE NOTION PASTE IS ACTUALLY PASTEABLE.
// ---------------------------------------------------------------------------
{
	const md = toNotionMarkdown([full, archived]);

	// A real heading for the title, not bold text pretending to be one.
	assert.match(md, /^## Cancellation waitlist/m, 'the title must be a heading Notion recognises');
	// The plate rides along, because LOT numbers are how the user refers to ideas.
	assert.match(md, /LOT-0001/);
	// Inner fields are labelled fields, not competing headings.
	assert.match(md, /\*\*Problem:\*\*/);
	assert.ok(!/^## Problem/m.test(md), 'a field must not outrank the idea it belongs to');
	// Checklist is a real GitHub-style task list.
	assert.match(md, /- \[x\] Count cancellations/);
	assert.match(md, /- \[ \] Draft the fill rule/);
	// Dictation is quoted, so it does not read as considered prose in another tool.
	assert.match(md, /^> /m);

	// Archived goes under its own heading and OUT of the main body.
	assert.match(md, /^## Archived/m);
	const mainSection = md.split(/^## Archived$/m)[0];
	assert.ok(!mainSection.includes('Old sync idea'), 'archived ideas must not clutter a working document');

	// No HTML that would render raw, and no fence around the whole file that would
	// make Notion show it as code.
	assert.ok(!md.includes('<div'), 'no raw HTML');
	assert.ok(!md.startsWith('```'), 'the whole document must not be a code block');
}

// A minimal idea still produces a usable document rather than empty sections.
{
	const md = toNotionMarkdown([idea({ title: 'Bare', tags: [], problem: undefined, audience: undefined, outcome: undefined, trigger: undefined, description: undefined, transcript: undefined, impact: undefined, effort: undefined, confidence: undefined, tasks: [] })]);
	assert.match(md, /^## Bare/m);
	assert.ok(!/\*\*Problem/.test(md), 'an absent field must not render as an empty label');
	assert.match(md, /Status: parked/);
}

// Titles with Markdown-significant characters must not break the structure.
{
	const md = toNotionMarkdown([idea({ title: 'Use #hashtags *and* [brackets] in titles' })]);
	const firstHeading = md.split('\n').find((line) => line.startsWith('## '))!;
	assert.ok(firstHeading.includes('Use #hashtags'), 'a # inside a title must not become a heading');
	assert.ok(firstHeading.includes('[brackets]'), 'and brackets survive');
}

// ---------------------------------------------------------------------------
// 4. CSV ROUND TRIPS, INCLUDING THE AWKWARD ROWS.
// ---------------------------------------------------------------------------
{
	const nasty = idea({
		title: 'Quoted "title", with a comma',
		description: 'Line one\nLine two, with a comma and "quotes"',
		tags: ['a b', 'c,d'],
		tasks: [{ title: 'Task, with comma', completed: true }]
	});
	const csv = toCsv([nasty]);
	const back = parseCsvImport(csv);
	assert.equal(back.candidates.length, 1);
	const c = back.candidates[0];
	assert.equal(c.title, nasty.title, 'a quoted comma title survives');
	assert.equal(c.description, nasty.description, 'an embedded newline survives');
	assert.deepEqual(c.tags, ['a b', 'c,d'], 'tags with separators survive');
	assert.equal(c.problem, nasty.problem);
	assert.equal(c.audience, nasty.audience);
	assert.equal(c.outcome, nasty.outcome);
	assert.equal(c.trigger, nasty.trigger);
}

// CRLF is what Excel produces, and is the usual reason a CSV import silently fails.
{
	const csv = toCsv([full]);
	assert.ok(csv.includes('\r\n'), 'Excel wants CRLF');
	const back = parseCsvImport(csv);
	assert.equal(back.candidates.length, 1);
	assert.equal(back.candidates[0].title, full.title);
}

// A CSV with no title column is REFUSED with a reason, not imported as nonsense.
{
	const bad = parseCsvImport('id,name\n1,Something');
	assert.equal(bad.candidates.length, 0);
	assert.match(bad.skipped[0]?.reason ?? '', /no "title" column/);
}

{
	// A trailing newline must not produce an empty trailing idea.
	const back = parseCsvImport(toCsv([full]));
	assert.equal(back.candidates.length, 1, 'a trailing newline must not add a blank row');
}

// ---------------------------------------------------------------------------
// 5. MARKDOWN IMPORT: THE REAL EXPORT SHAPES.
// ---------------------------------------------------------------------------
{
	// Round trip through our own Markdown is the strongest available check.
	const md = toNotionMarkdown([full, idea({ _id: 'i3', seq: 3, title: 'Second idea', transcript: undefined, tasks: [] })]);
	const back = parseMarkdownImport(md);
	const titles = back.candidates.map((c) => c.title);
	assert.ok(titles.includes('Cancellation waitlist'), `lost the title: ${titles.join(' | ')}`);
	assert.ok(titles.includes('Second idea'), `lost the second: ${titles.join(' | ')}`);

	const first = back.candidates.find((c) => c.title === 'Cancellation waitlist')!;
	assert.equal(first.problem, full.problem, 'the problem survives a Markdown round trip');
	assert.equal(first.audience, full.audience);
	assert.equal(first.outcome, full.outcome);
	assert.equal(first.trigger, full.trigger);
	assert.match(first.description ?? '', /Cancelled slots are refilled by hand/);
	assert.ok(first.tags.includes('scheduling'), 'tags survive');
}

// An Obsidian note, frontmatter and inline tags.
{
	const obsidian = `---
title: Field handover view
tags: [field, handover]
status: spark
---

# Field handover view

Notes taken on site get buried. #urgent

**Problem:** Handovers are lost
**Audience:** Field crews
`;
	const back = parseMarkdownImport(obsidian);
	const c = back.candidates[0];
	assert.equal(c.title, 'Field handover view');
	assert.ok(c.tags.includes('field') && c.tags.includes('handover'), 'frontmatter tags');
	assert.ok(c.tags.includes('urgent'), 'inline #tags');
	assert.equal(c.problem, 'Handovers are lost');
	assert.match(c.description ?? '', /Notes taken on site get buried/);
}

// A plain-text dump with NO headings, which is what Apple Notes and voice memos give.
{
	const plain = 'Queue predictor\n\nWatched three customers walk out because the queue looked long.';
	const back = parseMarkdownImport(plain);
	assert.equal(back.candidates.length, 1);
	assert.equal(back.candidates[0].title, 'Queue predictor');
	assert.match(back.candidates[0].description ?? '', /three customers walk out/);
}

// A fenced block inside an idea must NOT be split on headings inside the fence.
{
	const md = `# Real idea

\`\`\`md
# Not an idea, this is a code sample
\`\`\`

Trailing text.`;
	const back = parseMarkdownImport(md);
	assert.equal(back.candidates.length, 1, `a fence must not create a second idea: ${back.candidates.map((c) => c.title).join(' | ')}`);
	assert.match(back.candidates[0].description ?? '', /Not an idea/, 'and its contents survive');
}

// An empty file is reported, not treated as zero ideas with no explanation.
{
	const back = parseMarkdownImport('   \n\n  ');
	assert.equal(back.candidates.length, 0);
	assert.equal(back.skipped.length, 1);
	assert.match(back.skipped[0].reason, /empty/);
}

// ---------------------------------------------------------------------------
// 6. DUPLICATES ARE REPORTED, NOT DECIDED.
// ---------------------------------------------------------------------------
{
	const checks = findImportDuplicates(
		[
			{ title: 'Cancellation waitlist', tags: [] },
			{ title: 'Totally new idea', tags: [] }
		],
		[{ _id: 'existing-1', title: 'Cancellation waitlist' }]
	);
	const { fresh, duplicates } = partitionForImport(checks);
	assert.equal(fresh.length, 1);
	assert.equal(fresh[0].title, 'Totally new idea');
	assert.equal(duplicates.length, 1, 'a collision must be surfaced, not auto-skipped or auto-added');
	assert.equal(duplicates[0].matchesExisting[0].id, 'existing-1');

	// Case and punctuation must not hide a real collision.
	const loose = findImportDuplicates([{ title: 'cancellation   waitlist!', tags: [] }], [{ _id: 'x', title: 'Cancellation waitlist' }]);
	assert.equal(loose[0].matchesExisting.length, 1, 'punctuation must not disguise a duplicate');
}

// Re-importing the same file twice must not silently double the lot - and must not
// silently discard a genuine idea either.
{
	const fromExport = parseMarkdownImport(toNotionMarkdown([full]));
	const first = partitionForImport(findImportDuplicates(fromExport.candidates, []));
	assert.equal(first.fresh.length, 1, 'the first import is fresh');

	const second = partitionForImport(findImportDuplicates(fromExport.candidates, [{ _id: 'now-1', title: full.title }]));
	assert.equal(second.fresh.length, 0, 'the second import of the same file collides');
	assert.equal(second.duplicates.length, 1, 'and is reported rather than silently added');
}

// ---------------------------------------------------------------------------
// 7. FILENAMES.
// ---------------------------------------------------------------------------
{
	assert.match(exportFilename('markdown', Date.parse('2026-03-01T10:00:00Z')), /^thinklot-2026-03-01\.md$/);
	assert.match(exportFilename('csv', Date.parse('2026-03-01T10:00:00Z')), /^thinklot-2026-03-01\.csv$/);
	assert.match(exportFilename('json', Date.parse('2026-03-01T10:00:00Z')), /^thinklot-2026-03-01\.json$/);
	// No characters a filesystem rejects.
	for (const kind of ['markdown', 'csv', 'json'] as const) {
		assert.match(exportFilename(kind), /^[A-Za-z0-9.-]+$/, `filename has filesystem-hostile characters: ${exportFilename(kind)}`);
	}
}

// An unscored idea shows no priority rather than a fake number.
{
	const md = toNotionMarkdown([idea({ impact: undefined, effort: undefined, confidence: undefined })]);
	assert.ok(!md.includes('Priority:'), 'an unscored idea must not claim a priority');
	// Effort of zero must not divide by zero into Infinity.
	const zero = toNotionMarkdown([idea({ effort: 0, impact: 5, confidence: 5 })]);
	assert.ok(!/Infinity|NaN/.test(zero), 'a zero effort must not leak Infinity into the export');
}

console.log('PASS: exports are lossless backups, imports refuse to guess, and a round trip neither loses nor invents an idea (no database operations).');