/**
 * Convex Auth client configuration.
 *
 * This file is easy to get wrong in a way that fails *silently* — if
 * `applicationID` disagrees with the `id` passed to the provider in
 * `auth.ts`, sign-in appears to work and then never establishes a session.
 */
export default {
	providers: [
		{
			domain: process.env.CONVEX_SITE_URL,
			applicationID: 'convex'
		}
	]
};