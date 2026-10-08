<script lang="ts">
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery, type QueryHandle } from '$lib/convex/query.svelte';
	import QueryError from '$lib/components/QueryError.svelte';
	import StatusPill from '$lib/components/StatusPill.svelte';
	import { api } from '../../../convex/_generated/api';
	import { displayScore, lotPlate, priorityScore, scoreBand, scoreBarWidth } from '$lib/scoring';
	import { IDEA_STATUSES, type Idea, type IdeaStats } from '$lib/types';

	/**
	 * The dashboard.
	 *
	 * This route is in the spec's main navigation ("Dashboard, Ideas (List /
	 * Cards), Board, Review, Archive") and did not exist. Worse, the landing page
	 * carried a "Login to dashboard" link pointing at it, so that link was a live
	 * 404 - which is the kind of gap that a checklist of ticked boxes hides.
	 *
	 * Two widgets, per the spec's "counts + top ideas":
	 *   - counts, computed server-side by ideas:stats
	 *   - the highest-priority ideas, which is the only reason a dashboard is
	 *     worth opening: the answer to "what should I work on?"
	 */

	const TOP_N = 5;

	let statsHandle = $state<QueryHandle<IdeaStats | undefined> | null>(null);
	let topHandle = $state<
		QueryHandle<{ ideas: Idea[]; truncated: boolean; total: number } | undefined> | null
	>(null);

	$effect(() => {
		convex.start();
	});

	$effect(() => {
		// WRITE ONLY. See the note in (app)/ideas/+page.svelte about the
		// read-then-write effect loop.
		const next = watchQuery<IdeaStats | undefined>(convex.client!, api.ideas.stats, {});
		statsHandle = next;
		return () => {
			next.dispose();
		};
	});

	$effect(() => {
		// Sorted server-side by priority, so "top ideas" is a real ranking and not
		// the newest five that happened to be loaded. Excludes archived.
		const next = watchQuery<{ ideas: Idea[]; truncated: boolean; total: number }>(
			convex.client!,
			api.ideas.list,
			{ sortPriority: true, limit: TOP_N }
		);
		topHandle = next;
		return () => {
			next.dispose();
		};
	});

	const stats = $derived(statsHandle?.current);
	const top = $derived(topHandle?.current?.ideas ?? []);

	/**
	 * Busy until both queries have actually reported.
	 *
	 * The handles are assigned inside `$effect`, which runs after the first
	 * paint, so on that paint they are null. Testing only `.loading` therefore
	 * made `busy` undefined, which is falsy - and the dashboard rendered its
	 * empty state, telling users with a full ranking of scored ideas that
	 * "nothing scored yet". A slow load that admits it is slow is fine; one that
	 * asserts a falsehood is not.
	 */
	const busy = $derived(!statsHandle || !topHandle || statsHandle.loading || topHandle.loading);

	/** Scored ideas only - "top ideas" among unscored ones is meaningless. */
	const ranked = $derived(top.filter((idea) => priorityScore(idea) !== null));

	const BAND_BAR: Record<string, string> = {
		unscored: 'bg-rule',
		low: 'bg-ink-3',
		solid: 'bg-lot',
		strong: 'bg-signal'
	};
</script>

<svelte:head>
	<title>Dashboard | ThinkLot</title>
	<meta name="description" content="What deserves your attention today." />
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
	<h1 class="sr-only">Dashboard</h1>

	<div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-4">
		<p class="font-mono text-sm font-bold tracking-tight">Dashboard</p>
		<p class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
			<!--
				`active`, not `total`. The pipeline rows below are all active-only, so
				counting archived ideas here made the two halves of this screen
				disagree by exactly the number of archived ideas.
			-->
			{stats?.active ?? 0} {(stats?.active ?? 0) === 1 ? 'idea' : 'ideas'} parked
		</p>
	</div>

	<QueryError handle={statsHandle} what="The dashboard" />
	<QueryError handle={topHandle} what="The dashboard" />

	<!-- Counts -->
	<div class="rule-y mt-4 overflow-hidden rounded-lg border border-rule bg-paper">
		{#each [['Parked', stats?.active ?? 0], ['Unscored', stats?.unscored ?? 0], ['Starred', stats?.favorites ?? 0], ['Archived', stats?.archived ?? 0]] as [label, value] (label)}
			<div class="flex items-baseline justify-between gap-4 px-3 py-2.5">
				<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
					{label}
				</span>
				<span class="font-mono text-sm text-ink" data-numeric="true">{value}</span>
			</div>
		{/each}
	</div>

	<!-- Pipeline -->
	<h2 class="mt-8 font-mono text-[11px] tracking-wider text-ink-3 uppercase">
		Pipeline
	</h2>
	<div class="rule-y mt-2 overflow-hidden rounded-lg border border-rule bg-paper">
		{#each IDEA_STATUSES as stage (stage)}
			{@const count = stats?.byStatus?.[stage] ?? 0}
			{@const max = Math.max(1, ...IDEA_STATUSES.map((s) => stats?.byStatus?.[s] ?? 0))}
			<div class="flex items-center gap-3 px-3 py-2.5" data-stage={stage}>
				<span class="w-24 shrink-0 font-mono text-[11px] tracking-wider text-ink-3 uppercase">
					{stage}
				</span>
				<!--
					A bar, so the pipeline reads as a distribution rather than six rows
					of "label 0". Width is proportional to the busiest stage, which is
					what makes the shape of the backlog legible at a glance.
				-->
				<span class="h-1.5 flex-1 overflow-hidden rounded-full bg-rule">
					<span
						class="block h-full rounded-full bg-signal/70"
						style={`width:${Math.round((count / max) * 100)}%`}
					></span>
				</span>
				<span class="w-6 shrink-0 text-right font-mono text-xs text-ink" data-numeric="true">
					{count}
				</span>
			</div>
		{/each}
	</div>

	<!-- Top ideas -->
	<h2 class="mt-8 font-mono text-[11px] tracking-wider text-ink-3 uppercase">
		Worth building first
	</h2>

	{#if busy}
		<p class="mt-2 font-mono text-[11px] tracking-wider text-ink-3 uppercase">Loading…</p>
	{:else if ranked.length === 0}
		<div class="mt-2 rounded-lg border border-dashed border-rule-strong px-5 py-10 text-center">
			<p class="font-mono text-sm text-ink-2">Nothing scored yet.</p>
			<p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-3">
				Impact, confidence and effort turn a list into a ranking. Score one idea and it shows
				up here.
			</p>
			<a
				href="/ideas"
				class="mt-4 inline-block rounded-md border border-signal px-4 py-2 font-mono text-[11px] tracking-wider text-signal uppercase hover:bg-signal-soft"
			>
				Go to the lot
			</a>
		</div>
	{:else}
		<ul class="rule-y mt-2 overflow-hidden rounded-lg border border-rule bg-paper">
			{#each ranked as idea, i (idea._id)}
				{@const score = priorityScore(idea)}
				{@const band = scoreBand(score)}
				<li class="flex items-start gap-3 px-3 py-3">
					<!-- Rank position. Not decoration: this is an ordered list. -->
					<span class="w-4 shrink-0 pt-0.5 font-mono text-xs text-ink-3" data-numeric="true">
						{i + 1}
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
							<span class="font-mono text-[11px] font-bold tracking-wider text-lot">
								{lotPlate(idea.seq)}
							</span>
							<a
								href={`/ideas/${idea._id}`}
								class="min-w-0 flex-1 text-[15px] leading-6 font-medium text-ink underline-offset-4 hover:underline"
							>
								{idea.title}
							</a>
							<span class="font-mono text-[11px] text-lot" data-numeric="true">
								{displayScore(score)}
							</span>
						</div>
						<div class="mt-1.5 flex items-center gap-2">
							<StatusPill status={idea.status} />
							{#if idea.trigger}
								<span class="truncate font-mono text-[10px] text-ink-3">
									{idea.trigger}
								</span>
							{/if}
						</div>
					</div>
					<!--
						Score as a rule whose LENGTH encodes the score.

						The track is deliberately neutral. It was the band's own colour,
						which made the fill invisible against it: every bar read as one
						solid block and the length encoded nothing at all.
					-->
					<span class="mt-1 hidden w-16 shrink-0 sm:block">
						<span class="block h-1.5 rounded-full bg-rule">
							<span
								class="block h-full rounded-full {BAND_BAR[band]}"
								style={`width:${scoreBarWidth(score)}%`}
							></span>
						</span>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
