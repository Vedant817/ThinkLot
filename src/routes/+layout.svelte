<script lang="ts">
	import './layout.css';
	import { convex } from '$lib/convex/client.svelte';
	import { api } from '../convex/_generated/api';
	import { storedKeyIds } from '$lib/ai/credentials';

	const { children } = $props();

	// Open the WebSocket once, as early as possible. Every screen depends on it,
	// and `start()` is idempotent so calling it here and deeper is safe.
	$effect(() => {
		convex.start();
	});

	/*
	 * Once-daily product heartbeat: platform + whether an AI key is set.
	 *
	 * Guarded by a stored date so it fires at most once a day, and best-effort so
	 * telemetry can never break the app. The server enforces the opt-out and the
	 * once-per-day upsert; the client guard is only thrift. Runs when the auth
	 * state says signed in - which re-fires on sign-in, so a fresh login always
	 * counts even if the date guard was set by a previous account on this browser.
	 */
	$effect(() => {
		if (convex.auth.status !== 'authenticated') return;
		try {
			const today = new Date().toISOString().slice(0, 10);
			if (localStorage.getItem('thinklot:telemetry:heartbeat') === today) return;
			const aiConfigured = storedKeyIds('session').length + storedKeyIds('persistent').length > 0;
			void convex
				.mutation(api.telemetry.heartbeat, { platform: 'web', aiConfigured })
				.then(() => {
					try {
						localStorage.setItem('thinklot:telemetry:heartbeat', today);
					} catch {
						/* Private browsing: counted today, forgotten tomorrow. */
					}
				})
				.catch(() => {
					/* Best-effort by design. */
				});
		} catch {
			/* Storage disabled entirely: skip silently. */
		}
	});
</script>

{@render children()}