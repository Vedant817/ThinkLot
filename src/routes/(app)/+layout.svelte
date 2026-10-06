<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import AuthForm from '$lib/components/AuthForm.svelte';
	import { convex } from '$lib/convex/client.svelte';

	const { children } = $props();

	// 'loading' until Convex Auth has told us who (if anyone) this is. Rendering
	// the app during this window would flash the signed-out view at a signed-in
	// user on every refresh, so the guard waits.
	const ready = $derived(convex.auth.status !== 'loading');

	$effect(() => {
		if (ready && convex.auth.status === 'unauthenticated') {
			const target = page.url.pathname;
			if (target !== '/login' && target !== '/signup') {
				void goto(`/login?next=${encodeURIComponent(target)}`, { replaceState: true });
			}
		}
	});

	// An already-authenticated user has no business on the sign-in screen.
	$effect(() => {
		if (convex.auth.status === 'authenticated') {
			void goto('/ideas', { replaceState: true });
		}
	});

	function toggleTheme() {
		const root = document.documentElement;
		const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
		root.dataset.theme = next;
		try {
			localStorage.setItem('thinklot:theme', next);
		} catch {
			/* storage blocked; theme just will not persist */
		}
	}

	async function signOut() {
		await convex.signOut();
		await goto('/login', { replaceState: true });
	}

	const NAV = [
		{ href: '/ideas', label: 'Lot' },
		{ href: '/board', label: 'Board' },
		{ href: '/review', label: 'Review' },
		{ href: '/archive', label: 'Archive' }
	];

	/**
	 * Connection state.
	 *
	 * A capture app lives on trains and in basements. "Your idea did not save"
	 * is the worst possible failure, so a lost socket is surfaced rather than
	 * swallowed.
	 */
	let connection = $derived(convex.connection);
</script>


{#if !ready}
	<!-- Full-page hold while auth resolves. Deliberately plain: no spinner to stare at. -->
	<div class="grid min-h-dvh place-items-center bg-paper">
		<p class="font-mono text-xs tracking-widest text-ink-3">THINKLOT</p>
	</div>
{:else if convex.auth.status === 'unauthenticated'}
	{@render children()}
{:else}
	<div class="min-h-dvh bg-paper text-ink">
		<!-- Mobile bar. The sidebar is hidden under md; this is the phone affordance. -->
		<header
			class="sticky top-0 z-50 flex items-center justify-between border-b border-rule bg-paper px-4 py-3 md:hidden"
		>
			<a href="/ideas" class="font-mono text-sm font-bold tracking-tight">ThinkLot</a>
			<button
				type="button"
				onclick={signOut}
				class="font-mono text-[11px] tracking-wider text-ink-3 uppercase"
			>
				Sign out
			</button>
		</header>

		<div class="flex">
			<!--
				Sidebar nav. On a phone this becomes a bottom bar instead, because
				reaching a top-left nav with a thumb is the classic mobile failure.
			-->
			<nav
				aria-label="Main"
				class="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-rule bg-paper px-3 py-4 md:flex"
			>
				<a href="/ideas" class="flex items-center gap-2 px-2 pb-4">
					<span
						class="grid size-7 place-items-center rounded border border-rule-strong bg-panel font-mono text-[11px] font-bold"
					>
						TL
					</span>
					<span class="font-mono text-sm font-bold tracking-tight">ThinkLot</span>
				</a>

				<ul class="flex flex-col gap-0.5">
					{#each NAV as item (item.href)}
						{@const active = page.url.pathname.startsWith(item.href)}
						<li>
							<a
								href={item.href}
								aria-current={active ? 'page' : undefined}
								class="flex items-center justify-between rounded px-2 py-1.5 text-sm transition-colors"
								class:bg-sunk={active}
								class:text-ink={active}
								class:text-ink-2={!active}
							>
								{item.label}
								{#if active}
									<span class="size-1.5 rounded-full bg-signal" aria-hidden="true"></span>
								{/if}
							</a>
						</li>
					{/each}
				</ul>

				<div class="mt-auto flex flex-col gap-2 border-t border-rule pt-3">
					<button
						type="button"
						onclick={toggleTheme}
						class="rounded px-2 py-1.5 text-left font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:bg-sunk"
					>
						{document.documentElement.dataset.theme === 'dark' ? 'Light' : 'Dark'}
					</button>
					<p class="truncate px-2 font-mono text-[11px] text-ink-3" title={convex.auth.email ?? ''}>
						{convex.auth.email ?? 'signed in'}
					</p>
					<button
						type="button"
						onclick={signOut}
						class="rounded px-2 py-1.5 text-left font-mono text-[11px] tracking-wider text-ink-2 uppercase hover:bg-sunk"
					>
						Sign out
					</button>
				</div>
			</nav>

			<main class="min-w-0 flex-1 pb-20 md:pb-0">
				{@render children()}
			</main>
		</div>

		<!-- Bottom nav for phones. -->
		<nav
			aria-label="Main"
			class="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)] md:hidden"
		>
			{#each NAV as item (item.href)}
				{@const active = page.url.pathname.startsWith(item.href)}
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					class="flex flex-col items-center gap-0.5 py-2.5 font-mono text-[10px] tracking-wider uppercase"
					class:text-signal={active}
					class:text-ink-3={!active}
				>
					{item.label}
				</a>
			{/each}
		</nav>

		<!--
			Connection banner. Fixed to the bottom so it never covers the capture bar
			at the top, and it sits above the phone nav bar.
		-->
		{#if connection !== 'connected'}
			<div
				class="fixed bottom-14 left-1/2 z-50 -translate-x-1/2 rounded-full border border-warn/30 bg-warn-soft px-3 py-1 font-mono text-[10px] tracking-wider text-warn uppercase md:bottom-4"
				role="status"
			>
				{connection === 'connecting' ? 'Reconnecting…' : 'Offline — ideas may not save'}
			</div>
		{/if}
	</div>
{/if}
