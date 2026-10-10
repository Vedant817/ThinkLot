/**
 * Themes as data, shared by both clients.
 *
 * Before this module, the palette lived in two places that had to agree by
 * discipline: web `layout.css` variables and mobile `usePalette()` literals.
 * They drifted twice (a sage/olive mobile palette with no violet at all; a
 * `danger`/`bad` mismatch nobody noticed until a test compared them). The rule
 * now: `DEFAULT_THEME` below is the source of truth, and
 * `verify-theme-contrast.ts` asserts both clients equal it, so drift fails a
 * gate instead of shipping quietly.
 *
 * A theme defines BOTH modes. A light-only theme would leave every dark-mode
 * user stranded the moment they pick it, and a builder that lets that happen
 * is a worse failure than no builder at all.
 */

export type ThemeTokens = {
	paper: string;
	panel: string;
	sunk: string;
	line: string;
	lineStrong: string;
	ink: string;
	ink2: string;
	muted: string;
	signal: string;
	signalInk: string;
	signalSoft: string;
	lot: string;
	lotSoft: string;
	ok: string;
	okSoft: string;
	warn: string;
	warnSoft: string;
	danger: string;
	dangerSoft: string;
	good: string;
	goodSoft: string;
};

export const TOKEN_KEYS = [
	'paper',
	'panel',
	'sunk',
	'line',
	'lineStrong',
	'ink',
	'ink2',
	'muted',
	'signal',
	'signalInk',
	'signalSoft',
	'lot',
	'lotSoft',
	'ok',
	'okSoft',
	'warn',
	'warnSoft',
	'danger',
	'dangerSoft',
	'good',
	'goodSoft'
] as const;

export type TokenKey = (typeof TOKEN_KEYS)[number];

export type ThemeDef = {
	/** URL-safe slug. `default` is reserved for the built-in. */
	id: string;
	/** What the picker shows. */
	name: string;
	light: ThemeTokens;
	dark: ThemeTokens;
};

export const THEME_VERSION = 1;

/**
 * The built-in theme. Values here must equal web `layout.css` and mobile
 * `usePalette()` exactly - the contrast suite asserts it per token, per mode.
 */
export const DEFAULT_THEME: ThemeDef = {
	id: 'default',
	name: 'Default',
	light: {
		paper: '#ffffff',
		panel: '#f6f6f4',
		sunk: '#eeeeeb',
		line: '#e4e4de',
		lineStrong: '#85857d',
		ink: '#141418',
		ink2: '#55554f',
		muted: '#6b6b64',
		signal: '#5b4bdb',
		signalInk: '#ffffff',
		signalSoft: '#eeecfd',
		lot: '#8a5300',
		lotSoft: '#fdf1dc',
		ok: '#0f6b45',
		okSoft: '#e4f5ec',
		warn: '#8a5a00',
		warnSoft: '#fdf1dc',
		danger: '#a81f14',
		dangerSoft: '#fdeae8',
		good: '#1c6b3a',
		goodSoft: '#e7f4ec'
	},
	dark: {
		paper: '#171920',
		panel: '#1f232b',
		sunk: '#1c2027',
		line: '#343944',
		lineStrong: '#737b8b',
		ink: '#e8eaf0',
		ink2: '#a8aebc',
		muted: '#8b93a3',
		signal: '#8b7cf6',
		signalInk: '#16121f',
		signalSoft: '#232038',
		lot: '#f0b429',
		lotSoft: '#2e2413',
		ok: '#46b981',
		okSoft: '#12271e',
		warn: '#f0b429',
		warnSoft: '#2b2010',
		danger: '#f87171',
		dangerSoft: '#2c1614',
		good: '#4ade80',
		goodSoft: '#142a1e'
	}
};

/** WCAG 2.1 relative luminance. The maths is the spec's, not an approximation. */
export function luminance(hex: string): number {
	const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) throw new Error(`not a 6-digit hex colour: "${hex}"`);
	const value = parseInt(m[1], 16);
	const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((raw) => {
		const c = raw / 255;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 1.4.3, normal body text. */
export const AA_TEXT = 4.5;
/** WCAG 1.4.11, non-text boundaries such as input outlines. */
export const AA_NON_TEXT = 3;

/**
 * Check one mode's tokens. Returns human sentences, empty when all clear.
 *
 * Deliberately advisory, not refusing: a theme that fails AA is the user's
 * informed choice to preview, and blocking save would make the builder feel
 * broken for color-blind users testing combinations. Both clients show these
 * sentences next to Save; neither hides them.
 */
export function validateTokens(tokens: ThemeTokens): string[] {
	const problems: string[] = [];
	const ratio = (fg: string, bg: string) => {
		try {
			return contrast(tokens[fg as TokenKey], tokens[bg as TokenKey]);
		} catch {
			return 0;
		}
	};
	for (const surface of ['paper', 'panel', 'sunk'] as const) {
		for (const ink of ['ink', 'ink2', 'muted'] as const) {
			if (ratio(ink, surface) < AA_TEXT) {
				problems.push(`${ink} on ${surface} is below AA text contrast.`);
			}
		}
		if (ratio('lot', surface) < AA_TEXT) {
			problems.push(`lot plates on ${surface} are below AA text contrast.`);
		}
		// `signal` is a text color here, not just a fill: outline buttons and
		// links wear it as foreground on all three surfaces, so a custom signal
		// that fails as text fails the theme, however it looks as a slab.
		if (ratio('signal', surface) < AA_TEXT) {
			problems.push(`signal text on ${surface} is below AA text contrast.`);
		}
	}
	for (const surface of ['paper', 'panel'] as const) {
		if (ratio('lineStrong', surface) < AA_NON_TEXT) {
			problems.push(`input outlines on ${surface} are below the non-text minimum.`);
		}
	}
	return problems;
}

export function validateTheme(def: ThemeDef): { light: string[]; dark: string[] } {
	return { light: validateTokens(def.light), dark: validateTokens(def.dark) };
}

export function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return slug || 'theme';
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export type ThemeImportResult =
	| { ok: true; theme: ThemeDef; filled: TokenKey[]; warnings: string[] }
	| { ok: false; error: string };

/**
 * Read a theme from pasted or shared JSON.
 *
 * Strict about shape, forgiving about gaps: a missing token is filled from the
 * built-in and NAMED, so importing a theme that only redefines accents does the
 * obvious thing instead of failing. A missing mode, a non-object, or a bad hex
 * anywhere is a refusal - a theme that half-applies is worse than none, because
 * the user cannot tell which half they are looking at.
 */
export function parseThemeImport(text: string): ThemeImportResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { ok: false, error: 'That is not JSON. Export a theme first and paste the whole file.' };
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
		return { ok: false, error: 'A theme is a JSON object with a name, light and dark colors.' };
	}
	const obj = raw as Record<string, unknown>;
	const name = typeof obj.name === 'string' ? obj.name.trim() : '';
	if (!name) return { ok: false, error: 'A theme needs a name.' };
	if (name.length > 60) return { ok: false, error: 'Keep the name under 60 characters.' };
	for (const mode of ['light', 'dark'] as const) {
		if (typeof obj[mode] !== 'object' || obj[mode] === null || Array.isArray(obj[mode])) {
			return { ok: false, error: `A theme needs both light and dark colors - "${mode}" is missing.` };
		}
	}
	const filled: TokenKey[] = [];
	const warnings: string[] = [];
	const modes = {} as Record<'light' | 'dark', ThemeTokens>;
	for (const mode of ['light', 'dark'] as const) {
		const src = obj[mode] as Record<string, unknown>;
		const tokens = {} as Record<TokenKey, string>;
		for (const key of TOKEN_KEYS) {
			const value = src[key];
			if (value === undefined) {
				tokens[key] = DEFAULT_THEME[mode][key];
				filled.push(key);
			} else if (typeof value !== 'string' || !HEX.test(value.trim())) {
				return { ok: false, error: `"${key}" in ${mode} is not a color like #8b7cf6.` };
			} else {
				tokens[key] = value.trim().toLowerCase();
			}
		}
		modes[mode] = tokens as ThemeTokens;
		const problems = validateTokens(modes[mode]);
		for (const p of problems) warnings.push(`${mode}: ${p}`);
	}
	const id = `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;
	return { ok: true, theme: { id, name, light: modes.light, dark: modes.dark }, filled, warnings };
}

/** Stable export shape. Versioned so a future token set can migrate. */
export function serializeTheme(def: ThemeDef): string {
	return JSON.stringify(
		{ version: THEME_VERSION, id: def.id, name: def.name, light: def.light, dark: def.dark },
		null,
		2
	);
}

// ---------------------------------------------------------------------------
// Type scale
// ---------------------------------------------------------------------------

export type FontScaleId = 'compact' | 'default' | 'large' | 'xl';

export const FONT_SCALES: { id: FontScaleId; label: string; mult: number; blurb: string }[] = [
	{ id: 'compact', label: 'Compact', mult: 0.9, blurb: 'More on screen, smaller text.' },
	{ id: 'default', label: 'Default', mult: 1, blurb: 'Designed size.' },
	{ id: 'large', label: 'Large', mult: 1.15, blurb: 'Easier reading.' },
	{ id: 'xl', label: 'Extra large', mult: 1.3, blurb: 'Largest. Layouts may wrap more.' }
];

export function fontMult(id: string): number {
	return FONT_SCALES.find((s) => s.id === id)?.mult ?? 1;
}

/** Scale a point size and round to whole points - fractional points shimmer. */
export function scaled(px: number, id: string): number {
	return Math.max(8, Math.round(px * fontMult(id)));
}
