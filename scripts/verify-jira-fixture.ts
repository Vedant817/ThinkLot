/**
 * The real Jira fixture, parsed exactly as the app would parse it.
 *
 * This is the file from `make-csv.ps1` - the actual export shape, with an embedded comma
 * and newline inside the Description column, repeated `Labels` columns, and ~20 columns
 * most of which map to nothing. Every assertion here is against what the app should
 * actually produce, not against a smaller hand-built fixture.
 */
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { importFromPmSource, detectSource } from '../src/lib/pm-import';

const csv = readFileSync('C:/Users/vedan/AppData/Local/Temp/opencode/jira.csv', 'utf8');

// The file is CRLF, quoted, and has a repeated `Labels` column.
assert.match(csv, /\r\n/, 'Jira writes CRLF');
assert.match(csv, /^Issue Type,Issue key,Summary/, 'and ships a Source-shape header');

const detection = detectSource(csv, 'issues.csv');
assert.equal(detection.source.id, 'jira', 'identified as Jira');
assert.equal(detection.confidence, 'exact');

const result = importFromPmSource(csv, 'issues.csv');
assert.equal(result.entries.length, 3, 'all three rows import');

// The embedded comma and newline stay inside the description cell.
const first = result.entries[0];
assert.equal(first.title, 'Cancellation waitlist');
assert.match(first.description ?? '', /roughly 12% of booked appointments/, 'the embedded comma did not end the field');
// Both Labels columns become tags, plus Component - Jira's label column, so it is
// genuinely a label and mapping it is correct.
assert.deepEqual(first.tags.sort(), ['clinic', 'revenue', 'scheduling'], 'both Labels columns and Component became tags');

// Priority and Sprint are deliberately NOT tags - they are ticket metadata, and an
// earlier version imported real exports as `#high` and `#2026-03-s1`. They belong in
// the unmapped report instead.
assert.ok(!first.tags.includes('high'), 'Priority is not a tag');
assert.ok(!first.tags.some((t) => /-s\d/i.test(t)), 'a sprint code is not a tag');

// The remaining columns are all named as unmapped.
const named = new Set(result.unmappedColumns);
for (const column of ['Issue Type', 'Issue key', 'Story Points', 'Sprint', 'Parent', 'Time Spent', 'Work Log', 'Priority', 'Status']) {
	assert.ok(named.has(column), `the unmapped report names ${column}: ${result.unmappedColumns.join(', ')}`);
}
// And a mapped one is not reported as unmapped.
assert.ok(!named.has('Summary') && !named.has('Description'), 'mapped columns are not in the report');

assert.equal(result.skipped.length, 0, 'nothing was skipped');

console.log('PASS: the real Jira fixture parses correctly, and every unmapped column is named.');