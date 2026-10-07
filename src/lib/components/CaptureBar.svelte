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

	/**
	 * Survives a reload and a navigation.
	 *
	 * `sessionStorage` rather than a `beforeNavigate` guard, because it covers
	 * both cases with one mechanism: any remount of this component - navigating
	 * to an idea and back, or a hard reload - re-reads the draft. A
	 * `beforeNavigate` guard would not fire on reload at all.
	 *
	 * Restored ONCE here at initialisation, deliberately not inside an
	 * `$effect`: an effect that reads `draft` and then writes it re-triggers
	 * itself, and the restore would fight the user's typing forever.
	 */
	const DRAFT_KEY = 'thinklot.capture.draft';

	function readStoredDraft(): string {
		try {
			return sessionStorage.getItem(DRAFT_KEY) ?? '';
		} catch {
			return '';
		}
	}

	function storeDraft() {
		try {
			if (draft.trim()) sessionStorage.setItem(DRAFT_KEY, draft);
			else sessionStorage.removeItem(DRAFT_KEY);
		} catch {
			/* storage unavailable; the in-memory draft still works */
		}
	}

	let draft = $state(readStoredDraft());
	let saving = $state(false);
	let justSaved = $state<string | null>(null);
	let problem = $state<string | null>(null);
	/** Set when input hit the cap, so the loss is visible rather than silent. */
	let overflow = $state<string | null>(null);
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

		// Truncate, but SAY SO. The original `draft = draft.slice(0, DRAFT_LIMIT)`
		// rewrote the textarea's own value: the caret pinned at the cap, typing
		// appeared to stop working, and a pasted 10,000-character wall lost 6,000
		// characters with nothing on screen to explain why. That directly
		// contradicts this module's own promise that nothing is ever thrown away.
		if (draft.length > DRAFT_LIMIT) {
			const dropped = draft.length - DRAFT_LIMIT;
			draft = draft.slice(0, DRAFT_LIMIT);
			overflow = `That was ${dropped.toLocaleString()} characters over the limit. The first ${DRAFT_LIMIT.toLocaleString()} were kept - split a very long capture across several ideas rather than losing the tail.`;
		} else if (overflow) {
			overflow = null;
		}

		pending = draft.trim() || null;
		storeDraft();
	}

	/**
	 * Grow the field to fit its content.
	 *
	 * This was a `use:` action. A Svelte action with no argument list is invoked
	 * exactly once at mount - the compiled output was
	 * `$.action(textarea_1, ($$node) => autoGrow?.($$node))` with no re-run, because
	 * only an action that takes parameters gets a render effect to re-evaluate it.
	 * So the textarea stayed one row tall forever, `max-h-80` was unreachable dead
	 * CSS, and every multi-line dictated blob scrolled inside a single-line box.
	 *
	 * An `$effect` keyed on `draft` re-runs on every keystroke instead.
	 */
	$effect(() => {
		const node = textarea;
		if (!node) return;
		// `draft` is the dependency, read explicitly so the effect tracks it.
		void draft;
		node.style.height = 'auto';
		node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
	});

	async function capture(explicitSource?: CaptureSource) {
		const raw = draft.trim();
		if (!raw || saving) return;

		const source: CaptureSource = explicitSource ?? (looksDictated(gaps) ? 'dictated' : 'typed');
		const parsed = parseCapture(raw, source);
		if (!parsed) return;

		saving = true;
		problem = null;

		// Restore focus SYNCHRONOUSLY, inside the gesture that submitted.
		// `await`-ing first and calling focus() afterwards does not reopen an iOS
		// keyboard - the browser has already processed the tap and blurred the field.
		// On a phone, tapping PARK is the only capture gesture there is, so losing
		// focus here costs a re-tap per idea.
		textarea?.focus();

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
			overflow = null;
			storeDraft();
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

<!--
	Flat `bg-paper`. This was `bg-paper/95 backdrop-blur-sm`, i.e. glassmorphism on
	the primary capture surface, which the project's own "utilitarian ledger" rule
	forbids: flat surfaces, 1px rules, no blur. It also cost a compositing layer
	on the one component that renders on every scroll.
-->
<div class="sticky top-0 z-40 border-b border-rule bg-paper">
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
				rows="1"
				autofocus
				spellcheck="true"
				enterkeyhint="done"
				aria-label="Capture an idea"
				aria-keyshortcuts="/"
				placeholder="What just came to you?"
				/**
				 * The global shortcut layer finds this field by this attribute rather
				 * than by a prop drilled through three components. The `/` handler that
				 * used to live here is gone - it duplicated the registry and guarded
				 * only this textarea, so `/` was untypable in the search field.
				 */
				data-capture-field
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
				class:text-warn={problem === null && (pending !== null || overflow !== null)}
				class:text-ink-3={problem === null && pending === null && overflow === null}
				role={problem || overflow ? 'alert' : 'status'}
				aria-live="polite"
			>
				{#if problem}
					{problem}
				{:else if overflow}
					{overflow}
				{:else if saving}
					Saving…
				{:else if pending}
					Unsaved draft
				{:else if justSaved}
					<span class="text-ok">{justSaved}</span>
				{:else}
					<span>Enter to park · Shift+Enter for a new line</span>
				{/if}
			</p>
		</div>
	</div>
</div>