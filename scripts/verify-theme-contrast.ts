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
 * without this failing: web `layout.css`, mobile `components/ui.tsx`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * WCAG 2.1 relative luminance. The maths is the spec's, not an approximation.
 */
function luminance(hex: string): number {
	const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) throw new Error(`not a 6-digit hex colour: "${hex}"`);
	const value = parseInt(m[1], 16);
	const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((raw) => {
		const c = raw / 255;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 1.4.3 - normal body text. */
const AA_TEXT = 4.5;
/** WCAG 1.4.11 - non-text boundaries, e.g. the only outline on an input. */
const AA_NON_TEXT = 3;

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

console.log('PASS: every ink token clears WCAG AA on every surface, and the two clients are still one palette.');
