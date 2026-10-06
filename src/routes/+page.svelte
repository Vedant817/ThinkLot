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

<main class="min-h-screen bg-[#0b0b0f] text-orange-500">
	<div
		class="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(circle_at_20%_10%,rgba(249,115,22,0.2),transparent_45%),radial-gradient(circle_at_80%_10%,rgba(56,189,248,0.13),transparent_40%)]"
	></div>
	<header class="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#0b0b0f]/55 backdrop-blur-xl">
		<nav class="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-3 sm:px-8 lg:px-10">
			<a href={resolve('/')} class="flex items-center gap-3" aria-label="ThinkLot home">
				<span
					class="grid size-10 place-items-center rounded-lg border border-orange-400/40 bg-gradient-to-br from-orange-400/25 to-cyan-400/15 text-lg font-black text-orange-50"
				>
					TL
				</span>
				<span class="text-lg font-semibold text-orange-100">ThinkLot</span>
			</a>

			<div class="hidden items-center gap-6 text-sm font-medium text-orange-100/80 sm:flex">
				<a href="#features" class="transition hover:text-orange-100">Features</a>
				<a href="#workflow" class="transition hover:text-orange-100">Workflow</a>
				<a href="#review" class="transition hover:text-orange-100">Review</a>
				<a href={resolve('/signup')} class="transition hover:text-orange-100">Sign up</a>
				<a
					href={resolve('/login')}
					class="rounded-lg border border-orange-500/35 bg-orange-500/10 px-4 py-2 font-bold text-orange-100 transition hover:border-orange-300 hover:bg-orange-500/20"
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
					class="mb-5 inline-flex rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-sm font-semibold text-orange-200 backdrop-blur"
				>
					Idea management for people who ship
				</p>

				<h1 class="text-5xl font-black leading-[0.96] text-orange-50 sm:text-6xl lg:text-7xl">
					Stop losing good ideas in scattered notes.
				</h1>

				<p class="mt-6 max-w-xl text-base leading-8 text-orange-100/75 sm:text-lg">
					ThinkLot gives every idea a place to land, a way to be judged, and a path toward execution when it is ready.
				</p>

				<div class="mt-8 flex flex-wrap gap-3">
					<a
						href={resolve('/login')}
						class="rounded-lg bg-gradient-to-r from-orange-400 to-orange-500 px-5 py-3 text-sm font-black text-[#111] shadow-[0_16px_40px_rgba(249,115,22,0.25)] transition hover:from-orange-300 hover:to-orange-400"
					>
						Login to dashboard
					</a>
					<a
						href={resolve('/signup')}
						class="rounded-lg border border-orange-500/35 bg-white/[0.02] px-5 py-3 text-sm font-bold text-orange-100 transition hover:border-orange-300 hover:bg-orange-500/10"
					>
						Create account
					</a>
				</div>
			</div>

			<div class="grid items-stretch gap-3 sm:grid-cols-3">
				<div class="h-full rounded-xl border border-white/10 bg-white/[0.04] p-4 shadow-lg shadow-black/20 backdrop-blur-sm">
					<p class="text-sm font-semibold text-orange-100">For founders</p>
					<p class="mt-2 text-sm leading-6 text-orange-100/60">Prioritize opportunities without turning every thought into a task.</p>
				</div>
				<div class="h-full rounded-xl border border-white/10 bg-white/[0.04] p-4 shadow-lg shadow-black/20 backdrop-blur-sm">
					<p class="text-sm font-semibold text-orange-100">For teams</p>
					<p class="mt-2 text-sm leading-6 text-orange-100/60">Create a shared queue for ideas, experiments, and product bets.</p>
				</div>
				<div class="h-full rounded-xl border border-white/10 bg-white/[0.04] p-4 shadow-lg shadow-black/20 backdrop-blur-sm">
					<p class="text-sm font-semibold text-orange-100">For builders</p>
					<p class="mt-2 text-sm leading-6 text-orange-100/60">Keep momentum by moving the best concepts into executable plans.</p>
				</div>
			</div>

			<div class="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur sm:grid-cols-3">
				{#each stats as stat (stat.label)}
					<div>
						<p class="text-2xl font-black text-orange-50">{stat.value}</p>
						<p class="mt-1 text-xs uppercase tracking-[0.12em] text-orange-200/65">{stat.label}</p>
					</div>
				{/each}
			</div>
		</div>

		<div id="workflow" class="flex items-center pb-8 lg:pb-0">
			<div class="w-full rounded-2xl border border-white/10 bg-[#111218]/90 p-4 shadow-2xl shadow-black/40 backdrop-blur sm:p-5">
				<div class="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-orange-500/10 pb-4">
					<div>
						<p class="text-sm font-bold text-orange-100">Workspace preview</p>
						<p class="mt-1 text-xs text-orange-200/60">Capture, compare, review, execute</p>
					</div>
					<div class="flex gap-2">
						<span class="rounded-full bg-orange-500/15 px-3 py-1 text-xs font-semibold text-orange-100">Priority score 24</span>
						<span class="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">Ready</span>
					</div>
				</div>

				<div class="grid items-stretch gap-3 lg:grid-cols-4">
					{#each board as column (column.stage)}
						<section class="flex min-h-72 flex-col rounded-xl border border-white/10 bg-[#0f1016] p-3">
							<div class="mb-3 flex items-center justify-between gap-2">
								<h2 class="text-sm font-black text-orange-100">{column.stage}</h2>
								<span class="rounded-full bg-orange-500/10 px-2 py-0.5 text-xs font-bold text-orange-200">{column.count}</span>
							</div>

							<div class="flex flex-1 flex-col gap-2">
								{#each column.items as item (item)}
									<article class="min-h-20 rounded-lg border border-white/10 bg-white/[0.04] p-3">
										<p class="text-sm font-semibold leading-5 text-orange-50">{item}</p>
										<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-orange-950/70">
											<div
												class="h-full rounded-full bg-gradient-to-r from-orange-400 to-cyan-400"
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
					<div class="rounded-xl border border-white/10 bg-[#0f1016] p-4">
						<p class="font-black text-orange-100">Opportunity score</p>
						<p class="mt-2 text-sm leading-6 text-orange-100/60">
							Compare ideas with a simple scoring model that makes high-impact, low-effort work easier to spot.
						</p>

						<div class="mt-5 space-y-4">
							{#each scores as score (score.label)}
								<div>
									<div class="mb-2 flex items-center justify-between text-sm">
										<span class="font-semibold text-orange-100">{score.label}</span>
										<span class="font-black text-orange-50">{score.value}/10</span>
									</div>
									<div class="h-2 overflow-hidden rounded-full bg-orange-950/70">
										<div
											class="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500"
											style={`width: ${score.value * 10}%`}
										></div>
									</div>
								</div>
							{/each}
						</div>
					</div>

					<aside id="review" class="rounded-xl border border-white/10 bg-[#0f1016] p-4">
						<p class="font-black text-orange-100">Weekly review queue</p>
						<p class="mt-2 text-sm leading-6 text-orange-100/60">
							ThinkLot brings back ideas that are stale, promising, or ready for a decision so your backlog stays useful.
						</p>

						<div class="mt-5 space-y-3">
							<div class="rounded-lg border border-orange-500/20 bg-orange-500/10 p-3">
								<p class="text-sm font-bold text-orange-100">Promote promising ideas</p>
								<p class="mt-1 text-xs text-orange-200/60">Move validated opportunities into planning.</p>
							</div>
							<div class="rounded-lg border border-sky-400/20 bg-sky-400/10 p-3">
								<p class="text-sm font-bold text-sky-100">Snooze what is not ready</p>
								<p class="mt-1 text-xs text-sky-200/60">Set a revisit date without losing the context.</p>
							</div>
							<div class="rounded-lg border border-zinc-400/20 bg-zinc-400/10 p-3">
								<p class="text-sm font-bold text-zinc-100">Archive the noise</p>
								<p class="mt-1 text-xs text-zinc-300/60">Keep the workspace focused on active opportunities.</p>
							</div>
						</div>
					</aside>
				</div>
			</div>
		</div>
	</section>

	<section id="features" class="relative border-t border-orange-500/10 bg-[#0d0d12] px-5 py-16 sm:px-8 lg:px-10">
		<div class="mx-auto max-w-7xl">
			<div class="max-w-2xl">
				<p class="text-sm font-black uppercase tracking-[0.18em] text-orange-300/80">Why ThinkLot</p>
				<h2 class="mt-3 text-3xl font-black text-orange-50 sm:text-4xl">A focused system for deciding what to build next.</h2>
			</div>

			<div class="mt-8 grid gap-4 md:grid-cols-3">
				{#each features as feature (feature.title)}
					<article class="rounded-xl border border-white/10 bg-white/[0.04] p-5 shadow-lg shadow-black/20 backdrop-blur-sm">
						<h3 class="text-lg font-black text-orange-100">{feature.title}</h3>
						<p class="mt-3 text-sm leading-7 text-orange-100/62">{feature.description}</p>
					</article>
				{/each}
			</div>

			<div
				class="mt-10 flex flex-col items-start justify-between gap-4 rounded-2xl border border-white/10 bg-gradient-to-r from-orange-500/15 to-cyan-400/10 p-6 md:flex-row md:items-center"
			>
				<div>
					<p class="text-xl font-black text-orange-50">Build from your best ideas, not your newest notes.</p>
					<p class="mt-2 text-sm text-orange-100/70">Bring order to idea chaos with a workflow made for SaaS teams.</p>
				</div>
				<a
					href={resolve('/login')}
					class="rounded-lg bg-orange-500 px-5 py-3 text-sm font-black text-[#111] transition hover:bg-orange-400"
				>
					Login to start
				</a>
			</div>
		</div>
	</section>
</main>
