/**
 * Global keyboard shortcuts.
 *
 * Kept in one registry, in one place, for two reasons that both cost real bugs
 * during development:
 *
 * 1. Discoverability. A shortcut nobody can find does not exist. Everything here
 *    is rendered by the help overlay, which is opened with `?`.
 * 2. Correctness of the guard. Every handler must refuse to fire while the user
 *    is typing - in an input, a textarea, or anything contentEditable. The `/`
 *    shortcut originally only excluded the capture box, so `/` was literally
 *    untypable in the search field: pressing it yanked focus away mid-word.
 *    Centralising the guard means that class of bug cannot recur one handler at
 *    a time.
 *
 * Sequences use a two-key chord (`g` then `l`) rather than a single modified
 * key, because they need no modifier and so stay comfortable on a phone with a
 * keyboard attached, and they cannot collide with browser shortcuts.
 */

export type Shortcut = {
	/** Human label for the help overlay. */
	label: string;
	/** Rendered key hint, e.g. "g then l". */
	keys: string;
	/** Single key that triggers it, or null for the second half of a chord. */
	key: string | null;
	/** Chord prefix, for the second half of a two-key sequence. */
	chord?: string;
	run: () => void;
};

const CHORD_TIMEOUT_MS = 1200;

/** Is the user typing something? Every guard routes through here. */
export function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		target.isContentEditable
	);
}

export type ShortcutHandlers = {
	/** Move focus to the capture field. */
	focusCapture: () => void;
	/** Navigate within the app. */
	go: (path: string) => void;
	/** Toggle the shortcut help overlay. */
	toggleHelp: () => void;
	/** Close the overlay, or blur whatever is focused. */
	escape: () => void;
};

/**
 * Build the registry.
 *
 * Returned as a function rather than a module-level constant so the handlers
 * close over the live component state instead of capturing whatever existed at
 * module load.
 */
export function buildShortcuts(h: ShortcutHandlers): Shortcut[] {
	return [
		{
			label: 'Capture an idea',
			keys: '/',
			key: '/',
			run: h.focusCapture
		},
		{
			// First in the registry, matching its place in the navigation.
			//
			// This was missing entirely when the dashboard was added, which left it
			// the one destination in the nav that a keyboard user could not reach -
			// and it is the page you land on after signing in. Every other item has
			// had a chord, so the omission is not a defensible gap in coverage.
			label: 'Go to the dashboard',
			keys: 'g then d',
			key: 'd',
			chord: 'g',
			run: () => h.go('/dashboard')
		},
		{
			label: 'Go to the lot',
			keys: 'g then l',
			key: 'l',
			chord: 'g',
			run: () => h.go('/ideas')
		},
		{
			label: 'Go to the board',
			keys: 'g then b',
			key: 'b',
			chord: 'g',
			run: () => h.go('/board')
		},
		{
			label: 'Go to the review queue',
			keys: 'g then r',
			key: 'r',
			chord: 'g',
			run: () => h.go('/review')
		},
		{
			label: 'Go to the archive',
			keys: 'g then a',
			key: 'a',
			chord: 'g',
			run: () => h.go('/archive')
		},
		{
			label: 'Show these shortcuts',
			keys: '?',
			key: '?',
			run: h.toggleHelp
		},
		{
			label: 'Close, or step out of a field',
			keys: 'Esc',
			key: 'Escape',
			run: h.escape
		}
	];
}

/**
 * Resolve a keystroke against the registry.
 *
 * Pure, so the behaviour is testable and so the timer - which lives in the
 * caller - stays out of the decision.
 *
 * `pendingChord` is the prefix already typed, if any. Returns the shortcut to
 * run plus the new pending state, so the caller owns the timeout.
 */
export function resolve(
	shortcuts: Shortcut[],
	event: KeyboardEvent,
	pendingChord: string | null
): { run: Shortcut | null; nextChord: string | null } {
	// Never hijack a chord the user is building inside a field.
	if (event.metaKey || event.ctrlKey || event.altKey) {
		return { run: null, nextChord: null };
	}

	const key = event.key;

	if (pendingChord) {
		const match = shortcuts.find((s) => s.chord === pendingChord && s.key === key.toLowerCase());
		if (match) return { run: match, nextChord: null };
		// Wrong second key: drop the chord rather than firing the prefix alone.
		return { run: null, nextChord: null };
	}

	// Does this key START a chord? `s.chord` holds the prefix ("g") and `s.key`
	// holds the second key ("l"), so the pressed key has to be compared against
	// `s.chord`. Comparing it to `s.key` matched nothing, and every `g` chord was
	// dead - caught by testing `resolve` rather than by reading it.
	const chordStart = shortcuts.find((s) => s.chord === key.toLowerCase());
	if (chordStart) return { run: null, nextChord: key.toLowerCase() };

	const direct = shortcuts.find((s) => !s.chord && s.key?.toLowerCase() === key.toLowerCase());
	return { run: direct ?? null, nextChord: null };
}

/** Exported so the help overlay can offer "dismiss this forever". */
export const CHORD_HINT = `${CHORD_TIMEOUT_MS / 1000}s`;
