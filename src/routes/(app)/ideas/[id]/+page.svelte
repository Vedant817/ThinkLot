<script lang="ts">
	import StatusPill from '$lib/components/StatusPill.svelte';
	import TaskChecklist from '$lib/components/TaskChecklist.svelte';
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery, type QueryHandle } from '$lib/convex/query.svelte';
	import { api } from '../../../../convex/_generated/api';
	import { displayScore, lotPlate, priorityScore, scoreBand, scoreBarWidth } from '$lib/scoring';
	import { maturityLabel, maturityOf } from '$lib/maturity';
	import { IDEA_STATUSES, type Idea, type IdeaStatus, type IdeaTask, type TimelineEvent } from '$lib/types';
	import { page } from '$app/state';
	import { describeEvent } from '$lib/timeline';
	import { relativeDay } from '$lib/dates';

	let { data } = $props();

	let loaded = $state(false);
	let problem = $state<string | null>(null);

	// Local edit buffer. Editing writes through on blur, not on every keystroke,
	// so a half-typed title never reaches the server.
	let title = $state('');
	let description = $state('');
	let problemText = $state('');
	let audienceText = $state('');
	let outcomeText = $state('');
	let triggerText = $state('');
	let tagDraft = $state('');

	/**
	 * Not `$state`, for the same reason as the list page: an effect that disposes
	 * and recreates a handle it also tracks re-schedules itself until it dies.
	 */
	let handle = $state<QueryHandle<{ idea: Idea; tasks: IdeaTask[]; events: TimelineEvent[] }> | null>(null);

	// The idea itself is always derived straight from the subscription, so a
	// realtime edit from another device shows up here immediately.
	const idea = $derived(handle?.current?.idea ?? null);
	// Same for the checklist: a task added on another device appears
	// here without a refresh, and the progress bar follows it.
	const tasks = $derived(handle?.current?.tasks ?? []);

	// `loading` must come from the subscription, not from a local flag that
	// waits on a truthy idea. `api.ideas.get` returns null for an id you do not
	// own - not `{ idea: null }` - so a truthiness check on the payload hung on
	// "LOADING" forever instead of ever reaching the "not in your lot" branch.
	const loading = $derived(handle?.loading ?? true);

	$effect(() => {
		convex.start();
	});

	$effect(() => {
		const id = data.id;
		const next = watchQuery<{ idea: Idea; tasks: IdeaTask[]; events: TimelineEvent[] }>(convex.client!, api.ideas.get, {
			ideaId: id
		});
		// WRITE ONLY - see the note in (app)/ideas/+page.svelte about the
		// read-then-write effect loop.
		handle = next;
		return () => {
			next.dispose();
		};
	});

	// Seed the buffer once, then leave it alone so typing is never clobbered by
	// an incoming realtime update.
	//
	// Keyed on `data.id`, NOT on a bare `seeded` boolean. SvelteKit reuses this
	// component when only `params` change, so a `seeded` flag that is never reset
	// leaves the NEXT idea rendering with the PREVIOUS idea's title and notes in
	// the buffers - and the first blur then writes them onto the new idea. One
	// "related ideas" link away from silently overwriting somebody's work.
	let seededId: string | null = null;

	/**
	 * The last server values the text buffers were reconciled against.
	 *
	 * A copy rather than a reference to the same object the buffers hold, for the
	 * same reason the mobile `edit-buffer` copies: if these were one object, writing
	 * to a buffer would also move the snapshot, the "is this field being edited?"
	 * comparison would answer "yes, it matches", and the next realtime update would
	 * overwrite whatever was being typed.
	 */
	let snapshot = {
		title: '',
		description: '',
		problem: '',
		audience: '',
		outcome: '',
		trigger: ''
	};
	$effect(() => {
		const id = data.id;
		const incoming = handle?.current?.idea;
		if (!incoming || incoming._id !== id) return;

		/**
		 * The server's values as of the last time this page looked.
		 *
		 * Without it, this effect seeded the buffers once and then returned forever:
		 * `seededId === id` short-circuited every later update, so an open detail page
		 * never saw another client's edits. Score and status appeared to keep working
		 * because they are `$derived` off `idea`; the text fields did not, which is why
		 * this looked fine from the outside and only appeared with two tabs open.
		 *
		 * The rule matches the mobile editor's: take the server's value for a field
		 * nobody is editing, and never take it over one being typed into. Losing an
		 * in-progress sentence to somebody else's save is the worse of the two
		 * failures, because it is the unrecoverable one.
		 */
		const serverText = {
			title: incoming.title,
			description: incoming.description ?? '',
			problem: incoming.problem ?? '',
			audience: incoming.audience ?? '',
			outcome: incoming.outcome ?? '',
			trigger: incoming.trigger ?? ''
		};

		if (seededId !== id) {
			seededId = id;
			title = serverText.title;
			description = serverText.description;
			problemText = serverText.problem;
			audienceText = serverText.audience;
			outcomeText = serverText.outcome;
			triggerText = serverText.trigger;
			tagDraft = '';
			snapshot = serverText;
			return;
		}

		// Field by field, so one being typed into is untouched while the rest follow.
		if (title === snapshot.title) title = serverText.title;
		if (description === snapshot.description) description = serverText.description;
		if (problemText === snapshot.problem) problemText = serverText.problem;
		if (audienceText === snapshot.audience) audienceText = serverText.audience;
		if (outcomeText === snapshot.outcome) outcomeText = serverText.outcome;
		if (triggerText === snapshot.trigger) triggerText = serverText.trigger;
		snapshot = serverText;
	});

	const score = $derived(idea ? priorityScore(idea) : null);
	const band = $derived(scoreBand(score));

	/**
	 * How developed this idea actually is, and what is missing next.
	 *
	 * Derived rather than stored, so it cannot disagree with the fields it was
	 * computed from, and so both clients get it from the same module. The checklist
	 * counts come from `tasks`, which this page already subscribes to.
	 */
	const maturity = $derived(
		idea
			? maturityOf({
					...idea,
					totalTasks: tasks.length,
					doneTasks: tasks.filter((task) => task.completed).length
				})
			: null
	);

	/**
	 * Declared as objects rather than tuples so the template gets `field` as a
	 * literal union. A `[['impact','Impact',idea.impact]]` array infers as
	 * `(string | number | undefined)[]` and silently widens away the types.
	 */
	type ScoreField = 'impact' | 'confidence' | 'effort';

	const SCORE_FIELDS: { field: ScoreField; label: string; hint: string }[] = [
		{ field: 'impact', label: 'Impact', hint: 'How much does this matter if it ships?' },
		{ field: 'confidence', label: 'Confidence', hint: 'How sure are you it is worth doing?' },
		{ field: 'effort', label: 'Effort', hint: 'How much work is it? This is in the denominator.' }
	];

	const BAND_BAR: Record<string, string> = {
		unscored: 'bg-rule',
		low: 'bg-ink-3',
		solid: 'bg-lot',
		strong: 'bg-signal'
	};

	/**
	 * A COUNTER, not a boolean.
	 *
	 * With a single boolean, blurring the title and then the notes within 150ms
	 * meant the first `run` to resolve set `saving = false` while the second was
	 * still in flight, so "Saving…" vanished while a write was still outstanding.
	 * That mattered because the next write would arrive with no indication that
	 * one was pending.
	 */
	let inFlight = 0;

	async function run(fn: () => Promise<unknown>) {
		inFlight++;
		problem = null;
		try {
			await fn();
		} catch (error) {
			problem = error instanceof Error ? error.message : 'Could not save.';
		} finally {
			inFlight--;
		}
	}

	const saving = $derived(inFlight > 0);

	/**
	 * Write back ONE field, the one that just lost focus.
	 *
	 * This used to send title + description + problem together. Two overlapping
	 * commits were therefore two full three-field patches, and out-of-order
	 * execution could silently drop whichever edit landed first - the classic
	 * last-write-wins data loss.
	 */
	type TextField = 'title' | 'description' | 'problem' | 'audience' | 'outcome' | 'trigger';

	/**
	 * Buffer and server value for each field, as lookups.
	 *
	 * This began as a nested ternary over three fields and did not survive
	 * growing to six. Beyond the three deep nestings, a chain like
	 * `field === 'a' ? a : field === 'b' ? b : c` silently sends the WRONG field
	 * the moment a case is added and the final `else` becomes the fallback - so
	 * editing "audience" would patch `problem`. A map cannot have that bug.
	 */
	const BUFFER: Record<TextField, () => string> = {
		title: () => title.trim(),
		description: () => description,
		problem: () => problemText,
		audience: () => audienceText,
		outcome: () => outcomeText,
		trigger: () => triggerText
	};

	function commitText(field: TextField) {
		if (!idea) return;
		const bufferValue = BUFFER[field]();
		const serverValue = idea[field] ?? '';

		// Only the blurred field is compared, so editing one field is never
		// discarded by an early return that looked only at another.
		if (bufferValue === serverValue) return;

		void run(() =>
			convex.mutation(api.ideas.update, { ideaId: idea!._id, [field]: bufferValue })
		);
	}

	function addTag() {
		const tag = tagDraft.trim().toLowerCase();
		if (!idea || !tag) return;
		if (idea.tags.includes(tag)) {
			tagDraft = '';
			return;
		}
		// `addTag`, not a whole new array. Sending `[...idea.tags, tag]` built from
		// a possibly-stale copy was how a tag got silently lost: clicking a tag's
		// `x` blurs this input first, so the add and the remove were both computed
		// from the same stale `idea` and the second overwrote the first.
		void run(() => convex.mutation(api.ideas.update, { ideaId: idea!._id, addTag: tag }));
		tagDraft = '';
	}

	function removeTag(tag: string) {
		if (!idea) return;
		void run(() => convex.mutation(api.ideas.update, { ideaId: idea!._id, removeTag: tag }));
	}

	function setScore(field: ScoreField, value: number | null | undefined) {
		if (!idea) return;
		// `null` clears, `undefined` leaves the field alone. The two are NOT
		// interchangeable: Convex drops object keys whose value is undefined before
		// the request leaves the browser, so sending undefined silently does
		// nothing at all. That made an idea impossible to return to "unscored".
		void run(() => convex.mutation(api.ideas.update, { ideaId: idea!._id, [field]: value ?? null }));
	}

	function setStatus(status: IdeaStatus) {
		if (!idea) return;
		void run(() => convex.mutation(api.ideas.setStatus, { ideaId: idea._id, status }));
	}

	async function destroy() {
		if (!idea) return;
		const ok = confirm(`Delete ${idea.title}? This cannot be undone.`);
		if (!ok) return;
		await run(async () => {
			await convex.mutation(api.ideas.remove, { ideaId: idea!._id });
			history.back();
		});
	}

	function onTagKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			addTag();
		} else if (event.key === 'Backspace' && !tagDraft && idea?.tags.length) {
			removeTag(idea.tags[idea.tags.length - 1]);
		}
	}
</script>

<svelte:head>
	<title>{idea ? `${idea.title} | ThinkLot` : 'Idea | ThinkLot'}</title>
</svelte:head>

<div class="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
	<!--
		The back link keeps whatever filters you arrived with.

		The list puts its state in the query string and appends it to idea links, so
		arriving here from a search for "offline" means the URL already carries
		`?q=offline`. Reusing this page's own query string is enough to return to
		the list you left.

		Reusing it is safe only because this page defines no query parameters of its
		own - it does not filter or sort anything. If it ever grows one, this has to
		stop passing the whole string through, or "back to the lot" would come back
		filtered by the detail page's own controls.
	-->
	<a
		href={`/ideas${page.url.search}`}
		class="font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:text-ink"
	>
		← Back to the lot
	</a>

	{#if !loading && !idea}
		<div class="mt-4 rounded-lg border border-dashed border-rule-strong px-5 py-14 text-center">
			<p class="font-mono text-sm text-ink-2">That idea is not in your lot.</p>
			<p class="mx-auto mt-2 max-w-sm text-sm text-ink-3">
				It may have been deleted, or it belongs to another account.
			</p>
		</div>
	{:else if loading || !idea}
		<div class="mt-8 grid min-h-40 place-items-center">
			<p class="font-mono text-xs tracking-widest text-ink-3">LOADING</p>
		</div>
	{:else}
		{@const plate = lotPlate(idea.seq)}
		<div class="mt-4 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
			<!-- Left: the idea itself -->
			<section class="min-w-0">
				<div class="flex items-center gap-3">
					<span class="font-mono text-xs font-bold tracking-wider text-lot">{plate}</span>
					<StatusPill status={idea.status} size="md" />
					{#if idea.source === 'dictated'}
						<span
							class="rounded border border-lot/30 bg-lot-soft px-1.5 font-mono text-[10px] tracking-wider text-lot uppercase"
						>
							voice
						</span>
					{/if}
					{#if idea.archived}
						<span class="font-mono text-[10px] tracking-wider text-ink-3 uppercase">archived</span>
					{/if}
				</div>

				<label class="mt-4 block">
					<span class="sr-only">Title</span>
					<textarea
						bind:value={title}
						onblur={() => commitText('title')}
						rows="2"
						class="w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1 -ml-2 text-2xl leading-8 font-semibold text-ink outline-none hover:border-rule focus:border-signal focus:bg-paper"
					></textarea>
				</label>

				<label class="mt-4 block">
					<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Notes</span>
					<textarea
						bind:value={description}
						onblur={() => commitText('description')}
						rows="5"
						placeholder="What is actually true about this?"
						class="mt-1.5 w-full resize-y rounded-md border border-rule bg-panel px-3 py-2.5 text-[15px] leading-7 text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper"
					></textarea>
				</label>

				<label class="mt-4 block">
					<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Problem it solves</span>
					<textarea
						bind:value={problemText}
						onblur={() => commitText('problem')}
						rows="2"
						placeholder="Who has this problem, and how do they cope today?"
						class="mt-1.5 w-full resize-y rounded-md border border-rule bg-panel px-3 py-2.5 text-[15px] leading-7 text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper"
					></textarea>
				</label>

				<!--
					The three fields the product spec asks for in its Inbox model and
					which were missing from the app entirely: "Who is it for",
					"Expected outcome" and "Source / trigger".

					Placed with the problem statement rather than buried lower down,
					because the three of them together are the difference between an
					idea you can act on and a sentence you liked the sound of.
				-->
				<div class="mt-4 grid gap-4 sm:grid-cols-3">
					<label class="block">
						<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
							Who is it for
						</span>
						<textarea
							bind:value={audienceText}
							onblur={() => commitText('audience')}
							rows="2"
							placeholder="Who has this problem?"
							class="mt-1.5 w-full resize-y rounded-md border border-rule bg-panel px-3 py-2.5 text-[15px] leading-7 text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper"
						></textarea>
					</label>

					<label class="block">
						<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
							Expected outcome
						</span>
						<textarea
							bind:value={outcomeText}
							onblur={() => commitText('outcome')}
							rows="2"
							placeholder="What is true afterwards that is not true now?"
							class="mt-1.5 w-full resize-y rounded-md border border-rule bg-panel px-3 py-2.5 text-[15px] leading-7 text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper"
						></textarea>
					</label>

					<label class="block">
						<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
							Source / trigger
						</span>
						<textarea
							bind:value={triggerText}
							onblur={() => commitText('trigger')}
							rows="2"
							placeholder="A conversation, a problem you hit, an article…"
							class="mt-1.5 w-full resize-y rounded-md border border-rule bg-panel px-3 py-2.5 text-[15px] leading-7 text-ink outline-none placeholder:text-ink-3 focus:border-signal focus:bg-paper"
						></textarea>
					</label>
				</div>

				<!--
					Maturity: how far this idea has actually been developed, and the single
					most useful thing to do next.

					Placed directly above the checklist because that is where "an idea I
					keep" becomes "a thing I do", which is the transition this whole
					feature exists to measure. It says one thing, not a checklist of
					grievances - a panel listing everything missing is a to-do list, and
					this app already has one.
				-->
				{#if maturity}
					<div class="mt-6 rounded-lg border border-rule bg-panel px-3 py-3">
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
								Maturity
							</span>
							<span class="font-mono text-[11px] text-ink-2">{maturityLabel(maturity.stage)}</span>
						</div>

						<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-rule">
							<div
								class="h-full rounded-full bg-signal/70"
								style={`width:${maturity.percent}%`}
								role="progressbar"
								aria-valuenow={maturity.percent}
								aria-valuemin="0"
								aria-valuemax="100"
								aria-label="How developed this idea is"
							></div>
						</div>

						{#if maturity.next}
							<p class="mt-2.5 text-sm leading-6 text-ink-2">
								<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Next</span>
								{maturity.next}
							</p>
						{/if}
					</div>
				{/if}

				<!-- Checklist: the bridge from "an idea I keep" to "a thing I do" -->
				<TaskChecklist ideaId={idea._id} {tasks} />

				<!--
					Timeline: what actually happened to this idea.

					The events have been recorded on every capture, stage move, archive,
					snooze and judgement since before this feature existed - the only thing
					that read them was the delete cascade. So this is a view over data that
					was already correct.

					`describeEvent` is imported from the Convex module rather than
					reworded here, so the web and mobile clients cannot describe the same
					event differently.
				-->
				{#if (handle?.current?.events ?? []).length > 0}
					<div class="mt-6">
						<h3 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
							Timeline
						</h3>
						<ol class="mt-2 space-y-1.5">
							{#each handle?.current?.events ?? [] as event (event.id)}
								<li class="flex items-baseline gap-3 text-sm">
									<span class="w-20 shrink-0 font-mono text-[11px] text-ink-3">
										{relativeDay(event.createdAt)}
									</span>
									<span class="min-w-0 flex-1 text-ink-2">{describeEvent(event.kind, event.detail)}</span>
								</li>
							{/each}
						</ol>
					</div>
				{/if}

				<!-- Tags -->
				<div class="mt-5">
					<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Tags</span>
					<div
						class="mt-1.5 flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-rule bg-panel px-2 py-1.5 focus-within:border-signal focus-within:bg-paper"
					>
						{#each idea.tags as tag (tag)}
							<span
								class="inline-flex items-center gap-1 rounded border border-rule-strong bg-paper px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
							>
								{tag}
								<button
									type="button"
									onclick={() => removeTag(tag)}
									aria-label={`Remove tag ${tag}`}
									class="text-ink-3 hover:text-bad"
								>
									×
								</button>
							</span>
						{/each}
						<input
							bind:value={tagDraft}
							onkeydown={onTagKeydown}
							onblur={addTag}
							placeholder={idea.tags.length ? 'Add…' : 'mobile, cheap, revisit…'}
							aria-label="Add a tag"
							class="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm text-ink outline-none placeholder:text-ink-3"
						/>
					</div>
					<p class="mt-1 font-mono text-[11px] text-ink-3">Enter or comma to add · Backspace removes the last</p>
				</div>

				{#if idea.transcript}
					<details class="mt-5 rounded-md border border-rule bg-sunk">
						<summary class="cursor-pointer px-3 py-2 font-mono text-[11px] tracking-wider text-ink-3 uppercase">
							Original dictation
						</summary>
						<p class="border-t border-rule px-3 py-2.5 text-sm leading-6 text-ink-2">
							{idea.transcript}
						</p>
					</details>
				{/if}
			</section>

			<!-- Right: the judgement -->
			<aside class="lg:sticky lg:top-24 lg:self-start">
				<div class="rounded-lg border border-rule bg-paper p-4">
					<div class="flex items-baseline justify-between">
						<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Priority</span>
						<span
							class="font-mono text-2xl font-bold"
							class:text-signal={score !== null}
							class:text-ink-3={score === null}
							data-numeric="true"
						>
							{displayScore(score)}
						</span>
					</div>
					<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-rule">
						<div
							class="h-full rounded-full transition-all {BAND_BAR[band]}"
							style={`width:${scoreBarWidth(score)}%`}
						></div>
					</div>
					<p class="mt-2 font-mono text-[11px] text-ink-3">(impact × confidence) ÷ effort</p>

					<div class="mt-5 space-y-4">
						{#each SCORE_FIELDS as { field, label, hint } (field)}
							{@const value = idea[field]}
							<div>
								<div class="flex items-center justify-between">
									<label for={field} class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">
										{label}
									</label>
									<span class="font-mono text-xs text-ink" data-numeric="true">
										{value ?? '--'}
									</span>
								</div>
								<input
									id={field}
									type="range"
									min="0"
									max="10"
									step="1"
									title={hint}
									value={value ?? 0}
									onchange={(e) => {
										const n = Number(e.currentTarget.value);
										setScore(field, n === 0 ? null : n);
									}}
									class="mt-1.5 w-full accent-signal"
								/>
								<!--
									`min="0"` where 0 means "not scored".
									The previous `min="1"` with `value={value ?? 0}` was a lie in two
									ways: HTML clamps an out-of-range value up to the minimum, so an
									unscored idea rendered its thumb at 1/10 while the label beside it
									read `--`; and `n === 0` was therefore unreachable, which is what
									made clearing a score impossible.

									The visible affordance for "unscored" is a real button too, rather
									than only the far-left position on a slider, which nobody would
									think to try.
								-->
								{#if value !== undefined}
									<button
										type="button"
										onclick={() => setScore(field, null)}
										class="mt-1 font-mono text-[10px] tracking-wider text-ink-3 uppercase hover:text-bad"
									>
										Clear {label.toLowerCase()}
									</button>
								{/if}
							</div>
						{/each}
					</div>
				</div>

				<div class="mt-4 rounded-lg border border-rule bg-paper p-4">
					<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Stage</span>
					<div class="mt-2 flex flex-col gap-1">
						{#each IDEA_STATUSES as stage (stage)}
							<button
								type="button"
								onclick={() => setStatus(stage)}
								aria-pressed={idea.status === stage}
								class="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors"
								class:bg-sunk={idea.status === stage}
								class:text-ink={idea.status === stage}
								class:text-ink-3={idea.status !== stage}
							>
								<span
									class="size-1.5 rounded-full"
									class:bg-signal={idea.status === stage}
									class:bg-rule-strong={idea.status !== stage}
									aria-hidden="true"
								></span>
								{stage}
							</button>
						{/each}
					</div>
				</div>

				<div class="mt-4 flex flex-col gap-2">
					<button
						type="button"
						onclick={() => {
							if (!idea) return;
							void run(() =>
								convex.mutation(api.ideas.toggleFavorite, { ideaId: idea!._id })
							);
						}}
						class="rounded-md border border-rule-strong px-3 py-2 text-sm text-ink transition-colors hover:bg-sunk"
					>
						{idea.favorite ? 'Remove star' : 'Star this idea'}
					</button>
					<button
						type="button"
						onclick={destroy}
						class="rounded-md border border-bad/30 px-3 py-2 text-sm text-bad transition-colors hover:bg-bad-soft"
					>
						Delete permanently
					</button>
				</div>

				{#if problem}
					<p class="mt-3 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
						{problem}
					</p>
				{/if}
				{#if saving}
					<p class="mt-3 font-mono text-[11px] tracking-wider text-ink-3 uppercase">Saving…</p>
				{/if}
			</aside>
		</div>
	{/if}
</div>
