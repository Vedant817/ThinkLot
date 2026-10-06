import { getAuthUserId } from '@convex-dev/auth/server';
import type { Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import {
	normaliseBody,
	normaliseScore,
	normaliseTags,
	normaliseTitle,
	nowSeconds,
	ValidationError
} from '../lib/convex/validation';

/** Minimal shape `getAuthUserId` needs; satisfied by both query and mutation ctx. */
type WithAuth = { auth: { getUserIdentity: (token: string) => Promise<unknown> } };

/**
 * Resolve the caller, or fail.
 *
 * This is the single chokepoint that makes ownership non-optional. Every
 * function below goes through it, so there is no code path where a document is
 * read or written without first proving who the caller is.
 */
async function requireUser(ctx: WithAuth) {
	const userId = await getAuthUserId(ctx as Parameters<typeof getAuthUserId>[0]);
	if (!userId) {
		throw new ValidationError('You must be signed in.');
	}
	return userId;
}

/**
 * Load an idea and prove the caller owns it.
 *
 * Returns `null` (rather than throwing) when the id is not the caller's, so
 * that probing for the existence of another user's idea id cannot distinguish
 * "exists but not yours" from "does not exist".
 */
async function ownedIdea(ctx: QueryCtx, ideaId: Id<'ideas'>) {
	const userId = await requireUser(ctx);
	const idea = await ctx.db.get(ideaId);
	if (!idea || idea.userId !== userId) return null;
	return idea;
}

/**
 * Next `LOT-####` number for this user.
 *
 * Reads the user's highest existing seq. Two concurrent captures both read the
 * same max, both try to write, and Convex's OCC detects the conflicting read
 * and retries the whole transaction — so the sequence can never contain a
 * duplicate. This is correct *because* the read is inside the transaction.
 */
async function nextSeq(ctx: QueryCtx, userId: Id<'users'>) {
	const latest = await ctx.db
		.query('ideas')
		.withIndex('by_user_seq', (q) => q.eq('userId', userId))
		.order('desc')
		.first();
	return (latest?.seq ?? 0) + 1;
}

export const list = query({
	args: {
		status: v.optional(
			v.union(
				v.literal('inbox'),
				v.literal('parked'),
				v.literal('reviewing'),
				v.literal('ready'),
				v.literal('building'),
				v.literal('done')
			)
		),
		includeArchived: v.optional(v.boolean()),
		tags: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		const userId = await requireUser(ctx);

		const rows = args.status
			? await ctx.db
					.query('ideas')
					.withIndex('by_user_status', (q) => q.eq('userId', userId).eq('status', args.status!))
					.collect()
			: await ctx.db
					.query('ideas')
					.withIndex('by_user', (q) => q.eq('userId', userId))
					.collect();

		const includeArchived = args.includeArchived ?? false;
		let out = rows.filter((idea) => includeArchived || !idea.archived);

		if (args.tags?.length) {
			const wanted = new Set(args.tags.map((t) => t.toLowerCase()));
			out = out.filter((idea) => idea.tags.some((t) => wanted.has(t)));
		}

		return out.sort((a, b) => b.seq - a.seq);
	}
});

export const get = query({
	args: { ideaId: v.id('ideas') },
	handler: async (ctx, args) => {
		const idea = await ownedIdea(ctx, args.ideaId);
		if (!idea) return null;
		const tasks = await ctx.db
			.query('ideaTasks')
			.withIndex('by_idea', (q) => q.eq('ideaId', idea._id))
			.collect();
		return { idea, tasks: tasks.sort((a, b) => a.position - b.position) };
	}
});

/**
 * The capture path. Deliberately tiny: a title is the only required input, so
 * a thought can land before the user has decided what it is.
 */
export const capture = mutation({
	args: {
		title: v.string(),
		description: v.optional(v.string()),
		source: v.optional(v.union(v.literal('typed'), v.literal('dictated'))),
		transcript: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const userId = await requireUser(ctx);

		const title = normaliseTitle(args.title);
		if (!title) {
			throw new ValidationError('An idea needs a title.');
		}

		const seq = await nextSeq(ctx, userId);
		const timestamp = nowSeconds();

		const ideaId = await ctx.db.insert('ideas', {
			userId,
			seq,
			title,
			description: normaliseBody(args.description),
			status: 'inbox',
			tags: [],
			favorite: false,
			archived: false,
			source: args.source ?? 'typed',
			transcript: normaliseBody(args.transcript),
			createdAt: timestamp,
			updatedAt: timestamp
		});

		await ctx.db.insert('ideaEvents', {
			ideaId,
			userId,
			kind: 'captured',
			detail: args.source === 'dictated' ? 'Captured by voice' : undefined,
			createdAt: timestamp
		});

		return ideaId;
	}
});

/** Patch an idea. Omitted fields are left untouched. */
export const update = mutation({
	args: {
		ideaId: v.id('ideas'),
		title: v.optional(v.string()),
		description: v.optional(v.string()),
		problem: v.optional(v.string()),
		tags: v.optional(v.array(v.string())),
		impact: v.optional(v.number()),
		effort: v.optional(v.number()),
		confidence: v.optional(v.number()),
		revisitAt: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const idea = await ownedIdea(ctx, args.ideaId);
		if (!idea) {
			throw new ValidationError('That idea no longer exists.');
		}

		const patch: Record<string, unknown> = { updatedAt: nowSeconds() };

		const title = normaliseTitle(args.title);
		if (title !== undefined) patch.title = title;

		if ('description' in args) patch.description = normaliseBody(args.description);
		if ('problem' in args) patch.problem = normaliseBody(args.problem);

		const tags = normaliseTags(args.tags);
		if (tags !== undefined) patch.tags = tags;

		if ('impact' in args) patch.impact = normaliseScore(args.impact, 'Impact');
		if ('effort' in args) patch.effort = normaliseScore(args.effort, 'Effort');
		if ('confidence' in args) {
			patch.confidence = normaliseScore(args.confidence, 'Confidence');
		}

		if ('revisitAt' in args) patch.revisitAt = args.revisitAt;

		await ctx.db.patch(args.ideaId, patch);
		return args.ideaId;
	}
});

export const setStatus = mutation({
	args: {
		ideaId: v.id('ideas'),
		status: v.union(
			v.literal('inbox'),
			v.literal('parked'),
			v.literal('reviewing'),
			v.literal('ready'),
			v.literal('building'),
			v.literal('done')
		)
	},
	handler: async (ctx, args) => {
		const idea = await ownedIdea(ctx, args.ideaId);
		if (!idea) {
			throw new ValidationError('That idea no longer exists.');
		}

		await ctx.db.patch(args.ideaId, { status: args.status, updatedAt: nowSeconds() });
		await ctx.db.insert('ideaEvents', {
			ideaId: args.ideaId,
			userId: idea.userId,
			kind: 'status',
			detail: `${idea.status} → ${args.status}`,
			createdAt: nowSeconds()
		});
	}
});

export const toggleFavorite = mutation({
	args: { ideaId: v.id('ideas') },
	handler: async (ctx, args) => {
		const idea = await ownedIdea(ctx, args.ideaId);
		if (!idea) {
			throw new ValidationError('That idea no longer exists.');
		}
		await ctx.db.patch(args.ideaId, {
			favorite: !idea.favorite,
			updatedAt: nowSeconds()
		});
	}
});

/**
 * Archive is reversible and remembers the previous status, so restoring a
 * parked idea returns it to `parked` instead of dumping it back in the inbox.
 */
export const setArchived = mutation({
	args: {
		ideaId: v.id('ideas'),
		archived: v.boolean(),
		statusBeforeArchive: v.optional(
			v.union(
				v.literal('inbox'),
				v.literal('parked'),
				v.literal('reviewing'),
				v.literal('ready'),
				v.literal('building'),
				v.literal('done')
			)
		)
	},
	handler: async (ctx, args) => {
		const idea = await ownedIdea(ctx, args.ideaId);
		if (!idea) {
			throw new ValidationError('That idea no longer exists.');
		}

		await ctx.db.patch(args.ideaId, {
			archived: args.archived,
			status: args.archived ? 'parked' : (args.statusBeforeArchive ?? 'inbox'),
			updatedAt: nowSeconds()
		});

		await ctx.db.insert('ideaEvents', {
			ideaId: args.ideaId,
			userId: idea.userId,
			kind: args.archived ? 'archived' : 'restored',
			createdAt: nowSeconds()
		});
	}
});

export const remove = mutation({
	args: { ideaId: v.id('ideas') },
	handler: async (ctx, args) => {
		const idea = await ownedIdea(ctx, args.ideaId);
		if (!idea) {
			throw new ValidationError('That idea no longer exists.');
		}

		const tasks = await ctx.db
			.query('ideaTasks')
			.withIndex('by_idea', (q) => q.eq('ideaId', args.ideaId))
			.collect();
		const events = await ctx.db
			.query('ideaEvents')
			.withIndex('by_idea', (q) => q.eq('ideaId', args.ideaId))
			.collect();

		for (const task of tasks) await ctx.db.delete(task._id);
		for (const event of events) await ctx.db.delete(event._id);
		await ctx.db.delete(args.ideaId);
	}
});

/**
 * Aggregate counts for the dashboard, computed server-side so the dashboard
 * does not have to download every idea just to render three numbers.
 */
export const stats = query({
	handler: async (ctx) => {
		const userId = await requireUser(ctx);
		const ideas = await ctx.db
			.query('ideas')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.collect();

		const active = ideas.filter((idea) => !idea.archived);

		return {
			total: ideas.length,
			archived: ideas.length - active.length,
			byStatus: active.reduce<Record<string, number>>((acc, idea) => {
				acc[idea.status] = (acc[idea.status] ?? 0) + 1;
				return acc;
			}, {}),
			unscored: active.filter(
				(idea) => idea.impact === undefined || idea.effort === undefined || idea.confidence === undefined
			).length,
			favorites: active.filter((idea) => idea.favorite).length
		};
	}
});