<script lang="ts">
	import CaptureBar from '$lib/components/CaptureBar.svelte';
	import QueryError from '$lib/components/QueryError.svelte';
	import StatusPill from '$lib/components/StatusPill.svelte';
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery, type QueryHandle } from '$lib/convex/query.svelte';
	import { api } from '../../../convex/_generated/api';
	import { byPriority, displayScore, lotPlate, priorityScore, scoreBand } from '$lib/scoring';
	import { IDEA_STATUSES, type Idea, type IdeaStats } from '$lib/types';

	let search = $state('');

	/** Debounced copy of `search`, sent to the server. Typing must not re-query. */
	let searchQuery = $state('');

	/**
	 * Debounce typing into a query argument.
	 *
	 * MUST be an `$effect`. This was briefly a bare IIFE - `(() => { ... })` -
	 * which is a completely valid expression, so `svelte-check` stayed silent.
	 * It ran exactly once at setup, captured `search` as `''`, and threw its
	 * cleanup away, so `searchQuery` never changed and `api.ideas.list` was only
	 * ever called with `search: ''`. The server-side search was inert: the field
	 * looked like it filtered, and it filtered nothing.
	 *
	 * It broke because the line was written by a PowerShell string replacement
	 * in a double-quoted string, where `$effect` interpolated to nothing. Runes
	 * written that way vanish silently, so they are now written with the editor.
	 */
	$effect(() => {
		const value = search;
		const timer = setTimeout(() => {
			searchQuery = value;
		}, 250);
		return () => clearTimeout(timer);
	});

	let tagFilter = $state<string[]>([]);
	let showArchived = $state(false);
	let sortBy = $state<'capture' | 'priority'>('capture');

	/**
	 * Subscription handles are deliberately NOT `$state`.
	 *
	 * The previous version made them reactive and then disposed the old one
	 * inside the same `$effect` that created the new one. That reads and writes
	 * the same tracked value in one body, so Svelte re-scheduled the effect on
	 * every write: 1001 effect runs, 2002 WebSocket subscribe messages, then
	 * `effect_update_depth_exceeded`. The page never settled.
	 *
	 * Reactivity of the *data* comes from `handle.current`, which is itself a
	 * rune inside `watchQuery`. The handle object only has to exist; nothing
	 * about it needs to be reactive.
	 */
	let listHandle = $state<QueryHandle<{ ideas: Idea[]; truncated: boolean; total: number }> | null>(null);
	let statsHandle = $state<QueryHandle<IdeaStats | undefined> | null>(null);

	$effect(() => {
		convex.start();
	});

	// Only `showArchived` is tracked here, which is exactly when a re-subscribe
	// is warranted. Tag and text filtering run in the browser because they are
	// instant-response interactions and re-querying per keystroke would be worse.
	$effect(() => {
		const includeArchived = showArchived;

		const nextList = watchQuery<{ ideas: Idea[]; truncated: boolean; total: number }>(
			convex.client!,
			api.ideas.list,
			{ includeArchived, search: searchQuery }
		);
		const nextStats = watchQuery<IdeaStats>(convex.client!, api.ideas.stats, {});
		// WRITE ONLY. The original bug was an effect that both disposed and
		// recreated the handles it tracked - it READ listHandle to call dispose, then
		// WROTE listHandle, so Svelte re-scheduled it every time: 1001 runs, 2002
		// WebSocket subscribe messages, then effect_update_depth_exceeded. As long as
		// this body never reads the handles, writing them is safe.
		listHandle = nextList;
		statsHandle = nextStats;

		return () => {
			nextList.dispose();
			nextStats.dispose();
		};
	});

	/**
	 * `list` returns a projection without the (up to 20 KB) description and
	 * transcript bodies, plus a `truncated` flag. Reading whole documents here is
	 * what pushed a 400-idea lot past Convex's 16 MiB per-execution limit and
	 * bricked the app with no way back.
	 */
	const lot: Idea[] = $derived(listHandle?.current?.ideas ?? []);
	const truncated = $derived(listHandle?.current?.truncated ?? false);
	const totalIdeas = $derived(listHandle?.current?.total ?? 0);

	const allTags = $derived(
		Array.from(new Set(lot.flatMap((idea) => idea.tags))).sort((a, b) => a.localeCompare(b))
	);

	/**
	 * Only the tag filter runs locally. Text search happens server-side BEFORE the
	 * 250-row cap, because filtering the capped page client-side made any idea
	 * older than the cap unsearchable - and therefore impossible to open or delete.
	 */
	const visible = $derived.by(() => {
		const rows = lot.filter((idea) =>
			tagFilter.length === 0 ? true : tagFilter.every((t) => idea.tags.includes(t))
		);

		return sortBy === 'priority' ? [...rows].sort(byPriority) : rows;
	});

	const stats: IdeaStats | undefined = $derived(statsHandle?.current);

	function toggleTag(tag: string) {
		tagFilter = tagFilter.includes(tag)
			? tagFilter.filter((t) => t !== tag)
			: [...tagFilter, tag];
	}

	/**
	 * One place a row mutation reports failure.
	 *
	 * These three used to be bare `await convex.mutation(...)`. A rejected
	 * promise with no handler is an unhandled rejection: nothing appears on
	 * screen, no rollback happens, and the star or stage the user just clicked
	 * silently does not stick. `/board`, `/review` and `/archive` already caught;
	 * the lot page was the odd one out.
	 *
	 * `busyId` is per-idea rather than a single boolean so parallel rows stay
	 * independently interactive.
	 */
	let rowBusy = $state<string | null>(null);
	let rowProblem = $state<string | null>(null);

	async function runRow(idea: Idea, fn: () => Promise<unknown>) {
		rowProblem = null;
		rowBusy = idea._id;
		try {
			await fn();
		} catch (error) {
			rowProblem = error instanceof Error ? error.message : 'That did not save.';
		} finally {
			rowBusy = null;
		}
	}

	async function setStatus(idea: Idea, status: Idea['status']) {
		await runRow(idea, () => convex.mutation(api.ideas.setStatus, { ideaId: idea._id, status }));
	}

	/**
	 * `toggleFavorite` is a genuine read-modify-write on the server: it reads
	 * `idea.favorite` and writes its negation. Two rapid taps therefore execute
	 * sequentially and cancel out, and to the user the star "does not work".
	 * Guarding the control while the first is in flight is the honest fix; the
	 * alternative - a server-side absolute setter - is a bigger change for a
	 * control tapped twice a second.
	 */
	async function toggleFavorite(idea: Idea) {
		if (rowBusy === idea._id) return;
		await runRow(idea, () => convex.mutation(api.ideas.toggleFavorite, { ideaId: idea._id }));
	}

	async function archive(idea: Idea) {
		await runRow(idea, () =>
			convex.mutation(api.ideas.setArchived, {
				ideaId: idea._id,
				archived: true,
				statusBeforeArchive: idea.status
			})
		);
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
	<!--
		Every other route has an <h1>; this one had none, which fails 1.3.1 and
		2.4.6 and leaves screen-reader users with no page-level landmark on the
		app's most-used screen. The counters below read as a heading visually, so
		the heading is present but visually hidden rather than duplicated.
	-->
	<h1 class="sr-only">The lot</h1>

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
	<QueryError handle={listHandle} what="The lot" />

	{#if rowProblem}
		<p
			class="mb-3 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad"
			role="alert"
		>
			{rowProblem}
		</p>
	{/if}

	{#if listHandle?.error}
		<!-- An empty state here would be a lie: the list is empty because the
		     query failed, not because the user has no ideas. -->
	{:else if visible.length === 0}
		<!--
			"Nothing parked yet" and "nothing matches these filters" are different
			facts. Collapsing them told someone with 400 ideas that they had none,
			simply because their search did not hit.
		-->
		{@const filtering = searchQuery.trim().length > 0 || tagFilter.length > 0}
		<div class="rounded-lg border border-dashed border-rule-strong px-5 py-14 text-center">
			<p class="font-mono text-sm text-ink-2">
				{filtering ? 'Nothing matches those filters.' : 'Nothing parked yet.'}
			</p>
			<p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-3">
				{filtering
					? 'Search covers titles, notes and tags. Clear it or pick fewer tags.'
					: 'Use the bar above. Half a sentence is enough — you can make it useful later.'}
			</p>
		</div>
	{:else}
		<!--
			The lot caps a single response so a large backlog cannot brick the app.
			Saying so is better than silently showing a partial list.
		-->
		{#if truncated}
			<p class="mb-3 rounded-md border border-warn/25 bg-warn-soft px-3 py-2 font-mono text-[11px] tracking-wide text-warn">
				Showing the {lot.length} most recent of {totalIdeas}. Older ideas need search or tags.
			</p>
		{/if}
		<ul class="rule-y overflow-hidden rounded-lg border border-rule bg-paper">
			{#each visible as idea (idea._id)}
				{@const score = priorityScore(idea)}
				{@const band = scoreBand(score)}
				{@const upNext = nextStage(idea.status)}
				<li
					class="group flex items-start gap-3 px-3 py-3 transition-colors hover:bg-panel"
					aria-busy={rowBusy === idea._id}
				>
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
							<!--
								The whole row is the link, but only the title is an anchor.
								Wrapping the row in an <a> would nest the star/archive buttons
								inside a link, which is both invalid and unusable on a phone.
							-->
							<a
								href={`/ideas/${idea._id}`}
								class="text-[15px] leading-6 font-medium text-ink underline-offset-4 hover:underline"
							>
								{idea.title}
							</a>
							{#if idea.source === 'dictated'}
								<span
									class="rounded border border-lot/30 bg-lot-soft px-1 font-mono text-[9px] tracking-wider text-lot uppercase"
									title="Captured by voice"
								>
									voice
								</span>
							{/if}
						</div>

						{#if idea.preview}
							<p class="mt-1 line-clamp-2 text-sm leading-6 text-ink-2">{idea.preview}</p>
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
								class="rounded px-2 py-1.5 font-mono text-[11px] tracking-wider text-ink-3 uppercase transition-opacity hover:bg-sunk hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
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
							class="rounded px-2 py-1.5 text-sm text-ink-3 transition-opacity hover:bg-sunk hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
						>
							⤓
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>