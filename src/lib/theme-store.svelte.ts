import { DEFAULT_THEME, type FontScaleId, type ThemeDef, type ThemeTokens } from '$lib/theme';

export type ThemeMode = 'light' | 'dark' | 'system';

const MODE_KEY = 'thinklot:theme-mode';
const ACTIVE_KEY = 'thinklot:theme-active';
const CUSTOM_KEY = 'thinklot:themes-custom';
const FONT_KEY = 'thinklot:font-scale';

/**
 * Theme + type state for the web client, as a rune-backed singleton.
 *
 * Two independent choices: the MODE (light / dark / follow the device) and the
 * THEME (built-in Default or a user-built custom). Custom themes live in
 * localStorage next to the mode - they are the user's own paint, not account
 * data, so they do not sync and do not need a server row.
 *
 * Application is two mechanisms because there are two paint paths: `data-theme`
 * picks the light/dark token block, and an inline `<style>` overrides individual
 * variables when the active theme is custom. The boot script in `app.html` does
 * the same computation dependency-free so first paint already matches.
 */
class ThemeStore {
	mode = $state<ThemeMode>('light');
	activeId = $state<string>('default');
	customs = $state<ThemeDef[]>([]);
	fontScale = $state<FontScaleId>('default');

	constructor() {
		if (typeof window === 'undefined') return;
		try {
			const mode = localStorage.getItem(MODE_KEY);
			if (mode === 'light' || mode === 'dark' || mode === 'system') {
				this.mode = mode;
			} else {
				// No stored choice: follow the device, matching the boot script's
				// fallback. Defaulting to 'light' here while boot defaults to
				// system would paint dark for one frame and then override it to
				// light on store apply - exactly the flash the boot script exists
				// to prevent.
				this.mode = 'system';
			}
			this.activeId = localStorage.getItem(ACTIVE_KEY) ?? 'default';
			this.customs = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as ThemeDef[];
			const font = localStorage.getItem(FONT_KEY);
			if (font === 'compact' || font === 'default' || font === 'large' || font === 'xl') {
				this.fontScale = font;
			}
		} catch {
			/* storage blocked: defaults stand */
		}
	}

	/** The effective scheme after resolving `system` against the OS. */
	resolvedScheme(): 'light' | 'dark' {
		if (this.mode !== 'system') return this.mode;
		if (typeof window === 'undefined') return 'light';
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}

	active(): ThemeDef {
		return this.customs.find((t) => t.id === this.activeId) ?? DEFAULT_THEME;
	}

	tokens(): ThemeTokens {
		return this.active()[this.resolvedScheme()];
	}

	private persist() {
		try {
			localStorage.setItem(MODE_KEY, this.mode);
			localStorage.setItem(ACTIVE_KEY, this.activeId);
			localStorage.setItem(CUSTOM_KEY, JSON.stringify(this.customs));
			localStorage.setItem(FONT_KEY, this.fontScale);
		} catch {
			/* storage blocked: the choice lasts the session */
		}
	}

	setMode(mode: ThemeMode) {
		this.mode = mode;
		this.persist();
		this.apply();
	}

	setActive(id: string) {
		this.activeId = id;
		this.persist();
		this.apply();
	}

	setFontScale(id: FontScaleId) {
		this.fontScale = id;
		this.persist();
		this.applyFont();
	}

	saveCustom(def: ThemeDef) {
		this.customs = [...this.customs.filter((t) => t.id !== def.id), def];
		this.activeId = def.id;
		this.persist();
		this.apply();
	}

	deleteCustom(id: string) {
		this.customs = this.customs.filter((t) => t.id !== id);
		if (this.activeId === id) this.activeId = 'default';
		this.persist();
		this.apply();
	}

	applyFont() {
		if (typeof document === 'undefined') return;
		const mult = { compact: 90, default: 100, large: 115, xl: 130 }[this.fontScale] ?? 100;
		document.documentElement.style.fontSize = `${mult}%`;
	}

	/**
	 * Paint the theme. Called on boot (after the inline script already did),
	 * on every change, and on OS scheme flips while in system mode.
	 */
	apply() {
		if (typeof document === 'undefined') return;
		const scheme = this.resolvedScheme();
		document.documentElement.dataset.theme = scheme;
		this.applyFont();
		let style = document.getElementById('thinklot-theme-overrides') as HTMLStyleElement | null;
		const active = this.active();
		if (active.id === 'default') {
			style?.remove();
			return;
		}
		const tokens = active[scheme];
		const css = `:root{${Object.entries(tokens)
			.map(([key, value]) => `--${CSS_VARS[key] ?? key}:${value};`)
			.join('')}}`;
		if (!style) {
			style = document.createElement('style');
			style.id = 'thinklot-theme-overrides';
			document.head.appendChild(style);
		}
		style.textContent = css;
	}
}

/** Canonical token key to the css variable the web client actually uses. */
const CSS_VARS: Record<string, string> = {
	paper: 'paper',
	panel: 'panel',
	sunk: 'sunk',
	line: 'rule',
	lineStrong: 'rule-strong',
	ink: 'ink',
	ink2: 'ink-2',
	muted: 'ink-3',
	signal: 'signal',
	signalInk: 'signal-ink',
	signalSoft: 'signal-soft',
	lot: 'lot',
	lotSoft: 'lot-soft',
	ok: 'ok',
	okSoft: 'ok-soft',
	warn: 'warn',
	warnSoft: 'warn-soft',
	danger: 'bad',
	dangerSoft: 'bad-soft',
	good: 'good',
	goodSoft: 'good-soft'
};

export const themeStore = new ThemeStore();
