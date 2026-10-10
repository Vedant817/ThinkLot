<script lang="ts">
	/**
	 * Owner dashboard: how the product is doing, in aggregates.
	 *
	 * Deliberately NOT in the nav and NOT in the mobile app. The only reader is
	 * the builder, and obscurity is not the security - the `owner:stats` query
	 * compares the signed-in email against OWNER_EMAIL server-side and fails
	 * closed for everyone else, configured or not.
	 *
	 * What this page can show, by construction: one precomputed row per day.
	 * What it can never show: any user, any email, any idea text. Percentages
	 * suppress to "—" below 5 daily actives: tiny-cohort percentages are both
	 * noisy and identifying, while raw counts stay because the builder needs
	 * them and they reveal nothing about who.
	 */
	import { api } from '../../../convex/_generated/api';
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery, type QueryHandle } from '$lib/convex/query.svelte';

	type DayRow = {
		day: string;
		computedAt: number;
		verified: boolean;
		newUsers: number;
		dau: number;
		wau: number;
		mau: number;
		activatedCapture24h: number;
		activatedScored7d: number;
		retD1: number;
		retD7: number;
		retD30: number;
		captures: number;
		capturesPerDau: number;
		scoredIdeasPct: number;
		favUsersPct: number;
		snoozeUsersPct: number;
		letGoUsersPct: number;
		taskUsersPct: number;
		dictatedPct: number;
		archivedPct: number;
		aiSetupPct: number;
		platformWeb: number;
		platformAndroid: number;
		platformIos: number;
		statusInbox: number;
		statusParked: number;
		statusReviewing: number;
		statusReady: number;
		statusBuilding: number;
		statusDone: number;
		reminderReturnPct: number;
		authFailures: number;
	};

	type Me = { email: string | null } | null;

	let statsHandle = $state<QueryHandle<DayRow[] | undefined> | null>(null);
	let meHandle = $state<QueryHandle<Me | undefined> | null>(null);

	$effect(() => {
		// The gate refusal is the normal state here, not a failure: silent so a
		// working gate does not log an error on every load.
		const a = watchQuery<DayRow[] | undefined>(convex.client!, api.owner.stats, { limit: 30 }, undefined, {
			silent: true
		});
		const b = watchQuery<Me | undefined>(convex.client!, api.users.current, {});
		statsHandle = a;
		meHandle = b;
		return () => {
			a.dispose();
			b.dispose();
		};
	});

	const rows = $derived(statsHandle?.current ?? []);
	const latest = $derived(rows[0]);
	const locked = $derived(statsHandle?.error != null);
	const me = $derived(meHandle?.current);

	/** Percentages of tiny cohorts identify; counts do not. */
	function share(pct: number, dau: number): string {
		if (dau < 5) return '—';
		return `${pct}%`;
	}
</script>

<svelte:head><title>Owner - ThinkLot</title></svelte:head>

<div class="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
	<a href="/dashboard" class="font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:text-ink">
		← Dashboard
	</a>

	<h1 class="mt-3 text-2xl font-bold text-ink">Owner</h1>
	{#if me?.email}
		<p class="mt-1 font-mono text-[11px] text-ink-3">signed in as {me.email}</p>
	{/if}

	{#if !statsHandle || statsHandle.loading}
		<p class="mt-6 font-mono text-[11px] tracking-wider text-ink-3 uppercase">Loading…</p>
	{:else if locked}
		<p class="mt-6 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
			Not available. Owner analytics needs OWNER_EMAIL set on the deployment, and this
			account is not it.
		</p>
	{:else if rows.length === 0}
		<p class="mt-6 text-sm text-ink-2">
			No rolled-up days yet. The cron writes the first row at 08:00 UTC after deploy.
		</p>
	{:else if latest}
		<p class="mt-2 max-w-prose text-sm leading-6 text-ink-2">
			One precomputed row per day, written by the morning cron. Aggregates only —
			no users, no emails, no idea text. Percentages hide below 5 daily actives.
			{latest.verified ? '' : 'Latest row failed reconciliation — treat it as suspect.'}
		</p>

		<!-- Latest -->
		<section class="mt-6">
			<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
				{latest.day} · {latest.verified ? 'reconciled' : 'UNVERIFIED'}
			</h2>
			<dl class="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
				{#each [
					['DAU', String(latest.dau)],
					['WAU', String(latest.wau)],
					['MAU', String(latest.mau)],
					['New users', String(latest.newUsers)],
					['Captures', String(latest.captures)],
					['Per DAU', String(latest.capturesPerDau)],
					['D1', `${latest.retD1}%`],
					['D7', `${latest.retD7}%`],
					['D30', `${latest.retD30}%`],
					['AI set up', share(latest.aiSetupPct, latest.dau)],
					['Web / Android / iOS', `${latest.platformWeb} / ${latest.platformAndroid} / ${latest.platformIos}`],
					['Auth failures', String(latest.authFailures)]
				] as [label, value]}
					<div class="rounded-lg border border-rule bg-panel px-3 py-2">
						<dt class="font-mono text-[10px] tracking-wider text-ink-3 uppercase">{label}</dt>
						<dd class="mt-0.5 text-lg font-semibold text-ink" data-numeric="true">{value}</dd>
					</div>
				{/each}
			</dl>
		</section>

		<!-- Adoption -->
		<section class="mt-8">
			<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Adoption · % of monthly actives</h2>
			<dl class="mt-2 space-y-1.5 text-sm">
				{#each [
					['Scored ideas', share(latest.scoredIdeasPct, latest.dau)],
					['Favorites', share(latest.favUsersPct, latest.dau)],
					['Snoozes', share(latest.snoozeUsersPct, latest.dau)],
					['Let-go', share(latest.letGoUsersPct, latest.dau)],
					['Checklists', share(latest.taskUsersPct, latest.dau)],
					['Dictated', share(latest.dictatedPct, latest.dau)],
					['Archived', share(latest.archivedPct, latest.dau)],
					['Reminder return', share(latest.reminderReturnPct, latest.dau)]
				] as [label, value]}
					<div class="flex items-baseline justify-between gap-4">
						<dt class="text-ink-2">{label}</dt>
						<dd class="font-mono text-ink" data-numeric="true">{value}</dd>
					</div>
				{/each}
			</dl>
		</section>

		<!-- Pipeline -->
		<section class="mt-8">
			<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Pipeline · active ideas</h2>
			<p class="mt-2 font-mono text-sm text-ink-2" data-numeric="true">
				inbox {latest.statusInbox} · parked {latest.statusParked} · reviewing
				{latest.statusReviewing} · ready {latest.statusReady} · building
				{latest.statusBuilding} · done {latest.statusDone}
			</p>
		</section>

		<!-- History -->
		<section class="mt-8">
			<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Last 30 days</h2>
			<div class="mt-2 overflow-x-auto">
				<table class="w-full text-left font-mono text-[12px]">
					<thead>
						<tr class="text-ink-3">
							<th class="pr-3 font-normal">day</th>
							<th class="pr-3 font-normal">dau</th>
							<th class="pr-3 font-normal">new</th>
							<th class="pr-3 font-normal">capt</th>
							<th class="pr-3 font-normal">wau</th>
							<th class="pr-3 font-normal">d1</th>
							<th class="pr-3 font-normal">d7</th>
							<th class="font-normal">ok</th>
						</tr>
					</thead>
					<tbody>
						{#each rows as row (row.day)}
							<tr class="border-t border-rule text-ink-2" data-numeric="true">
								<td class="py-1 pr-3">{row.day}</td>
								<td class="pr-3">{row.dau}</td>
								<td class="pr-3">{row.newUsers}</td>
								<td class="pr-3">{row.captures}</td>
								<td class="pr-3">{row.wau}</td>
								<td class="pr-3">{row.retD1}%</td>
								<td class="pr-3">{row.retD7}%</td>
								<td>{row.verified ? 'yes' : 'NO'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>
