import { getAuthUserId } from '@convex-dev/auth/server';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { ValidationError } from '../lib/convex/validation';

const DAY_MS = 86_400_000;

/** UTC day bucket, `YYYY-MM-DD`. The one date shape analytics uses everywhere. */
export function utcDay(at = Date.now()): string {
	return new Date(at).toISOString().slice(0, 10);
}

async function isOptedOut(ctx: QueryCtx, userId: Id<'users'>): Promise<boolean> {
	const row = await ctx.db
		.query('telemetryPrefs')
		.withIndex('by_user', (q) => q.eq('userId', userId))
		.unique();
	return row !== null;
}

/**
 * One heartbeat per user per day. Upserted, so calling it twice costs one row.
 *
 * This is the ONLY per-user analytics write, and it exists because derivation
 * cannot answer "opened the app but changed nothing": event tables only record
 * actions. Fields are enums and a boolean - platform, coarse day, whether any AI
 * key is configured. Never a key, a prompt, a model id, an email, an IP, or
 * anything the user typed. Opted-out users no-op (still success: the client must
 * not be able to tell, from the response, whether it is tracked).
 */
export const heartbeat = mutation({
	args: {
		platform: v.union(v.literal('web'), v.literal('android'), v.literal('ios')),
		aiConfigured: v.boolean()
	},
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) throw new ValidationError('You must be signed in.');
		if (await isOptedOut(ctx, userId)) return { tracked: false as const };
		const day = utcDay();
		const existing = await ctx.db
			.query('clientHeartbeats')
			.withIndex('by_user_day', (q) => q.eq('userId', userId).eq('day', day))
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, { platform: args.platform, aiConfigured: args.aiConfigured });
		} else {
			await ctx.db.insert('clientHeartbeats', {
				userId,
				day,
				platform: args.platform,
				aiConfigured: args.aiConfigured
			});
		}
		return { tracked: true as const };
	}
});

/** Whether this user opted out of product telemetry. */
export const prefs = query({
	args: {},
	handler: async (ctx) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) throw new ValidationError('You must be signed in.');
		const row = await ctx.db
			.query('telemetryPrefs')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		return { optedOut: row !== null };
	}
});

/** Opt out (or back in) of product telemetry. Personal analytics is unaffected:
 * it computes from the user's own rows, which exist whether telemetry is on. */
export const setOptOut = mutation({
	args: { optedOut: v.boolean() },
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) throw new ValidationError('You must be signed in.');
		const existing = await ctx.db
			.query('telemetryPrefs')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.unique();
		if (args.optedOut && !existing) {
			await ctx.db.insert('telemetryPrefs', { userId });
		} else if (!args.optedOut && existing) {
			await ctx.db.delete(existing._id);
		}
		return { optedOut: args.optedOut };
	}
});

export { DAY_MS };
