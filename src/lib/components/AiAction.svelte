<script lang="ts">
	/**
	 * One AI action: configure, consent, run, explain.
	 *
	 * Shared by summarising and duplicate-checking so both obey the same rules, because
	 * the rules are the point:
	 *
	 * - Nothing runs until the user presses the button. There is no "helpful" background
	 *   call, because a model call costs the user money and sends their words to a third
	 *   party.
	 * - The button says exactly what will be sent, before it is sent.
	 * - Unconfigured is a link to settings, not a disabled control with no explanation.
	 * - Failure is a sentence plus what to try. Never a raw status.
	 *
	 * No Convex involvement anywhere: the call goes from this component straight to the
	 * provider the user configured.
	 */
	import { callModel, type AiFailure } from '$lib/ai/client';
	import { loadKey, loadConfig, type StorageMode } from '$lib/ai/credentials';
	import { providerById, validateConfig, type Provider } from '$lib/ai/providers';
	import type { ChatMessage } from '$lib/ai/adapters';

	let {
		label,
		/** Plain sentence describing exactly what leaves the device. */
		consent,
		messages,
		/** Model calls can be slow. */
		timeoutMs = 45_000
	}: {
		label: string;
		consent: string;
		messages: ChatMessage[];
		timeoutMs?: number;
	} = $props();

	let running = $state(false);
	let error = $state<AiFailure | null>(null);

	/** Read at click time rather than bound, so a key saved in another tab is picked up. */
	function ready(): { provider: Provider; baseUrl: string; key: string; model: string } | null {
		for (const mode of ['persistent', 'session'] as StorageMode[]) {
			const config = loadConfig(mode);
			if (!config) continue;
			const provider = providerById(config.providerId as never);
			const baseUrl = provider.id === 'custom' ? config.baseUrl : provider.baseUrl;
			const key = loadKey(provider.id, mode);
			if (validateConfig({ provider, baseUrl, key, model: config.model })) continue;
			return { provider, baseUrl, key, model: config.model };
		}
		return null;
	}

	const configured = $derived(ready() !== null);

	const onRun = async () => {
		if (running) return;
		const config = ready();
		if (!config) return;
		running = true;
		error = null;
		try {
			await callModel({ ...config, messages, timeoutMs });
		} catch (caught) {
			error = caught as AiFailure;
		} finally {
			running = false;
		}
	};
</script>

<div class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
	<button
		type="button"
		onclick={onRun}
		disabled={!configured || running}
		data-ai-action={label}
		class="rounded-md border border-signal px-3 py-1.5 font-mono text-[11px] tracking-wider text-signal uppercase hover:bg-signal-soft disabled:opacity-40"
	>
		{running ? 'Working…' : label}
	</button>

	{#if !configured}
		<span class="text-sm text-ink-3">
			Needs a provider and key.
			<a href="/settings/ai" class="text-ink-2 underline underline-offset-4 hover:text-ink">Set one up</a>
		</span>
	{:else if !running}
		<span class="text-sm text-ink-3">{consent}</span>
	{/if}
</div>

{#if error}
	<div class="mt-3 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad" data-ai-error="true">
		<p>{error.message}</p>
		{#if error.hint}
			<p class="mt-1 text-ink-2">{error.hint}</p>
		{/if}
	</div>
{/if}