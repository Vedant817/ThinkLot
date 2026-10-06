<script lang="ts">
	import type { IdeaStatus } from '$lib/types';

	interface Props {
		status: IdeaStatus;
		size?: 'sm' | 'md';
	}

	let { status, size = 'sm' }: Props = $props();

	/**
	 * Each stage gets its own hue so a board can be read as a colour field before
	 * any text is read. Tints are flat - a stage should not look "lit".
	 */
	const TONE: Record<IdeaStatus, string> = {
		inbox: 'bg-sunk text-ink-2 border-rule-strong',
		parked: 'bg-warn-soft text-warn border-warn/25',
		reviewing: 'bg-signal-soft text-signal border-signal/25',
		ready: 'bg-ok-soft text-ok border-ok/25',
		building: 'bg-lot-soft text-lot border-lot/30',
		done: 'bg-paper text-ink-3 border-rule'
	};

	const SIZE: Record<'sm' | 'md', string> = {
		sm: 'px-1.5 py-0.5 text-[10px]',
		md: 'px-2 py-1 text-[11px]'
	};
</script>

<span
	class="inline-flex shrink-0 items-center gap-1.5 rounded border font-mono font-medium tracking-wide uppercase {SIZE[
		size
	]} {TONE[status]}"
>
	<!-- A dot rather than a border tint: it survives being printed in mono. -->
	<span class="size-1.5 rounded-full bg-current opacity-70" aria-hidden="true"></span>
	{status}
</span>