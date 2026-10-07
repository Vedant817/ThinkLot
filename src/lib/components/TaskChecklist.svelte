<script lang="ts">
	import { convex } from '$lib/convex/client.svelte';
	import { api } from '../../convex/_generated/api';
	import type { IdeaTask } from '$lib/types';

	let {
		ideaId,
		tasks
	}: {
		ideaId: string;
		tasks: IdeaTask[];
	} = $props();

	let draft = $state('');
	let busyId = $state<string | null>(null);
	let problem = $state<string | null>(null);

	const total = $derived(tasks.length);
	const done = $derived(tasks.filter((t) => t.completed).length);
	const pct = $derived(total === 0 ? 0 : Math.round((done / total) * 100));

	/**
	 * The checklist is the bridge from "an idea I keep" to "a thing I
	 * do". Every action writes through Convex and the list updates via
	 * the subscription, so there is no local copy to fall out of step
	 * with the server - including from another device.
	 */
	async function run(fn: () => Promise<unknown>) {
		problem = null;
		try {
			await fn();
		} catch (error) {
			problem = error instanceof Error ? error.message : 'That did not work.';
		}
	}

	/**
	 * Clear the field only once the write has actually landed.
	 *
	 * The previous version did `draft = ''` BEFORE awaiting, so a failed add
	 * showed the error and had already eaten the typed task - the one thing the
	 * user cannot re-derive. Same shape as the capture bar's silent truncation:
	 * discard before confirmation, lose the user's words.
	 */
	function add() {
		const title = draft.trim();
		if (!title) return;
		void run(async () => {
			await convex.mutation(api.tasks.addTask, { ideaId, title });
			draft = '';
		});
	}

	function toggle(task: IdeaTask) {
		busyId = task._id;
		void run(() => convex.mutation(api.tasks.toggleTask, { taskId: task._id })).finally(() => {
			busyId = null;
		});
	}

	function remove(task: IdeaTask) {
		busyId = task._id;
		void run(() => convex.mutation(api.tasks.removeTask, { taskId: task._id })).finally(() => {
			busyId = null;
		});
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			add();
		} else if (event.key === 'Escape') {
			draft = '';
		}
	}
</script>

<section aria-label="Tasks">
	<div class="flex items-baseline justify-between">
		<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Tasks</span>
		{#if total > 0}
			<span class="font-mono text-[11px] text-ink-2" data-numeric="true">
				{done}/{total} · {pct}%
			</span>
		{/if}
	</div>

	{#if total > 0}
		<div
			class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rule"
			role="progressbar"
			aria-valuemin={0}
			aria-valuemax={total}
			aria-valuenow={done}
			aria-label="{done} of {total} tasks complete"
		>
			<div
				class="h-full rounded-full bg-lot transition-all"
				style={`width:${pct}%`}
			></div>
		</div>
		{#if done === total}
			<p class="mt-1.5 font-mono text-[11px] text-ok">
				Everything is done. Time to move the idea forward.
			</p>
		{/if}
	{/if}

	{#if problem}
		<p class="mt-2 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
			{problem}
		</p>
	{/if}

	{#if total === 0}
		<p class="mt-2 rounded-md border border-dashed border-rule-strong px-3 py-3 text-sm leading-6 text-ink-3">
			No tasks yet. Break this idea into the smallest next steps.
		</p>
	{:else}
		<ul class="rule-y mt-2 overflow-hidden rounded-lg border border-rule bg-paper">
			{#each tasks as task (task._id)}
				<li class="group flex items-start gap-2.5 px-3 py-2">
					<!--
						The button is 24x24 (WCAG 2.2 SC 2.5.8) and the visible box inside
						it is 16x16. The checkbox is the primary interaction of the whole
						checklist, and it was previously a bare `size-4` control - well
						under the minimum target size, and awkward on a phone.
					-->
					<button
						type="button"
						role="checkbox"
						aria-checked={task.completed}
						aria-label={task.completed ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
						onclick={() => toggle(task)}
						disabled={busyId === task._id}
						class="-ml-1.5 mt-0 flex size-6 shrink-0 items-center justify-center rounded disabled:opacity-40"
					>
						<span
							class="flex size-4 items-center justify-center rounded-[3px] border transition-colors"
							class:border-signal={task.completed}
							class:bg-signal={task.completed}
							class:border-rule-strong={!task.completed}
						>
							{#if task.completed}
								<span class="text-[10px] leading-none text-paper" aria-hidden="true">✓</span>
							{/if}
						</span>
					</button>
					<span
						class="min-w-0 flex-1 text-[15px] leading-7"
						class:text-ink-3={task.completed}
						class:line-through={task.completed}
					>
						{task.title}
					</span>
					<!--
						Visible by default, revealed-on-hover only from `md` up.
						Mobile browsers do not apply `:hover`, so the previous
						`opacity-0 group-hover:opacity-100` left a permanently
						invisible - yet still hit-testable - 17px target at the end of
						every row on a phone.
					-->
					<button
						type="button"
						onclick={() => remove(task)}
						aria-label={`Delete task "${task.title}"`}
						disabled={busyId === task._id}
						class="-mr-1.5 flex size-6 shrink-0 items-center justify-center rounded text-ink-3 transition-opacity hover:text-bad focus:opacity-100 disabled:opacity-40 md:opacity-0 md:group-hover:opacity-100"
					>
						×
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="mt-2 flex items-center gap-1.5 rounded-md border border-rule bg-panel px-2 focus-within:border-signal focus-within:bg-paper">
		<span class="font-mono text-[11px] text-ink-3" aria-hidden="true">+</span>
		<input
			bind:value={draft}
			onkeydown={onKeydown}
			placeholder="Next concrete step…"
			aria-label="Add a task"
			class="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3"
		/>
	</div>
	<p class="mt-1 font-mono text-[11px] text-ink-3">Enter to add</p>
</section>
