import { ConvexReactClient } from "convex/react";

/**
 * The one Convex client for the whole app.
 *
 * Lives in its own module because more than the root layout needs it: the connection
 * banner reads its transport state, and a route file cannot import from a `+layout`.
 *
 * `configured` is exported too, so the layout can tell "no URL was supplied" (which has
 * its own explicit screen) from a client that exists and is merely not yet connected.
 */
const url = process.env.EXPO_PUBLIC_CONVEX_URL;
export const configured = !!url && /^https:\/\/[^/]+\.convex\.cloud\/?$/.test(url ?? '');

export const client = configured
	? new ConvexReactClient(url!, { unsavedChangesWarning: false })
	: null;