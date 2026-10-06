import { onDestroy } from 'svelte';
import type { BaseConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import type { ConvexArgs } from './client.svelte';
import type { Value } from 'convex/values';

/**
 * A reactive Convex query, without React.
 *
 * Convex's official `useQuery` is a React hook built on `ConvexReactClient`,
 * which imports React at module scope. There is no Svelte equivalent, and
 * pulling React in for one hook would defeat the point of using Svelte here.
 *
 * The underlying mechanism is small and public, so this reimplements it:
 *
 *   client.subscribe(name, args as Record<string, Value>)          -> keeps a live server query open
 *   client.addOnTransitionHandler(fn)    -> fires when that query's value changes
 *   client.localQueryResult(name, args as Record<string, Value>)   -> reads the current cached value
 *
 * Call it during component initialisation, the same place you would call
 * `useQuery`. It returns an object of getters.
 */
export type QueryHandle<T> = {
	/** Current value. `undefined` until the first result arrives. */
	readonly current: T | undefined;
	/** True until the first result arrives. */
	readonly loading: boolean;
	/** Release the subscription. Called automatically inside a component. */
	dispose: () => void;
};

export function watchQuery<T>(
	client: BaseConvexClient,
	reference: unknown,
	args: ConvexArgs = {},
	initial: T | undefined = undefined
): QueryHandle<T> {
	const state = $state({ current: initial as T | undefined, loading: true });

	const name = getFunctionName(reference as never);

	const { queryToken, unsubscribe } = client.subscribe(name, args as Record<string, Value>);

	const publish = () => {
		state.current = client.localQueryResult(name, args as Record<string, Value>) as T | undefined;
		state.loading = false;
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
		dispose
	};
}
