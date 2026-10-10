<script lang="ts">
	/**
	 * Settings home: profile, destinations, and integrations in one place.
	 *
	 * The settings pages grew one by one (AI, import/export, analytics), each
	 * reachable only from the sidebar and from each other by luck. This page is
	 * the map: who is signed in, where everything lives, and what is connected.
	 * It states status rather than duplicating forms - the key field stays on the
	 * AI page, the file boxes stay on transfer - because two forms for one thing
	 * is how they disagree.
	 */
	import { goto } from '$app/navigation';
	import { api } from '../../../convex/_generated/api';
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery, type QueryHandle } from '$lib/convex/query.svelte';
	import QueryError from '$lib/components/QueryError.svelte';
	import { loadConfig, storedKeyIds, type StorageMode } from '$lib/ai/credentials';
	import { PROVIDERS } from '$lib/ai/providers';

	type Me = { email: string | null; name: string | null } | null;

	let meHandle = $state<QueryHandle<Me | undefined> | null>(null);

	$effect(() => {
		const next = watchQuery<Me | undefined>(convex.client!, api.users.current, {});
		meHandle = next;
		return () => {
			next.dispose();
		};
	});

	const me = $derived(meHandle?.current);

	/**
	 * Which AI providers hold a key, derived on every render rather than cached:
	 * a key forgotten on the AI page and a status here that still claims it is
	 * the exact staleness this section exists to prevent.
	 */
	const configuredProviders = $derived.by(() => {
		const ids = [...storedKeyIds('session'), ...storedKeyIds('persistent')];
		const labels = new Map(PROVIDERS.map((p) => [p.id, p.label] as const));
		return [...new Set(ids)].map((id) => labels.get(id as never) ?? id);
	});

	let signingOut = $state(false);
	let signOutError = $state<string | null>(null);

	async function signOut() {
		signingOut = true;
		signOutError = null;
		try {
			await convex.signOut();
			await goto('/login', { replaceState: true });
		} catch (error) {
			signOutError = error instanceof Error ? error.message : 'That did not work.';
			signingOut = false;
		}
	}

	const sections = [
		{
			href: '/settings/appearance',
			title: 'Appearance',
			blurb: 'Light, dark, or your device. Custom themes and type size.'
		},
		{
			href: '/settings/ai',
			title: 'AI providers & keys',
			blurb: 'Bring your own key. Requests go straight to the provider.'
		},
		{
			href: '/settings/transfer',
			title: 'Import / export',
			blurb: 'Jira, Linear, Notion, Obsidian, CSV, and the lossless backup.'
		},
		{
			href: '/settings/analytics',
			title: 'Your numbers',
			blurb: 'Streaks, voice share, decisions - from your ideas alone.'
		}
	];
</script>

<svelte:head><title>Settings - ThinkLot</title></svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<a href="/dashboard" class="font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:text-ink">
		← Dashboard
	</a>

	<h1 class="mt-3 text-2xl font-bold text-ink">Settings</h1>

	<!-- Profile -->
	<section class="mt-6">
		<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Profile</h2>
		{#if !meHandle || meHandle.loading}
			<p class="mt-2 font-mono text-[11px] tracking-wider text-ink-3 uppercase">Loading…</p>
		{:else if meHandle.error}
			<QueryError handle={meHandle} what="Profile" />
		{:else}
			<p class="mt-2 text-[15px] text-ink">{me?.email ?? 'Signed in'}</p>
			<div class="mt-3 flex flex-wrap items-center gap-3">
				<button
					type="button"
					onclick={signOut}
					disabled={signingOut}
					class="rounded-md border border-rule px-4 py-2 font-mono text-[11px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal disabled:opacity-40"
				>
					{signingOut ? 'Signing out…' : 'Sign out'}
				</button>
				{#if signOutError}
					<p class="text-sm text-bad">{signOutError}</p>
				{/if}
			</div>
			<p class="mt-2 text-sm text-ink-3">
				Your ideas sync with the same account on web and mobile.
			</p>
		{/if}
	</section>

	<!-- Destinations -->
	<section class="mt-8">
		<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Sections</h2>
		<ul class="mt-2 divide-y divide-rule overflow-hidden rounded-lg border border-rule bg-paper">
			{#each sections as section (section.href)}
				<li>
					<a href={section.href} class="block px-4 py-3 transition-colors hover:bg-panel">
						<span class="text-[15px] font-medium text-ink">{section.title}</span>
						<span class="mt-0.5 block text-sm text-ink-3">{section.blurb}</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	<!-- Integrations -->
	<section class="mt-8">
		<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Integrations</h2>
		<p class="mt-2 max-w-prose text-sm leading-6 text-ink-2">
			Everything this app connects to, and what it holds for each. Keys live only
			where you put them; file formats hold nothing at all.
		</p>
		<ul class="mt-2 divide-y divide-rule overflow-hidden rounded-lg border border-rule bg-paper">
			<li class="flex items-center gap-3 px-4 py-3">
				<div class="min-w-0 flex-1">
					<p class="text-[15px] font-medium text-ink">AI providers</p>
					<p class="mt-0.5 text-sm text-ink-3">
						{configuredProviders.length === 0
							? 'No keys stored.'
							: `Keys stored for ${configuredProviders.join(', ')}.`}
					</p>
				</div>
				<a
					href="/settings/ai"
					class="shrink-0 rounded-md border border-rule px-3 py-1.5 font-mono text-[10px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal"
				>
					Manage
				</a>
			</li>
			<li class="flex items-center gap-3 px-4 py-3">
				<div class="min-w-0 flex-1">
					<p class="text-[15px] font-medium text-ink">Import / export</p>
					<p class="mt-0.5 text-sm text-ink-3">
						Jira, Linear, Notion, Obsidian, CSV. Files, not accounts - nothing to connect, nothing to remove.
					</p>
				</div>
				<a
					href="/settings/transfer"
					class="shrink-0 rounded-md border border-rule px-3 py-1.5 font-mono text-[10px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal"
				>
					Open
				</a>
			</li>
		</ul>
	</section>
</div>
