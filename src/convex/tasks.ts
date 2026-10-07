import { getAuthUserId } from '@convex-dev/auth/server';
import type { Id } from './_generated/dataModel';
import { mutation, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import { normaliseBody, nowMs, ValidationError } from '../lib/convex/validation';

/**
 * The checklist that turns an idea into action (Week 6).
 *
 * The `ideaTasks` table existed in the schema from the start but had no
 * writer anywhere - a dead, indexed table. These four mutations are what
 * make it live, and what the progress bar reads.
 *
 * Every function proves the caller owns the row before touching it, and
 * `userId` is stored on the task itself so that check is a single get,
 * not a join. Ownership failures are indistinguishable from missing rows,
 * so probing for another user's task id tells an attacker nothing.
 *
 * `position` is assigned server-side. A client-supplied position would
 * let one device shove its own task to the top of another device's
 * list, and would make concurrent adds collide on the same slot.
 */

/** Minimal shape `getAuthUserId` needs; satisfied by mutation ctx. */
type WithAuth = { auth: { getUserIdentity: (token: string) => Promise<unknown> } };

async function requireUser(ctx: WithAuth) {
	const userId = await getAuthUserId(ctx as Parameters<typeof getAuthUserId>[0]);
	if (!userId) {
		throw new ValidationError('You must be signed in.');
	}
	return userId;
}

/**
 * Load a task and prove the caller owns it.
 *
 * Returns `null` - never throws - when the task is missing OR belongs to
 * someone else, so the two cases are indistinguishable to a caller.
 */
async function ownedTask(ctx: MutationCtx, taskId: Id<'ideaTasks'>) {
	const userId = await requireUser(ctx);
	const task = await ctx.db.get(taskId);
	if (!task || task.userId !== userId) return null;
	return task;
}

/**
 * Load an idea and prove the caller owns it, same contract as the
 * `ownedIdea` helper in ideas.ts.
 */
async function ownedIdea(ctx: MutationCtx, ideaId: Id<'ideas'>) {
	const userId = await requireUser(ctx);
	const idea = await ctx.db.get(ideaId);
	if (!idea || idea.userId !== userId) return null;
	return idea;
}

/**
 * Next position in an idea's checklist.
 *
 * A checklist is a personal, handful-sized list, so counting rows is the
 * honest bound here - there is no pagination problem to solve, and
 * `.take()` would silently truncate the count and duplicate positions.
 * Gaps in `position` are fine: only the relative order matters, and the
 * reader sorts by it.
 */
async function nextPosition(ctx: MutationCtx, ideaId: Id<'ideas'>) {
	const rows = await ctx.db
		.query('ideaTasks')
		.withIndex('by_idea', (q) => q.eq('ideaId', ideaId))
		.collect();
	return rows.length;
}

/** Task titles get the same treatment as idea bodies: trimmed, bounded. */
function normaliseTaskTitle(title: string | undefined) {
	const trimmed = normaliseBody(title);
	if (!trimmed) {
		throw new ValidationError('A task needs a title.');
	}
	if (trimmed.length > 200) {
		throw new ValidationError('A task is at most 200 characters.');
	}
	return trimmed;
}

export const addTask = mutation({
	args: { ideaId: v.id('ideas'), title: v.string() },
	handler: async (ctx, args) => {
		const idea = await ownedIdea(ctx, args.ideaId);
		// Identical to "no such idea" on purpose.
		if (!idea) throw new ValidationError('That idea no longer exists.');

		const title = normaliseTaskTitle(args.title);
		const position = await nextPosition(ctx, args.ideaId);

		return await ctx.db.insert('ideaTasks', {
			ideaId: args.ideaId,
			userId: idea.userId,
			title,
			completed: false,
			position,
			createdAt: nowMs()
		});
	}
});

export const updateTask = mutation({
	args: { taskId: v.id('ideaTasks'), title: v.string() },
	handler: async (ctx, args) => {
		const task = await ownedTask(ctx, args.taskId);
		if (!task) throw new ValidationError('That task no longer exists.');

		const title = normaliseTaskTitle(args.title);
		if (title === task.title) return args.taskId;

		await ctx.db.patch(args.taskId, { title });
		return args.taskId;
	}
});

export const toggleTask = mutation({
	args: { taskId: v.id('ideaTasks') },
	handler: async (ctx, args) => {
		const task = await ownedTask(ctx, args.taskId);
		if (!task) throw new ValidationError('That task no longer exists.');

		await ctx.db.patch(args.taskId, { completed: !task.completed });
		return args.taskId;
	}
});

export const removeTask = mutation({
	args: { taskId: v.id('ideaTasks') },
	handler: async (ctx, args) => {
		const task = await ownedTask(ctx, args.taskId);
		if (!task) throw new ValidationError('That task no longer exists.');

		await ctx.db.delete(args.taskId);
		return args.taskId;
	}
});
