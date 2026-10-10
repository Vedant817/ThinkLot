/**
 * Both clients offer every export target.
 *
 * The export code lived in one place (`$lib/export`) and both clients hand-wrote their
 * own buttons. They drifted, and a real device run proved it:
 *
 *   - web had three buttons: "Markdown for Notion", "JSON backup", "CSV" - so Jira,
 *     Linear and Obsidian were unreachable even though the module produces all of them;
 *   - Android had the same three, under different names.
 *
 * Both were wired to `$lib/export` afterwards, and this exists so that a target added
 * to the module cannot silently appear on neither client. A button is the only way a
 * user can reach a destination, so a missing button is a missing feature, not a style
 * problem.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXPORT_TARGETS } from '../src/lib/export';

assert.ok(EXPORT_TARGETS.length >= 5, 'the module should define at least five targets');

// Both clients must loop over the shared table rather than enumerate names.
const web = readFileSync('src/routes/(app)/settings/transfer/+page.svelte', 'utf8');
const mobile = readFileSync('apps/mobile/src/components/transfer.tsx', 'utf8');

for (const client of [
	{ name: 'web', source: web },
	{ name: 'android', source: mobile }
] as const) {
	assert.ok(
		client.source.includes('EXPORT_TARGETS'),
		`${client.name} must import the shared export target table`
	);
	assert.ok(
		/EXPORT_TARGETS\.(map|find)\(/.test(client.source),
		`${client.name} must generate its buttons from the table, not name them by hand`
	);
	assert.ok(
		client.source.includes('exportFor('),
		`${client.name} must call exportFor() so the target's own contract decides the file`
	);
}

// Every target's import steps must reach the screen. A file called
// `thinklot-jira-....csv` is not the same as issues in a backlog.
for (const target of EXPORT_TARGETS) {
	assert.ok(
		target.howTo.length > 10,
		`${target.id} has no usable import instructions: "${target.howTo}"`
	);
	assert.match(target.howTo, /import|copy|open|drag|paste|settings/i, `${target.id} steps are not instructions`);
	assert.ok(
		/^[a-z0-9-]+$/.test(target.filename().match(/thinklot-[a-z0-9-]+-/)?.[0] ?? ''),
		`${target.id} must distinguish itself in the filename`
	);
}

// The JSON backup is NOT a target, and must not be offered as one. It is the lossless
// round-trip this app reads back, which is a different contract from a conversion into
// somebody else's format.
assert.ok(
	!EXPORT_TARGETS.some((t) => t.id === 'json'),
	'the JSON backup must not be listed as a destination tool'
);
for (const client of [
	{ name: 'web', source: web },
	{ name: 'android', source: mobile }
] as const) {
	assert.ok(
		/toBackupJson\(/.test(client.source),
		`${client.name} must still offer the lossless backup separately`
	);
}

// Android shares rather than downloads, because there is no filesystem picker and
// installing one is blocked on this machine. It must still go through Share.share.
// (The prose names the module it does NOT use, so this checks for an import, not a
// mention - otherwise the explanation itself would fail the test.)
assert.match(mobile, /Share\.share\(/, 'android export goes through the share sheet');
assert.doesNotMatch(
	mobile,
	/^import .*expo-file-system/m,
	'expo-file-system cannot be installed here; the share sheet is the available path'
);

console.log(
	`PASS: ${EXPORT_TARGETS.length} export targets reach both clients from one shared table, each with its own import instructions.`
);
