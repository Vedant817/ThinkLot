/**
 * Keyboard shortcut resolution tests.
 *
 * Run with `npm run verify:shortcuts` (vite-node resolves the TypeScript
 * directly, so there is no build step and no test-runner dependency).
 *
 * This exists because the chord logic was WRONG when first written and reading
 * it did not reveal that. `resolve` looked for a chord entry whose `key` matched
 * the pressed key, but `chord` holds the prefix and `key` holds the second key -
 * so every `g`-chord silently did nothing. The single-key shortcuts worked, which
 * is exactly the shape of bug that ships, because the obvious manual test ("press
 * /") passes.
 */
import { buildShortcuts, resolve } from '../src/lib/keyboard';

let passed = 0;
const failures: string[] = [];

function check(name: string, got: unknown, want: unknown) {
	if (got === want) {
		passed++;
		console.log(`  PASS  ${name}`);
	} else {
		failures.push(name);
		console.log(`  FAIL  ${name}   got=${String(got)} want=${String(want)}`);
	}
}

const shortcuts = buildShortcuts({
	focusCapture: () => {},
	go: () => {},
	toggleHelp: () => {},
	escape: () => {}
});

/** A KeyboardEvent stand-in with the fields `resolve` actually reads. */
function key(k: string, modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {}) {
	return {
		key: k,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		...modifiers
	} as unknown as KeyboardEvent;
}

console.log('\n== single-key shortcuts ==');
check('"/" focuses capture', resolve(shortcuts, key('/'), null).run?.label, 'Capture an idea');
check('"?" opens help', resolve(shortcuts, key('?'), null).run?.label, 'Show these shortcuts');
check('Escape resolves', resolve(shortcuts, key('Escape'), null).run?.label, 'Close, or step out of a field');

console.log('\n== two-key chords ==');
const armed = resolve(shortcuts, key('g'), null);
check('"g" alone navigates nothing', armed.run, null);
check('"g" arms the chord', armed.nextChord, 'g');

for (const [second, label] of [
	['l', 'g then l'],
	['b', 'g then b'],
	['r', 'g then r'],
	['a', 'g then a']
] as const) {
	const fired = resolve(shortcuts, key(second), 'g');
	check(`${label} fires`, fired.run?.keys, label);
	check(`${label} disarms`, fired.nextChord, null);
}

console.log('\n== a wrong second key is not a shortcut ==');
const wrong = resolve(shortcuts, key('z'), 'g');
check('g then z does nothing', wrong.run, null);
check('g then z drops the chord rather than leaving it armed', wrong.nextChord, null);

console.log('\n== browser and OS chords are never hijacked ==');
for (const modifier of ['metaKey', 'ctrlKey', 'altKey'] as const) {
	check(`${modifier}+g does not arm a chord`, resolve(shortcuts, key('g', { [modifier]: true }), null).nextChord, null);
	check(`${modifier}+/ does not focus capture`, resolve(shortcuts, key('/', { [modifier]: true }), null).run, null);
	check(`${modifier} is ignored mid-chord`, resolve(shortcuts, key('l', { [modifier]: true }), 'g').run, null);
}

console.log('\n== chords are case-insensitive ==');
check('uppercase G arms the chord', resolve(shortcuts, key('G'), null).nextChord, 'g');
check('g then uppercase L navigates', resolve(shortcuts, key('L'), 'g').run?.keys, 'g then l');

console.log('\n== unrelated keys are inert ==');
for (const k of ['q', 'z', 'F5', 'Tab', 'Shift', 'ArrowDown', ' ']) {
	check(`${JSON.stringify(k)} does nothing`, resolve(shortcuts, key(k), null).run, null);
}

console.log('\n== every shortcut is reachable from the registry ==');
// A shortcut nobody can discover is not a feature, and `?` is the only way to
// find one - so nothing may exist that the overlay would not render.
check('the registry is not empty', shortcuts.length > 0, true);
check('every shortcut has a label to show', shortcuts.every((s) => s.label.length > 0), true);
check('every shortcut has key hints to show', shortcuts.every((s) => s.keys.length > 0), true);

console.log('\n-------------------------------------------');
if (failures.length === 0) {
	console.log(`ALL PASSED: ${passed} checks`);
} else {
	console.log(`PASSED: ${passed}   FAILED: ${failures.length}`);
	for (const f of failures) console.log(`  - ${f}`);
	process.exit(1);
}
