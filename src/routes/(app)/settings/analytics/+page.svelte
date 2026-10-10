<script lang="ts">
	/**
	 * Your numbers: personal analytics from rows already held.
	 *
	 * Every metric folds `ideas:list` (plus one bounded events read) into
	 * sentences, in the shared `computePersonal` module the phone also calls -
	 * so these numbers can never disagree with the four rows on mobile. No new
	 * writes, no cross-user reads: a user's analytics derive only from their own
	 * rows. The 250-row list cap applies, and the page says so where it matters
	 * rather than implying a full history.
	 */
	import { api } from '../../../../convex/_generated/api';
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery, type QueryHandle } from '$lib/convex/query.svelte';
	import QueryError from '$lib/components/QueryError.svelte';
	import { computePersonal, type AnalyticsEvent } from '$lib/analytics';

	type Lot = {
		ideas: {
			_id: string;
			title: string;
			status: string;
			archived: boolean;
			favorite: boolean;
			source: 'typed' | 'dictated';
			createdAt: number;
			updatedAt: number;
			impact?: number;
			effort?: number;
			confidence?: number;
			letGoAt?: number;
			hasTranscript?: boolean;
		}[];
		truncated: boolean;
		total: number;
	};

	type Stats = { tasksTotal: number; tasksDone: number; tasksTruncated: boolean };
	type Prefs = { optedOut: boolean };

	let lotHandle = $state<QueryHandle<Lot | undefined> | null>(null);
	let eventsHandle = $state<QueryHandle<AnalyticsEvent[] | undefined> | null>(null);
	let statsHandle = $state<QueryHandle<Stats | undefined> | null>(null);
	let prefsHandle = $state<QueryHandle<Prefs | undefined> | null>(null);

	$effect(() => {
		const handles = [
			watchQuery<Lot | undefined>(convex.client!, api.ideas.list, { includeArchived: true }),
			watchQuery<AnalyticsEvent[] | undefined>(convex.client!, api.analytics.events, {}),
			watchQuery<Stats | undefined>(convex.client!, api.ideas.stats, {}),
			watchQuery<Prefs | undefined>(convex.client!, api.telemetry.prefs, {})
		] as const;
		lotHandle = handles[0];
		eventsHandle = handles[1];
		statsHandle = handles[2];
		prefsHandle = handles[3];
		return () => {
			for (const h of handles) h.dispose();
		};
	});

	const lot = $derived(lotHandle?.current);
	const events = $derived(eventsHandle?.current ?? []);
	const stats = $derived(statsHandle?.current);
	const prefs = $derived(prefsHandle?.current);
	const loading = $derived(!lotHandle || lotHandle.loading);

	const analytics = $derived(
		lot
			? computePersonal(
					lot.ideas,
					events,
					stats
						? { done: stats.tasksDone, total: stats.tasksTotal, truncated: stats.tasksTruncated }
						: undefined
				)
			: null
	);

	/** Decision mix totals, derived so the template has no logic to misplace. */
	const mixTotal = $derived.by(() => {
		if (!analytics) return 0;
		const mix = analytics.decisionMix30d;
		return mix.try + mix.park + mix.letGo + mix.skip;
	});

	let toggling = $state(false);
	let toggleError = $state<string | null>(null);

	async function setOptOut(optedOut: boolean) {
		toggling = true;
		toggleError = null;
		try {
			await convex.mutation(api.telemetry.setOptOut, { optedOut });
		} catch (error) {
			toggleError = error instanceof Error ? error.message : 'That did not work.';
		} finally {
			toggling = false;
		}
	}

	function pct(n: number, d: number): string {
		if (d === 0) return '—';
		return `${Math.round((n / d) * 100)}%`;
	}
</script>

<svelte:head><title>Your numbers - ThinkLot</title></svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<a href="/dashboard" class="font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:text-ink">
		← Dashboard
	</a>

	<h1 class="mt-3 text-2xl font-bold text-ink">Your numbers</h1>
	<p class="mt-2 max-w-prose text-sm leading-6 text-ink-2">
		What your lot says about how you capture, decide, and follow through. Computed
		from your ideas alone — nothing here is compared against anyone else, and
		collecting it writes nothing anywhere.
	</p>

	{#if loading}
		<p class="mt-6 font-mono text-[11px] tracking-wider text-ink-3 uppercase">Loading…</p>
	{:else if lotHandle?.error}
		<QueryError handle={lotHandle} />
	{:else if analytics && lot}
		{#if lot.truncated}
			<p class="mt-4 rounded-md border border-warn/25 bg-warn-soft px-3 py-2 text-sm text-warn">
				Based on the {lot.ideas.length} most recent of {lot.total} ideas. Older history
				is not counted below.
			</p>
		{/if}

		<!-- Capture -->
		<section class="mt-8">
			<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Capture</h2>
			<dl class="mt-2 space-y-3">
				<div>
					<dt class="text-sm text-ink-2">Streak</dt>
					<dd class="text-[15px] text-ink">
						{#if analytics.streak.current > 0}
							{analytics.streak.current} day{analytics.streak.current === 1 ? '' : 's'} and counting{analytics.streak.best > analytics.streak.current ? ` (best ${analytics.streak.best})` : ''}.
						{:else if analytics.streak.best > 0}
							No streak right now — best is {analytics.streak.best} day{analytics.streak.best === 1 ? '' : 's'}.
						{:else}
							No streak yet — capture something today.
						{/if}
					</dd>
				</div>
				<div>
					<dt class="text-sm text-ink-2">By voice</dt>
					<dd class="text-[15px] text-ink">
						{#if analytics.voice.total30d > 0}
							{pct(analytics.voice.dictated30d, analytics.voice.total30d)} of last-30-day captures were dictated
							({analytics.voice.dictatedAll} of {analytics.voice.totalAll} all time).
						{:else}
							Nothing dictated lately{analytics.voice.dictatedAll > 0 ? ` (${analytics.voice.dictatedAll} all time)` : ''}.
						{/if}
					</dd>
				</div>
				<div>
					<dt class="text-sm text-ink-2">Verbatim kept</dt>
					<dd class="text-[15px] text-ink">
						{#if analytics.verbatimKept.dictated > 0}
							{analytics.verbatimKept.withTranscript} of {analytics.verbatimKept.dictated} dictated ideas kept the exact words.
						{:else}
							No dictated ideas yet — when you dictate, the exact wording is kept with the idea.
						{/if}
					</dd>
				</div>
			</dl>
		</section>

		<!-- Deciding -->
		<section class="mt-8">
			<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Deciding</h2>
			<dl class="mt-2 space-y-3">
				<div>
					<dt class="text-sm text-ink-2">Scoring coverage</dt>
					<dd class="text-[15px] text-ink">
						{#if analytics.scoring.open === 0}
							Nothing open to score.
						{:else}
							{analytics.scoring.scored} of {analytics.scoring.open} open ideas fully scored.
						{/if}
					</dd>
				</div>
				<div>
					<dt class="text-sm text-ink-2">Oldest untouched</dt>
					<dd class="text-[15px] text-ink">
						{#if analytics.oldestUntouched}
							<a href={`/ideas/${analytics.oldestUntouched.id}`} class="underline-offset-4 hover:underline">
								{analytics.oldestUntouched.title}
							</a>
							— untouched for {analytics.oldestUntouched.days} day{analytics.oldestUntouched.days === 1 ? '' : 's'}.
						{:else}
							Inbox is clear.
						{/if}
					</dd>
				</div>
				<div>
					<dt class="text-sm text-ink-2">Decision speed</dt>
					<dd class="text-[15px] text-ink">
						{#if analytics.decisionLatencyMedianDays !== null}
							Median {analytics.decisionLatencyMedianDays} day{analytics.decisionLatencyMedianDays === 1 ? '' : 's'} from capture to first decision.
						{:else}
							No decisions recorded yet.
						{/if}
					</dd>
				</div>
				<div>
					<dt class="text-sm text-ink-2">Last 30 days</dt>
					<dd class="text-[15px] text-ink">
						{#if mixTotal === 0}
							No decisions in the last 30 days.
						{:else}
							{analytics.decisionMix30d.try} tried · {analytics.decisionMix30d.park} parked · {analytics.decisionMix30d.letGo} let go · {analytics.decisionMix30d.skip} left for later.
						{/if}
					</dd>
				</div>
				<div>
					<dt class="text-sm text-ink-2">Decisive weeks</dt>
					<dd class="text-[15px] text-ink">
						{analytics.letGoWeeks4} of the last 4 weeks included letting something go.
					</dd>
				</div>
			</dl>
		</section>

		<!-- Follow-through -->
		<section class="mt-8">
			<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Follow-through</h2>
			<dl class="mt-2 space-y-3">
				<div>
					<dt class="text-sm text-ink-2">Parking works?</dt>
					<dd class="text-[15px] text-ink">
						{analytics.parkToBuild.everParked === 0
							? 'Nothing parked yet.'
							: `${analytics.parkToBuild.nowBuilt} of ${analytics.parkToBuild.everParked} parked ideas are now ready, building, or done.`}
					</dd>
				</div>
				<div>
					<dt class="text-sm text-ink-2">Finished vs let go</dt>
					<dd class="text-[15px] text-ink">
						{analytics.finishVsLetGo.done} built · {analytics.finishVsLetGo.letGo} let go. Both are outcomes.
					</dd>
				</div>
				<div>
					<dt class="text-sm text-ink-2">Checklists</dt>
					<dd class="text-[15px] text-ink">
						{analytics.tasks.total === 0
							? 'No checklist items yet.'
							: `${analytics.tasks.done} of ${analytics.tasks.total} done${analytics.tasks.truncated ? ' (count capped)' : ''}.`}
					</dd>
				</div>
				<div>
					<dt class="text-sm text-ink-2">Favorited, then what</dt>
					<dd class="text-[15px] text-ink">
						{analytics.favoritesActedOn.total === 0
							? 'Nothing favorited.'
							: `${analytics.favoritesActedOn.active} of ${analytics.favoritesActedOn.total} favorites are in active stages.`}
					</dd>
				</div>
			</dl>
		</section>

		<!-- Telemetry opt-out -->
		<section class="mt-10 border-t border-rule pt-4">
			<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Product telemetry</h2>
			<p class="mt-2 max-w-prose text-sm leading-6 text-ink-2">
				Once a day this browser reports which platform it is and whether an AI key
				is set, so the builder can see the product is healthy. Your ideas never
				leave your account either way — this page is unaffected by the switch.
			</p>
			<div class="mt-3">
				<button
					type="button"
					onclick={() => setOptOut(!(prefs?.optedOut ?? false))}
					disabled={toggling}
					class="rounded-md border border-rule px-4 py-2 font-mono text-[11px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal disabled:opacity-40"
				>
					{toggling ? '···' : prefs?.optedOut ? 'Telemetry: off — turn on' : 'Telemetry: on — turn off'}
				</button>
			</div>
			{#if toggleError}
				<p class="mt-2 text-sm text-bad">{toggleError}</p>
			{/if}
		</section>
	{/if}
</div>
