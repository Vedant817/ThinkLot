<script lang="ts">
	/**
	 * Import and export.
	 *
	 * Two halves of one promise: your ideas leave this app in a form that is genuinely
	 * yours, and they can come back.
	 *
	 * ## Three formats, three jobs
	 *
	 * - **Markdown** - paste into Notion. The founder's actual workflow, so it is first
	 *   and it is the default.
	 * - **JSON** - the backup. Lossless, versioned, and it includes archived ideas.
	 * - **CSV** - for a spreadsheet.
	 *
	 * ## What the screen will not do
	 *
	 * It will not import silently. Every file is parsed and shown with what would be
	 * added and what collides, because an import that adds 400 rows without asking is
	 * how someone ends up with two lots and no idea which is real.
	 */
	import { api } from '../../../../convex/_generated/api';
	import { convex } from '$lib/convex/client.svelte';
	import { watchQuery, type QueryHandle } from '$lib/convex/query.svelte';
	import QueryError from '$lib/components/QueryError.svelte';
	import {
		toNotionMarkdown,
		toCsv,
		toBackupJson,
		exportFilename,
		backupToImportEntry,
		parseMarkdownImport,
		parseCsvImport,
		findImportDuplicates,
		partitionForImport,
		type PortableIdea,
		type ImportCandidate
	} from '$lib/portability';
	import { importFromPmSource } from '$lib/pm-import';

	type ExportPayload = {
		ideas: PortableIdea[];
		truncated: boolean;
		taskTruncated: boolean;
		exportedAt: number;
		archivedCount: number;
		taskCount: number;
	};

	let exportHandle = $state<QueryHandle<ExportPayload | undefined> | null>(null);

	$effect(() => {
		const next = watchQuery<ExportPayload | undefined>(convex.client!, api.portability.exportAll, {});
		exportHandle = next;
		return () => {
			next.dispose();
		};
	});

	const payload = $derived(exportHandle?.current);
	const ideaCount = $derived(payload?.ideas.length ?? 0);

	// --- export ---------------------------------------------------------------------
	let exportNote = $state<string | null>(null);

	function download(name: string, contents: string, mime: string) {
		// A Blob rather than a data: URL - data URLs are capped far lower in some
		// browsers, and a 3000-idea JSON backup can exceed it, which would fail exactly
		// when the user most needs it.
		const url = URL.createObjectURL(new Blob([contents], { type: mime }));
		const link = document.createElement('a');
		link.href = url;
		link.download = name;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
	}

	function onExport(kind: 'markdown' | 'csv' | 'json') {
		const data = payload;
		if (!data) return;
		const at = data.exportedAt;
		if (kind === 'markdown') download(exportFilename('markdown', at), toNotionMarkdown(data.ideas, at), 'text/markdown');
		else if (kind === 'csv') download(exportFilename('csv', at), toCsv(data.ideas), 'text/csv');
		else download(exportFilename('json', at), toBackupJson(data.ideas, at), 'application/json');

		exportNote = `Exported ${data.ideas.length} idea${data.ideas.length === 1 ? '' : 's'}.`;
	}

	// --- import ---------------------------------------------------------------------
	let fileName = $state<string | null>(null);
	let parsed = $state<ReturnType<typeof parseMarkdownImport> | null>(null);
	/**
	 * What the file was, and which of its columns this app could not use.
	 *
	 * Both are shown on screen. Detection is shown because "we guessed this is Jira"
	 * must be checkable, and the unmapped columns are shown because a real Jira export
	 * has ~200 of them - silently importing 6 and saying nothing about the other 194 is
	 * the exact behaviour that makes an import untrustworthy.
	 */
	let detected = $state<{ source: string; label: string; confidence: string; matched: string[]; note?: string } | null>(
		null
	);
	let parseError = $state<string | null>(null);
	let importing = $state(false);
	let result = $state<{ imported: number; skipped: { title: string; reason: string }[]; remaining: number } | null>(
		null
	);

	const existingTitles = $derived((payload?.ideas ?? []).map((idea) => ({ _id: idea._id, title: idea.title })));
	const split = $derived(parsed ? partitionForImport(findImportDuplicates(parsed.candidates, existingTitles)) : null);

	/**
	 * Everything about a file, decided the same way for every source.
	 *
	 * This used to be three hand-written paths (JSON backup, CSV, Markdown) with their
	 * own guesses. `importFromPmSource` replaces them because a product manager's file is
	 * not one of three things: it is a Jira export, or a Linear CSV, or a Trello board, or
	 * an Obsidian vault, and the differences between those are which columns they ship -
	 * which is what `pm-import.ts` knows and this function did not.
	 */
	function detectAndParse(text: string, name: string): ReturnType<typeof parseMarkdownImport> {
		const outcome = importFromPmSource(text, name);
		detected = {
			source: outcome.detection.source.id,
			label: outcome.detection.source.label,
			confidence: outcome.detection.confidence,
			matched: outcome.detection.matched,
			note: outcome.detection.note
		};
		unmapped = outcome.unmappedColumns;
		return { candidates: outcome.entries, skipped: outcome.skipped };
	}

	let unmapped = $state<string[]>([]);

	async function onFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		fileName = file.name;
		parseError = null;
		result = null;
		parsed = null;
		detected = null;
		unmapped = [];

		if (file.size > 8 * 1024 * 1024) {
			parseError = 'That file is over 8 MB. Import it in pieces, or split it first.';
			return;
		}

		try {
			const text = await file.text();
			const outcome = detectAndParse(text, file.name);
			parsed = outcome;
			if (outcome.candidates.length === 0 && outcome.skipped.length === 0) {
				parseError = 'Nothing readable in that file.';
			}
		} catch {
			parseError = 'Could not read that file.';
		}
	}

	async function onImport() {
		const fresh = split?.fresh ?? [];
		if (fresh.length === 0 || importing) return;
		importing = true;
		result = null;
		try {
			// Batched on the server's own limit. A 3000-note file is many calls, each
			// verified, rather than one transaction that fails having written nothing.
			let imported = 0;
			const allSkipped: { title: string; reason: string }[] = [];
			let remaining = 0;

			for (let i = 0; i < fresh.length; i += 200) {
				const batch = fresh.slice(i, i + 200) as ImportCandidate[];
				const outcome = (await convex.mutation(api.portability.importMany, {
					entries: batch.map((entry) => ({
						title: entry.title,
						...(entry.description ? { description: entry.description } : {}),
						...(entry.problem ? { problem: entry.problem } : {}),
						...(entry.audience ? { audience: entry.audience } : {}),
						...(entry.outcome ? { outcome: entry.outcome } : {}),
						...(entry.trigger ? { trigger: entry.trigger } : {}),
						...(entry.transcript ? { transcript: entry.transcript } : {}),
						...(entry.tags.length ? { tags: entry.tags } : {})
					}))
				})) as { imported: number; skipped: { title: string; reason: string }[]; remaining: number };

				imported += outcome.imported;
				allSkipped.push(...outcome.skipped);
				remaining = outcome.remaining;
			}

			result = { imported, skipped: allSkipped, remaining };
		} catch (error) {
			parseError = error instanceof Error ? error.message : 'Import failed.';
		} finally {
			importing = false;
		}
	}
</script>

<svelte:head><title>Import and export — ThinkLot</title></svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
	<a href="/dashboard" class="font-mono text-[11px] tracking-wider text-ink-3 uppercase hover:text-ink">
		← Dashboard
	</a>

	<h1 class="mt-3 text-2xl font-bold text-ink">Import and export</h1>
	<p class="mt-2 max-w-prose text-sm leading-6 text-ink-2">
		Your ideas are yours. Everything here leaves this app as text you can read, and comes
		back without being reorganised on the way.
	</p>

	{#if exportHandle?.error}
		<QueryError handle={exportHandle} />
	{/if}

	<!-- Export -->
	<section class="mt-8">
		<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Export</h2>

		{#if exportHandle?.loading}
			<p class="mt-2 font-mono text-[11px] tracking-wider text-ink-3 uppercase">Loading…</p>
		{:else if ideaCount === 0}
			<p class="mt-2 text-sm text-ink-3">Nothing to export yet.</p>
		{:else}
			<p class="mt-2 text-sm text-ink-3">
				{ideaCount} idea{ideaCount === 1 ? '' : 's'}
				{#if payload?.archivedCount}
					· {payload.archivedCount} archived, included
				{/if}
				{#if payload?.taskCount}
					· {payload.taskCount} checklist item{payload.taskCount === 1 ? '' : 's'}, included
				{/if}
			</p>

			<!--
				Truncation is stated, never implied. A capped export that looked complete is
				the worst possible outcome here, because the user would believe they had a
				backup and not have one.
			-->
			{#if payload?.truncated}
				<p class="mt-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">
					This lot is larger than one export covers, so this file is only the most recent
					part of it. Raise the limit before relying on this as a backup.
				</p>
			{/if}

			<div class="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					onclick={() => onExport('markdown')}
					class="rounded-md border border-signal px-4 py-2 font-mono text-[11px] tracking-wider text-signal uppercase hover:bg-signal-soft"
				>
					Markdown for Notion
				</button>
				<button
					type="button"
					onclick={() => onExport('json')}
					class="rounded-md border border-rule px-4 py-2 font-mono text-[11px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal"
				>
					JSON backup
				</button>
				<button
					type="button"
					onclick={() => onExport('csv')}
					class="rounded-md border border-rule px-4 py-2 font-mono text-[11px] tracking-wider text-ink-2 uppercase hover:border-signal hover:text-signal"
				>
					CSV
				</button>
			</div>
			<p class="mt-2 text-sm text-ink-3">
				The JSON backup is the lossless one — every field, archived ideas and checklists
				included.
			</p>
			{#if exportNote}
				<p class="mt-2 text-sm text-good">{exportNote}</p>
			{/if}
		{/if}
	</section>

	<!-- Import -->
	<section class="mt-10">
		<h2 class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">Import</h2>
		<p class="mt-2 max-w-prose text-sm leading-6 text-ink-3">
			Markdown from Notion or Obsidian, a CSV, or a JSON backup from this app. You will see
			exactly what would be added before anything is.
		</p>

		<label class="mt-3 block">
			<span class="sr-only">Choose a file to import</span>
			<input
				type="file"
				accept=".md,.markdown,.csv,.txt,.json,text/markdown,text/csv,text/plain,application/json"
				onchange={onFile}
				data-import-input="true"
				class="block w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border file:border-rule file:bg-panel file:px-4 file:py-2 file:font-mono file:text-[11px] file:tracking-wider file:text-ink-2 file:uppercase hover:file:border-signal hover:file:text-signal"
			/>
		</label>

		{#if parseError}
			<p class="mt-3 rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-sm text-bad">{parseError}</p>
		{/if}

		{#if parsed && split}
			<div class="mt-4 rounded-lg border border-rule bg-panel p-4">
				<p class="font-mono text-[11px] tracking-wider text-ink-3 uppercase">{fileName}</p>

				<!--
					What this app thought the file was, and how sure it is.

					Shown because a guess presented as a fact is a lie the user cannot
					check. "Read as Jira" invites "no, that is Linear", and either way the
					import works - but the person who dragged the file in should be the one
					who knows what it was.
				-->
				{#if detected}
					<p class="mt-2 text-sm text-ink-2">
						Read as {detected.label}
						{#if detected.confidence !== 'exact'}
							<span class="text-ink-3">(probably)</span>
						{/if}
						{#if detected.matched.length > 0}
							<span class="text-ink-3"> — saw {detected.matched.join(', ')}</span>
						{/if}
					</p>
					{#if detected.note}
						<p class="mt-1 text-sm text-ink-3">{detected.note}</p>
					{/if}
				{/if}

				<!--
					Every column this app had NO field for.

					This is the reason a product manager can trust a Jira import: a real
					export has around 200 columns, six of which map, and the other 194 are
					NAMED here rather than quietly discarded. A blank version of this line
					would claim every column was understood, which is never true of a real
					export - and the importer that says nothing is the one with a bug.
				-->
				{#if unmapped.length > 0}
					<details class="mt-2">
						<summary class="cursor-pointer font-mono text-[11px] tracking-wider text-ink-3 uppercase">
							{unmapped.length} column{unmapped.length === 1 ? '' : 's'} not imported
						</summary>
						<p class="mt-2 text-sm text-ink-3">
							ThinkLot has no field for these. They are listed rather than dropped silently, so you know
							exactly what stayed behind - and your original file is untouched.
						</p>
						<ul class="mt-1.5 flex flex-wrap gap-1">
							{#each unmapped as column (column)}
								<li class="rounded border border-rule-strong bg-paper px-1.5 font-mono text-[10px] text-ink-2">
									{column}
								</li>
							{/each}
						</ul>
					</details>
				{:else if (parsed?.candidates.length ?? 0) > 0}
					<p class="mt-2 text-sm text-ink-3">Every column in it mapped to a ThinkLot field.</p>
				{/if}

				<p class="mt-2 text-sm text-ink-2">
					{split.fresh.length} new
					{#if split.duplicates.length}
						· {split.duplicates.length} already look like something you have
					{/if}
					{#if parsed.skipped.length}
						· {parsed.skipped.length} unreadable
					{/if}
				</p>

				<!--
					Collisions are shown and NOT imported. Deciding for the user loses in one
					direction or the other: skipping loses a real idea, importing silently
					doubles the lot.
				-->
				{#if split.duplicates.length > 0}
					<details class="mt-2">
						<summary class="cursor-pointer font-mono text-[11px] tracking-wider text-ink-3 uppercase">
							Skipped as duplicates ({split.duplicates.length})
						</summary>
						<ul class="mt-2 space-y-1">
							{#each split.duplicates as dup (dup.candidate.title)}
								<li class="text-sm text-ink-2">
									{dup.candidate.title}
									<span class="text-ink-3">
										— matches “{dup.matchesExisting[0].title}”
									</span>
								</li>
							{/each}
						</ul>
					</details>
				{/if}

				{#if parsed.skipped.length > 0}
					<details class="mt-2">
						<summary class="cursor-pointer font-mono text-[11px] tracking-wider text-ink-3 uppercase">
							Unreadable ({parsed.skipped.length})
						</summary>
						<ul class="mt-2 space-y-1">
							{#each parsed.skipped as entry (entry.source)}
								<li class="text-sm text-ink-2">{entry.source} <span class="text-ink-3">— {entry.reason}</span></li>
							{/each}
						</ul>
					</details>
				{/if}

				{#if split.fresh.length > 0}
					<details class="mt-2">
						<summary class="cursor-pointer font-mono text-[11px] tracking-wider text-ink-3 uppercase">
							Will add ({split.fresh.length})
						</summary>
					<ul class="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
						{#each split.fresh as entry (entry.title)}
							<li class="text-sm text-ink-2">
								<span class="font-medium text-ink">{entry.title}</span>
								<!--
									What came with it, shown before the import rather than after.
									A preview that listed only titles could not be checked: 300
									plausible titles and no way to see whether the description,
									problem or tags survived the parse. Everything about this
									screen argues the user should verify the mapping before
									committing to it, so the mapping is shown here.
								-->
								{#if entry.description || entry.problem || entry.audience || entry.outcome}
									<span class="block truncate text-ink-3">
										{entry.description ?? entry.problem ?? entry.audience ?? entry.outcome}
									</span>
								{/if}
								{#if entry.tags.length}
									<span class="font-mono text-[10px] text-ink-3">#{entry.tags.join(' #')}</span>
								{/if}
							</li>
						{/each}
					</ul>
					</details>

					<button
						type="button"
						onclick={onImport}
						disabled={importing}
						data-import-confirm="true"
						class="mt-4 rounded-md border border-signal px-4 py-2 font-mono text-[11px] tracking-wider text-signal uppercase hover:bg-signal-soft disabled:opacity-40"
					>
						{importing ? 'Importing…' : `Import ${split.fresh.length} idea${split.fresh.length === 1 ? '' : 's'}`}
					</button>
				{/if}
			</div>
		{/if}

		{#if result}
			<!--
				The outcome is stated in full, including what was not imported. An import that
				reports "400 imported" and silently dropped 40 rows has not earned trust, and
				trust is the only reason this screen exists.
			-->
			<div class="mt-4 rounded-lg border border-rule bg-panel p-4" data-import-result="true">
				<p class="text-sm text-ink-2">
					Imported {result.imported} idea{result.imported === 1 ? '' : 's'}.
				</p>
				{#if result.skipped.length > 0}
					<details class="mt-2">
						<summary class="cursor-pointer font-mono text-[11px] tracking-wider text-ink-3 uppercase">
							Not imported ({result.skipped.length})
						</summary>
						<ul class="mt-2 space-y-1">
							{#each result.skipped as entry (entry.title)}
								<li class="text-sm text-ink-2">{entry.title} <span class="text-ink-3">— {entry.reason}</span></li>
							{/each}
						</ul>
					</details>
				{/if}
			</div>
		{/if}
	</section>
</div>
