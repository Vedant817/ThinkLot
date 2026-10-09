import { getAuthUserId } from '@convex-dev/auth/server';
import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { normaliseBody, normaliseRevisitAt, nowMs, ValidationError } from '../lib/convex/validation';
import {
	DEFAULT_REVISIT_DAYS,
	effectOf,
	validateDecision,
	type Decision
} from '../lib/review';

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

/** Hard ceiling on the scan backing the queue. See .take at the call site. */
const QUEUE_SCAN_LIMIT = 500;

export const queue = query({
	args: {},
	handler: async (ctx) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) throw new Error('You must be signed in.');

		// Bounded scan. This reads whole documents, description and transcript
		// included, so an unbounded `.collect()` is a second route to the 16 MiB
		// per-execution cliff that previously bricked `ideas:list`. A user with more
		// ideas than this gets the oldest portion of their lot reviewed and a
		// truncation flag rather than an error page.
		const ideas = await ctx.db
			.query('ideas')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.take(QUEUE_SCAN_LIMIT);

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
 * Public, because the client calls it. Ownership comes from the verified request
 * identity, never from an argument, so there is no way to snooze somebody else's
 * idea.
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
		// Whole days only. `days: 0.5` was accepted and wrote a sub-day snooze,
		// which is not something anyone means when they click "snooze". Rounding it
		// silently would hide the mistake rather than refuse it, and this value is
		// indexed - junk in it poisons index scans. Anything non-integral is
		// rejected, and the resulting timestamp still goes through
		// normaliseRevisitAt so this path cannot become a second way to write an
		// out-of-range revisitAt if the day cap is ever widened.
		if (!Number.isFinite(args.days) || !Number.isInteger(args.days) || args.days <= 0 || args.days > 365) {
			throw new Error('Snooze must be a whole number of days between 1 and 365.');
		}

		const revisitAt = normaliseRevisitAt(nowMs() + args.days * 24 * 60 * 60 * 1000);

		await ctx.db.patch(args.ideaId, { revisitAt, updatedAt: nowMs() });
		await ctx.db.insert('ideaEvents', {
			ideaId: args.ideaId,
			userId,
			kind: 'snoozed',
			detail: `${args.days} days`,
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
/**
 * Record one of the four review decisions.
 *
 * The rules live in `src/lib/review.ts`, not here, so the web and mobile clients and
 * the server cannot disagree about what "park" does. All this does is apply the effect
 * and write the event.
 *
 * The one rule worth restating at the boundary: `let go` ARCHIVES and never deletes.
 * The idea stays, with its reason. That is the whole difference between an archive you
 * can read a year later and a graveyard.
 */
export const decide = mutation({
	args: {
		ideaId: v.id('ideas'),
		outcome: v.union(
			v.literal('try'),
			v.literal('park'),
			v.literal('letGo'),
			v.literal('skip')
		),
		reason: v.optional(v.string()),
		inDays: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const userId = await getAuthUserId(ctx);
		if (!userId) throw new ValidationError('You must be signed in.');

		const idea = await ctx.db.get(args.ideaId);
		if (!idea || idea.userId !== userId) {
			// Deliberately the same refusal whether the idea does not exist or belongs to
			// someone else: a distinct message would confirm that a given id exists.
			throw new ValidationError('That idea is not yours to decide.');
		}

		const at = nowMs();
		const decision: Decision = {
			outcome: args.outcome,
			reason: args.reason ?? '',
			inDays: args.inDays ?? DEFAULT_REVISIT_DAYS
		};

		// Rejected here, not in the client, so a bad decision cannot be recorded however
		// it arrives. The sentence is the same one the UI shows.
		const problem = validateDecision(decision);
		if (problem) throw new ValidationError(problem);

		const effect = effectOf(decision, at);
		// `narrative` is for the event, not the document - it has no column, and
		// destructuring it out is how the pure function stays able to carry it.
		const { clearLetGo, narrative, ...fields } = effect;

		// A `Record<string, unknown>` patch, for the same reason `ideas:update` uses one.
		// Anything the pure function reported as `null` means CLEAR THIS FIELD, which in
		// Convex is `undefined` - the validator accepts an absent optional field and
		// rejects a literal null. Writing null directly produced:
		//   Value does not match validator. Path: .revisitAt Value: null
		// which surfaced as a Server Error from the `letGo` path only, so the obvious
		// suspect was the reason handling rather than the date.
		const patch: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(fields)) {
			patch[key] = value === null ? undefined : value;
		}
		if (clearLetGo) {
			patch.letGoAt = undefined;
			patch.letGoReason = undefined;
		}
		patch.updatedAt = at;

		await ctx.db.patch(args.ideaId, patch as never);

		await ctx.db.insert('ideaEvents', {
			ideaId: args.ideaId,
			userId,
			// The kind is the DECISION, not "archived": a history read as a series of
			// decisions is what lets someone see how they actually spend attention.
			kind: args.outcome === 'letGo' ? 'letGo' : 'reviewed',
			detail: narrative,
			createdAt: at
		});

		return { ok: true, at, narrative };
	}
});

export const remindDueSnoozes = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = nowMs();

		// A single index range over `revisitAt`, which is exactly why `by_revisit`
		// exists as a separate index from `by_user_revisit` - the latter leads with
		// `userId` and so cannot answer "whose date has passed" at all.
		//
		// Bounded with `.take` because this is a daily cron: unbounded, it would be a
		// full-table scan on a schedule nobody asked for.
		// Convex 1.46's index range builder takes the field name as a plain string
		// argument (`q.lte('revisitAt', now)`) - `q.field(...)` does not exist on it.
		const due = await ctx.db
			.query('ideas')
			.withIndex('by_revisit', (q) => q.lte('revisitAt', now))
			.take(200);

		let reminded = 0;
		for (const idea of due) {
			if (idea.archived) continue;
			if (idea.revisitAt === undefined || idea.revisitAt > now) continue;

			// Bounded and filtered to just reminders. The previous version collected
			// every event for the idea and filtered in JS - an N+1 that re-read a
			// growing row set once per due idea, every single day.
			const reminders = await ctx.db
				.query('ideaEvents')
				.withIndex('by_idea', (q) => q.eq('ideaId', idea._id))
				.filter((q) => q.eq(q.field('kind'), 'reminder'))
				.order('desc')
				.take(1);

			const lastReminder = reminders[0];

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