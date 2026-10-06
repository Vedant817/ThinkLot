<script lang="ts">
	import AuthForm from '$lib/components/AuthForm.svelte';
</script>

<svelte:head>
	<title>Sign in | ThinkLot</title>
	<meta name="description" content="Sign in to your ThinkLot idea lot." />
</svelte:head>

<main class="grid min-h-dvh place-items-center bg-paper px-4 py-10">
	<div class="w-full max-w-sm">
		<a href="/" class="mb-6 flex items-center justify-center gap-2">
			<span
				class="grid size-8 place-items-center rounded border border-rule-strong bg-panel font-mono text-[11px] font-bold"
			>
				TL
			</span>
			<span class="font-mono text-sm font-bold tracking-tight">ThinkLot</span>
		</a>

		<AuthForm mode="signin" />
	</div>
</main>