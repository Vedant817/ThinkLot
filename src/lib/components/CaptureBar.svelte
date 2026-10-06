<script lang="ts">
	import { convex } from '$lib/convex/client.svelte';
	import { api } from '../../convex/_generated/api';
	import {
		DRAFT_LIMIT,
		looksDictated,
		parseCapture,
		type CaptureSource
	} from '$lib/capture';

	interface Props {
		/** Called after a successful capture with the new idea's plate. */
		onCaptured?: (plate: string) => void;
	}

	let { onCaptured }: Props = $props();

	let draft = $state('');
	let saving = $state(false);
	let justSaved = $state<string | null>(null);
	let problem = $state<string | null>(null);
	let textarea = $state<HTMLTextAreaElement | null>(null);

	/** Gaps between input events, used to tell dictation from typing. */
	let gaps: number[] = [];
	let lastInputAt = 0;

	/**
	 * Text that has been sitting unsaved. Kept so a failed save or an accidental
	 * navigation cannot lose a thought - the whole premise is that these get lost.
	 */
	let pending = $state<string | null>(null);

	function trackInput() {
		const now = performance.now();
		if (lastInputAt > 0) {
			const gap = now - lastInputAt;
			gaps.push(gap);
			// Only the current burst matters; a long pause starts a new one.
			if (gap > 1200) gaps = [gap];
		}
		lastInputAt = now;

		if (draft.length > DRAFT_LIMIT) draft = draft.slice(0, DRAFT_LIMIT);
		pending = draft.trim() || null;
	}

	function autoGrow(node: HTMLTextAreaElement) {
		node.style.height = 'auto';
		node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
	}

	async function capture(explicitSource?: CaptureSource) {
		const raw = draft.trim();
		if (!raw || saving) return;

		const source: CaptureSource = explicitSource ?? (looksDictated(gaps) ? 'dictated' : 'typed');
		const parsed = parseCapture(raw, source);
		if (!parsed) return;

		saving = true;
		problem = null;

		try {
			const ideaId = await convex.mutation<string>(api.ideas.capture, {
				title: parsed.title,
				description: parsed.description,
				source: parsed.source,
				transcript: parsed.transcript
			});

			draft = '';
			gaps = [];
			lastInputAt = 0;
			pending = null;
			justSaved = parsed.source === 'dictated' ? 'Dictated idea parked' : 'Idea parked';
			onCaptured?.(ideaId);
		} catch (error) {
			// Keep the draft. Losing the thought is the one unacceptable outcome.
			problem = error instanceof Error ? error.message : 'Could not save that idea.';
		} finally {
			saving = false;
		}
	}

	function onKeydown(event: KeyboardEvent) {
		// Enter captures. Shift+Enter is a newline, because a dictated thought is
		// usually more than one line and forcing a single-line box would truncate it.
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void capture();
		}
	}
</script>

<svelte:window
	onkeydown={(event) => {
		// The capture bar is the product. Reaching for the mouse to type a thought
		// is the friction this whole app exists to remove.
		if (event.key === '/' && document.activeElement !== textarea) {
			event.preventDefault();
			textarea?.focus();
		}
	}}
/>

<div
	class="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur-sm supports-[not(backdrop-filter:blur(0))]:bg-paper"
>
	<div class="mx-auto w-full max-w-5xl px-4 py-3 sm:px-6">
		<div
			class="flex items-start gap-2 rounded-lg border border-rule-strong bg-panel transition-colors focus-within:border-signal focus-within:bg-paper"
		>
			<!--
				The plate column. Mono, fixed width, so every capture lines up in the
				same place and the eye can find the input without reading it.
			-->
			<span
				class="mt-2.5 hidden shrink-0 select-none font-mono text-[11px] tracking-wider text-ink-3 sm:block"
				aria-hidden="true"
			>
				+
			</span>

			<!--
				Autofocus is the point of this component. The whole premise of ThinkLot
				is that a thought is gone in thirty seconds, so making the user click
				before they can type it would be a real cost. This is the one place
				the a11y warning is knowingly overridden.
			-->
			<!-- svelte-ignore a11y_autofocus -->
			<textarea
				bind:this={textarea}
				bind:value={draft}
				oninput={trackInput}
				onkeydown={onKeydown}
				use:autoGrow
				rows="1"
				autofocus
				spellcheck="true"
				enterkeyhint="done"
				aria-label="Capture an idea"
				placeholder="What just came to you?"
				class="max-h-80 w-full resize-none bg-transparent px-1 py-2.5 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-3"
			></textarea>

			<button
				type="button"
				onclick={() => capture()}
				disabled={!draft.trim() || saving}
				class="m-1.5 shrink-0 self-center rounded-md bg-signal px-3 py-1.5 font-mono text-[11px] font-bold tracking-wider text-signal-ink transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
			>
				{saving ? '···' : 'PARK ⏎'}
			</button>
		</div>

		<!--
			One line of feedback, never a toast. A capture tool must never interrupt:
			the user is mid-thought, and the only facts worth reporting are "saved",
			"saving", and "that failed".
		-->
		<div class="mt-1.5 flex min-h-4 items-center justify-between gap-3 px-1">
			<p
				class="font-mono text-[11px] tracking-wide"
				class:text-bad={problem !== null}
				class:text-ink-3={problem === null}
				role={problem ? 'alert' : 'status'}
				aria-live="polite"
			>
				{#if problem}
					{problem}
				{:else if saving}
					Saving…
				{:else if justSaved}
					<span class="text-ok">{justSaved}</span>
				{:else if pending}
					<span>Unsaved draft</span>
				{:else}
					<span>Enter to park · Shift+Enter for a new line</span>
				{/if}
			</p>
		</div>
	</div>
</div>