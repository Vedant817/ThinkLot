import { getAuthUserId } from '@convex-dev/auth/server';
import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { normaliseBody, nowMs } from '../lib/convex/validation';

/**
 * The weekly review queue.
 *
 * The whole reason to keep an idea lot is that it surfaces things you have
 * forgotten. A list you have to remember to look at is a list you will not look
 * at, so this computes what deserves attention rather than storing a flag that
 * somebody has to remember to set.
 *
 * Every rule is explainable and returns its `reason`, because a queue that says
 * "review this" with no justification is indistinguishable from noise, and the
 * whole premise of the app is that a thought is worth the trouble of keeping.
 */

export type ReviewReason =
	| 'stale' // untouched for 7+ days
	| 'parked' // explicitly parked, never revisited
	| 'strong' // scores well
	| 'snoozed' // user asked to look back
	| 'untouched_inbox'; // never judged

const STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** Score at or above which an idea is worth a second look on its own. */
const STRONG_SCORE = 24;

/** How many to return. A review you cannot finish is a review you skip. */
const QUEUE_LIMIT = 40;

export const queue = query({
	args: {},
	handler: async (ctx) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) throw new Error('You must be signed in.');

		const ideas = await ctx.db
			.query('ideas')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.collect();

		const now = nowMs();
		const items: {
			idea: typeof ideas[number];
			score: number | null;
			reasons: ReviewReason[];
			oldest: number;
		}[] = [];

		for (const idea of ideas) {
			if (idea.archived) continue;
			if (idea.status === 'done') continue;

			const reasons: ReviewReason[] = [];
			const score = priority(idea);

			if (idea.revisitAt !== undefined && idea.revisitAt <= now) {
				reasons.push('snoozed');
			}

			const idleFor = now - idea.updatedAt;
			if (idleFor >= STALE_MS) reasons.push('stale');
			if (idea.status === 'parked') reasons.push('parked');
			if (score !== null && score >= STRONG_SCORE) reasons.push('strong');
			if (idea.status === 'inbox' && score === null) reasons.push('untouched_inbox');

			if (reasons.length === 0) continue;

			items.push({
				idea,
				score,
				reasons,
				// Oldest activity first: the thing you have neglected longest is the
				// one most likely to be genuinely forgotten.
				oldest: idea.updatedAt
			});
		}

		items.sort((a, b) => a.oldest - b.oldest);

		return {
			items: items.slice(0, QUEUE_LIMIT).map((item) => ({
				id: item.idea._id,
				seq: item.idea.seq,
				title: item.idea.title,
				status: item.idea.status,
				score: item.score,
				reasons: item.reasons,
				updatedAt: item.idea.updatedAt,
				createdAt: item.idea.createdAt
			})),
			total: items.length,
			// Surfaced so the UI can say "showing 40 of 137" rather than silently
			// truncating a list the user is meant to trust.
			truncated: items.length > QUEUE_LIMIT
		};
	}
});

function priority(idea: { impact?: number; effort?: number; confidence?: number }): number | null {
	const { impact, effort, confidence } = idea;
	if (impact === undefined || effort === undefined || confidence === undefined) return null;
	if (!Number.isFinite(impact) || !Number.isFinite(effort) || !Number.isFinite(confidence)) return null;
	if (effort <= 0) return null;
	return (impact * confidence) / effort;
}

/**
 * Put an idea aside and ask to be reminded.
 *
 * Public, because the client calls it. Ownership comes from the verified
 * request identity, never from an argument, so there is no way to snooze
 * somebody else's idea.
 */
export const snooze = mutation({
	args: { ideaId: v.id('ideas'), days: v.number() },
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) throw new Error('You must be signed in.');

		const idea = await ctx.db.get(args.ideaId);
		if (!idea || idea.userId !== userId) {
			// Deliberately identical to the "no such idea" case.
			throw new Error('That idea no longer exists.');
		}
		if (!Number.isFinite(args.days) || args.days <= 0 || args.days > 365) {
			throw new Error('Snooze must be between 1 and 365 days.');
		}

		await ctx.db.patch(args.ideaId, {
			revisitAt: nowMs() + args.days * 24 * 60 * 60 * 1000,
			updatedAt: nowMs()
		});
		await ctx.db.insert('ideaEvents', {
			ideaId: args.ideaId,
			userId,
			kind: 'snoozed',
			detail: `${Math.round(args.days)} days`,
			createdAt: nowMs()
		});

		return args.ideaId;
	}
});

/**
 * Nudge snoozed ideas whose revisit date has arrived.
 *
 * A cron rather than a flag flipped at read time, because the reminder has to
 * survive the app not being open. On a shared backend this is the one piece of
 * genuinely server-driven work; everything else the user triggers themselves.
 *
 * Currently a no-op stub rather than sending email, because there is no mail
 * provider configured and silently pretending to remind someone is worse than
 * not reminding them. The event log it writes is what the in-app reminder will
 * read, so wiring a real channel later changes only this function.
 */
export const remindDueSnoozes = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = nowMs();

		// `by_user_revisit` is an index over `revisitAt`, so this is a bounded
		// range scan rather than a full table walk.
		const due = await ctx.db
			.query('ideas')
			.withIndex('by_user_revisit')
			.collect();

		let reminded = 0;
		for (const idea of due) {
			if (idea.archived) continue;
			if (idea.revisitAt === undefined || idea.revisitAt > now) continue;

			const already = await ctx.db
				.query('ideaEvents')
				.withIndex('by_idea', (q) => q.eq('ideaId', idea._id))
				.collect();

			const lastReminder = already
				.filter((e) => e.kind === 'reminder')
				.sort((a, b) => b.createdAt - a.createdAt)[0];

			// Do not re-remind about the same date every day.
			if (lastReminder && lastReminder.createdAt >= idea.revisitAt) continue;

			await ctx.db.insert('ideaEvents', {
				ideaId: idea._id,
				userId: idea.userId,
				kind: 'reminder',
				detail: normaliseBody(`Revisit was due ${new Date(idea.revisitAt).toISOString()}`),
				createdAt: now
			});
			reminded++;
		}

		return { reminded, scanned: due.length };
	}
});