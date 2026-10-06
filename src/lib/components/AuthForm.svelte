<script lang="ts">
	import { goto } from '$app/navigation';
	import { convex } from '$lib/convex/client.svelte';

	interface Props {
		mode: 'signin' | 'signup';
	}

	let { mode }: Props = $props();

	let email = $state('');
	let password = $state('');
	let busy = $state(false);
	let problem = $state<string | null>(null);

	const isSignup = $derived(mode === 'signup');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;

		// Catch the two mistakes that are cheap to fix before a round trip.
		if (!email.includes('@')) {
			problem = 'Enter the email address you signed up with.';
			return;
		}
		if (isSignup && password.length < 8) {
			problem = 'Password must be at least 8 characters.';
			return;
		}

		busy = true;
		problem = null;

		try {
			if (isSignup) {
				await convex.signUp(email, password);
			} else {
				await convex.signIn(email, password);
			}
			// `replaceState` so the back button does not return to the form the user
			// just completed.
			await goto('/ideas', { replaceState: true });
		} catch (error) {
			problem = error instanceof Error ? error.message : 'Something went wrong. Try again.';
		} finally {
			busy = false;
		}
	}
</script>

<form
	onsubmit={submit}
	class="w-full max-w-sm rounded-lg border border-rule bg-paper p-6 shadow-sm"
>
	<h1 class="font-mono text-lg font-bold tracking-tight text-ink">
		{isSignup ? 'Open a lot' : 'Sign in'}
	</h1>
	<p class="mt-1 text-sm leading-6 text-ink-2">
		{isSignup
			? 'One account keeps your ideas on every device.'
			: 'Pick up where you left off.'}
	</p>

	<label class="mt-6 block">
		<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Email</span>
		<input
			type="email"
			name="email"
			bind:value={email}
			autocomplete="email"
			required
			spellcheck="false"
			class="mt-1.5 w-full rounded-md border border-rule-strong bg-panel px-3 py-2 text-[15px] text-ink outline-none transition-colors focus:border-signal focus:bg-paper"
		/>
	</label>

	<label class="mt-4 block">
		<span class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Password</span>
		<input
			type="password"
			name="password"
			bind:value={password}
			autocomplete={isSignup ? 'new-password' : 'current-password'}
			required
			minlength={isSignup ? 8 : undefined}
			class="mt-1.5 w-full rounded-md border border-rule-strong bg-panel px-3 py-2 text-[15px] text-ink outline-none transition-colors focus:border-signal focus:bg-paper"
		/>
		{#if isSignup}
			<span class="mt-1.5 block font-mono text-[11px] text-ink-3">At least 8 characters</span>
		{/if}
	</label>

	{#if problem}
		<p
			class="mt-4 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-sm text-bad"
			role="alert"
		>
			{problem}
		</p>
	{/if}

	<button
		type="submit"
		disabled={busy}
		class="mt-6 w-full rounded-md bg-signal px-4 py-2.5 font-mono text-xs font-bold tracking-wider text-signal-ink transition-colors hover:brightness-110 disabled:opacity-50"
	>
		{busy ? 'Working…' : isSignup ? 'CREATE ACCOUNT' : 'SIGN IN'}
	</button>

	<p class="mt-4 text-center text-sm text-ink-2">
		{#if isSignup}
			Already have an account?
			<a href="/login" class="font-medium text-signal underline underline-offset-2">Sign in</a>
		{:else}
			New here?
			<a href="/signup" class="font-medium text-signal underline underline-offset-2">Open a lot</a>
		{/if}
	</p>
</form>