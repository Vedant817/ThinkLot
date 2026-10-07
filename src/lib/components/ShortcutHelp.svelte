<script lang="ts">
	import type { Shortcut } from '$lib/keyboard';

	let { shortcuts, onclose }: { shortcuts: Shortcut[]; onclose: () => void } = $props();

	let dialog = $state<HTMLElement | null>(null);
	let restoreFocusTo = $state<HTMLElement | null>(null);

	$effect(() => {
		restoreFocusTo = document.activeElement as HTMLElement | null;
		dialog?.focus();
		return () => restoreFocusTo?.focus?.();
	});
</script>

<!--
	A modal dialog, not a dropdown.

	Implemented by hand rather than with <dialog> because the overlay needs to sit
	inside the app shell and match the ledger rules - 1px rules, flat surfaces, no
	blur. `role="dialog"` + `aria-modal` + focus restoration is what actually
	matters for a keyboard user; Escape is wired in the global shortcut layer.

	The backdrop is a real <button>, not a div with a click handler: a div is
	not focusable, cannot be reached by keyboard, and svelte-check correctly
	refuses to let it pass silently.
-->
<div class="fixed inset-0 z-50 grid place-items-center p-4">
	<button
		type="button"
		onclick={onclose}
		aria-label="Close shortcuts"
		class="absolute inset-0 bg-ink/20"
	></button>

	<div
		bind:this={dialog}
		role="dialog"
		aria-modal="true"
		aria-labelledby="shortcut-title"
		tabindex="-1"
		class="relative w-full max-w-md rounded-lg border border-rule-strong bg-paper p-4 outline-none"
	>
		<div class="flex items-baseline justify-between border-b border-rule pb-3">
			<h2 id="shortcut-title" class="font-mono text-sm font-bold">Keyboard</h2>
			<button
				type="button"
				onclick={onclose}
				aria-label="Close shortcuts"
				class="font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:text-bad"
			>
				Esc
			</button>
		</div>

		<dl class="mt-3 space-y-2">
			{#each shortcuts as shortcut (shortcut.keys)}
				<div class="flex items-baseline justify-between gap-4">
					<dt class="text-sm text-ink-2">{shortcut.label}</dt>
					<dd class="shrink-0 font-mono text-[11px] text-ink">
						{#each shortcut.keys.split(' then ') as part, i (part)}
							{#if i > 0}<span class="text-ink-3">then</span>{/if}
							<kbd class="rounded border border-rule-strong bg-panel px-1.5 py-0.5">{part}</kbd>
						{/each}
					</dd>
				</div>
			{/each}
		</dl>

		<p class="mt-4 border-t border-rule pt-3 font-mono text-[11px] text-ink-3">
			Shortcuts stand down while you are typing in a field.
		</p>
	</div>
</div>
