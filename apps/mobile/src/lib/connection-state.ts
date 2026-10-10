/**
 * Offline state, decided from the Convex client's own connection report.
 *
 * Pure, and in a `.ts` file so it can be unit-tested without a JSX parser - which is
 * also why the state logic, the React binding, and the banner component are separate.
 *
 * `isWebSocketConnected` and `hasEverConnected` are the fields the client actually
 * exposes, checked against `node_modules/convex/dist` rather than assumed. A banner
 * built on an invented field name compiles, renders, and never fires - exactly the
 * failure this module exists to prevent, and one a real device run caught.
 */

import { useCallback, useSyncExternalStore } from "react";

type ConnectionSnapshot = {
	isWebSocketConnected: boolean;
	hasEverConnected: boolean;
};

type ConnectionSource = {
	connectionState: () => ConnectionSnapshot;
	subscribeToConnectionState: (cb: (state: ConnectionSnapshot) => void) => () => void;
};

export type ConnectionStatus = {
	connected: boolean;
	reconnecting: boolean;
	idle: boolean;
};

/** What "nothing wrong yet" looks like, so callers never have to build it. */
export const IDLE_STATUS: ConnectionStatus = { connected: false, reconnecting: false, idle: true };

/**
 * Read the banner state.
 *
 * Takes the client directly rather than reaching for it, because the layout owns it and
 * a test can supply a stub.
 */
export function connectionStatus(client: ConnectionSource | null): ConnectionStatus {
	if (!client) return IDLE_STATUS;
	const state = client.connectionState();
	const isConnected = state.isWebSocketConnected === true;
	const hasEver = state.hasEverConnected === true;
	return {
		connected: isConnected,
		reconnecting: hasEver && !isConnected,
		idle: !hasEver
	};
}

/*
 * A cached snapshot for `useSyncExternalStore`.
 *
 * `getSnapshot` must return a referentially stable value or React throws "The result of
 * getSnapshot should be cached to avoid an infinite loop". A fresh object literal every
 * read - which is what the raw `connectionStatus` returns - is not stable, so the value is
 * only replaced when one of the three flags actually changes. There is exactly one client
 * per app, so a module-level cache cannot disagree with itself.
 */
let cached: ConnectionStatus = IDLE_STATUS;

export function connectionSnapshot(client: ConnectionSource | null): ConnectionStatus {
	const next = connectionStatus(client);
	if (
		cached.connected !== next.connected ||
		cached.reconnecting !== next.reconnecting ||
		cached.idle !== next.idle
	) {
		cached = next;
	}
	return cached;
}

/**
 * Subscribe to transport state, so the banner updates the moment it turns over.
 *
 * `useSyncExternalStore` rather than reading `client.connectionState()` during render:
 * the client returns a plain snapshot with no way to be notified, so a render-time read
 * only refreshes when some unrelated query happens to re-run. `subscribeToConnectionState`
 * is the subscription the client actually publishes, and it is the reason the banner can
 * appear promptly instead of whenever the next fetch lands.
 *
 * The subscribe callback is memoised on the client, so React does not tear down and
 * rebuild the subscription on every render.
 */
export function useConnectionStatus(client: ConnectionSource | null): ConnectionStatus {
	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			if (!client) return () => {};
			return client.subscribeToConnectionState(() => onStoreChange());
		},
		[client]
	);

	// The server snapshot is the idle state: a server render has no transport, and "offline"
	// is not a claim worth making from it.
	return useSyncExternalStore(
		subscribe,
		() => connectionSnapshot(client),
		() => IDLE_STATUS
	);
}
