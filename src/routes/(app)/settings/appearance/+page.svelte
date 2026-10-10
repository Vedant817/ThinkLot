<script lang="ts">
	/**
	 * Appearance: mode, themes, and the builder.
	 *
	 * Modes are light / dark / system. Themes are the built-in Default plus
	 * user-built customs, each defining BOTH modes - a light-only theme would
	 * strand every dark-mode user the moment they pick it. Custom themes live in
	 * localStorage (paint, not account data), import/export shares the same JSON
	 * the phone reads, and contrast warnings are advisory: a failing combination
	 * is the user's informed choice to preview, not a broken save button.
	 */
	import { themeStore } from '$lib/theme-store.svelte';
	import {
		DEFAULT_THEME,
		TOKEN_KEYS,
		FONT_SCALES,
		validateTheme,
		parseThemeImport,
		serializeTheme,
		type ThemeDef,
		type ThemeTokens,
		type TokenKey
	} from '$lib/theme';

	const GROUPS: { title: string; keys: TokenKey[] }[] = [
		{ title: 'Surfaces', keys: ['paper', 'panel', 'sunk'] },
		{ title: 'Text', keys: ['ink', 'ink2', 'muted'] },
		{ title: 'Borders', keys: ['line', 'lineStrong'] },
		{ title: 'Action', keys: ['signal', 'signalInk', 'signalSoft'] },
		{ title: 'Numbers', keys: ['lot', 'lotSoft'] },
		{ title: 'Status', keys: ['ok', 'okSoft', 'warn', 'warnSoft', 'danger', 'dangerSoft', 'good', 'goodSoft'] }
	];

	function humanize(key: TokenKey): string {
		return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
	}

	const MODES = [
		{ id: 'light', label: 'Light' },
		{ id: 'dark', label: 'Dark' },
		{ id: 'system', label: 'System' }
	] as const;

	// --- builder state ---------------------------------------------------------
	let builderName = $state('');
	let builderMode = $state<'light' | 'dark'>('light');
	let builderTokens = $state<Record<'light' | 'dark', Record<TokenKey, string>>>({
		light: { ...DEFAULT_THEME.light },
		dark: { ...DEFAULT_THEME.dark }
	});
	let editingId = $state<string | null>(null);
	let builderError = $state<string | null>(null);

	const builderWarnings = $derived(
		validateTheme({ id: 'draft', name: builderName || 'draft', ...builderTokens })
	);

	function startNew() {
		builderName = '';
		builderTokens = { light: { ...DEFAULT_THEME.light }, dark: { ...DEFAULT_THEME.dark } };
		builderMode = themeStore.resolvedScheme();
		editingId = null;
		builderError = null;
	}

	function startEdit(def: ThemeDef) {
		builderName = def.name;
		builderTokens = { light: { ...def.light }, dark: { ...def.dark } };
		builderMode = themeStore.resolvedScheme();
		editingId = def.id;
		builderError = null;
	}

	function saveBuilder() {
		builderError = null;
		if (!builderName.trim()) {
			builderError = 'Give the theme a name first.';
			return;
		}
		const id =
			editingId ?? `${builderName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'theme'}-${Math.random().toString(36).slice(2, 8)}`;
		themeStore.saveCustom({ id, name: builderName.trim(), light: builderTokens.light, dark: builderTokens.dark });
		startNew();
	}

	// --- import / export ---------------------------------------------------------
	let importText = $state('');
	let importState = $state<{ ok: true; theme: ThemeDef; filled: string[]; warnings: string[] } | { ok: false; error: string } | null>(null);

	function runImport() {
		importState = null;
		const result = parseThemeImport(importText);
		if (!result.ok) {
			importState = { ok: false, error: result.error };
			return;
		}
		importState = { ok: true, theme: result.theme, filled: result.filled, warnings: result.warnings };
	}

	function keepImport() {
		if (!importState || !importState.ok) return;
		themeStore.saveCustom(importState.theme);
		importText = '';
		importState = null;
	}

	function download(name: string, contents: string, mime: string) {
		const url = URL.createObjectURL(new Blob([contents], { type: mime }));
		const link = document.createElement('a');
		link.href = url;
		link.download = name;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}

	function exportTheme(def: ThemeDef) {
		download(
			`thinklot-theme-${def.id}.json`,
			serializeTheme(def),
			'application/json'
		);
	}

	function previewDots(tokens: ThemeTokens): string[] {
		return [tokens.paper, tokens.signal, tokens.lot, tokens.ink, tokens.panel];
	}
</script>

<svelte:head><title>Appearance - ThinkLot</title></svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<a href="/settings" class="font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:text-ink">
		← Settings
	</a>

	<h1 class="mt-3 text-2xl font-bold text-ink">Appearance</h1>
	<p class="mt-2 max-w-prose text-sm leading-6 text-ink-2">
		How the app looks on this device. Themes are paint, not account data - they
		stay on this browser and never sync.
	</p>

	<!-- Mode -->
	<section class="mt-6">
		<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Mode</h2>
		<div class="mt-2 flex flex-wrap gap-2">
			{#each MODES as mode (mode.id)}
				<button
					type="button"
					onclick={() => themeStore.setMode(mode.id)}
					aria-pressed={themeStore.mode === mode.id}
					class="rounded-md border px-4 py-2 font-mono text-[11px] tracking-wider uppercase transition-colors {themeStore.mode === mode.id
						? 'border-signal bg-signal-soft text-signal'
						: 'border-rule text-ink-2 hover:border-signal hover:text-signal'}"
				>
					{mode.label}
				</button>
			{/each}
		</div>
		<p class="mt-1.5 text-sm text-ink-3">
			{#if themeStore.mode === 'system'}
				Following this device ({themeStore.resolvedScheme()} right now).
			{:else}
				Always {themeStore.mode}, regardless of the device.
			{/if}
		</p>
	</section>

	<!-- Type size -->
	<section class="mt-6">
		<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Type size</h2>
		<div class="mt-2 flex flex-wrap gap-2">
			{#each FONT_SCALES as scale (scale.id)}
				<button
					type="button"
					onclick={() => themeStore.setFontScale(scale.id)}
					aria-pressed={themeStore.fontScale === scale.id}
					title={scale.blurb}
					class="rounded-md border px-4 py-2 font-mono text-[11px] tracking-wider uppercase transition-colors {themeStore.fontScale === scale.id
						? 'border-signal bg-signal-soft text-signal'
						: 'border-rule text-ink-2 hover:border-signal hover:text-signal'}"
				>
					{scale.label}
				</button>
			{/each}
		</div>
		<p class="mt-1.5 text-sm text-ink-3">
			Scales the app's text. Layouts may wrap more at larger sizes - that is
			expected, not broken.
		</p>
	</section>

	<!-- Themes -->
	<section class="mt-8">
		<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Themes</h2>
		<ul class="mt-2 divide-y divide-rule overflow-hidden rounded-lg border border-rule bg-paper">
			{#each [DEFAULT_THEME, ...themeStore.customs] as theme (theme.id)}
				<li class="flex items-center gap-3 px-4 py-3">
					<span class="flex overflow-hidden rounded border border-rule" aria-hidden="true">
						{#each previewDots(theme[themeStore.resolvedScheme()]) as color (color)}
							<span class="block size-5" style:background-color={color}></span>
						{/each}
					</span>
					<div class="min-w-0 flex-1">
						<p class="text-[15px] font-medium text-ink">
							{theme.name}
							{#if themeStore.activeId === theme.id}
								<span class="ml-1 font-mono text-[10px] tracking-wider text-signal uppercase">active</span>
							{/if}
						</p>
						<p class="mt-0.5 text-sm text-ink-3">
							{theme.id === 'default' ? 'Built in.' : 'Yours.'}
						</p>
					</div>
					<div class="flex shrink-0 gap-1.5">
						{#if themeStore.activeId !== theme.id}
							<button
								type="button"
								onclick={() => themeStore.setActive(theme.id)}
								class="rounded border border-rule px-2 py-1 font-mono text-[10px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal"
							>
								Use
							</button>
						{/if}
						<button
							type="button"
							onclick={() => exportTheme(theme)}
							class="rounded border border-rule px-2 py-1 font-mono text-[10px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal"
						>
							Export
						</button>
						{#if theme.id !== 'default'}
							<button
								type="button"
								onclick={() => startEdit(theme)}
								class="rounded border border-rule px-2 py-1 font-mono text-[10px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal"
							>
								Edit
							</button>
							<button
								type="button"
								onclick={() => themeStore.deleteCustom(theme.id)}
								class="rounded border border-rule px-2 py-1 font-mono text-[10px] tracking-wider text-ink-3 uppercase hover:border-bad/40 hover:text-bad"
							>
								Delete
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>

	<!-- Builder -->
	<section class="mt-8">
		<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
			{editingId ? 'Edit theme' : 'Build a theme'}
		</h2>
		<p class="mt-2 max-w-prose text-sm leading-6 text-ink-2">
			Pick colors for both modes - a theme without a dark side strands night
			readers the moment they choose it. Contrast notes are advice, not a lock:
			they say what fails, and saving stays yours.
		</p>

		<label class="mt-4 block">
			<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Name</span>
			<input
				type="text"
				bind:value={builderName}
				placeholder="Evening paper"
				maxlength="60"
				autocomplete="off"
				spellcheck="false"
				class="mt-1.5 w-full rounded-md border border-rule bg-panel px-3 py-2 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper"
			/>
		</label>

		<div class="mt-4 flex gap-2" role="tablist" aria-label="Editing mode">
			{#each ['light', 'dark'] as const as mode (mode)}
				<button
					type="button"
					role="tab"
					aria-selected={builderMode === mode}
					onclick={() => (builderMode = mode)}
					class="rounded-md border px-4 py-1.5 font-mono text-[11px] tracking-wider uppercase {builderMode === mode
						? 'border-signal bg-signal-soft text-signal'
						: 'border-rule text-ink-2 hover:border-signal hover:text-signal'}"
				>
					{mode === 'light' ? 'Light' : 'Dark'}
				</button>
			{/each}
		</div>

		{#each GROUPS as group (group.title)}
			<details class="mt-3 rounded-lg border border-rule bg-paper" open={group.title === 'Surfaces' || group.title === 'Text'}>
				<summary class="cursor-pointer px-4 py-2.5 font-mono text-[11px] tracking-wider text-ink-3 uppercase">
					{group.title}
				</summary>
				<div class="grid gap-2 px-4 pb-4 sm:grid-cols-2">
					{#each group.keys as key (key)}
						<label class="flex items-center gap-2.5 rounded-md border border-rule bg-panel px-2.5 py-2">
							<input
								type="color"
								value={builderTokens[builderMode][key]}
								oninput={(e) => (builderTokens[builderMode][key] = e.currentTarget.value)}
								class="size-8 shrink-0 cursor-pointer rounded border border-rule bg-transparent p-0.5"
								aria-label={`${humanize(key)} color picker`}
							/>
							<span class="min-w-0 flex-1">
								<span class="block text-sm text-ink">{humanize(key)}</span>
								<span class="block font-mono text-[11px] text-ink-3">{builderTokens[builderMode][key]}</span>
							</span>
						</label>
					{/each}
				</div>
			</details>
		{/each}

		{#if builderWarnings[builderMode].length > 0}
			<div class="mt-3 rounded-md border border-warn/25 bg-warn-soft px-3 py-2" role="note">
				<p class="font-mono text-[11px] tracking-wider text-warn uppercase">Contrast notes · {builderMode}</p>
				<ul class="mt-1 space-y-0.5 text-sm text-ink-2">
					{#each builderWarnings[builderMode] as warning (warning)}
						<li>{warning}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if builderError}
			<p class="mt-2 text-sm text-bad" role="alert">{builderError}</p>
		{/if}

		<div class="mt-3 flex flex-wrap gap-2">
			<button
				type="button"
				onclick={saveBuilder}
				class="rounded-md border border-signal px-4 py-2 font-mono text-[11px] tracking-wider text-signal uppercase hover:bg-signal-soft"
			>
				{editingId ? 'Save changes' : 'Save theme'}
			</button>
			{#if editingId}
				<button
					type="button"
					onclick={startNew}
					class="rounded-md border border-rule px-4 py-2 font-mono text-[11px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal"
				>
					Start fresh instead
				</button>
			{/if}
		</div>
	</section>

	<!-- Import -->
	<section class="mt-8">
		<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Import a theme</h2>
		<p class="mt-2 max-w-prose text-sm leading-6 text-ink-2">
			Paste a theme file - exported from here or from the phone. Missing colors
			fill in from Default and are named, so an accents-only file does the
			obvious thing.
		</p>
		<label class="mt-3 block">
			<span class="sr-only">Theme JSON</span>
			<textarea
				bind:value={importText}
				rows="4"
				placeholder={'{\n  "name": "Evening paper",\n  "light": { "signal": "#b3541e" },\n  "dark": { "signal": "#e09a5f" }\n}'}
				spellcheck="false"
				autocomplete="off"
				class="w-full resize-y rounded-md border border-rule bg-panel px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper"
			></textarea>
		</label>
		<div class="mt-2">
			<button
				type="button"
				onclick={runImport}
				disabled={!importText.trim()}
				class="rounded-md border border-rule px-4 py-2 font-mono text-[11px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal disabled:opacity-40"
			>
				Preview import
			</button>
		</div>
		{#if importState}
			{#if importState.ok}
				<div class="mt-3 rounded-md border border-rule bg-panel px-3 py-2">
					<p class="text-sm text-ink">
						“{importState.theme.name}” reads clean.
						{#if importState.filled.length > 0}
							<span class="text-ink-3">
								{importState.filled.length} color{importState.filled.length === 1 ? '' : 's'} filled from Default{importState.filled.length <= 6 ? `: ${importState.filled.join(', ')}` : ''}.
							</span>
						{/if}
					</p>
					{#if importState.warnings.length > 0}
						<ul class="mt-1 space-y-0.5 text-sm text-ink-3">
							{#each importState.warnings.slice(0, 4) as warning (warning)}
								<li>{warning}</li>
							{/each}
							{#if importState.warnings.length > 4}
								<li>…and {importState.warnings.length - 4} more.</li>
							{/if}
						</ul>
					{/if}
					<div class="mt-2">
						<button
							type="button"
							onclick={keepImport}
							class="rounded-md border border-signal px-4 py-1.5 font-mono text-[11px] tracking-wider text-signal uppercase hover:bg-signal-soft"
						>
							Keep this theme
						</button>
					</div>
				</div>
			{:else}
				<p class="mt-2 text-sm text-bad" role="alert">{importState.error}</p>
			{/if}
		{/if}
	</section>
</div>
