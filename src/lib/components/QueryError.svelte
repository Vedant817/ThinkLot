<script lang="ts">
	import type { QueryHandle } from '$lib/convex/query.svelte';

	let {
		handle,
		what = 'This view'
	}: {
		handle: { error: string | null } | null | undefined;
		what?: string;
	} = $props();
</script>

<!--
	A failed query is the single most dangerous thing this app can show wrong.

	`watchQuery` leaves `current` undefined when a subscription errors, so the
	list derived from it is `[]`. Any component that renders an empty state
	without checking `error` therefore tells the user their entire lot is empty -
	which, for someone who keeps ideas here precisely because they cannot trust
	their memory, is not a cosmetic bug. They go on capturing duplicates.

	So this banner is rendered by every list, and every empty state is gated on
	its absence. `role="alert"` so it is announced, not just drawn.
-->
{#if handle?.error}
	<p
		class="mb-3 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad"
		role="alert"
	>
		<span class="font-medium">{what} could not load.</span>
		{handle.error}
	</p>
{/if}
