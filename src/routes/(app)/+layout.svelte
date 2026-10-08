<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import AuthForm from '$lib/components/AuthForm.svelte';
	import ShortcutHelp from '$lib/components/ShortcutHelp.svelte';
	import { convex } from '$lib/convex/client.svelte';
	import { buildShortcuts, isTyping, resolve, type Shortcut } from '$lib/keyboard';

	const { children } = $props();

	// 'loading' until Convex Auth has told us who (if anyone) this is. Rendering
	// the app during this window would flash the signed-out view at a signed-in
	// user on every refresh, so the guard waits.
	const ready = $derived(convex.auth.status !== 'loading');

	$effect(() => {
		if (!ready || convex.auth.status !== 'unauthenticated') return;

		const target = page.url.pathname;
		if (target === '/login' || target === '/signup') return;

		// Honour ?next= so signing in returns you to where you were headed.
		//
		// There used to be a second effect here that sent every authenticated user
		// to /ideas. It lived in a layout that never mounts on /login or /signup,
		// so it could not do the job its comment claimed - all it did was fire on
		// the app pages and bounce them. That made refresh, share and deep links
		// to /ideas/<id> silently redirect to the list, losing the user's filters.
		const dest = page.url.pathname + page.url.search + page.url.hash;
		void goto(`/login?next=${encodeURIComponent(dest)}`, { replaceState: true });
	});

	/**
	 * Theme is tracked here rather than read from the DOM in the template.
	 * Reading `document.documentElement.dataset.theme` inside markup compiled to a
	 * one-shot `textContent` assignment, so the toggle kept saying "Dark" after
	 * the surface had already gone dark.
	 */
	let theme = $state<'light' | 'dark'>('light');
	$effect(() => {
		theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
	});

	function toggleTheme() {
		const next = theme === 'dark' ? 'light' : 'dark';
		theme = next;
		document.documentElement.dataset.theme = next;
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

	// ---------------------------------------------------------------------
	// Keyboard shortcuts
	//
	// Live here rather than per-page so one registry answers for the whole app
	// and the "do not fire while typing" guard cannot be forgotten by the next
	// page that adds a handler.
	// ---------------------------------------------------------------------

	let showShortcuts = $state(false);
	let pendingChord = $state<string | null>(null);
	let chordTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Reach the capture field by contract, not by prop drilling.
	 *
	 * CaptureBar owns its textarea, and threading a bindable ref through the
	 * layout, the page and the component would couple three files to one text
	 * field. One documented attribute is the smaller cost, and it cannot drift
	 * silently the way an undeclared coupling would.
	 */
	function focusCapture() {
		const field = document.querySelector<HTMLTextAreaElement>('[data-capture-field]');
		if (field) {
			field.focus();
			field.scrollIntoView({ block: 'nearest' });
		} else {
			// No capture bar on this route. The lot is where capture belongs, so go
			// there and let the user press the key again.
			void goto('/ideas');
		}
	}

	const shortcuts: Shortcut[] = buildShortcuts({
		focusCapture,
		go: (path) => void goto(path),
		toggleHelp: () => (showShortcuts = !showShortcuts),
		escape: () => {
			if (showShortcuts) {
				showShortcuts = false;
				return;
			}
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
		}
	});

	function onWindowKeydown(event: KeyboardEvent) {
		// The guard the old `/` handler got wrong: it excluded only the capture
		// textarea, so `/` was untypable in the search field - pressing it yanked
		// focus away mid-word.
		if (isTyping(event.target)) return;

		const { run, nextChord } = resolve(shortcuts, event, pendingChord);
		pendingChord = nextChord;

		if (chordTimer) clearTimeout(chordTimer);
		if (nextChord) {
			// A chord that is never completed lapses rather than leaving the app
			// waiting for a second key indefinitely.
			chordTimer = setTimeout(() => (pendingChord = null), 1200);
		}

		if (!run) return;
		event.preventDefault();
		run.run();
	}

	/**
	 * Only destinations that actually exist are navigable.
	 *
	 * `/board` (Week 3) and `/review` (Week 5) are not built yet. Listing them as
	 * live links produced three-flavours-of-nothing: SvelteKit's unstyled error
	 * page rendered *inside* the app shell, `aria-current` marked the broken item
	 * as active, and the layout was not re-mounted so nothing recovered it.
	 * A visibly disabled item with "soon" is honest; a 404 is not.
	 */
	const NAV = [
		{ href: '/ideas', label: 'Lot', soon: false },
		{ href: '/board', label: 'Board', soon: false },
		{ href: '/review', label: 'Review', soon: false },
		{ href: '/archive', label: 'Archive', soon: false }
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


<svelte:window onkeydown={onWindowKeydown} />

{#if !ready}
	<!-- Full-page hold while auth resolves. Deliberately plain: no spinner to stare at. -->
	<div class="grid min-h-dvh place-items-center bg-paper">
		<p class="font-mono text-xs tracking-widest text-ink-3">THINKLOT</p>
	</div>
{:else if convex.auth.status === 'unauthenticated'}
	{@render children()}
{:else}
	<div class="min-h-dvh bg-paper text-ink">
		<!--
			Mobile bar. NOT sticky.

			It used to be `sticky top-0 z-50`, which put it in direct conflict with
			the capture bar's own `sticky top-0 z-40`: both pinned to y=0 in the same
			scrolling container, so once you scrolled past the header it painted over
			the top half of the capture field. That is precisely the moment the app
			exists for - mid-list, new idea. The capture bar keeps the sticky slot
			since it is the thing you came to use; this bar scrolls away and the
			bottom nav carries navigation.
		-->
		<header
			class="flex items-center justify-between border-b border-rule bg-paper px-4 py-3 md:hidden"
		>
			<a href="/ideas" class="font-mono text-sm font-bold tracking-tight">ThinkLot</a>
			<!--
				Theme toggle on mobile too. It lived only in the sidebar's
				`hidden md:flex`, so on a phone - the device this app is most used on -
				there was no way to reach it at all.
			-->
			<div class="flex items-center gap-4">
				<button
					type="button"
					onclick={toggleTheme}
					aria-pressed={theme === 'dark'}
					class="font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:text-ink md:hidden"
				>
					{theme === 'dark' ? 'Light' : 'Dark'}
				</button>
				<button
					type="button"
					onclick={signOut}
					class="font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:text-ink"
				>
					Sign out
				</button>
			</div>
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
							{#if item.soon}
								<span
									class="flex cursor-not-allowed items-center justify-between rounded px-2 py-1.5 text-sm text-ink-3 opacity-60"
									title="Not built yet"
								>
									{item.label}
									<span class="font-mono text-[9px] tracking-wider uppercase">soon</span>
								</span>
							{:else}
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
							{/if}
						</li>
					{/each}
				</ul>

				<div class="mt-auto flex flex-col gap-2 border-t border-rule pt-3">
					<button
						type="button"
						onclick={toggleTheme}
						class="rounded px-2 py-1.5 text-left font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:bg-sunk"
					>
						{theme === 'dark' ? 'Light' : 'Dark'}
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

		<!--
			Bottom nav for phones.

			py-3.5 rather than py-2.5: the previous padding produced a ~35px target,
			under the 44px minimum for a control the app expects you to hit one-handed
			while walking.
		-->
		<nav
			aria-label="Main"
			class="fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)] md:hidden"
		>
			{#each NAV as item (item.href)}
				{@const active = page.url.pathname.startsWith(item.href)}
				{#if item.soon}
					<span
						class="flex flex-col items-center gap-0.5 py-3.5 font-mono text-[10px] tracking-wider text-ink-3 opacity-60 uppercase"
						title="Not built yet"
					>
						{item.label}
					</span>
				{:else}
					<a
						href={item.href}
						aria-current={active ? 'page' : undefined}
						class="flex flex-col items-center gap-0.5 py-3.5 font-mono text-[10px] tracking-wider uppercase"
						class:text-signal={active}
						class:text-ink-3={!active}
					>
						{item.label}
					</a>
				{/if}
			{/each}
		</nav>

		<!--
			Connection banner. Fixed to the bottom so it never covers the capture bar
			at the top, and it sits above the phone nav bar.

		Shown only when genuinely DISCONNECTED. `connection` starts as
		'connecting' and `applyConnectionState` maps "has never connected yet" to
		that same value, so every cold page load announced that it was
		reconnecting - a claim about a dropped connection while the socket was in
		fact opening for the first time.
		-->
		{#if connection === 'disconnected'}
			<div
				class="fixed bottom-14 left-1/2 z-50 -translate-x-1/2 rounded-full border border-warn/30 bg-warn-soft px-3 py-1 font-mono text-[10px] tracking-wider text-warn uppercase md:bottom-4"
				role="status"
			>
				Offline — ideas may not save
			</div>
		{/if}
	</div>

	{#if showShortcuts}
		<ShortcutHelp {shortcuts} onclose={() => (showShortcuts = false)} />
	{/if}
{/if}
