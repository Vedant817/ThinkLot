import { mutation } from './_generated/server';
import { v } from 'convex/values';

/**
 * One-off scrub of adversarial-QA test data.
 *
 * Two QA agents deliberately created ~128 accounts and ~1,300 ideas in this
 * deployment while probing authorisation, and Convex began refusing further
 * work with "Your projects are above the Free plan limits." The data is worthless
 * and its scan cost was landing in real query metrics: the bytes-read-limit
 * errors on `ideas:list` and `ideas:stats` were being driven by junk rows rather
 * than by real usage.
 *
 * ## Why it is shaped like this
 *
 * Convex allows only ONE paginated query per function execution. The obvious
 * implementation - loop over tables, paginating each - fails at runtime with
 * "ran multiple paginated queries". So every function here processes exactly one
 * page and returns the cursor, and the driver loop in PowerShell calls them
 * repeatedly. That also keeps each call small and cheap, which matters precisely
 * because the deployment is over quota.
 *
 * ## Safety
 *
 * This is a PUBLIC mutation, which is normally indefensible. It is acceptable
 * only because it refuses to touch anything not matching an unmistakable
 * test-account pattern, and because the deployment is disposable dev. A real
 * owner account is never named like this.
 *
 * Lifecycle: run once, then delete this file and the scratch table. It is kept
 * in the repo rather than run ad hoc so the operation is reviewable.
 */

const QA_EMAIL = /@(example\.com|example\.org|example\.net)$/i;

const QA_LOCAL_PARTS = [
	'qa-', 'f1-', 'f2-', 'f3-', 'f4-', 'f5-', 'f6-',
	'takeover-', 'dup', 'enum-', 'cliff-', 'scale-', 'bloat-',
	'brute-', 'flood-', 'pw-', 'flowtest', 'normtest', 'enumcheck',
	'ghost-', 'probe-'
];

function looksLikeTestEmail(email: string | undefined | null): boolean {
	if (!email) return false;
	if (!QA_EMAIL.test(email)) return false;
	const local = email.split('@')[0].toLowerCase();
	return QA_LOCAL_PARTS.some((p) => local.startsWith(p));
}

/**
 * Step 1: walk `users` one page at a time and record the doomed ids.
 * Repeat with the returned cursor until `isDone`.
 */
export const markDoomedUsers = mutation({
	args: { cursor: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const page = await ctx.db.query('users').paginate({
			numItems: 128,
			cursor: args.cursor ?? null
		});

		let marked = 0;
		for (const user of page.page) {
			if (!looksLikeTestEmail(user.email)) continue;
			const already = await ctx.db
				.query('scratchDoomed')
				.withIndex('by_user', (q) => q.eq('userId', user._id))
				.unique();
			if (already) continue;
			await ctx.db.insert('scratchDoomed', { userId: user._id, email: user.email ?? '' });
			marked++;
		}

		return {
			markedThisCall: marked,
			isDone: page.isDone,
			cursor: page.isDone ? null : (page.continueCursor ?? null)
		};
	}
});

/** Step 2: delete one page of doomed rows from a single table. */
export const wipePage = mutation({
	args: {
		table: v.string(),
		cursor: v.optional(v.string()),
		/** When true, match by the table's own email-ish column instead of userId. */
		byEmail: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		// Build the doomed set for this call. Small table, cheap read.
		const scratch = await ctx.db.query('scratchDoomed').collect();
		const doomed = new Set(scratch.map((d) => d.userId as string));

		// `ctx.db.query` is intentionally loose here: one shared scrub routine
		// covers six differently-shaped tables.
		const table = args.table as any;
		const page = await ctx.db
			.query(table)
			.paginate({ numItems: 128, cursor: args.cursor ?? null });

		let deleted = 0;
		for (const doc of page.page as any[]) {
			const owned = typeof doc.userId === 'string' && doomed.has(doc.userId);
			const linked =
				typeof doc.userId === 'string' && doomed.has(doc.userId);
			const byEmailHere =
				args.byEmail === true &&
				(looksLikeTestEmail(doc.email) || looksLikeTestEmail(doc.providerAccountId));

			if (owned || linked || byEmailHere) {
				await ctx.db.delete(doc._id);
				deleted++;
			}
		}

		return {
			deletedThisCall: deleted,
			isDone: page.isDone,
			cursor: page.isDone ? null : (page.continueCursor ?? null)
		};
	}
});

/** Step 3: drop the scratch table contents. */
export const clearScratch = mutation({
	args: { confirm: v.literal(true) },
	handler: async (ctx) => {
		const rows = await ctx.db.query('scratchDoomed').collect();
		for (const row of rows) await ctx.db.delete(row._id);
		return { cleared: rows.length };
	}
});

/** Counts, for verifying the scrub actually did something. */
export const census = mutation({
	args: {},
	handler: async (ctx) => {
		const count = async (t: string) => (await ctx.db.query(t as any).collect()).length;
		return {
			users: await count('users'),
			ideas: await count('ideas'),
			ideaEvents: await count('ideaEvents'),
			scratchDoomed: await count('scratchDoomed')
		};
	}
});