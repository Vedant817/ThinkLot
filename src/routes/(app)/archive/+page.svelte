<script lang="ts">
	import StatusPill from '$lib/components/StatusPill.svelte';
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery, type QueryHandle } from '$lib/convex/query.svelte';
	import { api } from '../../../convex/_generated/api';
	import { displayScore, lotPlate, priorityScore } from '$lib/scoring';
	import type { Idea } from '$lib/types';

	type Lot = { ideas: Idea[]; truncated: boolean; total: number };

	let handle = $state<QueryHandle<Lot> | null>(null);
	let search = $state('');
	let restoringId = $state<string | null>(null);
	let problem = $state<string | null>(null);

	$effect(() => {
		convex.start();
	});

	$effect(() => {
		const next = watchQuery<Lot>(convex.client!, api.ideas.list, { includeArchived: true });
		handle = next;
		return () => {
			next.dispose();
		};
	});

	const archived = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		const rows = (handle?.current?.ideas ?? []).filter((idea) => idea.archived);
		if (!needle) return rows;
		return rows.filter(
			(idea) =>
				idea.title.toLowerCase().includes(needle) ||
				(idea.preview ?? '').toLowerCase().includes(needle)
		);
	});

	async function restore(idea: Idea) {
		restoringId = idea._id;
		problem = null;
		try {
			await convex.mutation(api.ideas.setArchived, {
				ideaId: idea._id,
				archived: false,
				// Falls back to `inbox` server-side. We pass the status the idea had
				// while away so a restore does not dump it back at the start of the
				// pipeline.
				statusBeforeArchive: idea.status
			});
		} catch (error) {
			problem = error instanceof Error ? error.message : 'Could not restore that idea.';
		} finally {
			restoringId = null;
		}
	}
</script>

<svelte:head>
	<title>Archive | ThinkLot</title>
	<meta name="description" content="Ideas you parked for good." />
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
	<div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-4">
		<h1 class="font-mono text-sm font-bold tracking-tight">Archive</h1>
		<p class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
			{archived.length} parked away
		</p>
	</div>

	<div class="py-3">
		<input
			type="search"
			bind:value={search}
			placeholder="Search the archive…"
			aria-label="Search archived ideas"
			class="w-full max-w-xs rounded-md border border-rule bg-panel px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper"
		/>
	</div>

	{#if problem}
		<p class="mb-3 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
			{problem}
		</p>
	{/if}

	{#if archived.length === 0}
		<div class="rounded-lg border border-dashed border-rule-strong px-5 py-14 text-center">
			<p class="font-mono text-sm text-ink-2">Nothing archived.</p>
			<p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-3">
				Archiving is reversible, and an idea keeps the stage it was parked from.
			</p>
		</div>
	{:else}
		<ul class="rule-y overflow-hidden rounded-lg border border-rule bg-paper">
			{#each archived as idea (idea._id)}
				{@const score = priorityScore(idea)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 sm:flex-nowrap">
					<span class="font-mono text-[11px] font-bold tracking-wider text-lot">
						{lotPlate(idea.seq)}
					</span>

					<div class="min-w-0 flex-1">
						<a
							href={`/ideas/${idea._id}`}
							class="text-[15px] leading-6 font-medium text-ink underline-offset-4 hover:underline"
						>
							{idea.title}
						</a>
						{#if idea.preview}
							<p class="mt-0.5 line-clamp-1 text-sm text-ink-2">{idea.preview}</p>
						{/if}
					</div>

					<div class="flex shrink-0 items-center gap-2">
						<StatusPill status={idea.status} />
						<span
							class="font-mono text-[11px]"
							class:text-lot={score !== null}
							class:text-ink-3={score === null}
							data-numeric="true"
						>
							{displayScore(score)}
						</span>
						<button
							type="button"
							onclick={() => restore(idea)}
							disabled={restoringId === idea._id}
							class="rounded border border-rule-strong px-2 py-1 font-mono text-[10px] tracking-wider text-ink uppercase transition-colors hover:bg-sunk disabled:opacity-50"
						>
							{restoringId === idea._id ? '···' : 'Restore'}
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>