import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { v } from 'convex/values';
import { relatedIdeas } from '../lib/clustering';
import {
	normaliseBody,
	normaliseScore,
	normaliseTags,
	normaliseTitle,
	normaliseRevisitAt,
	nowMs,
	TITLE_MAX,
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
 * Next `LOT-####` number for this user, from a counter that only ever increments.
 *
 * The previous version read `max(existing seq) + 1`, which handed the same plate
 * back out after a deletion. It also made every concurrent capture contend on the
 * same "highest idea" document, which under load exhausted the OCC retry budget
 * and dropped writes (measured: 7 of 48 concurrent captures returned HTTP 503).
 *
 * ## Why this does not use `.unique()`
 *
 * `counters` has an index but no uniqueness constraint. Two concurrent FIRST
 * captures for a new user can both miss the "already exists" branch and both
 * insert a row - an index range read does not conflict with a concurrent insert,
 * so OCC does not reliably catch it. If this function then called `.unique()`,
 * the duplicate would make it throw *permanently*, and that user could never
 * capture an idea again. A silent permanent brick from a race is far worse than a
 * duplicated counter row.
 *
 * So instead: read all rows for the key, keep the highest, delete the rest, and
 * increment. That is self-healing - duplicates get folded back together on the
 * next capture rather than poisoning the function forever.
 */
async function nextSeq(ctx: MutationCtx, userId: Id<'users'>) {
	const rows = await ctx.db
		.query('counters')
		.withIndex('by_user_key', (q) => q.eq('userId', userId).eq('key', 'idea_seq'))
		.collect();

	if (rows.length > 0) {
		let keep = rows[0];
		for (const row of rows) {
			if (row.value > keep.value) keep = row;
		}
		// Consolidate any duplicates. Cheap, and only ever runs when there is
		// something to consolidate.
		for (const row of rows) {
			if (row._id !== keep._id) await ctx.db.delete(row._id);
		}
		const next = keep.value + 1;
		await ctx.db.patch(keep._id, { value: next });
		return next;
	}

	await ctx.db.insert('counters', { userId, key: 'idea_seq', value: 1 });
	return 1;
}

/**
 * Projection returned by list queries.
 *
 * `description` and `transcript` are deliberately excluded. Both are capped at
 * 20 000 characters server-side, so returning them from the list query meant a
 * lot of 400 real ideas read ~16 MB and hit Convex's hard 16 MiB per-execution
 * limit - at which point `list`, `stats` and the whole UI bricked permanently,
 * with no delete affordance to recover from. The list now carries a short
 * preview; full bodies are fetched one at a time by `get`.
 */
type IdeaSummary = {
	_id: string;
	seq: number;
	title: string;
	status: string;
	tags: string[];
	impact?: number;
	effort?: number;
	confidence?: number;
	favorite: boolean;
	archived: boolean;
	source: string;
	revisitAt?: number;
	createdAt: number;
	updatedAt: number;
	preview?: string;
};

function toSummary(idea: Doc<'ideas'>): IdeaSummary {
	return {
		_id: idea._id,
		seq: idea.seq,
		title: idea.title,
		status: idea.status,
		tags: idea.tags,
		impact: idea.impact,
		effort: idea.effort,
		confidence: idea.confidence,
		favorite: idea.favorite,
		archived: idea.archived,
		source: idea.source,
		revisitAt: idea.revisitAt,
		/**
		 * The trigger is carried into the list so a card can say what prompted the
		 * idea without a second fetch. Audience and outcome are not: they are long
		 * free text, and the list is capped - shipping them here would multiply
		 * response bytes for content only the detail page shows.
		 */
		...(idea.trigger ? { trigger: idea.trigger } : {}),
		createdAt: idea.createdAt,
		updatedAt: idea.updatedAt,
		...(idea.description ? { preview: idea.description.slice(0, 160) } : {})
	};
}

/** Hard ceiling on a single list response. See `toSummary` for why. */
const LIST_LIMIT = 250;

/**
 * `(impact × confidence) ÷ effort`, or -1 when unscored.
 *
 * Shared by the list's two sort paths so the fast path and the scan path cannot
 * disagree about what "high priority" means - which is the kind of divergence that
 * makes a ranking change depending on whether a filter happened to be set.
 */
function priorityOf(idea: Doc<'ideas'>): number {
	if (idea.impact === undefined || idea.effort === undefined || idea.confidence === undefined) return -1;
	if (idea.effort <= 0) return -1;
	return (idea.impact * idea.confidence) / idea.effort;
}

/**
 * Hard ceiling on the scan backing `stats`.
 *
 * `stats` reads whole documents, description and transcript included, so an
 * unbounded scan is a second route to the 16 MiB per-execution cliff that
 * permanently bricked the app once already.
 */
const STATS_SCAN_LIMIT = 1000;

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
		archivedOnly: v.optional(v.boolean()),
		favoriteOnly: v.optional(v.boolean()),
		sortPriority: v.optional(v.boolean()),
		tags: v.optional(v.array(v.string())),
		/**
		 * Server-side text match over title, description and tags.
		 *
		 * This exists because the list caps at 250 rows while search previously ran
		 * in the browser over those 250. Past the cap an older idea was not just
		 * missing from a search result - it was unreachable, because the client had
		 * no way to obtain its id to open or delete it. Searching must therefore
		 * happen before the slice, not after it.
		 */
		search: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const userId = await requireUser(ctx);

		const cap = Math.min(Math.max(args.limit ?? LIST_LIMIT, 1), LIST_LIMIT);
		const includeArchived = args.includeArchived ?? false;
		const needle = args.search?.trim().toLowerCase();

		/**
		 * Which filters force a full read of the user's rows.
		 *
		 * `archived` and `status` are index fields, so they narrow the read in the
		 * database. `favorite`, tags and free text are not indexed - a substring
		 * match over six text columns cannot be - so when any of those are present
		 * the whole candidate set still has to be read to know the true `total`.
		 *
		 * This distinction is the whole optimisation: when nothing needs a scan, we
		 * stop after `cap + 1` rows instead of reading everything the user has ever
		 * parked, so opening the lot costs the page rather than the history.
		 */
		const needsScan = Boolean(needle) || args.favoriteOnly === true || Boolean(args.tags?.length);

		/**
		 * The read, with the archive and stage filters pushed into the index range
		 * where possible.
		 *
		 * `newestFirst` matters and is not cosmetic. Convex 1.46 cannot read an index
		 * range backwards - `q.order('desc')` is missing from the range object at
		 * runtime and `.reverse()` is missing from the type and the runtime query, both
		 * of which shipped past `svelte-check` before failing live. So the newest-first
		 * order comes from an inverted key, `seqDesc = -seq`, indexed as
		 * `(userId, archived, seqDesc)`: ascending there means descending in `seq`.
		 */
		const base = (newestFirst: boolean) => {
			if (args.status) {
				return ctx.db
					.query('ideas')
					.withIndex('by_user_status', (q) => q.eq('userId', userId).eq('status', args.status!));
			}
			if (args.archivedOnly) {
				return ctx.db
					.query('ideas')
					.withIndex('by_user_archived', (q) => q.eq('userId', userId).eq('archived', true));
			}
			if (!includeArchived) {
				// The default path, and the one the lot uses: an index range that
				// returns exactly the active ideas, newest first, and nothing else.
				return ctx.db
					.query('ideas')
					.withIndex('by_user_archived_seq', (q) => q.eq('userId', userId).eq('archived', false));
			}
			return ctx.db.query('ideas').withIndex('by_user_seq', (q) => q.eq('userId', userId));
		};

		if (!needsScan && !args.status) {
			// One extra row, so `truncated` is exact without counting anything.
			const page: Doc<'ideas'>[] = await base(true).take(cap + 1);

			let out = page;
			if (args.sortPriority) {
				// A priority ranking cannot come from a `seq` index, so this path does
				// still sort - but over at most `cap + 1` rows rather than over every
				// idea the user owns.
				out = [...page].sort((a, b) => priorityOf(b) - priorityOf(a) || b.seq - a.seq);
			}
			// `total` is the page size when the cap was reached, because the real total
			// is unknowable without the scan this path exists to avoid. It is only read
			// to decide whether to say "showing N of M", and when it is wrong `truncated`
			// is already true, so what the user sees is an honest "at least this many".
			return {
				ideas: out.slice(0, cap).map(toSummary),
				truncated: page.length > cap,
				total: page.length > cap ? cap + 1 : page.length
			};
		}

		const rows: Doc<'ideas'>[] = await base(false).collect();

		let out = args.archivedOnly
			? rows
			: includeArchived
				? rows
				: rows.filter((idea) => !idea.archived);
		if (args.favoriteOnly) out = out.filter((idea) => idea.favorite);

		if (args.tags?.length) {
			const wanted = new Set(args.tags.map((t) => t.toLowerCase()));
			out = out.filter((idea) => idea.tags.some((t) => wanted.has(t)));
		}

		// Applied BEFORE the cap, so a search can reach ideas the cap would hide.
		if (needle) {
			out = out.filter(
				(idea) =>
					idea.title.toLowerCase().includes(needle) ||
					(idea.description ?? '').toLowerCase().includes(needle) ||
					(idea.problem ?? '').toLowerCase().includes(needle) ||
					(idea.audience ?? '').toLowerCase().includes(needle) ||
					(idea.outcome ?? '').toLowerCase().includes(needle) ||
					(idea.trigger ?? '').toLowerCase().includes(needle) ||
					idea.tags.some((t) => t.includes(needle))
			);
		}

		out.sort((a, b) => b.seq - a.seq);
		if (args.sortPriority) {
			out.sort((a, b) => priorityOf(b) - priorityOf(a) || b.seq - a.seq);
		}

		return {
			ideas: out.slice(0, cap).map(toSummary),
			truncated: out.length > cap,
			total: out.length
		};
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

		/**
		 * The idea's history, newest first - spec section 8's "idea timeline".
		 *
		 * `ideaEvents` has been written on every capture, status move, archive and
		 * snooze since before this feature existed, and the only thing that ever read
		 * it was the delete cascade. So the data was already correct and complete;
		 * nobody could see it.
		 *
		 * Served from `get` rather than as its own query on purpose: the detail page
		 * already subscribes here, so a separate subscription would be a second
		 * WebSocket message per change for data that always arrives together.
		 *
		 * Capped, newest first, because a timeline nobody scrolls to the end of is
		 * not a timeline. Old entries are not deleted - they simply fall off, so a
		 * long-lived idea loses its early history from view rather than from the
		 * database.
		 */
		const raw = await ctx.db
			.query('ideaEvents')
			.withIndex('by_idea', (q) => q.eq('ideaId', idea._id))
			.collect();

		const events = raw
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, TIMELINE_LIMIT)
			.map((event) => ({
				id: event._id,
				kind: event.kind,
				detail: event.detail ?? null,
				createdAt: event.createdAt
			}));

		/**
		 * Related ideas, computed here rather than in the browser.
		 *
		 * The clustering needs the whole lot to judge whether a shared tag is
		 * informative or just common, so it cannot be derived from what one detail
		 * page happens to hold. Doing it server-side keeps the response at five rows
		 * instead of shipping the entire lot to every detail page for a panel most
		 * people scroll past.
		 */
		const siblingRows = await ctx.db
			.query('ideas')
			.withIndex('by_user_archived', (q) => q.eq('userId', idea.userId).eq('archived', false))
			.take(RELATED_SCAN_LIMIT);

		const neighbours = relatedIdeas(idea, siblingRows, RELATED_LIMIT).map(({ idea: other, via }) => ({
			...toSummary(other),
			via
		}));

		return {
			idea,
			tasks: tasks.sort((a, b) => a.position - b.position),
			events,
			related: neighbours
		};
	}
});

/** How many active ideas the related-ideas computation looks at. */
const RELATED_SCAN_LIMIT = 250;

/** How many neighbours one idea shows. Five is a panel, not a search result. */
const RELATED_LIMIT = 5;

/**
 * How much history one idea's timeline shows.
 *
 * Fifty is roughly a year of weekly reviews for a single idea, which is past the
 * point where anybody scrolls further.
 */
const TIMELINE_LIMIT = 50;

/**
 * The capture path. Deliberately tiny: a title is the only required input, so
 * a thought can land before the user has decided what it is.
 */
export const capture = mutation({
	args: {
		title: v.string(),
		description: v.optional(v.string()),
		problem: v.optional(v.string()),
		/**
		 * The spec's "Who is it for", "Expected outcome" and "Source / trigger".
		 * Optional on capture because the whole premise is capturing in 30 seconds
		 * without judging - these are filled in later, or never.
		 */
		audience: v.optional(v.string()),
		outcome: v.optional(v.string()),
		trigger: v.optional(v.string()),
		source: v.optional(v.union(v.literal('typed'), v.literal('dictated'))),
		transcript: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const userId = await requireUser(ctx);

		/**
		 * Over-long input is split here rather than rejected.
		 *
		 * `normaliseTitle` caps a title at 300 characters, and that cap is right -
		 * a title is a label, and a 9,000-character one cannot be listed or
		 * scanned. But the client's `parseCapture` already splits a long dictated
		 * blob into title + description, so the app works while the raw API does
		 * not. That asymmetry is a trap: it works in the browser and fails the
		 * moment a second client speaks to the same endpoint, which is exactly
		 * what a mobile app is.
		 *
		 * So the invariant lives on the server: nothing the user typed is ever
		 * thrown away. Whatever does not fit the title is appended to the
		 * description instead.
		 */
		const rawTitle = (args.title ?? '').trim();
		const incomingBody = normaliseBody(args.description) ?? '';

		let title = rawTitle;
		let description = incomingBody;

		if (title.length > TITLE_MAX) {
			const overflow = title.slice(TITLE_MAX);
			title = normaliseTitle(title.slice(0, TITLE_MAX)) ?? overflow.slice(0, TITLE_MAX);
			description = description ? `${description}\n\n${overflow}` : overflow;
		}

		const cleanTitle = normaliseTitle(title);
		if (!cleanTitle) {
			throw new ValidationError('An idea needs a title.');
		}

		const seq = await nextSeq(ctx, userId);
		const timestamp = nowMs();

		const ideaId = await ctx.db.insert('ideas', {
			userId,
			seq,
			// `-seq` so an ascending `(userId, archived, seqDesc)` index range is
			// newest-first. Set here, in the only place `seq` is assigned, so the
			// inverted key cannot drift from the sequence it mirrors.
			seqDesc: -seq,
			title: cleanTitle,
			description: normaliseBody(description),
			problem: normaliseBody(args.problem),
			audience: normaliseBody(args.audience),
			outcome: normaliseBody(args.outcome),
			trigger: normaliseBody(args.trigger),
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
		/**
		 * The update contract, uniformly: OMIT a field to leave it alone, send
		 * `null` to CLEAR it, send a value to set it.
		 *
		 * `undefined` cannot express "clear" - Convex's `convexToJson` drops keys
		 * whose value is undefined before the request leaves the browser, so the
		 * handler's `if ('description' in args)` would never be true. Without an
		 * explicit null, a field could be set but never unset.
		 *
		 * `title` is deliberately NOT nullable. An idea with no title cannot be
		 * listed, searched or quoted, so "Title cannot be empty" is the correct
		 * refusal rather than a gap in the contract.
		 */
		title: v.optional(v.string()),
		description: v.optional(v.union(v.string(), v.null())),
		problem: v.optional(v.union(v.string(), v.null())),
		/**
		 * Spec fields. `null` clears, omitting leaves alone - the same contract as
		 * every other optional field here.
		 */
		audience: v.optional(v.union(v.string(), v.null())),
		outcome: v.optional(v.union(v.string(), v.null())),
		trigger: v.optional(v.union(v.string(), v.null())),
		tags: v.optional(v.union(v.array(v.string()), v.null())),

		/**
		 * Append / remove one tag, computed from CURRENT server state.
		 *
		 * The client used to send a whole new tags array built from its own
		 * possibly-stale copy. Clicking a tag's `x` blurs the input first, which
		 * fired `addTag` with `[...idea.tags, newTag]` and then `removeTag` with
		 * `idea.tags.filter(...)` built from the same stale `idea` - so the second
		 * patch overwrote the first and the newly added tag was silently lost.
		 *
		 * Expressing the intent rather than the result removes the race: each
		 * mutation reads current tags and applies one change, and Convex's OCC
		 * retries the loser of a genuine concurrent write.
		 */
		addTag: v.optional(v.string()),
		removeTag: v.optional(v.string()),
		/**
		 * `null` clears a score. `undefined` cannot: Convex's `convexToJson` drops
		 * object keys whose value is undefined BEFORE the request is sent, so
		 * `'impact' in args` would never be true server-side and an idea could be
		 * scored but never returned to unscored. This mirrors how `revisitAt`
		 * already expresses "clear me".
		 */
		impact: v.optional(v.union(v.number(), v.null())),
		effort: v.optional(v.union(v.number(), v.null())),
		confidence: v.optional(v.union(v.number(), v.null())),
		revisitAt: v.optional(v.union(v.number(), v.null()))
	},
	handler: async (ctx, args) => {
		const idea = await ownedIdea(ctx, args.ideaId);
		if (!idea) {
			throw new ValidationError('That idea no longer exists.');
		}

		const patch: Record<string, unknown> = { updatedAt: nowMs() };

		const title = normaliseTitle(args.title);
		if (title !== undefined) patch.title = title;

		// `normaliseBody(null)` returns undefined and `patch` removes a field set to
		// undefined, so an explicit null clears the body.
		if ('description' in args) patch.description = normaliseBody(args.description);
		if ('problem' in args) patch.problem = normaliseBody(args.problem);

		if ('audience' in args) patch.audience = normaliseBody(args.audience);
		if ('outcome' in args) patch.outcome = normaliseBody(args.outcome);
		if ('trigger' in args) patch.trigger = normaliseBody(args.trigger);

		// Tags need their own null branch. `normaliseTags(null)` returns undefined,
		// which this handler treats as "no change" - so sending null would be a
		// silent no-op. `tags` is a required column, so clearing it means [].
		if (args.tags === null) {
			patch.tags = [];
		} else {
			const tags = normaliseTags(args.tags);
			if (tags !== undefined) patch.tags = tags;
		}

		// Single-tag edits are resolved against the CURRENT stored tags, not
		// against anything the caller sent. See the arg docs for why.
		if (args.addTag !== undefined) {
			const added = normaliseTags([args.addTag]);
			if (added && added.length) {
				const merged = [...idea.tags];
				for (const tag of added) if (!merged.includes(tag)) merged.push(tag);
				patch.tags = normaliseTags(merged);
			}
		}
		if (args.removeTag !== undefined) {
			const target = normaliseTags([args.removeTag])?.[0];
			if (target) patch.tags = idea.tags.filter((t) => t !== target);
		}

		// `normaliseScore(null)` returns undefined, and `patch` removes a field set
		// to undefined - so passing null CLEARS a score instead of writing a bad
		// one. The `in` checks are load-bearing: omitting a field leaves it alone.
		if ('impact' in args) patch.impact = normaliseScore(args.impact, 'Impact');
		if ('effort' in args) patch.effort = normaliseScore(args.effort, 'Effort');
		if ('confidence' in args) {
			patch.confidence = normaliseScore(args.confidence, 'Confidence');
		}

		// Was previously passed through unvalidated, so -1e308 and 0.5 both persisted.
		// The field is indexed by by_user_revisit, so junk here poisons index scans.
		if ('revisitAt' in args) patch.revisitAt = normaliseRevisitAt(args.revisitAt);

		await ctx.db.patch(args.ideaId, patch);

		/**
		 * Record the moment an idea became judged, or stopped being judged.
		 *
		 * Scoring was the one milestone the timeline could not see: capture, stage
		 * moves, archiving and snoozes all wrote an event, and the single most
		 * important transition in the lifecycle - "this is now a decision" - left no
		 * trace at all.
		 *
		 * Recorded only when the judged/unscored state actually FLIPS, not on every
		 * slider drag. The score inputs commit on change, so a user nudging impact
		 * from 7 to 8 would otherwise write an event per nudge and bury the real
		 * milestone in noise.
		 */
		const wasJudged = priorityOf(idea) >= 0;
		const isJudged = priorityOf({ ...idea, ...patch } as Doc<'ideas'>) >= 0;
		if (wasJudged !== isJudged) {
			const score = priorityOf({ ...idea, ...patch } as Doc<'ideas'>);
			await ctx.db.insert('ideaEvents', {
				ideaId: args.ideaId,
				userId: idea.userId,
				kind: isJudged ? 'scored' : 'unscored',
				detail: isJudged ? score.toFixed(1) : undefined,
				createdAt: nowMs()
			});
		}

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

		await ctx.db.patch(args.ideaId, { status: args.status, updatedAt: nowMs() });
		await ctx.db.insert('ideaEvents', {
			ideaId: args.ideaId,
			userId: idea.userId,
			kind: 'status',
			detail: `${idea.status} → ${args.status}`,
			createdAt: nowMs()
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
			updatedAt: nowMs()
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
			updatedAt: nowMs()
		});

		await ctx.db.insert('ideaEvents', {
			ideaId: args.ideaId,
			userId: idea.userId,
			kind: args.archived ? 'archived' : 'restored',
			createdAt: nowMs()
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
	// `stats` was the only function declared without an `args` validator, so unlike
	// every sibling it silently accepted and ignored anything:
	//   ideas:stats { "anything": "here", "__proto__": 1 }  ->  success
	// Harmless today, but it removes the guard that rejects unknown fields
	// everywhere else, which is a footgun the day a real arg is added here.
	args: {},
	handler: async (ctx) => {
		const userId = await requireUser(ctx);
		const ideas = await ctx.db
			.query('ideas')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.take(STATS_SCAN_LIMIT);

		const active = ideas.filter((idea) => !idea.archived);

		return {
			total: ideas.length,
			/**
			 * How many ideas are actually IN the lot, i.e. excluding archived.
			 *
			 * `total` counts archived ideas, while byStatus / unscored / favorites
			 * below count active ones only. That is defensible per-field but it
			 * made the dashboard say "12 ideas parked" directly above a pipeline
			 * that added up to 10, with nothing on screen to reconcile the two.
			 * Rather than change `total` - which other screens already read, and
			 * which legitimately means "every idea I have ever parked" - the
			 * number the label "parked" actually refers to is now explicit.
			 */
			active: active.length,
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
