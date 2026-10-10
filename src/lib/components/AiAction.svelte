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
	import { callModel, type AiFailure, type AiResult } from '$lib/ai/client';
	import { loadKey, loadConfig, type StorageMode } from '$lib/ai/credentials';
	import { providerById, validateConfig, type Provider } from '$lib/ai/providers';
	import type { ChatMessage } from '$lib/ai/adapters';

	let {
		label,
		/** Plain sentence describing exactly what leaves the device. */
		consent,
		messages,
		/**
		 * Turn the model's raw text into what the user reads, or null when it is not
		 * usable output.
		 *
		 * Required, not optional. The first version of this component had no such
		 * prop: it awaited the call, discarded the result, and rendered nothing -
		 * so pressing "Summarise" spent the user's money and showed them a button
		 * going back to idle. A model call with nowhere to put its answer is a bug,
		 * and the type system is where this one is prevented from recurring.
		 */
		parseResult,
		/** Model calls can be slow. */
		timeoutMs = 45_000
	}: {
		label: string;
		consent: string;
		messages: ChatMessage[];
		parseResult: (raw: string) => string | null;
		timeoutMs?: number;
	} = $props();

	let running = $state(false);
	let error = $state<AiFailure | null>(null);
	let result = $state<{ text: string; ms: number; model: string } | null>(null);

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
		result = null;
		try {
			const answer: AiResult = await callModel({ ...config, messages, timeoutMs });
			const text = parseResult(answer.text);
			if (text) {
				result = { text, ms: answer.ms, model: answer.model };
			} else {
				// A 200 with unusable output is a failure with a different shape, not
				// a success with nothing to show. Saying so is the difference between
				// "the model said nothing useful" and a button that did nothing.
				error = {
					message: 'The model answered, but not in a form this check can use.',
					hint: 'Try again — or try a different model. Short, literal answers work best here.',
					likelyKeyProblem: false
				} satisfies AiFailure;
			}
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

{#if result}
	<div class="mt-3 rounded-md border border-rule bg-panel px-3 py-2 text-sm leading-6 text-ink" data-ai-result="true">
		<p class="whitespace-pre-wrap">{result.text}</p>
		<p class="mt-1 font-mono text-[11px] text-ink-3">{result.model} · {result.ms}ms</p>
	</div>
{/if}