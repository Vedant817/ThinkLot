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

	/**
	 * Failed-attempt budget for the sign-in proxy, keyed on a hash of the address.
	 *
	 * This exists because `@convex-dev/auth`'s own limiter keys on the ACCOUNT ID,
	 * and there is no account row for an address that was never registered - so
	 * guesses against unknown addresses were completely unthrottled. That is what
	 * made bulk enumeration cheap, and no configuration of the library can change
	 * it.
	 *
	 * Keyed on a SHA-256 of the normalised address rather than the address itself:
	 * this table is about "how many guesses against this mailbox", and storing the
	 * plaintext would duplicate every account address into a table that outlives
	 * account deletion.
	 *
	 * `windowStart` is a timestamp, not a counter, so the window cannot drift and a
	 * record always expires on its own.
	 */
	authAttempts: defineTable({
		/** `sha256(normalised email) + ':' + flow`. Never the address itself. */
		key: v.string(),
		flow: v.string(),
		/** Attempts inside the current window. Reset when the window rolls over. */
		count: v.number(),
		windowStart: v.number()
	})
		// The proxy looks a budget up by key alone, always.
		.index('by_key', ['key']),

	ideas: defineTable({
		userId: v.id('users'),

		/**
		 * Per-user monotonic counter behind the `LOT-0042` plate on every card.
		 * Stable, human-quotable, and independent of timestamps so sorting by it
		 * is a true capture order even when many ideas land in the same second.
		 */
		seq: v.number(),
		/**
		 * `-seq`, so an ascending index range is newest-first.
		 *
		 * Optional rather than required because documents written before this field
		 * existed do not have it, and making it required would refuse every one of
		 * them. The list falls back to sorting by `seq` when it is missing.
		 */
		seqDesc: v.optional(v.number()),

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
		 * `archived` as an index field rather than a post-filter.
		 *
		 * The archive flag is a boolean on every row and used to be applied in
		 * JavaScript AFTER `.collect()` had already pulled every idea the user owns.
		 * That made the most common request in the app - open the lot - read the
		 * entire table before discarding the archived rows, so cost grew with total
		 * history instead of with the page being shown. An index range on
		 * `(userId, archived)` returns exactly the active set, or exactly the
		 * archived set, and costs what the page costs.
		 *
		 * Added because `list` filters on this flag on every single call. The other
		 * filters here - favorites, tags, free text - cannot be indexed and still
		 * need a scan, which is why the handler caps early where it can rather than
		 * pretending the whole problem is solved.
		 */
		.index('by_user_archived', ['userId', 'archived'])
		/**
		 * `by_revisit` leads with `revisitAt` so the reminder cron can ask for
		 * "every idea whose revisit date has passed" as a single index range.
		 * `by_user_revisit` cannot do that job - it leads with `userId`, so it
		 * groups by owner rather than by date.
		 */
		.index('by_revisit', ['revisitAt'])
		/**
		 * Newest-first ordering for the hot path: `(userId, archived, seqDesc)`.
		 *
		 * `seqDesc` is `-seq`, so ascending index order IS newest-first. That looks
		 * redundant until you know Convex 1.46 cannot read an index range backwards:
		 * `q.order('desc')` is missing from the range object at runtime, and
		 * `.reverse()` is missing from the type and from the runtime query. Both were
		 * tried; both passed `svelte-check` and failed live.
		 *
		 * Without this, "open the lot" had to read every active idea and sort them,
		 * because the newest N cannot be taken from the far end of an ascending
		 * range. Cost grew with total history rather than with the page on screen.
		 * With it, `take(cap + 1)` returns exactly the newest `cap + 1`, and archived
		 * rows are excluded by the index rather than filtered in JavaScript.
		 *
		 * One inverted number per document is a cheap price for removing the growth
		 * term, and it is written in the only place `seq` is written - `capture - so
		 * the two cannot drift apart.
		 */
		.index('by_user_archived_seq', ['userId', 'archived', 'seqDesc']),

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
