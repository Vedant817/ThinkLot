/**
 * Offline state, decided from the Convex client's own connection report.
 *
 * Pure and in a `.ts` file so it can be unit-tested without a JSX parser - which is
 * also why the state logic and the banner component are separate files.
 *
 * `isWebSocketConnected` and `hasEverConnected` are the fields the client actually
 * exposes, checked against `node_modules` rather than assumed. A banner built on an
 * invented field name compiles, renders, and never fires - which is exactly the
 * failure this module was written to prevent, and the one a device run caught.
 */

type ConnectionSnapshot = {
	isWebSocketConnected: boolean;
	hasEverConnected: boolean;
};

type ConnectionSource = {
	connectionState: () => ConnectionSnapshot;
};

export type ConnectionStatus = {
	connected: boolean;
	reconnecting: boolean;
	idle: boolean;
};

/**
 * Read the banner state.
 *
 * Takes the client directly rather than reaching for it, because the layout owns it and
 * a test can supply a stub.
 */
export function connectionStatus(client: ConnectionSource | null): ConnectionStatus {
	if (!client) return { connected: false, reconnecting: false, idle: true };
	const state = client.connectionState();
	const isConnected = state.isWebSocketConnected === true;
	const hasEver = state.hasEverConnected === true;
	return {
		connected: isConnected,
		reconnecting: hasEver && !isConnected,
		idle: !hasEver
	};
}