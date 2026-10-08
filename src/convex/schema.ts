import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * The idea lifecycle, in pipeline order. This ordering is real information:
 * it drives the Kanban column order and the "advance" affordance.
 *
 * `archived` is deliberately NOT a status. It is a boolean flag so an idea can
 * be archived from any stage and restored without losing where it was.
 */
export const IDEA_STATUSES = [
	'inbox',
	'parked',
	'reviewing',
	'ready',
	'building',
	'done'
] as const;

export type IdeaStatus = (typeof IDEA_STATUSES)[number];

const ideaStatus = v.union(
	v.literal('inbox'),
	v.literal('parked'),
	v.literal('reviewing'),
	v.literal('ready'),
	v.literal('building'),
	v.literal('done')
);

/**
 * How an idea entered the lot.
 *
 * - `typed`    — the user typed it
 * - `dictated` — the text arrived from a voice dictation tool (e.g. Wispr Flow)
 *                landing in the capture bar. The raw utterance is kept in
 *                `transcript` so it can be re-parsed later without data loss.
 */
const ideaSource = v.union(v.literal('typed'), v.literal('dictated'));

/** Score inputs are 1..10 integers. Optional until the user bothers to score. */
const score = v.optional(v.number());

const schema = defineSchema({
	...authTables,

	/**
	 * Monotonic per-user counters.
	 *
	 * `ideas.seq` used to be `max(existing seq) + 1`, which is not monotonic: delete
	 * LOT-0003 and the next capture is handed LOT-0003 again. Since the plate is the
	 * app's core conversational primitive ("that was LOT-0003"), two different ideas
	 * sharing a label over time quietly breaks the thing users actually talk about.
	 *
	 * A dedicated counter row only ever increments, so plates are never reused.
	 */
	counters: defineTable({
		userId: v.id('users'),
		key: v.string(),
		value: v.number()
	})
		// One counter row per (user, key); the uniqueness that matters.
		.index('by_user_key', ['userId', 'key']),

	ideas: defineTable({
		userId: v.id('users'),

		/**
		 * Per-user monotonic counter behind the `LOT-0042` plate on every card.
		 * Stable, human-quotable, and independent of timestamps so sorting by it
		 * is a true capture order even when many ideas land in the same second.
		 */
		seq: v.number(),

		title: v.string(),
		description: v.optional(v.string()),
		problem: v.optional(v.string()),

		/**
		 * The three capture fields the product spec asks for and that were
		 * missing: "Who is it for", "Expected outcome" and "Source / trigger".
		 *
		 * These were absent from the schema, the mutations and every screen, and
		 * the roadmap had them ticked off anyway - which is precisely the failure
		 * this comment exists to prevent.
		 *
		 * `source` is NOT one of them: that records whether text arrived by voice,
		 * which is a different question from what prompted the idea.
		 */
		audience: v.optional(v.string()),
		outcome: v.optional(v.string()),
		trigger: v.optional(v.string()),

		status: ideaStatus,
		tags: v.array(v.string()),

		impact: score,
		effort: score,
		confidence: score,

		favorite: v.boolean(),
		archived: v.boolean(),

		/** When the user asked to be reminded about this idea. */
		revisitAt: v.optional(v.number()),

		source: ideaSource,
		/** Raw dictated text, kept verbatim for later re-parsing. */
		transcript: v.optional(v.string()),

		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_user', ['userId'])
		.index('by_user_status', ['userId', 'status'])
		.index('by_user_updated', ['userId', 'updatedAt'])
		.index('by_user_seq', ['userId', 'seq'])
		.index('by_user_revisit', ['userId', 'revisitAt'])
		/**
		 * `by_revisit` leads with `revisitAt` so the reminder cron can ask for
		 * "every idea whose revisit date has passed" as a single index range.
		 * `by_user_revisit` cannot do that job - it leads with `userId`, so it
		 * groups by owner rather than by date.
		 */
		.index('by_revisit', ['revisitAt']),

	ideaTasks: defineTable({
		ideaId: v.id('ideas'),
		userId: v.id('users'),
		title: v.string(),
		completed: v.boolean(),
		position: v.number(),
		createdAt: v.number()
	})
		.index('by_idea', ['ideaId'])
		.index('by_user_idea', ['userId', 'ideaId']),

	/**
	 * Append-only activity log per idea. Backs the idea timeline (backlog item)
	 * and makes the review queue explainable — a user can see *why* an idea
	 * surfaced rather than being told by an opaque rule.
	 */
	ideaEvents: defineTable({
		ideaId: v.id('ideas'),
		userId: v.id('users'),
		kind: v.string(),
		detail: v.optional(v.string()),
		createdAt: v.number()
	})
		.index('by_idea', ['ideaId'])
		.index('by_user_created', ['userId', 'createdAt'])
});

export default schema;