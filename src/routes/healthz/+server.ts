import { env } from '$env/dynamic/public';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Health check.
 *
 * Deliberately reports the Convex URL rather than just returning 200. The one
 * deployment failure this app has is a missing `PUBLIC_CONVEX_URL`, and its
 * symptom is a blank page with a TypeError in the browser console - invisible
 * to a load balancer that only asks "did you get a 200". So this endpoint
 * answers 503 when the app is misconfigured, which is what turns "the deploy
 * looks healthy but every user sees a white screen" into a failing health
 * check instead.
 *
 * Deliberately NOT a round-trip to Convex. A health check that calls the
 * database turns every Convex hiccup into a restarting deploy, which is how a
 * backend blip becomes a frontend outage.
 */
export const GET: RequestHandler = async () => {
	const url = env.PUBLIC_CONVEX_URL ?? '';
	const ok = url.length > 0 && url.startsWith('https://');

	if (!ok) {
		return json(
			{
				ok: false,
				error: 'PUBLIC_CONVEX_URL is not set to an https:// URL.',
				convexConfigured: false
			},
			{ status: 503 }
		);
	}

	return json(
		{
			ok: true,
			convexConfigured: true,
			// The deployment host only. Never echo the full URL with any query
			// string, in case someone has ever pasted credentials into it.
			convexHost: new URL(url).host
		},
		{ headers: { 'cache-control': 'no-store' } }
	);
};
