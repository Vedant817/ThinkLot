<script lang="ts">
	import './layout.css';
	import { convex } from '$lib/convex/client.svelte';

	const { children } = $props();

	// Open the WebSocket once, as early as possible. Every screen depends on it,
	// and `start()` is idempotent so calling it here and deeper is safe.
	$effect(() => {
		convex.start();
	});
</script>

{@render children()}