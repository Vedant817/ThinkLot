/**
 * Getting ideas in from a product manager's scattered tools.
 *
 * Offline, no database. Every check uses a REALISTIC fixture, because the failure mode
 * of a naive parser is not a crash - it is 400 confidently imported rows where the
 * titles are the timestamps and the notes are empty, and nobody notices until they have
 * lost an afternoon.
 *
 * The single rule every check exists to protect: **a column this app does not
 * understand is REPORTED, never silently dropped.**
 */
import assert from 'node:assert/strict';
import {
	detectSource,
	importFromPmSource,
	PM_SOURCES,
	type PmImport
} from '../src/lib/pm-import';

// ---------------------------------------------------------------------------
// 1. A JIRA EXPORT, AS JIRA ACTUALLY SHIPS IT.
//
// Header first, ~200 columns in "all fields" mode, order dependent on site config, and
// `Labels` repeated when an issue has several. The first version of anyone's parser
// assumes fixed positions and gets every one of these wrong.
// ---------------------------------------------------------------------------
{
	const jira = [
		'Issue Type,Issue key,Summary,Assignee,Reporter,Priority,Status,Resolution,Created,Updated,Due Date,Description,Labels,Labels,Labels',
		'Story,PM-1,"Cancellation waitlist",pm@example.com,pm@example.com,High,In Progress,Unresolved,2026-03-01T10:00:00Z,2026-03-02T11:00:00Z,,"Customers cancel and nobody fills the slot.",scheduling,revenue,',
		'Bug,PM-2,"Handover notes lost",,pm@example.com,Medium,To Do,Unresolved,2026-03-03T09:00:00Z,2026-03-03T09:00:00Z,,"Field crews lose notes between shifts.",handover,,',
		'Task,PM-3,"Triage the sprint backlog",pm@example.com,pm@example.com,Low,Done,Done,2026-03-04T08:00:00Z,2026-03-04T18:00:00Z,2026-03-05,,"",,,,,'
	].join('\n');

	const detection = detectSource(jira, 'issues.csv');
	assert.equal(detection.source.id, 'jira', 'identified as Jira');
	assert.equal(detection.confidence, 'exact', 'and exactly, from several tell columns');
	assert.ok(detection.matched.length >= 2, 'the matching columns are shown, so detection is checkable');

	const result = importFromPmSource(jira, 'issues.csv');
	assert.equal(result.entries.length, 3, 'every row imported');

	const first = result.entries[0];
	assert.equal(first.title, 'Cancellation waitlist', 'from the Summary column, not position 1');
	assert.equal(first.description, 'Customers cancel and nobody fills the slot.');
	assert.ok(first.tags.includes('scheduling'), 'the first Labels column');
	assert.ok(first.tags.includes('revenue'), 'the second Labels column - repeated columns aggregate');
	// Assignee AND Reporter both map to `audience`, because they are both "who it is
	// for". Jira ships both, and they are usually the same person - so the joined value
	// is redundant, but that is the data's redundancy, not the parser's.
	assert.equal(first.audience, 'pm@example.com, pm@example.com', 'Assignee and Reporter both map to audience');

	// The columns this app has no field for are REPORTED, not dropped in silence - and\n	// with their ORIGINAL casing, because that is how the user recognises their own\n	// header row.
	assert.ok(
		result.unmappedColumns.includes('Created') && result.unmappedColumns.includes('Resolution'),
		`unmapped columns are reported so the user knows what was left behind: ${result.unmappedColumns.join(', ')}`
	);
	assert.ok(
		result.unmappedColumns.length >= 5,
		`a real Jira export has many columns, most unmapped, and every one is listed: got ${result.unmappedColumns.length}`
	);
	assert.ok(
		!result.unmappedColumns.some((c) => c.toLowerCase() === 'summary'),
		'a mapped column is never reported as unmapped'
	);
}

// A row with no Summary is reported, not imported as an empty idea.
{
	const jira = [
		'Summary,Description',
		'Real idea,has notes',
		',"a row with no title"'
	].join('\n');
	const result = importFromPmSource(jira);
	assert.equal(result.entries.length, 1);
	assert.equal(result.skipped.length, 1, 'the title-less row is reported with a reason');
}

// `Labels` written as one comma-joined cell, which is how some sites export.
{
	const csv = ['Summary,Labels', 'One idea,"alpha, beta, gamma"'].join('\n');
	const result = importFromPmSource(csv);
	assert.deepEqual(result.entries[0].tags, ['alpha', 'beta', 'gamma']);
}

// A column named like a title but spelled differently is still found.
{
	const csv = ['Issue summary,Notes', 'Found by alias,imported'].join('\n');
	const result = importFromPmSource(csv);
	assert.equal(result.entries[0].title, 'Found by alias');
	assert.equal(result.entries[0].description, 'imported');
}

// ---------------------------------------------------------------------------
// 2. LINEAR.
// ---------------------------------------------------------------------------
{
	const linear = [
		'Team,Cycle,Initiative,Title,Description,Estimate,State',
		'Core,2026-03,"Reduce churn","Cancel waitlist","Fill the slot automatically.",3,started'
	].join('\n');
	const result = importFromPmSource(linear);
	assert.equal(result.entries[0].title, 'Cancel waitlist', 'Linear calls it Title, not Summary');
	assert.equal(result.entries[0].description, 'Fill the slot automatically.');
	// Team and Cycle map to audience and tags respectively, because that is what they are.
	assert.equal(result.entries[0].audience, 'Core');
}

// ---------------------------------------------------------------------------
// 3. TRELLO'S JSON BOARD.
// ---------------------------------------------------------------------------
{
	const trello = JSON.stringify({
		name: 'Product ideas',
		cards: [
			{ name: 'Waitlist', desc: 'Fill empty slots', due: '2026-04-01', labels: [{ name: 'revenue' }] },
			{ name: '', desc: 'a card with no name' },
			{ desc: 'no name at all' }
		]
	});
	const detection = detectSource(trello);
	assert.equal(detection.source.id, 'trello', 'identified as Trello from its cards key');

	const result = importFromPmSource(trello);
	assert.equal(result.entries.length, 1, 'only the card with a name imports');
	assert.equal(result.entries[0].title, 'Waitlist');
	assert.equal(result.entries[0].description, 'Fill empty slots');
	// Unnamed cards are reported rather than dropped in silence.
	assert.equal(result.skipped.length, 2, 'both unnamed cards are reported');
}

// A bare array of cards is also a Trello board.
{
	const board = JSON.stringify([{ name: 'From array', desc: 'a board' }]);
	const result = importFromPmSource(board);
	assert.equal(result.entries.length, 1);
	assert.equal(result.entries[0].title, 'From array');
}

// ---------------------------------------------------------------------------
// 4. OBSIDIAN - frontmatter AND inline #tags.
// ---------------------------------------------------------------------------
{
	const vault = [
		'---',
		'title: Field handover view',
		'tags: [field, handover]',
		'status: spark',
		'---',
		'',
		'# Field handover view',
		'',
		'Notes taken on site get buried. #urgent',
		'',
		'**Problem:** Handovers are lost',
		'**Audience:** Field crews'
	].join('\n');

	const detection = detectSource(vault);
	assert.equal(detection.source.id, 'obsidian', 'frontmatter identifies Obsidian');

	const result = importFromPmSource(vault);
	assert.equal(result.entries.length, 1);
	const entry = result.entries[0];
	assert.equal(entry.title, 'Field handover view');
	assert.ok(entry.tags.includes('field'), 'frontmatter tags');
	assert.ok(entry.tags.includes('handover'));
	assert.ok(entry.tags.includes('urgent'), 'and inline #tags');
	assert.equal(entry.problem, 'Handovers are lost');
	assert.equal(entry.audience, 'Field crews');
}

// ---------------------------------------------------------------------------
// 5. A NOTION MARKDOWN EXPORT.
// ---------------------------------------------------------------------------
{
	const notion = [
		'# Cancellation waitlist',
		'',
		'**Problem:** Empty slots cost money',
		'**Audience:** Clinic staff',
		'**Outcome:** No slot sits empty',
		'',
		'Customers cancel and nobody fills it.'
	].join('\n');

	const detection = detectSource(notion, 'notion-export.md');
	assert.equal(detection.source.id, 'notion', 'from the headings and the filename');

	const result = importFromPmSource(notion);
	assert.equal(result.entries[0].title, 'Cancellation waitlist');
	assert.equal(result.entries[0].problem, 'Empty slots cost money');
	assert.equal(result.entries[0].audience, 'Clinic staff');
	assert.equal(result.entries[0].outcome, 'No slot sits empty');
	assert.match(result.entries[0].description ?? '', /Customers cancel/);
}

// ---------------------------------------------------------------------------
// 6. PLAIN TEXT, which is what pasting from Slack or an email looks like.
// ---------------------------------------------------------------------------
{
	const paste = [
		'Waitlist for cancellations',
		'',
		'Watched three customers walk out because the queue looked long.'
	].join('\n');
	const detection = detectSource(paste);
	assert.equal(detection.source.id, 'plain', 'no headings and no table');

	const result = importFromPmSource(paste);
	assert.equal(result.entries.length, 1, 'the first line is the title and the rest the notes');
	assert.equal(result.entries[0].title, 'Waitlist for cancellations');
	assert.match(result.entries[0].description ?? '', /three customers walk out/);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 7. THE FILE THE USER CANNOT EXPLAIN.
//
// A CSV whose columns are the user's own labels. Two cases, and the difference between
// them is the whole point: a label this app recognises imports; one it does not is
// REFUSED with a reason, rather than producing 200 empty rows.
// ---------------------------------------------------------------------------

// 7a. Labels it does not recognise. Refused, and it says why.
{
	const mystery = [
		'The thing,Why it matters,Who cares,What done looks like',
		'Queue predictor,"People leave when it looks long",Retail staff,"Nobody leaves"'
	].join('\n');
	const result = importFromPmSource(mystery);
	assert.equal(result.entries.length, 0, 'nothing imported');
	assert.match(
		result.skipped[0].reason,
		/no column named like a title/i,
		'and it says exactly why, rather than showing an empty screen'
	);
	// Every unmapped column is still reported, so the user knows what was available.
	// `Why it matters` is NOT among them - it maps to `problem`, which is exactly what
	// it means.
	assert.equal(result.unmappedColumns.length, 3, `all three unmapped columns reported: ${result.unmappedColumns.join(', ')}`);
}

// 7b. Unusual but recognisable labels. These import, because they mean the same thing.
{
	const odd = [
		'Initiative,Why it matters,Owner,Done when',
		'Queue predictor,"People leave when it looks long",Retail staff,"Nobody leaves"'
	].join('\n');
	const result = importFromPmSource(odd);
	assert.equal(result.entries.length, 1, 'the alias table absorbs unusual labels');
	assert.equal(result.entries[0].title, 'Queue predictor', 'Initiative is a title');
	assert.equal(result.entries[0].problem, 'People leave when it looks long', 'Why it matters is a problem');
	assert.equal(result.entries[0].audience, 'Retail staff', 'Owner is who it is for');
	assert.equal(result.entries[0].outcome, 'Nobody leaves', 'Done when is the outcome');
}

// 8. AN EMPTY OR BROKEN FILE IS NEVER A CRASH.
// ---------------------------------------------------------------------------
{
	assert.deepEqual(importFromPmSource('').entries, []);
	assert.equal(importFromPmSource('   \n\n  ').entries.length, 0);
	// JSON that fails to parse falls through to the text paths rather than throwing.
	const broken = '{"cards": [';
	const result = importFromPmSource(broken);
	assert.ok(result.entries.length >= 0, 'a broken JSON file does not throw');
}

// ---------------------------------------------------------------------------
// 9. THE REGISTRY IS COHERENT.
//
// Every source a user can pick must have a `howTo` they can follow, and must claim only
// the formats it can actually be detected from - otherwise the UI would offer an option
// that silently produces nothing.
// ---------------------------------------------------------------------------
{
	assert.equal(new Set(PM_SOURCES.map((s) => s.id)).size, PM_SOURCES.length, 'no duplicate ids');
	for (const source of PM_SOURCES) {
		assert.ok(source.label.length > 0, `${source.id} needs a label`);
		assert.ok(source.howTo.length > 20, `${source.id} needs instructions a user can follow`);
		assert.ok(source.formats.length > 0, `${source.id} must claim at least one format`);
	}
	// The one every PM tool shares: export a CSV, and this app reads it by column name.
	assert.ok(
		PM_SOURCES.filter((s) => s.formats.includes('csv')).length >= 4,
		'CSV is the common denominator across PM tools'
	);
}

console.log('PASS: ideas come in from Jira, Linear, Trello, Obsidian, Notion and plain text, and every unknown column is reported rather than dropped.');