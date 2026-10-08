<script lang="ts">
	import { resolve } from '$app/paths';

	const board = [
		{
			stage: 'Capture',
			count: 8,
			items: ['Voice-note ideas', 'Feature requests', 'Customer problems']
		},
		{
			stage: 'Review',
			count: 5,
			items: ['Validate pricing page test', 'Refine onboarding idea']
		},
		{
			stage: 'Plan',
			count: 3,
			items: ['AI summary workflow', 'Launch checklist']
		},
		{
			stage: 'Build',
			count: 2,
			items: ['Public roadmap view', 'Weekly review digest']
		}
	];

	const features = [
		{
			title: 'Capture ideas before they disappear',
			description:
				'Quickly save product ideas, customer pain points, experiments, content concepts, and follow-up notes in one calm workspace.'
		},
		{
			title: 'Know what deserves attention',
			description:
				'Score ideas by impact, effort, and confidence so your next move is based on signal instead of recency or noise.'
		},
		{
			title: 'Turn thinking into execution',
			description:
				'Move the best ideas into checklists, tasks, and build-ready plans without losing the context that made them valuable.'
		}
	];

	const scores = [
		{ label: 'Impact', value: 9 },
		{ label: 'Effort', value: 3 },
		{ label: 'Confidence', value: 8 }
	];

	const stats = [
		{ label: 'Ideas captured', value: '12.4k+' },
		{ label: 'Weekly reviews', value: '3.1k+' },
		{ label: 'Teams shipping', value: '420+' }
	];
</script>

<svelte:head>
	<title>ThinkLot | Organize ideas into action</title>
	<meta
		name="description"
		content="ThinkLot helps founders, builders, and teams capture ideas, score opportunities, review priorities, and turn the best ideas into execution."
	/>
</svelte:head>

<main class="min-h-screen bg-paper text-ink">
	<!--
		Was two stacked radial gradients in orange and cyan - decorative glow,
		which the ledger rule bans outright. A flat --sunk band carries the same
		"lighter at the top" read as a section separator without a gradient.
	-->
	<div class="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-sunk"></div>
	<header class="fixed inset-x-0 top-0 z-50 border-b border-rule bg-paper">
		<nav class="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8 lg:px-10">
			<a href={resolve('/')} class="flex items-center gap-3" aria-label="ThinkLot home">
				<span
					class="grid size-10 place-items-center rounded-lg border border-rule-strong bg-panel font-mono text-xs font-bold text-signal"
				>
					TL
				</span>
				<span class="text-lg font-semibold text-ink">ThinkLot</span>
			</a>

			<div class="hidden items-center gap-6 text-sm font-medium text-ink-2 sm:flex">
				<a href="#features" class="transition hover:text-ink">Features</a>
				<a href="#workflow" class="transition hover:text-ink">Workflow</a>
				<a href="#review" class="transition hover:text-ink">Review</a>
				<a href={resolve('/signup')} class="transition hover:text-ink">Sign up</a>
				<a
					href={resolve('/login')}
					class="rounded-lg border border-signal/40 bg-signal-soft px-4 py-2 font-bold text-ink transition hover:border-signal hover:bg-signal-soft"
				>
					Login
				</a>
			</div>
		</nav>
	</header>

	<section class="relative mx-auto grid min-h-screen w-full gap-12 px-5 pb-6 pt-28 sm:px-8 sm:pt-32 lg:grid-cols-[0.92fr_1.08fr] lg:px-10">
		<div class="flex flex-col justify-between gap-12 py-4 lg:py-8">

			<div class="max-w-2xl">
				<p
					class="mb-5 inline-flex rounded border border-rule-strong bg-signal-soft px-3 py-1 text-sm font-semibold text-ink-3 "
				>
					Idea management for people who ship
				</p>

				<h1 class="text-5xl font-bold leading-[0.96] text-ink sm:text-6xl lg:text-7xl">
					Stop losing good ideas in scattered notes.
				</h1>

				<p class="mt-6 max-w-xl text-base leading-8 text-ink-2 sm:text-lg">
					ThinkLot gives every idea a place to land, a way to be judged, and a path toward execution when it is ready.
				</p>

				<div class="mt-8 flex flex-wrap gap-3">
					<a
						href={resolve('/login')}
						class="rounded-md bg-signal px-5 py-3 text-sm font-bold text-signal-ink transition hover:brightness-110"
					>
						Login to dashboard
					</a>
					<a
						href={resolve('/signup')}
						class="rounded-lg border border-signal/40 bg-transparent px-5 py-3 text-sm font-bold text-ink transition hover:border-signal hover:bg-signal-soft"
					>
						Create account
					</a>
				</div>
			</div>

			<div class="grid items-stretch gap-3 sm:grid-cols-3">
				<div class="h-full rounded-md border border-white/10 bg-panel p-4 ">
					<p class="text-sm font-semibold text-ink">For founders</p>
					<p class="mt-2 text-sm leading-6 text-ink-3">Prioritize opportunities without turning every thought into a task.</p>
				</div>
				<div class="h-full rounded-md border border-white/10 bg-panel p-4 ">
					<p class="text-sm font-semibold text-ink">For teams</p>
					<p class="mt-2 text-sm leading-6 text-ink-3">Create a shared queue for ideas, experiments, and product bets.</p>
				</div>
				<div class="h-full rounded-md border border-white/10 bg-panel p-4 ">
					<p class="text-sm font-semibold text-ink">For builders</p>
					<p class="mt-2 text-sm leading-6 text-ink-3">Keep momentum by moving the best concepts into executable plans.</p>
				</div>
			</div>

			<div class="grid gap-3 rounded-lg border border-white/10 bg-panel p-4  sm:grid-cols-3">
				{#each stats as stat (stat.label)}
					<div>
						<p class="text-2xl font-bold text-ink">{stat.value}</p>
						<p class="mt-1 text-xs uppercase tracking-[0.12em] text-ink-3">{stat.label}</p>
					</div>
				{/each}
			</div>
		</div>

		<div id="workflow" class="flex items-center pb-8 lg:pb-0">
			<div class="w-full rounded-lg border border-white/10 bg-paper p-4  sm:p-5">
				<div class="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-4">
					<div>
						<p class="text-sm font-bold text-ink">Workspace preview</p>
						<p class="mt-1 text-xs text-ink-3">Capture, compare, review, execute</p>
					</div>
					<div class="flex gap-2">
						<span class="rounded bg-signal-soft px-3 py-1 text-xs font-semibold text-ink">Priority score 24</span>
						<span class="rounded border border-ok/30 bg-ok/15 px-2 py-0.5 font-mono text-[10px] tracking-wider text-ok uppercase">Ready</span>
					</div>
				</div>

				<div class="grid items-stretch gap-3 lg:grid-cols-4">
					{#each board as column (column.stage)}
						<section class="flex min-h-72 flex-col rounded-md border border-white/10 bg-panel p-3">
							<div class="mb-3 flex items-center justify-between gap-2">
								<h2 class="text-sm font-bold text-ink">{column.stage}</h2>
								<span class="rounded bg-signal-soft px-2 py-0.5 text-xs font-bold text-ink-3">{column.count}</span>
							</div>

							<div class="flex flex-1 flex-col gap-2">
								{#each column.items as item (item)}
									<article class="min-h-20 rounded-lg border border-white/10 bg-panel p-3">
										<p class="text-sm font-semibold leading-5 text-ink">{item}</p>
										<div class="mt-3 h-1.5 overflow-hidden rounded bg-rule">
											<div
												class="h-full rounded bg-signal"
												style={`width: ${40 + item.length}%`}
											></div>
										</div>
									</article>
								{/each}
							</div>
						</section>
					{/each}
				</div>

				<div class="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
					<div class="rounded-md border border-white/10 bg-panel p-4">
						<p class="font-bold text-ink">Opportunity score</p>
						<p class="mt-2 text-sm leading-6 text-ink-3">
							Compare ideas with a simple scoring model that makes high-impact, low-effort work easier to spot.
						</p>

						<div class="mt-5 space-y-4">
							{#each scores as score (score.label)}
								<div>
									<div class="mb-2 flex items-center justify-between text-sm">
										<span class="font-semibold text-ink">{score.label}</span>
										<span class="font-bold text-ink">{score.value}/10</span>
									</div>
									<div class="h-2 overflow-hidden rounded bg-rule">
										<div
											class="h-full rounded bg-signal"
											style={`width: ${score.value * 10}%`}
										></div>
									</div>
								</div>
							{/each}
						</div>
					</div>

					<aside id="review" class="rounded-md border border-white/10 bg-panel p-4">
						<p class="font-bold text-ink">Weekly review queue</p>
						<p class="mt-2 text-sm leading-6 text-ink-3">
							ThinkLot brings back ideas that are stale, promising, or ready for a decision so your backlog stays useful.
						</p>

						<div class="mt-5 space-y-3">
							<div class="rounded-lg border border-rule-strong bg-signal-soft p-3">
								<p class="text-sm font-bold text-ink">Promote promising ideas</p>
								<p class="mt-1 text-xs text-ink-3">Move validated opportunities into planning.</p>
							</div>
							<div class="rounded-md border border-rule-strong bg-panel p-3">
								<p class="text-sm font-bold text-ink">Snooze what is not ready</p>
								<p class="mt-1 text-xs text-ink-3">Set a revisit date without losing the context.</p>
							</div>
							<div class="rounded-md border border-rule-strong bg-panel p-3">
								<p class="text-sm font-bold text-ink-2">Archive the noise</p>
								<p class="mt-1 text-xs text-ink-3">Keep the workspace focused on active opportunities.</p>
							</div>
						</div>
					</aside>
				</div>
			</div>
		</div>
	</section>

	<section id="features" class="relative border-t border-rule bg-sunk px-5 py-16 sm:px-8 lg:px-10">
		<div class="mx-auto max-w-7xl">
			<div class="max-w-2xl">
				<p class="text-sm font-bold uppercase tracking-[0.18em] text-signal">Why ThinkLot</p>
				<h2 class="mt-3 text-3xl font-bold text-ink sm:text-4xl">A focused system for deciding what to build next.</h2>
			</div>

			<div class="mt-8 grid gap-4 md:grid-cols-3">
				{#each features as feature (feature.title)}
					<article class="rounded-md border border-white/10 bg-panel p-5 ">
						<h3 class="text-lg font-bold text-ink">{feature.title}</h3>
						<p class="mt-3 text-sm leading-7 text-ink/62">{feature.description}</p>
					</article>
				{/each}
			</div>

			<div
				class="mt-10 flex flex-col items-start justify-between gap-4 rounded-lg border border-white/10 bg-panel p-6 md:flex-row md:items-center"
			>
				<div>
					<p class="text-xl font-bold text-ink">Build from your best ideas, not your newest notes.</p>
					<p class="mt-2 text-sm text-ink-2">Bring order to idea chaos with a workflow made for SaaS teams.</p>
				</div>
				<a
					href={resolve('/login')}
					class="rounded-md border border-signal px-5 py-3 text-sm font-bold text-signal transition hover:bg-signal-soft"
				>
					Login to start
				</a>
			</div>
		</div>
	</section>
</main>
