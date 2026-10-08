<script lang="ts">
	/**
	 * AI provider settings.
	 *
	 * Bring-your-own-key, entirely in the browser: the request goes from this page
	 * straight to the provider the user chose, so no key and no idea ever reaches a
	 * server this project runs, and there is nothing here to bill.
	 *
	 * The storage choice is presented honestly rather than decided for the user. A key
	 * typed into a browser cannot be kept secret from that browser, so the default is
	 * session-only and persistence is a separate, labelled opt-in.
	 */
	import { PROVIDERS, providerById, validateConfig, type ProviderId } from '$lib/ai/providers';
	import { callModel, type AiFailure } from '$lib/ai/client';
	import {
		loadKey,
		saveKey,
		forgetAll,
		storedKeyIds,
		loadConfig,
		saveConfig,
		maskKey,
		type StorageMode
	} from '$lib/ai/credentials';

	// Sorted so local (genuinely free) and recommended options are reachable first,
	// without hiding anything.
	const sorted = [...PROVIDERS].sort((a, b) => {
		if (!!a.local !== !!b.local) return a.local ? -1 : 1;
		if (!!a.recommended !== !!b.recommended) return a.recommended ? -1 : 1;
		return 0;
	});

	let providerId = $state<ProviderId>('openrouter');
	let model = $state('');
	let customBaseUrl = $state('');
	let keyInput = $state('');
	let mode = $state<StorageMode>('session');
	let savedKey = $state('');

	let testing = $state(false);
	let testResult = $state<{ ok: boolean; text: string; hint?: string } | null>(null);

	const provider = $derived(providerById(providerId));
	const baseUrl = $derived(provider.id === 'custom' ? customBaseUrl : provider.baseUrl);
	const key = $derived(savedKey || keyInput);

	// Key input is cleared whenever the provider or storage mode changes: leaving a
	// pasted key sitting in the DOM after the user switches provider is exactly the
	// accident this page is supposed to make hard.
	$effect(() => {
		void providerId;
		void mode;
		savedKey = loadKey(providerId, mode);
		keyInput = '';
		testResult = null;
	});

	$effect(() => {
		saveConfig({ providerId, baseUrl: customBaseUrl, model }, mode);
	});

	const problem = $derived(validateConfig({ provider, baseUrl, key, model }));

	/** Only local runtimes can be tested for real, because they need no key. */
	const canTest = $derived(!problem && !testing);

	const onSaveKey = () => {
		if (mode === 'persistent') {
			// Deliberate, irreversible-ish action: the user is choosing to write a secret
			// to disk. Confirm rather than assume.
			if (!confirm('Save this key to this browser permanently?\n\nAny script running on this site could read it while it is stored. Session-only is safer; you can change this later.')) {
				return;
			}
		}
		saveKey(providerId, keyInput, mode);
		savedKey = keyInput;
		keyInput = '';
	};

	const onForget = () => {
		saveKey(providerId, '', mode);
		savedKey = '';
		keyInput = '';
		testResult = null;
	};

	const onForgetAll = () => {
		if (!confirm('Remove every stored AI key from this browser, in both session and persistent storage?')) return;
		forgetAll('session');
		forgetAll('persistent');
		savedKey = '';
		keyInput = '';
	};

	/**
	 * The cheapest possible end-to-end proof that a setup works.
	 *
	 * A real model call with a handful of output tokens, rather than a synthetic
	 * "list models" request, because a provider can accept a key and still refuse the
	 * browser or the chosen model - and those are exactly the failures worth catching
	 * here rather than later.
	 */
	const onTest = async () => {
		if (problem || testing) return;
		testing = true;
		testResult = null;
		try {
			const result = await callModel({
				provider,
				baseUrl,
				key,
				model,
				messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
				maxTokens: 8,
				temperature: 0,
				timeoutMs: 30_000
			});
			testResult = { ok: true, text: `Replied in ${result.ms}ms: “${result.text.trim()}”` };
		} catch (error) {
			const failure = error as AiFailure;
			testResult = { ok: false, text: failure.message, hint: failure.hint };
		} finally {
			testing = false;
		}
	};

	const hasStored = $derived(storedKeyIds(mode).length);
</script>

<svelte:head><title>AI — ThinkLot</title></svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<a href="/dashboard" class="font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:text-ink">
		← Dashboard
	</a>

	<h1 class="mt-3 text-2xl font-bold text-ink">AI</h1>
	<p class="mt-2 max-w-prose text-sm leading-6 text-ink-2">
		Summaries and duplicate checks run in your browser, using a provider and key that are
		yours. Nothing is sent to a server this app runs, and there is no cost to use.
	</p>

	<!--
		The storage trade-off, stated before the key field rather than in a tooltip. A
		key pasted into a browser cannot be kept from that browser, so the honest thing
		is to say so and let the user pick the line.
	-->
	<fieldset class="mt-6 rounded-lg border border-rule bg-panel p-4">
		<legend class="px-1 font-mono text-[11px] tracking-wider text-ink-3 uppercase">Where is the key kept?</legend>

		<label class="mt-1 flex cursor-pointer items-start gap-2.5">
			<input type="radio" name="mode" value="session" bind:group={mode} class="mt-1 accent-signal" />
			<span class="text-sm text-ink-2">
				<span class="text-ink">This tab only</span>
				<span class="mt-0.5 block text-ink-3">
					Recommended. Gone when you close the tab; you re-paste it next time.
				</span>
			</span>
		</label>

		<label class="mt-3 flex cursor-pointer items-start gap-2.5">
			<input type="radio" name="mode" value="persistent" bind:group={mode} class="mt-1 accent-signal" />
			<span class="text-sm text-ink-2">
				<span class="text-ink">Remember on this device</span>
				<span class="mt-0.5 block text-ink-3">
					Convenient, and it writes the key to disk. Any script running on this site could
					read it while it is stored.
				</span>
			</span>
		</label>
	</fieldset>

	<!-- Provider -->
	<label for="provider" class="mt-6 block font-mono text-[11px] tracking-wider text-ink-3 uppercase">
		Provider
	</label>
	<select
		id="provider"
		bind:value={providerId}
		class="mt-1.5 w-full rounded-md border border-rule bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-signal focus:bg-paper"
	>
		{#each sorted as p (p.id)}
			<option value={p.id}>{p.label}{p.local ? ' — free, local' : ''}</option>
		{/each}
	</select>
	<p class="mt-1.5 text-sm text-ink-3">{provider.blurb}</p>

	<!-- Endpoint, only when it is the user's to supply -->
	{#if provider.id === 'custom'}
		<label for="base" class="mt-5 block font-mono text-[11px] tracking-wider text-ink-3 uppercase">
			Endpoint
		</label>
		<input
			id="base"
			type="url"
			bind:value={customBaseUrl}
			placeholder="https://api.example.com/v1"
			autocomplete="off"
			spellcheck="false"
			class="w-full rounded-md border border-rule bg-panel px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper"
		/>
	{/if}

	<!-- Key -->
	<label for="key" class="mt-5 block font-mono text-[11px] tracking-wider text-ink-3 uppercase">
		{provider.needsKey ? 'API key' : 'API key (not needed)'}
	</label>
	{#if savedKey}
		<div class="mt-1.5 flex items-center gap-2">
			<span class="font-mono text-sm text-ink-2">{maskKey(savedKey)}</span>
			<span class="font-mono text-[11px] text-ink-3 uppercase">saved</span>
			<button
				type="button"
				onclick={onForget}
				class="ml-auto rounded-md border border-rule px-3 py-1.5 font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:border-bad/40 hover:text-bad"
			>
				Forget
			</button>
		</div>
	{:else}
		<div class="mt-1.5 flex flex-wrap gap-2">
			<input
				id="key"
				type="password"
				bind:value={keyInput}
				placeholder={provider.needsKey ? 'Paste your key' : 'Not required'}
				disabled={!provider.needsKey}
				autocomplete="off"
				spellcheck="false"
				class="w-full rounded-md border border-rule bg-panel px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper disabled:opacity-50 sm:flex-1"
			/>
			{#if provider.needsKey}
				<button
					type="button"
					onclick={onSaveKey}
					disabled={!keyInput.trim()}
					class="rounded-md border border-rule px-4 py-2 font-mono text-[11px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal disabled:opacity-40"
				>
					Save
				</button>
			{/if}
		</div>
	{/if}

	<!-- Model: a select of suggestions that is also a free-text field -->
	<label for="model" class="mt-5 block font-mono text-[11px] tracking-wider text-ink-3 uppercase">
		Model
	</label>
	<input
		id="model"
		list="model-suggestions"
		bind:value={model}
		placeholder="Type any model id this provider accepts"
		autocomplete="off"
		spellcheck="false"
		class="w-full rounded-md border border-rule bg-panel px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper"
	/>
	<datalist id="model-suggestions">
		{#each provider.models as m (m)}
			<option value={m}></option>
		{/each}
	</datalist>
	<p class="mt-1.5 text-sm text-ink-3">
		Suggestions only — the list is a starting point, and any id the provider accepts works.
	</p>

	<!-- Problems and the test, in one place -->
	<div class="mt-6 flex flex-wrap items-center gap-3">
		<button
			type="button"
			onclick={onTest}
			disabled={!canTest}
			class="rounded-md border border-signal px-4 py-2 font-mono text-[11px] tracking-wider text-signal uppercase hover:bg-signal-soft disabled:opacity-40"
		>
			{testing ? 'Testing…' : 'Test connection'}
		</button>
		{#if problem && !testing}
			<p class="text-sm text-ink-3">{problem}</p>
		{/if}
	</div>

	{#if testResult}
		<div
			class="mt-3 rounded-md border px-3 py-2 text-sm {testResult.ok
				? 'border-good/30 bg-good-soft text-good'
				: 'border-bad/30 bg-bad-soft text-bad'}"
			data-test-result={testResult.ok ? 'ok' : 'failed'}
		>
			<p>{testResult.text}</p>
			{#if testResult.hint}
				<p class="mt-1 text-ink-2">{testResult.hint}</p>
			{/if}
		</div>
	{/if}

	{#if hasStored > 0}
		<button
			type="button"
			onclick={onForgetAll}
			class="mt-10 rounded-md border border-rule px-4 py-2 font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:border-bad/40 hover:text-bad"
		>
			Remove all stored keys
		</button>
	{/if}
</div>