<script lang="ts">
	import CaptureBar from '$lib/components/CaptureBar.svelte';
	import QueryError from '$lib/components/QueryError.svelte';
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery, type QueryHandle } from '$lib/convex/query.svelte';
	import { api } from '../../../convex/_generated/api';
	import { displayScore, lotPlate, priorityScore } from '$lib/scoring';
	import { IDEA_STATUSES, type Idea, type IdeaStatus } from '$lib/types';

	type Lot = { ideas: Idea[]; truncated: boolean; total: number };

	let handle = $state<QueryHandle<Lot> | null>(null);

	/** Which column a card is being dragged over, for the drop-target affordance. */
	let dropTarget = $state<IdeaStatus | null>(null);
	let draggingId = $state<string | null>(null);
	let problem = $state<string | null>(null);

	$effect(() => {
		convex.start();
	});

	$effect(() => {
		const next = watchQuery<Lot>(convex.client!, api.ideas.list, { includeArchived: false });
		handle = next;
		return () => {
			next.dispose();
		};
	});

	const byStatus = $derived.by(() => {
		const groups = Object.fromEntries(IDEA_STATUSES.map((s) => [s, [] as Idea[]])) as Record<
			IdeaStatus,
			Idea[]
		>;
		for (const idea of handle?.current?.ideas ?? []) {
			groups[idea.status]?.push(idea);
		}
		return groups;
	});

	const total = $derived(handle?.current?.total ?? 0);
	const truncated = $derived(handle?.current?.truncated ?? false);
	const loaded = $derived(handle?.current?.ideas.length ?? 0);

	async function move(idea: Idea, status: IdeaStatus) {
		if (idea.status === status) return;
		problem = null;
		try {
			await convex.mutation(api.ideas.setStatus, { ideaId: idea._id, status });
		} catch (error) {
			problem = error instanceof Error ? error.message : 'Could not move that idea.';
			// Convex is the source of truth, so the card snaps back on its own via the
			// subscription. Nothing to roll back locally.
		}
	}

	function onDragStart(event: DragEvent, idea: Idea) {
		draggingId = idea._id;
		event.dataTransfer?.setData('text/plain', idea._id);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function onDragOver(event: DragEvent, status: IdeaStatus) {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dropTarget = status;
	}

	function onDrop(event: DragEvent, status: IdeaStatus) {
		event.preventDefault();
		dropTarget = null;
		const id = event.dataTransfer?.getData('text/plain') || draggingId;
		draggingId = null;
		const idea = (handle?.current?.ideas ?? []).find((i) => i._id === id);
		if (idea) void move(idea, status);
	}
</script>

<svelte:head>
	<title>Board | ThinkLot</title>
	<meta name="description" content="Move ideas through the pipeline." />
</svelte:head>

<CaptureBar />

<div class="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
	<div class="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-4">
		<h1 class="font-mono text-sm font-bold tracking-tight">Board</h1>
		<p class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">{total} in the lot</p>
	</div>

	<p class="py-3 font-mono text-[11px] text-ink-3">
		Drag a card, or use the move menu on it. Both do the same thing - the menu is
		how you do this from a keyboard or a phone.
	</p>

	<QueryError handle={handle} what="The board" />

	<!--
		The board bound `truncated` and then never read it, so past 250 ideas it
		showed a silently partial view with no indication at all. `/ideas` and
		`/review` both say so; this now does too.
	-->
	{#if truncated}
		<p class="mb-3 rounded-md border border-warn/25 bg-warn-soft px-3 py-2 font-mono text-[11px] tracking-wide text-warn">
			Showing {loaded} of {total}. Older ideas need search on the lot.
		</p>
	{/if}

	{#if problem}
		<p class="mb-3 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
			{problem}
		</p>
	{/if}

	<!--
		Horizontally scrollable on purpose: a Kanban that squeezes six stages into a
		phone viewport makes every column unreadable. Scrolling beats shrinking.
	-->
	<div class="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
		<div class="flex min-w-max gap-3">
			{#each IDEA_STATUSES as status (status)}
				{@const cards = byStatus[status]}
				<section
					aria-label={status}
					ondragover={(e) => onDragOver(e, status)}
					ondragleave={() => (dropTarget = dropTarget === status ? null : dropTarget)}
					ondrop={(e) => onDrop(e, status)}
					class="flex w-64 shrink-0 flex-col rounded-lg border bg-sunk transition-colors"
					class:border-signal={dropTarget === status}
					class:border-rule={dropTarget !== status}
					class:ring-2={dropTarget === status}
					class:ring-signal={dropTarget === status}
				>
					<header class="flex items-center justify-between border-b border-rule px-3 py-2">
						<h2 class="font-mono text-[11px] font-bold tracking-wider text-ink uppercase">
							{status}
						</h2>
						<span class="font-mono text-[11px] text-ink-3" data-numeric="true">
							{cards.length}
						</span>
					</header>

					<ul class="flex flex-col gap-2 p-2">
						{#each cards as idea (idea._id)}
							{@const score = priorityScore(idea)}
							<li
								draggable="true"
								ondragstart={(e) => onDragStart(e, idea)}
								ondragend={() => {
									draggingId = null;
									dropTarget = null;
								}}
								class="cursor-grab rounded-md border border-rule bg-paper p-2.5 transition-colors hover:border-rule-strong active:cursor-grabbing"
								class:opacity-40={draggingId === idea._id}
							>
								<div class="flex items-center justify-between gap-2">
									<span class="font-mono text-[10px] font-bold tracking-wider text-lot">
										{lotPlate(idea.seq)}
									</span>
									<span
										class="font-mono text-[10px]"
										class:text-lot={score !== null}
										class:text-ink-3={score === null}
										data-numeric="true"
									>
										{displayScore(score)}
									</span>
								</div>

								<a
									href={`/ideas/${idea._id}`}
									class="mt-1 block text-sm leading-5 font-medium text-ink underline-offset-4 hover:underline"
								>
									{idea.title}
								</a>

								{#if idea.tags.length}
									<div class="mt-1.5 flex flex-wrap gap-1">
										{#each idea.tags.slice(0, 3) as tag (tag)}
											<span class="font-mono text-[10px] text-ink-3">#{tag}</span>
										{/each}
									</div>
								{/if}

								<!--
									The non-drag path. Drag-and-drop is unusable from a keyboard
									and unreliable on touch, so it can never be the only way to
									move a card.
								-->
								<div class="mt-2">
									<label class="sr-only" for={`move-${idea._id}`}>
										Move {idea.title}
									</label>
									<select
										id={`move-${idea._id}`}
										value={idea.status}
										onchange={(e) => move(idea, e.currentTarget.value as IdeaStatus)}
										class="w-full rounded border border-rule bg-panel px-1.5 py-1 font-mono text-[10px] tracking-wider text-ink-2 uppercase outline-none focus:border-signal"
									>
										{#each IDEA_STATUSES as option (option)}
											<option value={option} disabled={option === idea.status}>
												{option}
											</option>
										{/each}
									</select>
								</div>
							</li>
						{/each}

						{#if cards.length === 0}
							<li class="px-1 py-3 text-center font-mono text-[10px] text-ink-3">empty</li>
						{/if}
					</ul>
				</section>
			{/each}
		</div>
	</div>
</div>