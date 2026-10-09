<script lang="ts">
	import StatusPill from '$lib/components/StatusPill.svelte';
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery, type QueryHandle } from '$lib/convex/query.svelte';
	import { api } from '../../../convex/_generated/api';
	import { displayScore, lotPlate } from '$lib/scoring';
	import type { IdeaStatus } from '$lib/types';
	import { page } from '$app/state';
	import { syncFilters } from '$lib/filters.svelte';

	type Reason = 'stale' | 'parked' | 'strong' | 'snoozed' | 'untouched_inbox';

	/**
	 * Human wording for each rule, because a queue that cannot explain itself is
	 * noise.
	 *
	 * Declared at the top rather than next to its first use: `?reason=` from the
	 * URL is validated against these keys during component setup, so anything this
	 * depends on has to exist before setup runs. Validating a param against a const
	 * declared further down is a temporal-dead-zone crash, not a lint warning.
	 */
	const REASON_COPY: Record<Reason, { label: string; help: string }> = {
		stale: { label: 'stale', help: 'Untouched for 7 days or more' },
		parked: { label: 'parked', help: 'Parked and never revisited' },
		strong: { label: 'strong', help: 'Scores 24 or higher' },
		snoozed: { label: 'due back', help: 'You asked to look at this again' },
		untouched_inbox: { label: 'undecided', help: 'Never scored, still sitting in the inbox' }
	};

	/** Derived, so a new reason cannot be added to the copy and forgotten here. */
	const REASONS = Object.keys(REASON_COPY) as Reason[];

	function isReason(value: string | null): value is Reason {
		return value !== null && (REASONS as string[]).includes(value);
	}

	type Item = {
		id: string;
		seq: number;
		title: string;
		status: IdeaStatus;
		score: number | null;
		reasons: Reason[];
		updatedAt: number;
		createdAt: number;
	};

	type Queue = { items: Item[]; total: number; truncated: boolean };

	let handle = $state<QueryHandle<Queue> | null>(null);
	let busyId = $state<string | null>(null);
	let problem = $state<string | null>(null);

	/**
	 * The reason filter lives in the URL.
	 *
	 * "Show me the high-scoring ideas I have not looked at" is a view worth
	 * sending to someone, and it used to evaporate on refresh. Unvalidated input
	 * falls back to "all" rather than matching nothing, so a typo in a shared link
	 * shows the whole queue instead of an empty screen with no explanation.
	 */
	const initialReason = page.url.searchParams.get('reason');
	let reasonFilter = $state<Reason | 'all'>(isReason(initialReason) ? initialReason : 'all');

	syncFilters(() => ({
		search: '',
		tags: [],
		archived: false,
		sort: 'capture',
		view: 'cards',
		reason: reasonFilter === 'all' ? null : reasonFilter
	}));

	$effect(() => {
		convex.start();
	});

	$effect(() => {
		const next = watchQuery<Queue>(convex.client!, api.review.queue, {});
		handle = next;
		return () => {
			next.dispose();
		};
	});

	const items = $derived(handle?.current?.items ?? []);
	const truncated = $derived(handle?.current?.truncated ?? false);
	const total = $derived(handle?.current?.total ?? 0);

	const visible = $derived.by(() => {
		const filter = reasonFilter;
		if (filter === 'all') return items;
		return items.filter((i) => i.reasons.includes(filter));
	});

	/** How many items carry each reason, for the filter chips. */
	const counts = $derived.by(() => {
		const map = new Map<Reason, number>();
		for (const item of items) {
			for (const reason of item.reasons) map.set(reason, (map.get(reason) ?? 0) + 1);
		}
		return map;
	});

	function ago(ts: number): string {
		const days = Math.floor((now - ts) / 86_400_000);
		if (days <= 0) return 'today';
		if (days === 1) return 'yesterday';
		return `${days}d ago`;
	}

	// Captured once so the list does not recompute every render and, more
	// importantly, so "3d ago" does not silently change mid-read.
	const now = Date.now();

	async function run(fn: () => Promise<unknown>) {
		problem = null;
		try {
			await fn();
		} catch (error) {
			problem = error instanceof Error ? error.message : 'That did not work.';
		}
	}

	async function snooze(item: Item, days: number) {
		busyId = item.id;
		await run(() => convex.mutation(api.review.decide, { ideaId: item.id, outcome: 'park', inDays: days }));
		busyId = null;
	}

	async function promote(item: Item) {
		busyId = item.id;
		await run(() => convex.mutation(api.review.decide, { ideaId: item.id, outcome: 'try', inDays: 7 }));
		busyId = null;
	}

	/**
	 * Which row is showing the "let go" reason form.
	 *
	 * Inline rather than a dialog, because a modal over a list the user is working
	 * through is the fastest way to make them abandon the session. And the reason is
	 * REQUIRED: a "let go" with no words behind it is just an archive with extra steps,
	 * which is the exact confusion `review:decide` exists to remove.
	 */
	let lettingGoId = $state<string | null>(null);
	let letGoReason = $state('');

	function startLetGo(item: Item) {
		lettingGoId = item.id;
		letGoReason = '';
		problem = null;
	}

	function cancelLetGo() {
		lettingGoId = null;
		letGoReason = '';
	}

	async function confirmLetGo(item: Item) {
		if (!letGoReason.trim()) {
			problem = 'Say why, in a few words. That is the part you will want to read later.';
			return;
		}
		busyId = item.id;
		await run(() =>
			convex.mutation(api.review.decide, {
				ideaId: item.id,
				outcome: 'letGo',
				reason: letGoReason.trim()
			})
		);
		busyId = null;
		lettingGoId = null;
		letGoReason = '';
	}
</script>

<svelte:head>
	<title>Review | ThinkLot</title>
	<meta name="description" content="Ideas that need a decision." />
</svelte:head>

<div class="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6">
	<div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-4">
		<h1 class="font-mono text-sm font-bold tracking-tight">Review</h1>
		<p class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
			{total} {total === 1 ? 'idea needs' : 'ideas need'} a decision
		</p>
	</div>

	<p class="py-3 text-sm leading-6 text-ink-2">
		Ideas you have not looked at, things you parked and forgot, and anything scoring well.
		Oldest first, because whatever has been neglected longest is the one most likely to be
		gone from your head.
	</p>

	<!-- Reason filters, with counts so an empty chip is visibly empty. -->
	{#if REASONS.some((r) => (counts.get(r) ?? 0) > 0)}
		<div class="flex flex-wrap gap-1.5 pb-4">
			<button
				type="button"
				onclick={() => (reasonFilter = 'all')}
				aria-pressed={reasonFilter === 'all'}
				class="rounded border px-2 py-0.5 font-mono text-[11px] transition-colors"
				class:border-signal={reasonFilter === 'all'}
				class:bg-signal-soft={reasonFilter === 'all'}
				class:text-signal={reasonFilter === 'all'}
				class:border-rule-strong={reasonFilter !== 'all'}
				class:text-ink-3={reasonFilter !== 'all'}
			>
				all {items.length}
			</button>
			{#each REASONS as reason (reason)}
				{@const n = counts.get(reason) ?? 0}
				{#if n > 0}
					<button
						type="button"
						onclick={() => (reasonFilter = reasonFilter === reason ? 'all' : reason)}
						aria-pressed={reasonFilter === reason}
						title={REASON_COPY[reason].help}
						class="rounded border px-2 py-0.5 font-mono text-[11px] transition-colors"
						class:border-signal={reasonFilter === reason}
						class:bg-signal-soft={reasonFilter === reason}
						class:text-signal={reasonFilter === reason}
						class:border-rule-strong={reasonFilter !== reason}
						class:text-ink-3={reasonFilter !== reason}
					>
						{REASON_COPY[reason].label} {n}
					</button>
				{/if}
			{/each}
		</div>
	{/if}

	{#if problem}
		<p class="mb-3 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
			{problem}
		</p>
	{/if}

	{#if truncated}
		<p class="mb-3 rounded-md border border-warn/25 bg-warn-soft px-3 py-2 font-mono text-[11px] text-warn">
			Showing the {items.length} most neglected of {total}. Filter by reason to narrow.
		</p>
	{/if}

	{#if handle?.error}
		<p class="mb-3 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
			{handle.error}
		</p>
	{/if}

	<!--
		Gated on `handle.error`. Previously the error banner and "Nothing needs
		reviewing." rendered together, which is the same lie the lot page told: a
		failed query is not the same fact as an empty lot.
	-->
	{#if handle?.error}
		<!-- error is shown above; do not also claim there is nothing to review -->
	{:else if visible.length === 0}
		<div class="rounded-lg border border-dashed border-rule-strong px-5 py-14 text-center">
			<p class="font-mono text-sm text-ink-2">
				{items.length === 0 ? 'Nothing needs reviewing.' : 'Nothing with that reason.'}
			</p>
			<p class="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink-3">
				{items.length === 0
					? 'Everything here has been looked at recently. That is the goal.'
					: 'Clear the filter to see the rest.'}
			</p>
		</div>
	{:else}
		<ul class="rule-y overflow-hidden rounded-lg border border-rule bg-paper">
			{#each visible as item (item.id)}
				<li class="px-3 py-3">
					<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<span class="font-mono text-[11px] font-bold tracking-wider text-lot">
							{lotPlate(item.seq)}
						</span>
						<a
							href={`/ideas/${item.id}`}
							class="min-w-0 flex-1 text-[15px] leading-6 font-medium text-ink underline-offset-4 hover:underline"
						>
							{item.title}
						</a>
						<span
							class="font-mono text-[11px]"
							class:text-lot={item.score !== null}
							class:text-ink-3={item.score === null}
							data-numeric="true"
						>
							{displayScore(item.score)}
						</span>
					</div>

					<div class="mt-2 flex flex-wrap items-center gap-1.5">
						<StatusPill status={item.status} />
						{#each item.reasons as reason (reason)}
							<span
								class="rounded border border-rule-strong bg-paper px-1.5 font-mono text-[10px] tracking-wide text-ink-2 uppercase"
								title={REASON_COPY[reason].help}
							>
								{REASON_COPY[reason].label}
							</span>
						{/each}
						<span class="font-mono text-[10px] text-ink-3">
							touched {ago(item.updatedAt)}
						</span>
					</div>

				<!--
					The four decisions, each of which is a DECISION rather than a deferral.
					Every one writes through Convex and the row disappears on its own via
					the subscription, so there is no local state to keep in step with the
					server.

					Archive was replaced by Let it go because archive meant three
					different things - finished, maybe later, and decided against - and none
					of them was legible a month later. Delete was never right for any of
					them, and the ones it was almost right for were the ones a person most
					wanted to keep.
				-->
				<div class="mt-2.5 flex flex-wrap gap-1.5">
					<button
						type="button"
						onclick={() => promote(item)}
						disabled={busyId === item.id || item.status === 'ready'}
						class="rounded border border-ok/30 bg-ok-soft px-2 py-1 font-mono text-[10px] tracking-wider text-ok uppercase transition-colors hover:brightness-105 disabled:opacity-40"
					>
						Try this week
					</button>
					<button
						type="button"
						onclick={() => snooze(item, 7)}
						disabled={busyId === item.id}
						class="rounded border border-rule-strong px-2 py-1 font-mono text-[10px] tracking-wider text-ink-2 uppercase transition-colors hover:bg-sunk disabled:opacity-40"
					>
						Park 7d
					</button>
					<button
						type="button"
						onclick={() => snooze(item, 30)}
						disabled={busyId === item.id}
						class="rounded border border-rule-strong px-2 py-1 font-mono text-[10px] tracking-wider text-ink-2 uppercase transition-colors hover:bg-sunk disabled:opacity-40"
					>
						Park 30d
					</button>
					<button
						type="button"
						onclick={() => startLetGo(item)}
						disabled={busyId === item.id || lettingGoId === item.id}
						class="rounded border border-rule-strong px-2 py-1 font-mono text-[10px] tracking-wider text-ink-3 uppercase transition-colors hover:bg-sunk disabled:opacity-40"
					>
						Let it go
					</button>
				</div>

				{#if lettingGoId === item.id}
					<!--
						Inline, not a modal: a dialog over a list the user is working through
						is the fastest way to make them abandon the whole session.

						The reason is required, and the form says what it is FOR. It is the only
						thing that makes the archive readable a year later. Repeatable, not
						sticky - Same as the 2024 attempt is a good answer, and a form that
						made people think harder would simply go unused.
					-->
					<div class="mt-2 rounded-md border border-rule-strong bg-panel p-2.5">
						<label class="block">
							<span class="font-mono text-[10px] tracking-wider text-ink-3 uppercase">
								Why are you letting it go?
							</span>
							<textarea
								bind:value={letGoReason}
								rows="2"
								placeholder="Same thing as the 2024 attempt, which shipped"
								class="mt-1 block w-full resize-y rounded-md border border-rule bg-paper px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-signal"
							></textarea>
						</label>
						<p class="mt-1 text-sm text-ink-3">
							Kept with your reason, not deleted - and reversible from the archive.
						</p>
						<div class="mt-2 flex gap-1.5">
							<button
								type="button"
								onclick={() => confirmLetGo(item)}
								disabled={busyId === item.id || !letGoReason.trim()}
								class="rounded border border-ok/30 bg-ok-soft px-2 py-1 font-mono text-[10px] tracking-wider text-ok uppercase transition-colors hover:brightness-105 disabled:opacity-40"
							>
								Let it go for good
							</button>
							<button
								type="button"
								onclick={cancelLetGo}
								class="rounded border border-rule-strong px-2 py-1 font-mono text-[10px] tracking-wider text-ink-2 uppercase transition-colors hover:bg-sunk"
							>
								Keep it
							</button>
						</div>
					</div>
				{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
