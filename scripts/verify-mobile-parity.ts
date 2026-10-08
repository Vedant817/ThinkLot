/**
 * Mobile parity: do the two native clients still decode what the backend returns?
 *
 * ## Why this exists
 *
 * `apps/ios/scripts/verify-contracts.mjs` checks that every Convex function Swift
 * *names* still exists, and that every argument it sends still exists. It says nothing
 * about the RESPONSE. So a backend field rename - or a required field being dropped
 * from `toSummary` - would keep every contract green while the iOS app silently decoded
 * nothing, and nobody would find out until someone opened the app on a phone.
 *
 * That is the specific failure this closes. Swift's `Decodable` synthesises a decoder
 * that throws on a missing **non-optional** key, so the whole lot or detail screen
 * fails to render, and the failure looks like an auth problem rather than a contract one.
 *
 * ## What is checked, against the LIVE deployment
 *
 * Not the source. The actual JSON the dev deployment returns, from a throwaway account:
 *
 *   1. Every non-optional field of every Swift `Decodable` struct exists in the real
 *      `ideas:list` and `ideas:get` responses.
 *   2. Every non-optional field of the shared web `Idea` type exists too, so the
 *      Android client - which has no type of its own and therefore cannot catch drift
 *      with `tsc` - has a baseline that is actually enforced.
 *   3. Fields the CLIENTS do not know about are reported but never fail, because
 *      additive backend changes are safe for a decoder that ignores unknown keys. This
 *      check exists to catch removals, not additions.
 *
 * Run: `npm run verify:parity`
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONVEX = process.env.CONVEX_URL ?? 'https://posh-chihuahua-240.convex.cloud';
const PASSWORD = 'correct-horse-battery-staple';

let passes = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
	if (ok) {
		passes++;
		console.log(`  PASS  ${name}`);
	} else {
		failures.push(name);
		console.log(`  FAIL  ${name}${detail ? `   ${detail}` : ''}`);
	}
}

// --- Convex HTTP -----------------------------------------------------------------
async function call(fn: string, args: Record<string, unknown>, token?: string, kind: 'query' | 'mutation' | 'action' = 'mutation') {
	const response = await fetch(`${CONVEX}/api/${kind}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {})
		},
		body: JSON.stringify({ path: fn.replace(':', ':'), args, format: 'json' })
	});
	return (await response.json()) as { status: string; value?: unknown; errorMessage?: string };
}

// --- 1. Read the clients' REQUIRED fields from their own source --------------------

/**
 * Non-optional stored properties of Swift structs.
 *
 * These are the ones that make `Decodable` throw. An optional field that goes missing
 * decodes to nil and the screen renders with a blank - annoying. A required field that
 * goes missing fails the WHOLE decode - the screen does not render at all. Only the
 * second kind is worth blocking a change over.
 */
function swiftRequiredFields(structName: string): string[] {
	return swiftFields(structName).required;
}

/** Every stored property, optional ones included. */
function swiftFields(structName: string): { required: string[]; all: string[] } {
	const sources = readdirSync(path.join(ROOT, 'apps/ios/Sources'))
		.filter((f) => f.endsWith('.swift'))
		.map((f) => readFileSync(path.join(ROOT, 'apps/ios/Sources', f), 'utf8'));

	const required: string[] = [];
	const all: string[] = [];
	for (const source of sources) {
		const match = new RegExp(`struct\\s+${structName}\\s*:\\s*Decodable[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(source);
		if (!match) continue;
		for (const line of match[1].split('\n')) {
			// `let x: T` is required; `let x: T?` is optional. Computed properties have no
			// stored-type annotation we care about, and are skipped by the `let` anchor.
			const field = /^\s*let\s+(\w+)\s*:\s*([^=]+?)\s*$/.exec(line);
			if (!field) continue;
			if (field[2].includes('{')) continue; // computed, e.g. `var id: String {`
			all.push(field[1]);
			if (!field[2].trim().endsWith('?')) required.push(field[1]);
		}
	}
	return { required, all };
}

/**
 * Properties of the shared TypeScript `Idea` type, required ones separated out.
 *
 * Both halves are needed and confusing them is a trap worth naming: the FIRST version
 * of this only captured required fields, because the regex stopped at the name and an
 * optional `trigger?:` does not match. That made every optional field look like a new,
 * unrecognised addition - including `trigger`, which has been in the summary all along.
 */
function tsFields(): { required: string[]; all: string[] } {
	const source = readFileSync(path.join(ROOT, 'src/lib/types.ts'), 'utf8');
	const match = /export type Idea = \{([\s\S]*?)\n\};/.exec(source);
	assert.ok(match, 'could not find the shared Idea type in src/lib/types.ts');

	const required: string[] = [];
	const all: string[] = [];
	for (const line of match[1].split('\n')) {
		// `name: T;` is required, `name?: T;` optional. The `?` must be matched explicitly.
		const field = /^\s*(\w+)(\?)?\s*:\s*([^;]+);/.exec(line);
		if (!field) continue;
		all.push(field[1]);
		if (!field[2]) required.push(field[1]);
	}
	return { required, all };
}

// --- 2. Ask the live deployment what it actually returns -------------------------

const email = `qa-parity-${Date.now()}@example.com`;
const signed = await call(
	'signInProxy:signInProxy',
	{ provider: 'password', params: { email, password: PASSWORD, flow: 'signUp' } },
	undefined,
	'action'
);
if (signed.status !== 'success') {
	console.error(`Could not create a throwaway account: ${signed.errorMessage}`);
	process.exit(1);
}
const token = (signed.value as { tokens: { token: string } }).tokens.token;

// One idea with everything filled, so no field is absent because the user left it blank.
const captured = await call(
	'ideas:capture',
	{
		title: 'Parity probe idea',
		description: 'Notes that exist so the list carries a preview.',
		problem: 'Field notes are lost between shifts',
		audience: 'field engineers',
		outcome: 'no unconfirmed note survives a shift change',
		trigger: 'a postmortem in March',
		source: 'typed'
	},
	token
);
assert.equal(captured.status, 'success', `capture failed: ${captured.errorMessage}`);
const ideaId = captured.value as string;

await call('ideas:update', { ideaId, tags: ['parity'], impact: 3, effort: 1, confidence: 3, favorite: true }, token);

const listed = await call('ideas:list', { limit: 50 }, token, 'query');
const detail = await call('ideas:get', { ideaId }, token, 'query');

check('the live list query answers', listed.status === 'success', String(listed.errorMessage));
check('the live get query answers', detail.status === 'success', String(detail.errorMessage));
if (listed.status !== 'success' || detail.status !== 'success') {
	console.log(`\nPASSED: ${passes}   FAILED: ${failures.length}`);
	failures.forEach((f) => console.log(`  - ${f}`));
	process.exit(1);
}

const listIdea = (listed.value as { ideas: Record<string, unknown>[] }).ideas[0];
const getIdea = (detail.value as { idea: Record<string, unknown> }).idea;
assert.ok(listIdea && getIdea, 'expected at least one idea back');

// --- 3. Compare ------------------------------------------------------------------

console.log('\n== iOS: required Decodable fields must exist in the real response ==');

const swiftIdea = swiftRequiredFields('Idea');
check('the Swift Idea struct was found', swiftIdea.length > 0, 'parsing failed - a silent pass would be worse than a failure');

for (const field of swiftIdea) {
	const inList = Object.hasOwn(listIdea, field);
	const inDetail = Object.hasOwn(getIdea, field);
	check(`iOS decodes Idea.${field}`, inList && inDetail, `list=${inList} detail=${inDetail}`);
}

for (const [structName, payload] of [
	['IdeaPage', listed.value],
	['IdeaDetail', detail.value]
] as const) {
	const required = swiftRequiredFields(structName);
	check(`the Swift ${structName} struct was found`, required.length > 0);
	for (const field of required) {
		check(
			`iOS decodes ${structName}.${field}`,
			Object.hasOwn(payload as object, field),
			`missing from the live payload: ${JSON.stringify(Object.keys(payload as object))}`
		);
	}
}

console.log('\n== Android: the shared Idea type has a baseline, since the app has none of its own ==');

const ts = tsFields();
const tsIdea = ts.required;
check('the shared Idea type was found', tsIdea.length > 0);
for (const field of tsIdea) {
	const inList = Object.hasOwn(listIdea, field);
	const inDetail = Object.hasOwn(getIdea, field);
	check(`Android resolves Idea.${field}`, inList && inDetail, `list=${inList} detail=${inDetail}`);
}

// --- 4. Report additions without failing on them ----------------------------------

console.log('\n== Additive changes the clients ignore (safe, but worth seeing) ==');

/**
 * Scoped to the LIST response, deliberately.
 *
 * `ideas:get` returns the whole idea document - `_creationTime`, `userId`, `seqDesc`
 * and the full free text - so almost every internal field looks "new" there, and
 * calling that out would be noise on every run. The list is the summary shape, so a
 * field appearing there IS a contract change worth naming.
 */
const known = new Set([...swiftFields('Idea').all, ...ts.all]);
const additions = Object.keys(listIdea).filter((k) => !known.has(k));
if (additions.length === 0) {
	console.log('  (none)');
} else {
	// A Swift decoder ignores unknown keys and TypeScript structural typing permits
	// extra properties, so additions are SAFE. The point of listing them is that a
	// client which started depending on one of these would be relying on a field the
	// backend is free to remove.
	console.log(`  ignored by both clients: ${additions.join(', ')}`);
	check(
		'every new summary field is one we know was added deliberately',
		additions.every((k) => ['coreFields'].includes(k)),
		`unexpected new summary fields: ${additions.join(', ')}`
	);
}

// The detail response is the full row by design; assert that, so a future change that
// quietly reduced it to a summary would be noticed.
const detailExtras = ['_creationTime', 'userId', 'seqDesc'];
check(
	'ideas:get still returns the full document, not a summary',
	detailExtras.every((k) => Object.hasOwn(getIdea, k)),
	`detail keys: ${Object.keys(getIdea).join(', ')}`
);
check(
	'ideas:get still carries the full free text, not just a preview',
	typeof getIdea.description === 'string' && typeof getIdea.problem === 'string',
	'the detail page needs the real fields'
);

// --- 5. The shape change this was written for -------------------------------------

check(
	'list carries coreFields, which is what stops every listed idea reading as a spark',
	Object.hasOwn(listIdea, 'coreFields'),
	`list idea keys: ${Object.keys(listIdea).join(', ')}`
);

console.log(`\n-------------------------------------------`);
if (failures.length === 0) console.log(`ALL PASSED: ${passes} checks`, '\x1b[32m');
else {
	console.log(`PASSED: ${passes}   FAILED: ${failures.length}`, '\x1b[31m');
	failures.forEach((f) => console.log(`  - ${f}`));
}
console.log(`\nThrowaway account left behind (tracked in docs/TODO.md section 5): ${email}`);
process.exit(failures.length === 0 ? 0 : 1);