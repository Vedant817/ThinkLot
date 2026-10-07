import { onDestroy } from 'svelte';
import type { BaseConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import type { ConvexArgs } from './client.svelte';

/**
 * A reactive Convex query, without React.
 *
 * Convex's official `useQuery` is a React hook built on `ConvexReactClient`,
 * which imports React at module scope. There is no Svelte equivalent, and
 * pulling React in for one hook would defeat the point of using Svelte here.
 *
 * The underlying mechanism is small and public, so this reimplements it:
 *
 *   client.subscribe(name, args)          -> keeps a live server query open
 *   client.addOnTransitionHandler(fn)    -> fires when that query's value changes
 *   client.localQueryResult(name, args)   -> reads the current cached value
 *
 * Call it during component initialisation, the same place you would call
 * `useQuery`. It returns an object of getters.
 */
export type QueryHandle<T> = {
	/** Current value. `undefined` until the first result arrives. */
	readonly current: T | undefined;
	/** True until the first result has arrived *successfully*. */
	readonly loading: boolean;
	/** Last error this subscription produced, or null. */
	readonly error: string | null;
	/** Release the subscription. Called automatically inside a component. */
	dispose: () => void;
};

export function watchQuery<T>(
	client: BaseConvexClient | null,
	reference: unknown,
	args: ConvexArgs = {},
	initial: T | undefined = undefined
): QueryHandle<T> {
	const state = $state({ current: initial as T | undefined, loading: true, error: null as string | null });

	const name = getFunctionName(reference as never);

	/**
	 * No client means no subscription, and that is a CONFIGURATION state, not a
	 * crash.
	 *
	 * Every app page passes `convex.client!` in here. When `PUBLIC_CONVEX_URL`
	 * is unset - a fresh clone, a CI build, an `adapter-node` deploy that forgot
	 * the env var - `start()` leaves `client` null and that non-null assertion
	 * becomes `TypeError: Cannot read properties of null (reading 'subscribe')`,
	 * thrown from inside an `$effect`. Svelte 5 tears the tree down and the user
	 * gets a blank page with the cause visible only in the console.
	 *
	 * Returning an errored handle instead lets the page render its normal error
	 * banner and say what is actually wrong - recoverable, and honest about it.
	 */
	if (!client) {
		state.loading = false;
		state.error =
			'ThinkLot is not connected: PUBLIC_CONVEX_URL is not set. Run `npx convex dev`, then restart.';
		return {
			get current() {
				return state.current;
			},
			get loading() {
				return state.loading;
			},
			get error() {
				return state.error;
			},
			dispose: () => {}
		};
	}

	const { queryToken, unsubscribe } = client.subscribe(name, args as Record<string, never>);

	/**
	 * Convex THROWS from `localQueryResult` when the cached result is an error, and
	 * its `_transition` dispatches handlers in a bare loop with no try/catch. So an
	 * unguarded read here escapes, aborts every *other* subscriber's handler for
	 * that tick, and leaves this handle frozen at its last value with no message.
	 *
	 * Convex's own React bindings wrap this exact call; the port had to as well.
	 */
	const publish = () => {
		try {
			state.current = client.localQueryResult(name, args as Record<string, never>) as T | undefined;
			state.loading = false;
			state.error = null;
		} catch (error) {
			state.loading = false;
			state.error = error instanceof Error ? error.message : String(error);
			console.error(`ThinkLot: query ${name} failed.`, error);
		}
	};

	const removeHandler = client.addOnTransitionHandler((transition) => {
		if (transition.queries.some((q) => q.token === queryToken)) {
			publish();
		}
	});

	// A cached value may already exist from an earlier mount of the same query.
	publish();

	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		removeHandler();
		unsubscribe();
	};

	// `onDestroy` throws when called outside component initialisation. Guard it so
	// the same helper works in both a component and a plain module; callers outside
	// a component own `dispose` themselves.
	try {
		onDestroy(dispose);
	} catch {
		/* not in a component - caller disposes */
	}

	return {
		get current() {
			return state.current;
		},
		get loading() {
			return state.loading;
		},
		get error() {
			return state.error;
		},
		dispose
	};
}