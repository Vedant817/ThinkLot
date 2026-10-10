/**
 * Settings, appearance and type scale: presence, parity, and honesty.
 *
 * Three features that must agree across clients: where settings live, how a
 * theme is chosen/built/imported, and how text size changes. The shared
 * `theme.ts` math is covered by `verify-theme-contrast.ts`; this file covers
 * the wiring both clients need: routes exist, stores persist under the same
 * key names, the boot script agrees with the store, and nothing renders a
 * control its platform cannot honor.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const strip = (src: string) =>
	src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

const read = (p: string) => strip(readFileSync(p, 'utf8'));

// ---------------------------------------------------------------- settings

{
	const home = read('src/routes/(app)/settings/+page.svelte');
	assert.match(home, /api\.users\.current/, 'settings home shows the profile from the account');
	assert.match(home, /convex\.signOut/, 'settings home signs out through the client');
	assert.match(home, /\/settings\/appearance/, 'settings home links to appearance');
	assert.match(home, /\/settings\/ai/, 'settings home links to AI settings');
	assert.match(home, /\/settings\/transfer/, 'settings home links to transfer');
	assert.match(home, /\/settings\/analytics/, 'settings home links to numbers');
	assert.match(home, /storedKeyIds/, 'integrations state derives from stored keys, not memory');
	assert.match(home, /Manage/, 'integrations rows carry an action, not just status');

	const account = read('apps/mobile/src/app/(tabs)/account.tsx');
	assert.match(account, /Profile/, 'mobile account has a profile section');
	assert.match(account, /signOut\(\)/, 'mobile profile signs out');
	assert.match(account, /\/appearance/, 'mobile account links to appearance');

	const integrations = read('apps/mobile/src/components/integrations.tsx');
	assert.match(integrations, /useFocusEffect/, 'mobile integrations refresh on focus, never stale');
	assert.match(integrations, /storedKeyIds/, 'mobile integrations read the keychain');
	assert.match(integrations, /\/ai-settings/, 'mobile integrations link to AI settings');
}

// ------------------------------------------------------------------ themes

{
	// The store is the only writer. Two writers for one surface is how they disagree.
	const store = read('src/lib/theme-store.svelte.ts');
	for (const key of ['thinklot:theme-mode', 'thinklot:theme-active', 'thinklot:themes-custom', 'thinklot:font-scale']) {
		assert.ok(store.includes(`'${key}'`), `web store persists ${key}`);
	}
	assert.match(store, /resolvedScheme/, 'system mode resolves against the OS');
	assert.match(store, /saveCustom/, 'store saves customs');
	assert.match(store, /deleteCustom/, 'store deletes customs');

	// Boot script parity: the same key names, the same css-var mapping, the same
	// font percentages. A boot script that disagrees with the store flashes the
	// wrong theme for one frame on every cold start.
	const boot = readFileSync('src/app.html', 'utf8');
	for (const key of ['thinklot:theme-mode', 'thinklot:theme-active', 'thinklot:themes-custom', 'thinklot:font-scale', 'thinklot:theme']) {
		assert.ok(boot.includes(key), `boot script handles ${key}`);
	}
	assert.ok(boot.includes('lineStrong') && boot.includes('rule-strong'), 'boot script maps canonical keys to css vars');

	const appearance = read('src/routes/(app)/settings/appearance/+page.svelte');
	assert.match(appearance, /System/, 'web offers system mode, not just light/dark');
	assert.match(appearance, /type="color"/, 'web builder uses native color inputs');
	assert.match(appearance, /parseThemeImport/, 'web import parses through the shared module');
	assert.match(appearance, /serializeTheme/, 'web export serializes through the shared module');
	assert.match(appearance, /builderWarnings/, 'web builder shows contrast notes');
	assert.match(appearance, /FONT_SCALES/, 'web offers the shared type sizes');

	const mobileAppearance = read('apps/mobile/src/app/appearance.tsx');
	assert.match(mobileAppearance, /system/, 'mobile offers system mode');
	assert.match(mobileAppearance, /parseThemeImport/, 'mobile import parses through the shared module');
	assert.match(mobileAppearance, /serializeTheme/, 'mobile export serializes through the shared module');
	assert.match(mobileAppearance, /Share\.share/, 'mobile export goes through the share sheet');
	assert.match(mobileAppearance, /Alert\.alert/, 'mobile delete confirms natively');
	assert.match(mobileAppearance, /FONT_SCALES/, 'mobile offers the shared type sizes');

	// Mobile theme plumbing: one provider, unchanged call sites.
	const ui = read('apps/mobile/src/components/ui.tsx');
	assert.match(ui, /ThemeProvider/, 'ui exports the theme provider');
	assert.match(ui, /tokensToPalette/, 'palette maps from shared tokens');
	assert.match(ui, /AsyncStorage\.getItem\(MODE_KEY\)/, 'provider restores persisted choices');
	const layout = read('apps/mobile/src/app/_layout.tsx');
	assert.match(layout, /<ThemeProvider>/, 'theme wraps everything including sign-in');

	// Import/export byte-identity across clients is structural: both call the
	// same two functions on the same shape. Asserted here so a future
	// platform-specific "fix" that breaks the format fails loudly.
	assert.ok(
		read('apps/mobile/src/lib/api.ts').includes('parseThemeImport') &&
			read('apps/mobile/src/lib/api.ts').includes('serializeTheme'),
		'mobile re-exports the shared theme module'
	);
}

// ---------------------------------------------------------------- type size

{
	// Web applies at the root: rem-based utilities follow document font size.
	const store = read('src/lib/theme-store.svelte.ts');
	assert.match(store, /document\.documentElement\.style\.fontSize/, 'web type size sets root font size');

	// Mobile applies in the primitives plus every inline fontSize outside them.
	const ui = read('apps/mobile/src/components/ui.tsx');
	assert.match(ui, /useFontMult/, 'primitives scale through one multiplier');
	const scaledFiles = [
		'apps/mobile/src/app/(tabs)/_layout.tsx',
		'apps/mobile/src/app/(tabs)/board.tsx',
		'apps/mobile/src/app/(tabs)/index.tsx',
		'apps/mobile/src/app/(tabs)/review.tsx',
		'apps/mobile/src/components/ai-action.tsx',
		'apps/mobile/src/components/idea-list.tsx',
		'apps/mobile/src/lib/connection.tsx'
	];
	for (const file of scaledFiles) {
		const src = read(file);
		assert.ok(src.includes('useFontMult'), `${file} scales its inline text`);
		assert.ok(!/fontSize: \d+[,}]/.test(src), `${file} has no unscaled inline font size left`);
	}
}

console.log('PASS: settings gather profile and integrations, themes build/import on both clients, type scales everywhere text is painted.');
