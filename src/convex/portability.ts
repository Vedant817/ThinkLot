/**
 * Getting a whole lot out, and a batch in.
 *
 * Separate from `ideas.ts` because these are the only two functions here that are not
 * about a single idea, and both are deliberately bounded and deliberate about what they
 * report.
 *
 * ## Export includes ARCHIVED ideas
 *
 * `ideas:list` excludes them, which is correct for a working list and wrong for a
 * backup. Someone who exports believing they have everything, then loses an idea they
 * archived eight months ago, has been worse off than if no export existed. So this reads
 * both, and the count is reported rather than implied.
 *
 * ## Import is bounded, deduplicated by report, and never pre-decides
 *
 * One call creates at most `IMPORT_LIMIT` ideas, because a 3000-note import in a single
 * transaction is how a mutation blows its limits - and how a user ends up with a second
 * unreadable flood. The remainder is returned so the caller can drive the rest as a
 * sequence of small verified steps.
 *
 * Three deliberate choices:
 *
 * - Duplicates are REPORTED, not silently skipped and not silently added. Both
 *   automatic answers lose something: skipping loses a genuine idea, adding loses the
 *   user's ability to see what they already have.
 * - Imported ideas always land in `inbox`, never in their exported status. An idea
 *   restored from a backup has not been re-decided, and pre-setting a status quietly
 *   asserts a judgement the user has not made in this app.
 * - Every import writes an event, so the timeline shows a restore happened rather than
 *   ideas appearing from nowhere.
 */

import { v } from 'convex/values';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { getAuthUserId } from '@convex-dev/auth/server';
import { normaliseBody, normaliseTags, normaliseTitle, nowMs, ValidationError } from '../lib/convex/validation';
import { titleSimilarity } from '../lib/duplicates';

/**
 * Most ideas one import call may create.
 *
 * Sized to sit well inside a Convex transaction while still being a useful chunk of a
 * large vault. A 3000-note Obsidian import is therefore several calls, each of which can
 * fail on its own without stranding the ones before it.
 */
export const IMPORT_LIMIT = 200;

/**
 * Export cap.
 *
 * A personal backlog by a wide margin, and still a real number rather than "everything":
 * `truncated` is returned so a capped export can never be mistaken for a whole one.
 */
const EXPORT_LIMIT = 2000;

/** Task rows read for one export. Above EXPORT_LIMIT, since an idea may have many. */
const EXPORT_TASK_LIMIT = 8000;

/** Existing titles consulted for duplicate reporting. Bounded for the same reason. */
const IMPORT_DUPE_SCAN_LIMIT = 500;

type AuthCtx = QueryCtx | MutationCtx;

async function requireUser(ctx: AuthCtx) {
	const userId = await getAuthUserId(ctx as Parameters<typeof getAuthUserId>[0]);
	if (!userId) throw new ValidationError('You must be signed in.');
	return userId;
}

type IdeaRow = {
	_id: unknown;
	seq: number;
	title: string;
	status: string;
	tags: string[];
	impact?: number;
	effort?: number;
	confidence?: number;
	favorite: boolean;
	archived: boolean;
	description?: string;
	problem?: string;
	audience?: string;
	outcome?: string;
	trigger?: string;
	transcript?: string;
	revisitAt?: number;
	createdAt: number;
	updatedAt: number;
};

type TaskRow = { ideaId: string; title: string; completed: boolean; position: number };

/**
 * Every idea the signed-in user owns, archived included, with checklists.
 *
 * Tasks are read once by user rather than per idea. Fetching them per idea would be an
 * N+1 of up to 2000 queries; one bounded read grouped in memory is the same answer for
 * a single pass. An export that returned ideas without their checklists would be a
 * summary, not a backup.
 */
export const exportAll = query({
	args: {},
	handler: async (ctx) => {
		const userId = await requireUser(ctx);

		const rows = (await ctx.db
			.query('ideas')
			.withIndex('by_user_archived', (q) => q.eq('userId', userId))
			.take(EXPORT_LIMIT)) as Doc<'ideas'>[];

		const wanted = new Set(rows.map((row) => String(row._id)));

		const taskRows = (await ctx.db
			.query('ideaTasks')
			.withIndex('by_user_idea', (q) => q.eq('userId', userId))
			.take(EXPORT_TASK_LIMIT)) as Doc<'ideaTasks'>[];

		// Grouped in the order rows come back, which the `by_user_idea` index guarantees
		// is `position` order per idea - the user's own arrangement. Sorting these
		// alphabetically would misrepresent work in progress.
		const ordered = new Map<string, { title: string; completed: boolean }[]>();
		for (const task of taskRows) {
			if (!wanted.has(task.ideaId)) continue;
			const list = ordered.get(task.ideaId);
			if (list) list.push({ title: task.title, completed: task.completed });
			else ordered.set(task.ideaId, [{ title: task.title, completed: task.completed }]);
		}

		const ideas = rows.map((row) => ({
			_id: String(row._id),
			seq: row.seq,
			title: row.title,
			status: row.status as never,
			tags: row.tags,
			impact: row.impact,
			effort: row.effort,
			confidence: row.confidence,
			favorite: row.favorite,
			archived: row.archived,
			description: row.description,
			problem: row.problem,
			audience: row.audience,
			outcome: row.outcome,
			trigger: row.trigger,
			transcript: row.transcript,
			revisitAt: row.revisitAt,
			// How the text arrived. Dropped from the first version of this mapping, which
			// made an export silently unable to tell a dictated idea from a typed one - and
			// a backup that loses which of the two it was cannot be re-parsed as faithfully
			// as it claims.
			source: row.source,
			// The abandonment decision and its reason. The reason is the single most valuable
			// field the review feature produces - it is what makes an archive readable a
			// year later - and it was absent from every export, so a restored lot looked
			// like ideas with unexplained disappearances.
			letGoAt: row.letGoAt,
			letGoReason: row.letGoReason,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			tasks: ordered.get(String(row._id)) ?? []
		}));

		return {
			ideas,
			truncated: rows.length === EXPORT_LIMIT,
			taskTruncated: taskRows.length === EXPORT_TASK_LIMIT,
			exportedAt: nowMs(),
			archivedCount: ideas.filter((i) => i.archived).length,
			taskCount: [...ordered.values()].reduce((sum, list) => sum + list.length, 0)
		};
	}
});

export const importMany = mutation({
	args: {
		entries: v.array(
			v.object({
				title: v.string(),
				description: v.optional(v.string()),
				problem: v.optional(v.string()),
				audience: v.optional(v.string()),
				outcome: v.optional(v.string()),
				trigger: v.optional(v.string()),
				transcript: v.optional(v.string()),
				tags: v.optional(v.array(v.string())),
				// Restoration fields, present only when the entry came from a backup. They
				// are read as DATA rather than re-derived, because a backup is not a
				// judgement to be repeated - it is a record of one already made.
				revisitAt: v.optional(v.number()),
				source: v.optional(v.string()),
				letGoAt: v.optional(v.number()),
				letGoReason: v.optional(v.string())
			})
		)
	},
	handler: async (ctx, args) => {
		const userId = await requireUser(ctx);

		if (args.entries.length === 0) {
			return { imported: 0, importedIds: [] as string[], skipped: [], remaining: 0 };
		}

		const existing = (await ctx.db
			.query('ideas')
			.withIndex('by_user_archived', (q) => q.eq('userId', userId))
			.take(IMPORT_DUPE_SCAN_LIMIT)) as Doc<'ideas'>[];

		const known = existing.map((row) => ({ _id: String(row._id), title: row.title }));

		// One monotonic counter, shared with capture. LOT plates are never reused, and an
		// import with its own numbering would collide with later captures.
		const counterRows = (await ctx.db
			.query('counters')
			.withIndex('by_user_key', (q) => q.eq('userId', userId).eq('key', 'idea_seq'))
			.take(1)) as Doc<'counters'>[];
		const counter = counterRows[0];

		let seq = counter?.value ?? 0;

		const imported: string[] = [];
		const skipped: { title: string; reason: string }[] = [];

		for (const entry of args.entries.slice(0, IMPORT_LIMIT)) {
			const title = normaliseTitle(entry.title);
			if (!title) {
				skipped.push({ title: String(entry.title ?? '').slice(0, 60), reason: 'no title to import' });
				continue;
			}

			// Exact title match, or a near-identical one. `titleSimilarity` rather than
			// fuzzy tags: this is the same "is this the same sentence" question clustering
			// already answers, and tags are deliberately not evidence.
			const collision = known.find(
				(candidate) =>
					candidate.title.toLowerCase() === title.toLowerCase() || titleSimilarity(candidate.title, title) >= 0.85
			);
			if (collision) {
				skipped.push({ title, reason: `looks like an existing idea: "${collision.title}"` });
				continue;
			}

		/*
		 * A BACKUP restores the decision it recorded; a foreign import does not.
		 *
		 * The distinction is `letGoAt` being present, which only a backup of this
		 * app's own export carries. So restoring an idea you decided against puts it
		 * back WITH its reason - the whole point of the field - while importing 300
		 * Obsidian notes cannot accidentally create 300 archived ideas with invented
		 * reasons.
		 *
		 * A separate record rather than a union spread, because Convex's insert type
		 * rejects a union of field sets.
		 */
		const restoration: Record<string, unknown> = {};
		if (entry.letGoAt) {
			restoration.letGoAt = entry.letGoAt;
			if (entry.letGoReason) restoration.letGoReason = normaliseBody(entry.letGoReason);
			restoration.archived = true;
			/*
			 * `undefined`, not `null`.
			 *
			 * A let-go idea is not also pending a revisit - those are opposite facts - so
			 * the field has to be cleared rather than left alone. Convex accepts an
			 * absent optional field and rejects a literal null, which the `let go`
			 * decision path already proved once.
			 */
			restoration.revisitAt = undefined;
		} else if (entry.revisitAt) {
			restoration.revisitAt = entry.revisitAt;
		}
		seq += 1;
		const at = nowMs();
			const ideaId = await ctx.db.insert('ideas', {
				userId,
				seq,
				seqDesc: -seq,
				title,
				status: 'inbox',
				// The schema constrains `source` to the two capture paths, so an import has to pick
				// one. `typed` is the honest choice: the text arrived as text through a
				// field, and widening the union would mean every existing reader - the web
				// capture parser, the mobile one, the Swift decoder - had to learn a third
				// case for no user-visible gain. Provenance that matters is written to the
				// timeline event instead, where there is no closed union to widen.
				source: 'typed',
				// `normaliseTags` returns undefined for a missing list, because on a captured idea
				// tags are optional. Here they are NOT: the schema requires an array, so an
				// import with no tags gets an empty one rather than an undefined that the
				// validator accepts and the document then fails on.
				tags: normaliseTags(entry.tags) ?? [],
				favorite: false,
				// NOT pre-decided as done, and never pre-archived. A restored idea has not
				// been re-judged in this app, and setting a status would quietly assert a
				// decision the user never made here.
			archived: false,
			...(entry.description ? { description: normaliseBody(entry.description) } : {}),
			...(entry.problem ? { problem: normaliseBody(entry.problem) } : {}),
			...(entry.audience ? { audience: normaliseBody(entry.audience) } : {}),
			...(entry.outcome ? { outcome: normaliseBody(entry.outcome) } : {}),
			...(entry.trigger ? { trigger: normaliseBody(entry.trigger) } : {}),
			...(entry.transcript ? { transcript: normaliseBody(entry.transcript) } : {}),
			...restoration,
			createdAt: entry.letGoAt ? entry.letGoAt : at,
			updatedAt: at
			});

			await ctx.db.insert('ideaEvents', {
				ideaId,
				userId,
				kind: 'captured',
				detail: 'imported from a file',
				createdAt: at
			});

			known.push({ _id: String(ideaId), title });
			imported.push(String(ideaId));
		}

		if (counter) {
			await ctx.db.patch(counter._id, { value: seq });
		} else if (seq > 0) {
			await ctx.db.insert('counters', { userId, key: 'idea_seq', value: seq });
		}

		return {
			imported: imported.length,
			importedIds: imported,
			skipped,
			remaining: Math.max(0, args.entries.length - IMPORT_LIMIT)
		};
	}
});
