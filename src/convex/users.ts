import { getAuthUserId } from '@convex-dev/auth/server';
import { query } from './_generated/server';

/**
 * The signed-in user's own profile.
 *
 * Deliberately the only read path to user data, and it always resolves from the
 * verified request identity — there is no email argument to pass, so it cannot
 * be used to read somebody else's record.
 */
export const current = query({
	args: {},
	handler: async (ctx) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) return null;

		const user = await ctx.db.get(userId);
		if (!user) return null;

		return {
			id: userId,
			email: user.email ?? null,
			name: user.name ?? null
		};
	}
});