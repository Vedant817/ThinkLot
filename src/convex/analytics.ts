import { getAuthUserId } from '@convex-dev/auth/server';
import { query } from './_generated/server';
import { v } from 'convex/values';
import { ValidationError } from '../lib/convex/validation';

/**
 * The signed-in user's own event history, bounded.
 *
 * Personal analytics (decision latency, decision mix, useful weeks) needs event
 * kinds across ideas, and per-idea fetches would be one read per idea. This is
 * one bounded index read over the user's own rows. The cap and the 90-day default
 * window are the cost control: analytics never pays for a full history scan.
 */
export const events = query({
	args: {
		since: v.optional(v.number()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) throw new ValidationError('You must be signed in.');
		const since = args.since ?? Date.now() - 90 * 86_400_000;
		const limit = Math.min(Math.max(args.limit ?? 500, 1), 2000);
		return await ctx.db
			.query('ideaEvents')
			.withIndex('by_user_created', (q) => q.eq('userId', userId).gte('createdAt', since))
			.take(limit);
	}
});
