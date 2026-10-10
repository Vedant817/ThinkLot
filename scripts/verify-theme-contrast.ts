/**
 * Every ink token must clear WCAG AA on every surface it can sit on.
 *
 * This exists because softening the dark theme is exactly the change that quietly
 * breaks contrast. A device run flagged dark mode as "too black, very contrasted",
 * and the fix - lifting the surfaces and dimming the inks - moves the tokens in
 * opposite directions of the ratio that has to hold.
 *
 * The light theme made this mistake once already: `--ink-3` was asserted in the
 * comment to clear 4.5:1 on sunk and measured 4.353:1. The audit was right and the
 * comment was wrong, which is the worst combination. So the claim is executable now.
 *
 * Read from the source of truth in both clients, so the two palettes cannot drift
 * without this failing: web `layout.css`, mobile `components/ui.tsx` - and both
 * against `src/lib/theme.ts` DEFAULT_THEME, so the shared definition cannot drift
 * from either client either. Three-way agreement, or the gate fails.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	contrast,
	AA_TEXT,
	AA_NON_TEXT,
	DEFAULT_THEME,
	TOKEN_KEYS,
	parseThemeImport,
	validateTheme,
	fontMult,
	scaled,
	type ThemeTokens
} from '../src/lib/theme';

// ---------------------------------------------------------------- web tokens

const css = readFileSync('src/routes/layout.css', 'utf8');

/** Pull `--token: #hex;` out of a named block. */
function block(name: string): Record<string, string> {
	const start = css.indexOf(name);
	if (start < 0) throw new Error(`no ${name} block in layout.css`);
	const end = css.indexOf('}', start);
	const body = css.slice(start, end);
	const out: Record<string, string> = {};
	for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
		out[m[1]] = m[2].toLowerCase();
	}
	return out;
}

const light = block("[data-theme='light']");
const dark = block("[data-theme='dark']");

for (const theme of [
	{ name: 'light', t: light },
	{ name: 'dark', t: dark }
] as const) {
	for (const surface of ['paper', 'panel', 'sunk']) {
		for (const ink of ['ink', 'ink-2', 'ink-3', 'bad']) {
			if (!(ink in theme.t) || !(surface in theme.t)) continue;
			const ratio = contrast(theme.t[ink], theme.t[surface]);
			assert.ok(
				ratio >= AA_TEXT,
				`web ${theme.name}: --${ink} on --${surface} is ${ratio.toFixed(3)}:1, below AA 4.5:1 ` +
					`(${theme.t[ink]} on ${theme.t[surface]})`
			);
		}
	}
	// The only thing outlining a text input must be perceivable.
	for (const surface of ['paper', 'panel']) {
		assert.ok(
			contrast(theme.t['rule-strong'], theme.t[surface]) >= AA_NON_TEXT,
			`web ${theme.name}: --rule-strong on --${surface} fails the 3:1 non-text requirement`
		);
	}
	// The amber plate is the product's signature element; it must be readable.
	for (const surface of ['paper', 'panel', 'sunk']) {
		assert.ok(
			contrast(theme.t['lot'], theme.t[surface]) >= AA_TEXT,
			`web ${theme.name}: --lot on --${surface} is ${contrast(theme.t['lot'], theme.t[surface]).toFixed(2)}:1`
		);
	}
}

// -------------------------------------------------------------- mobile tokens

const mobile = readFileSync('apps/mobile/src/components/ui.tsx', 'utf8');

/** Pull `key: "#hex",` out of the dark or light object literal. */
function mobileBlock(isDark: boolean): Record<string, string> {
	const start = mobile.indexOf(isDark ? '    ? {' : '    : {');
	if (start < 0) throw new Error('cannot find the mobile palette objects');
	// Walk to the matching close, tracking brace depth so the nested literal ends.
	let depth = 0;
	let i = mobile.indexOf('{', start);
	const from = i;
	for (; i < mobile.length; i++) {
		if (mobile[i] === '{') depth++;
		else if (mobile[i] === '}') {
			depth--;
			if (depth === 0) break;
		}
	}
	const body = mobile.slice(from, i + 1);
	const out: Record<string, string> = {};
	for (const m of body.matchAll(/(\w+):\s*"(#[0-9a-fA-F]{6})"/g)) {
		out[m[1]] = m[2].toLowerCase();
	}
	return out;
}

const mobileDark = mobileBlock(true);
const mobileLight = mobileBlock(false);

for (const theme of [
	{ name: 'light', t: mobileLight },
	{ name: 'dark', t: mobileDark }
] as const) {
	for (const surface of ['paper', 'panel', 'sunk']) {
		for (const ink of ['ink', 'ink2', 'muted', 'danger']) {
			if (!(ink in theme.t) || !(surface in theme.t)) continue;
			const ratio = contrast(theme.t[ink], theme.t[surface]);
			assert.ok(
				ratio >= AA_TEXT,
				`mobile ${theme.name}: ${ink} on ${surface} is ${ratio.toFixed(3)}:1, below AA 4.5:1 ` +
					`(${theme.t[ink]} on ${theme.t[surface]})`
			);
		}
	}
	for (const surface of ['paper', 'panel']) {
		assert.ok(
			contrast(theme.t.lineStrong, theme.t[surface]) >= AA_NON_TEXT,
			`mobile ${theme.name}: lineStrong on ${surface} fails the 3:1 non-text requirement`
		);
	}
	for (const surface of ['paper', 'panel', 'sunk']) {
		assert.ok(
			contrast(theme.t.lot, theme.t[surface]) >= AA_TEXT,
			`mobile ${theme.name}: lot on ${surface} is ${contrast(theme.t.lot, theme.t[surface]).toFixed(2)}:1`
		);
	}
}

// ------------------------------------------------- the two clients must agree

// One product. The whole reason these values are duplicated is so they cannot drift,
// and a drift in the DARK theme is invisible until someone compares the two clients
// side by side, so it is asserted rather than left to review.
const pairs: [string, string][] = [
	['paper', 'paper'],
	['panel', 'panel'],
	['sunk', 'sunk'],
	['line', 'rule'],
	['lineStrong', 'rule-strong'],
	['ink', 'ink'],
	['ink2', 'ink-2'],
	['muted', 'ink-3'],
	['signal', 'signal'],
	['signalInk', 'signal-ink'],
	['signalSoft', 'signal-soft'],
	['lot', 'lot'],
	['lotSoft', 'lot-soft'],
	['danger', 'bad'],
	['ok', 'ok'],
	['danger', 'bad']
];

for (const [mobileKey, webKey] of pairs) {
	for (const theme of [
		{ name: 'light', m: mobileLight, w: light },
		{ name: 'dark', m: mobileDark, w: dark }
	] as const) {
		assert.ok(
			mobileKey in theme.m,
			`mobile ${theme.name} palette is missing ${mobileKey}`
		);
		assert.ok(
			webKey in theme.w,
			`web ${theme.name} palette is missing ${webKey}`
		);
		assert.equal(
			theme.m[mobileKey],
			theme.w[webKey],
			`${theme.name}: mobile ${mobileKey} (${theme.m[mobileKey]}) and web ${webKey} ` +
				`(${theme.w[webKey]}) have drifted apart`
		);
	}
}

// ------------------------------------------------- three-way agreement
//
// The shared DEFAULT_THEME must equal both clients, token for token. This is
// the assertion that makes "single source of truth" a fact rather than a
// comment: change a value in one place without the others and the gate fails
// naming the token and the mode.
{
	// css `--rule-strong` style names to canonical keys.
	const webToCanonical: Record<string, string> = {
		paper: 'paper', panel: 'panel', sunk: 'sunk', rule: 'line', 'rule-strong': 'lineStrong',
		ink: 'ink', 'ink-2': 'ink2', 'ink-3': 'muted', signal: 'signal', 'signal-ink': 'signalInk',
		'signal-soft': 'signalSoft', lot: 'lot', 'lot-soft': 'lotSoft', ok: 'ok', 'ok-soft': 'okSoft',
		warn: 'warn', 'warn-soft': 'warnSoft', bad: 'danger', 'bad-soft': 'dangerSoft',
		good: 'good', 'good-soft': 'goodSoft'
	};
	for (const mode of ['light', 'dark'] as const) {
		const expected = DEFAULT_THEME[mode] as unknown as Record<string, string>;
		const sources = { web: mode === 'light' ? light : dark, mobile: mode === 'light' ? mobileLight : mobileDark };
		for (const key of TOKEN_KEYS) {
			// Web side: find the css var that maps to this canonical key.
			const cssVar = Object.keys(webToCanonical).find((v) => webToCanonical[v] === key)!;
			assert.equal(
				sources.web[cssVar],
				expected[key],
				`web ${mode} --${cssVar} differs from DEFAULT_THEME.${mode}.${key}`
			);
			// Mobile side: every canonical key except the *-soft set and warn pair,
			// which the phone never reads (it uses signalSoft/lotSoft + ok/good/danger only).
			if (key.endsWith('Soft') && key !== 'signalSoft' && key !== 'lotSoft') continue;
			if (key === 'warn' || key === 'warnSoft') continue;
			assert.ok(key in sources.mobile, `mobile ${mode} palette is missing ${key} that DEFAULT_THEME defines`);
			assert.equal(
				(sources.mobile as Record<string, string>)[key],
				expected[key],
				`mobile ${mode} ${key} differs from DEFAULT_THEME.${mode}.${key}`
			);
		}
	}
}

// --------------------------------------------- import/export + font scale

{
	// A full theme round-trips byte-identically through export and import.
	const exported = JSON.stringify({ version: 1, id: 'x', name: 'Round trip', light: DEFAULT_THEME.light, dark: DEFAULT_THEME.dark });
	const parsed = parseThemeImport(exported);
	assert.equal(parsed.ok, true, 'a well-formed export must import');
	if (parsed.ok) {
		assert.deepEqual(parsed.theme.light, DEFAULT_THEME.light, 'light survives the round trip');
		assert.deepEqual(parsed.theme.dark, DEFAULT_THEME.dark, 'dark survives the round trip');
		assert.deepEqual(parsed.filled, [], 'nothing needs filling on a full export');
		// Imported ids are unique per import, so two imports of the same file are
		// two themes, not a collision.
		const again = parseThemeImport(exported);
		assert.ok(again.ok && again.theme.id !== parsed.theme.id, 're-import mints a fresh id');
	}

	// A partial theme fills from the built-in and SAYS SO.
	const partial = parseThemeImport(
		JSON.stringify({ name: 'Accents', light: { signal: '#ff0000' }, dark: { signal: '#00ff00' } })
	);
	assert.equal(partial.ok, true, 'a partial theme imports');
	if (partial.ok) {
		assert.equal(partial.theme.light.signal, '#ff0000', 'the override wins');
		assert.equal(partial.theme.light.paper, DEFAULT_THEME.light.paper, 'gaps fill from built-in');
		assert.ok(partial.filled.length > 0, 'filled tokens are reported');
		assert.ok(partial.warnings.length > 0, 'a pure-red signal on white warns about contrast');
	}

	// Refusals, each with a message a user can act on.
	for (const bad of [
		'not json at all',
		'[1,2,3]',
		JSON.stringify({ name: '', light: {}, dark: {} }),
		JSON.stringify({ name: 'No modes' }),
		JSON.stringify({ name: 'Bad hex', light: { paper: 'red' }, dark: {} }),
		JSON.stringify({ name: 'x'.repeat(61), light: {}, dark: {} })
	]) {
		const r = parseThemeImport(bad);
		assert.equal(r.ok, false, `must refuse: ${bad.slice(0, 40)}`);
		if (!r.ok) assert.ok(r.error.length > 10, 'refusals explain themselves');
	}

	// validateTheme agrees with the gate above on the built-in.
	assert.deepEqual(validateTheme(DEFAULT_THEME), { light: [], dark: [] }, 'built-in validates clean');

	// Font scale is a closed set with a safe fallback.
	assert.equal(fontMult('default'), 1, 'default is unity');
	assert.equal(fontMult('nope'), 1, 'unknown scale degrades to unity, not zero or NaN');
	assert.equal(scaled(15, 'large'), 17, '15pt at 1.15 rounds to 17');
	assert.ok(scaled(10, 'compact') >= 8, 'minimum 8pt floor holds');
}

console.log('PASS: every ink token clears WCAG AA on every surface, and the two clients are still one palette.');
