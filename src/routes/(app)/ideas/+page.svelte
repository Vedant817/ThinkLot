<script lang="ts">
	import CaptureBar from '$lib/components/CaptureBar.svelte';
	import StatusPill from '$lib/components/StatusPill.svelte';
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery } from '$lib/convex/query.svelte';
	import { api } from '../../../convex/_generated/api';
	import { byPriority, displayScore, lotPlate, priorityScore, scoreBand } from '$lib/scoring';
	import { IDEA_STATUSES, type Idea, type IdeaStats } from '$lib/types';

	let search = $state('');
	let tagFilter = $state<string[]>([]);
	let showArchived = $state(false);
	let sortBy = $state<'capture' | 'priority'>('capture');

	let listHandle = $state<ReturnType<typeof watchQuery<Idea[]>> | null>(null);
	let statsHandle = $state<ReturnType<typeof watchQuery<IdeaStats>> | null>(null);

	$effect(() => {
		convex.start();
	});

	// Re-subscribing on a filter change is the whole point: Convex only ships the
	// rows that match, so filtering does not re-run in the browser.
	$effect(() => {
		listHandle?.dispose();
		statsHandle?.dispose();
		listHandle = watchQuery<Idea[]>(convex.client!, api.ideas.list, {
			includeArchived: showArchived
		});
		statsHandle = watchQuery<IdeaStats>(convex.client!, api.ideas.stats, {});
		return () => {
			listHandle?.dispose();
			statsHandle?.dispose();
		};
	});

	const ideas = $derived(listHandle?.current ?? []);

	const allTags = $derived(
		Array.from(new Set(ideas.flatMap((idea) => idea.tags))).sort((a, b) => a.localeCompare(b))
	);

	const visible = $derived.by(() => {
		const needle = search.trim().toLowerCase();

		let rows = ideas.filter((idea) =>
			tagFilter.length === 0 ? true : tagFilter.every((t) => idea.tags.includes(t))
		);

		if (needle) {
			rows = rows.filter(
				(idea) =>
					idea.title.toLowerCase().includes(needle) ||
					(idea.description ?? '').toLowerCase().includes(needle) ||
					idea.tags.some((t) => t.includes(needle))
			);
		}

		return sortBy === 'priority' ? [...rows].sort(byPriority) : rows;
	});

	const stats = $derived(statsHandle?.current);

	function toggleTag(tag: string) {
		tagFilter = tagFilter.includes(tag)
			? tagFilter.filter((t) => t !== tag)
			: [...tagFilter, tag];
	}

	async function setStatus(idea: Idea, status: Idea['status']) {
		await convex.mutation(api.ideas.setStatus, { ideaId: idea._id, status });
	}

	async function toggleFavorite(idea: Idea) {
		await convex.mutation(api.ideas.toggleFavorite, { ideaId: idea._id });
	}

	async function archive(idea: Idea) {
		await convex.mutation(api.ideas.setArchived, {
			ideaId: idea._id,
			archived: true,
			statusBeforeArchive: idea.status
		});
	}

	/** Next stage in the pipeline, or null when already done. */
	function nextStage(status: Idea['status']): Idea['status'] | null {
		const index = IDEA_STATUSES.indexOf(status);
		return index >= 0 && index < IDEA_STATUSES.length - 1 ? IDEA_STATUSES[index + 1] : null;
	}

	const BAND_BAR: Record<string, string> = {
		unscored: 'bg-rule',
		low: 'bg-ink-3',
		solid: 'bg-lot',
		strong: 'bg-signal'
	};

	function relativeDay(ts: number): string {
		const days = Math.floor((Date.now() - ts) / 86_400_000);
		if (days <= 0) return 'today';
		if (days === 1) return 'yesterday';
		if (days < 30) return `${days}d`;
		return `${Math.floor(days / 30)}mo`;
	}
</script>

<svelte:head>
	<title>The lot | ThinkLot</title>
	<meta name="description" content="Every idea you have parked." />
</svelte:head>

<CaptureBar />

<div class="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
	<!-- Counters. Three numbers, because a lot with 200 ideas and no sense of
	     size is just a list. -->
	<div class="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule pb-4">
		<p class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
			{stats?.total ?? 0} parked
		</p>
		<p class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
			{stats?.unscored ?? 0} unscored
		</p>
		{#if stats?.favorites}
			<p class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
				{stats.favorites} starred
			</p>
		{/if}
	</div>

	<!-- Filter row -->
	<div class="flex flex-wrap items-center gap-2 py-3">
		<input
			type="search"
			bind:value={search}
			placeholder="Search ideas…"
			aria-label="Search ideas"
			class="min-w-0 flex-1 rounded-md border border-rule bg-panel px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper sm:max-w-xs"
		/>

		<div class="flex items-center gap-1">
			<button
				type="button"
				onclick={() => (sortBy = 'capture')}
				aria-pressed={sortBy === 'capture'}
				class="rounded px-2 py-1 font-mono text-[11px] tracking-wider uppercase"
				class:bg-sunk={sortBy === 'capture'}
				class:text-ink={sortBy === 'capture'}
				class:text-ink-3={sortBy !== 'capture'}
			>
				Newest
			</button>
			<button
				type="button"
				onclick={() => (sortBy = 'priority')}
				aria-pressed={sortBy === 'priority'}
				class="rounded px-2 py-1 font-mono text-[11px] tracking-wider uppercase"
				class:bg-sunk={sortBy === 'priority'}
				class:text-ink={sortBy === 'priority'}
				class:text-ink-3={sortBy !== 'priority'}
			>
				Priority
			</button>
			<button
				type="button"
				onclick={() => (showArchived = !showArchived)}
				aria-pressed={showArchived}
				class="rounded px-2 py-1 font-mono text-[11px] tracking-wider uppercase"
				class:bg-sunk={showArchived}
				class:text-ink={showArchived}
				class:text-ink-3={!showArchived}
			>
				Archive
			</button>
		</div>
	</div>

	{#if allTags.length > 0}
		<div class="flex flex-wrap gap-1.5 pb-4">
			{#each allTags as tag (tag)}
				<button
					type="button"
					onclick={() => toggleTag(tag)}
					aria-pressed={tagFilter.includes(tag)}
					class="rounded border px-2 py-0.5 font-mono text-[11px] transition-colors"
					class:border-signal={tagFilter.includes(tag)}
					class:bg-signal-soft={tagFilter.includes(tag)}
					class:text-signal={tagFilter.includes(tag)}
					class:border-rule-strong={!tagFilter.includes(tag)}
					class:text-ink-3={!tagFilter.includes(tag)}
				>
					{tag}
				</button>
			{/each}
		</div>
	{/if}

	<!-- The ledger -->
	{#if visible.length === 0}
		<div class="rounded-lg border border-dashed border-rule-strong px-5 py-14 text-center">
			<p class="font-mono text-sm text-ink-2">
				{ideas.length === 0 ? 'Nothing parked yet.' : 'Nothing matches those filters.'}
			</p>
			<p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-3">
				{ideas.length === 0
					? 'Use the bar above. Half a sentence is enough — you can make it useful later.'
					: 'Clear the search or pick fewer tags.'}
			</p>
		</div>
	{:else}
		<ul class="rule-y overflow-hidden rounded-lg border border-rule bg-paper">
			{#each visible as idea (idea._id)}
				{@const score = priorityScore(idea)}
				{@const band = scoreBand(score)}
				{@const upNext = nextStage(idea.status)}
				<li class="group flex items-start gap-3 px-3 py-3 transition-colors hover:bg-panel">
					<!-- The plate. Amber rule whose length encodes the score. -->
					<div class="flex w-16 shrink-0 flex-col items-end gap-1.5 pt-0.5">
						<span
							class="font-mono text-[11px] font-bold tracking-wider"
							class:text-lot={score !== null}
							class:text-ink-3={score === null}
							title={`Priority score ${displayScore(score)}`}
						>
							{lotPlate(idea.seq)}
						</span>
						<span class="h-1 w-full overflow-hidden rounded-full bg-rule">
							<span
								class="block h-full rounded-full transition-all {BAND_BAR[band]}"
								style={`width:${score === null ? 6 : Math.min(100, (score / 40) * 100)}%`}
							></span>
						</span>
					</div>

					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-2">
							<p class="text-[15px] leading-6 font-medium text-ink">{idea.title}</p>
							{#if idea.source === 'dictated'}
								<span
									class="rounded border border-lot/30 bg-lot-soft px-1 font-mono text-[9px] tracking-wider text-lot uppercase"
									title="Captured by voice"
								>
									voice
								</span>
							{/if}
						</div>

						{#if idea.description}
							<p class="mt-1 line-clamp-2 text-sm leading-6 text-ink-2">{idea.description}</p>
						{/if}

						<div class="mt-2 flex flex-wrap items-center gap-2">
							<StatusPill status={idea.status} />
							{#each idea.tags as tag (tag)}
								<button
									type="button"
									onclick={() => toggleTag(tag)}
									class="font-mono text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
								>
									#{tag}
								</button>
							{/each}
							<span class="font-mono text-[11px] text-ink-3">{relativeDay(idea.createdAt)}</span>
						</div>
					</div>

					<div class="flex shrink-0 items-center gap-1">
						{#if upNext}
							<button
								type="button"
								onclick={() => setStatus(idea, upNext)}
								title={`Move to ${upNext}`}
								class="rounded px-2 py-1 font-mono text-[11px] tracking-wider text-ink-3 uppercase opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sunk hover:text-ink focus-visible:opacity-100"
							>
								→ {upNext}
							</button>
						{/if}
						<button
							type="button"
							onclick={() => toggleFavorite(idea)}
							aria-pressed={idea.favorite}
							aria-label={idea.favorite ? 'Remove star' : 'Star this idea'}
							class="rounded px-1.5 py-1 text-sm transition-colors"
							class:text-lot={idea.favorite}
							class:text-ink-3={!idea.favorite}
							class:hover:bg-sunk={true}
						>
							{idea.favorite ? '★' : '☆'}
						</button>
						<button
							type="button"
							onclick={() => archive(idea)}
							aria-label="Archive this idea"
							class="rounded px-1.5 py-1 text-sm text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sunk hover:text-ink focus-visible:opacity-100"
						>
							⤓
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>