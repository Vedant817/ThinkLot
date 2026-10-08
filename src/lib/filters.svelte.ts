import { page } from '$app/state';
import { goto } from '$app/navigation';

/**
 * List filters, kept in the URL.
 *
 * The bug this exists to prevent: filter state held in component `$state` is
 * invisible to the browser, so a refresh empties it, a "back to the list" link
 * drops it, and a filtered view cannot be shared or bookmarked. All three bit
 * within a minute of using the app, and none of them announce themselves.
 *
 * Spec section 6 describes a right-hand details panel next to the list, and the
 * reason that layout exists is precisely that it never discards the list you were
 * looking at. This app uses a dedicated route instead, which is the right choice
 * on a phone - so the state has to travel in the query string to get the property
 * the panel would have provided for free.
 *
 * Named `.svelte.ts` rather than the `filters.ts` of spec section 7 because it
 * uses runes, and runes only compile in a `.svelte`/`.svelte.ts` module. That is a
 * deviation from the folder sketch in the spec, and a small one: this file is
 * shared behaviour used by three routes rather than an empty placeholder.
 */

export type SortOrder = 'capture' | 'priority';
export type ResultView = 'cards' | 'list';

export type Filters = {
	search: string;
	tags: string[];
	archived: boolean;
	sort: SortOrder;
	view: ResultView;
	reason: string | null;
};

export const NO_FILTERS: Filters = {
	search: '',
	tags: [],
	archived: false,
	sort: 'capture',
	view: 'cards',
	reason: null
};

/**
 * Read the filters out of a URL.
 *
 * Anything unparseable falls back to the default rather than throwing. A
 * hand-edited or truncated link should show an unfiltered list, not an error page.
 */
export function readFilters(url: URL): Filters {
	const sort = url.searchParams.get('sort');
	const view = url.searchParams.get('view');
	return {
		search: url.searchParams.get('q') ?? '',
		// Repeated params, never one comma-joined value: `normaliseTags` permits
		// commas inside a tag, and joining on that character would split a tag
		// called `work, urgent` into two the moment the page is reloaded.
		tags: url.searchParams
			.getAll('tags')
			.map((tag) => tag.trim())
			.filter(Boolean),
		archived: url.searchParams.get('archived') === '1',
		sort: sort === 'priority' ? 'priority' : 'capture',
		view: view === 'list' ? 'list' : 'cards',
		reason: url.searchParams.get('reason')
	};
}

/**
 * Write the filters into a URL, in place.
 *
 * Defaults are left implicit rather than written out. A plain list therefore has
 * a clean URL, and turning a default back on is expressed as the absence of a
 * param rather than as `?sort=capture`.
 *
 * `search` is written from what is in the box rather than from the debounced copy
 * the server was queried with, so a link clicked mid-word carries what the user
 * can see rather than what they typed 250ms ago.
 */
export function writeFilters(url: URL, filters: Filters): void {
	const set = (key: string, value: string | null) => {
		if (value) url.searchParams.set(key, value);
		else url.searchParams.delete(key);
	};

	set('q', filters.search.trim() || null);

	// Deleted then re-appended, because the param is repeated.
	url.searchParams.delete('tags');
	// Sorted so that selecting the same tags in a different order still produces
	// the same link. Two people filtering identically should end up with the same
	// URL, and there is no other way to tell that two links are the same view.
	for (const tag of [...filters.tags].sort()) url.searchParams.append('tags', tag);

	set('archived', filters.archived ? '1' : null);
	set('sort', filters.sort === 'priority' ? 'priority' : null);
	set('view', filters.view === 'list' ? 'list' : null);
	set('reason', filters.reason || null);
}

/**
 * The current filter set as a query string, for appending to links.
 *
 * Used so that opening an idea and coming back returns to the list that was left,
 * rather than to an unfiltered one.
 */
export function filtersQuery(filters: Filters): string {
	const url = new URL('https://filters.invalid/');
	writeFilters(url, filters);
	return url.search;
}

/**
 * Mirror a route's filter state into the address bar.
 *
 * MUST be called during component initialisation - it registers an `$effect`, so
 * calling it later (from an event handler, say) throws.
 *
 * `replaceState`, so typing a search does not fill the back button with one entry
 * per keystroke. `noScroll`, because filtering a list must not jump the page back
 * to the top and lose the reader's position. `keepFocus`, because without it the
 * search input loses focus part-way through a word and the next character is
 * typed into nothing.
 */
export function syncFilters(get: () => Filters): void {
	$effect(() => {
		const filters = get();
		const url = new URL(page.url);
		const before = url.pathname + url.search;
		writeFilters(url, filters);
		if (url.pathname + url.search !== before) {
			void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});
}
