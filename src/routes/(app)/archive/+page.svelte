<script lang="ts">
	import QueryError from '$lib/components/QueryError.svelte';
	import StatusPill from '$lib/components/StatusPill.svelte';
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery, type QueryHandle } from '$lib/convex/query.svelte';
	import { api } from '../../../convex/_generated/api';
	import { displayScore, lotPlate, priorityScore } from '$lib/scoring';
	import type { Idea } from '$lib/types';
	import { page } from '$app/state';
	import { readFilters, syncFilters } from '$lib/filters.svelte';

	type Lot = { ideas: Idea[]; truncated: boolean; total: number };

	let handle = $state<QueryHandle<Lot> | null>(null);
	let restoringId = $state<string | null>(null);
	let problem = $state<string | null>(null);

	/**
	 * Search is in the URL, for the same reason as the lot's.
	 *
	 * Searching the archive is how you find the one idea you put away six months
	 * ago, which makes it the single most shareable view in the app - "here is the
	 * idea we discussed in March" - and it used to be unreproducible because the
	 * query lived in component state. `?q=` is shared with the lot, so the same
	 * search works in both places.
	 */
	const initial = readFilters(page.url);
	let search = $state(initial.search);

	syncFilters(() => ({
		search,
		tags: [],
		// Left implicit rather than written as `archived=1`. This route always
		// queries with `includeArchived: true` because that is what the page IS, so
		// writing the param would put `?archived=1` on every archive URL - and any
		// such link pasted into the lot would silently switch the lot to showing
		// archived ideas.
		archived: false,
		sort: 'capture',
		view: 'cards',
		reason: null
	}));

	/**
	 * Debounced copy of `search`, sent to the server.
	 *
	 * MUST be an `$effect` - a bare IIFE here once meant the lot's search never
	 * ran at all, and svelte-check could not tell, because a bare IIFE is valid
	 * JavaScript. Filtering the capped page in the browser is worse than useless
	 * past 250 rows: an older archived idea is not merely absent from results, it
	 * cannot be found or restored at all.
	 *
	 * Seeded from the URL so a shared archive link runs its first query WITH the
	 * filter, rather than flashing the unfiltered archive first.
	 */
	let searchQuery = $state(initial.search);

	$effect(() => {
		const value = search;
		const timer = setTimeout(() => {
			searchQuery = value;
		}, 250);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		convex.start();
	});

	$effect(() => {
		/*
		 * `archivedOnly`, not `includeArchived`.
		 *
		 * This used to ask for everything and filter in the browser. Correct, but it
		 * read every idea the user has ever had in order to show the archived subset -
		 * and with a 250-row cap, "everything" is a lie about a large lot: an archived
		 * idea older than the cap is not merely missing from the page, the page has
		 * no idea it exists.
		 *
		 * `archivedOnly` narrows in the index, so the read is the page itself and
		 * `truncated` means what it says. It is also what the mobile client already
		 * sends, so both clients now make the same request - the QA audit that found
		 * this was wrong that the two disagreed in RESULT, and right that they
		 * disagreed in cost.
		 */
		const next = watchQuery<Lot>(convex.client!, api.ideas.list, {
			archivedOnly: true,
			search: searchQuery
		});
		handle = next;
		return () => {
			next.dispose();
		};
	});

	const all = $derived(handle?.current?.ideas ?? []);
	const truncated = $derived(handle?.current?.truncated ?? false);
	const total = $derived(handle?.current?.total ?? 0);

	// The server already narrowed by index, so this is a rename rather than a filter.
	const archived = $derived(all);

	/** True when a filter is narrowing the view, so the empty state can say so. */
	const filtering = $derived(search.trim().length > 0);

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

	<QueryError handle={handle} what="The archive" />

	{#if problem}
		<p class="mb-3 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
			{problem}
		</p>
	{/if}

	{#if truncated && !filtering}
		<p class="mb-3 rounded-md border border-warn/25 bg-warn-soft px-3 py-2 font-mono text-[11px] tracking-wide text-warn">
			Showing {all.length} of {total}. Clear search to narrow it - older ideas are still here, just not loaded.
		</p>
	{/if}

	{#if handle?.error}
		<!-- An empty state here would be a lie: nothing is archived *as far as this
		     page knows*, which is not the same as nothing being archived. -->
	{:else if archived.length === 0}
		<div class="rounded-lg border border-dashed border-rule-strong px-5 py-14 text-center">
			<p class="font-mono text-sm text-ink-2">
				{filtering ? 'Nothing archived matches that search.' : 'Nothing archived.'}
			</p>
			<p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-3">
				{filtering
					? 'Search looks at the title and the start of the notes.'
					: 'Archiving is reversible, and an idea keeps the stage it was parked from.'}
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
\t\t\t\t\t\t<!--
\t\t\t\t\t\t\tThe reason this one was let go, on the row rather than behind a click.
\t\t\t\t\t\t\tIt was stored from the first version and then rendered nowhere, so the
\t\t\t\t\t\t\tarchive listed ideas the user had decided against with no visible
\t\t\t\t\t\t\trecord of why. The reason is the one part that cannot be reconstructed
\t\t\t\t\t\t\tlater, which is why the review screen demands it in the first place.
\t\t\t\t\t\t-->
						{#if idea.letGoReason}
							<p class="mt-0.5 line-clamp-2 text-sm text-ink-3">
								<span class="font-mono text-[10px] tracking-wider uppercase">let go because</span>
								— {idea.letGoReason}
							</p>
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
