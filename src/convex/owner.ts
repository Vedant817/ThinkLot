import { getAuthUserId } from '@convex-dev/auth/server';
import { internalMutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { ValidationError } from '../lib/convex/validation';
import { utcDay } from './telemetry';

const DAY_MS = 86_400_000;
/** Single bounded reads stay under this; beyond it, paginate (see rollup). */
const SCAN_LIMIT = 2000;

/**
 * Owner-only gate.
 *
 * Compares the signed-in user's EMAIL (read from the users table via the verified
 * request identity, never from a client argument) against the OWNER_EMAIL
 * deployment variable. Fail-closed both ways: unset variable and wrong user throw
 * the same message, so the endpoint does not even confirm it is configured.
 */
async function requireOwner(ctx: QueryCtx | MutationCtx): Promise<void> {
	const userId = await getAuthUserId(ctx);
	const ownerEmail = process.env.OWNER_EMAIL;
	if (!userId || !ownerEmail) throw new ValidationError('Not available.');
	const user = await ctx.db.get(userId);
	const email = (user as { email?: unknown } | null)?.email;
	if (typeof email !== 'string' || email.toLowerCase() !== ownerEmail.toLowerCase()) {
		throw new ValidationError('Not available.');
	}
}

/** The precomputed daily rows, newest first. Aggregates only - no per-user data. */
export const stats = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		await requireOwner(ctx);
		const rows = await ctx.db
			.query('dailyOwnerStats')
			.withIndex('by_day')
			.order('desc')
			.take(Math.min(Math.max(args.limit ?? 90, 1), 365));
		return rows;
	}
});

type Ctx = MutationCtx;

async function optedOutIds(ctx: Ctx): Promise<Set<string>> {
	const rows = await ctx.db.query('telemetryPrefs').take(SCAN_LIMIT);
	return new Set(rows.map((r) => String(r.userId)));
}

/** Everything one rollup needs from one user, read once. */
type UserSlice = {
	id: string;
	created: number;
	ideas: { createdAt: number; archived: boolean; status: string; scored: boolean; dictated: boolean }[];
	/** Events in the trailing 28 days - the rolled day is always inside this window. */
	ev28: { kind: string; createdAt: number }[];
	beats: { day: string; platform: 'web' | 'android' | 'ios'; aiConfigured: boolean }[];
	hasTasks: boolean;
};

/**
 * One bounded pass per user: four reads that every metric below folds in
 * memory. The first version re-scanned per metric (DAU loop, WAU loop, ideas
 * loop, adoption loop, retention loop) and read ~31k documents for a few dozen
 * test accounts - the exact over-quota failure mode. Per-user rows stay bounded
 * by take() caps; growth in users adds users × 4 reads, never a cross-user scan.
 */
async function collectUser(ctx: Ctx, userId: Id<'users'>, since28d: number): Promise<UserSlice> {
	const [ideas, ev28, beats, tasks] = await Promise.all([
		ctx.db
			.query('ideas')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.take(SCAN_LIMIT),
		ctx.db
			.query('ideaEvents')
			.withIndex('by_user_created', (q) => q.eq('userId', userId).gte('createdAt', since28d))
			.take(SCAN_LIMIT),
		ctx.db
			.query('clientHeartbeats')
			.withIndex('by_user_day', (q) => q.eq('userId', userId))
			.take(100),
		ctx.db
			.query('ideaTasks')
			.withIndex('by_user', (q) => q.eq('userId', userId))
			.take(1)
	]);
	const user = await ctx.db.get(userId);
	return {
		id: String(userId),
		created: user?._creationTime ?? 0,
		ideas: ideas.map((i) => ({
			createdAt: i.createdAt,
			archived: i.archived,
			status: i.status,
			scored: i.impact !== undefined && i.effort !== undefined && i.confidence !== undefined,
			dictated: i.source === 'dictated'
		})),
		ev28: ev28.map((e) => ({ kind: e.kind, createdAt: e.createdAt })),
		beats: beats.map((b) => ({ day: b.day, platform: b.platform, aiConfigured: b.aiConfigured })),
		hasTasks: tasks.length > 0
	};
}

/** Any write or check-in by this slice inside [start, end)? Pure. */
function sliceActive(s: UserSlice, start: number, end: number): boolean {
	return (
		s.ev28.some((e) => e.createdAt >= start && e.createdAt < end) ||
		s.ideas.some((i) => i.createdAt >= start && i.createdAt < end) ||
		s.beats.some((b) => {
			const t = Date.parse(b.day + 'T00:00:00Z');
			return t >= start && t < end;
		})
	);
}

/**
 * Roll up one UTC day into a single `dailyOwnerStats` row.
 *
 * Runs from the daily cron (internal: never HTTP-reachable). Everything is
 * derived from tables that already exist plus heartbeats; there is deliberately
 * no per-event analytics write anywhere in the request path - that is the cost
 * control that keeps this affordable over the free-plan limits.
 *
 * Scaling note, stated rather than hidden: user and idea reads below are single
 * bounded `take(SCAN_LIMIT)` calls. Correct into the thousands of users; past
 * that, paginate by `_creationTime` cursor. The dashboard read stays O(1)
 * regardless because it only ever reads the precomputed rows.
 */
export const rollupDay = internalMutation({
	args: { day: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const day = args.day ?? utcDay(Date.now() - DAY_MS);
		const start = Date.parse(day + 'T00:00:00Z');
		const end = start + DAY_MS;

		const users = await ctx.db.query('users').take(SCAN_LIMIT);
		const optedOut = await optedOutIds(ctx);
		const tracked = users.filter((u) => !optedOut.has(String(u._id)));

		const newUsers = users.filter((u) => u._creationTime >= start && u._creationTime < end);

		// Heartbeats for the day (tracked users only).
		const beats = (
			await ctx.db
				.query('clientHeartbeats')
				.withIndex('by_day', (q) => q.eq('day', day))
				.take(SCAN_LIMIT)
		).filter((b) => !optedOut.has(String(b.userId)));

		const beatUsers = new Set(beats.map((b) => String(b.userId)));

		// Single collection pass. Every metric below folds these slices in
		// memory; no second read of any user table happens after this loop.
		const slices = new Map<string, UserSlice>();
		for (const u of tracked) {
			slices.set(String(u._id), await collectUser(ctx, u._id, end - 28 * DAY_MS));
		}
		const sliceOf = (id: string) => slices.get(id);

		// Activity-derived DAU: heartbeat OR any write that day.
		const dauSet = new Set<string>(beatUsers);
		for (const s of slices.values()) {
			if (sliceActive(s, start, end)) dauSet.add(s.id);
		}

		const windowActive = (days: number): Set<string> => {
			const s = end - days * DAY_MS;
			const set = new Set<string>();
			for (const sl of slices.values()) {
				if (sliceActive(sl, s, end)) set.add(sl.id);
			}
			return set;
		};
		const wau = windowActive(7);
		const mau = windowActive(28);

		// Captures, pipeline, scores, sources - folded from the collected ideas.
		let captures = 0;
		let capturesCheck = 0;
		let ideasTotal = 0;
		let scored = 0;
		let dictated = 0;
		let archived = 0;
		const statusCounts: Record<string, number> = {};
		for (const s of slices.values()) {
			for (const idea of s.ideas) {
				ideasTotal++;
				if (idea.createdAt >= start && idea.createdAt < end) captures++;
				if (idea.archived) archived++;
				else statusCounts[idea.status] = (statusCounts[idea.status] ?? 0) + 1;
				if (idea.scored) scored++;
				if (idea.dictated) dictated++;
			}
			capturesCheck += s.ev28.filter((e) => e.kind === 'captured' && e.createdAt >= start && e.createdAt < end).length;
		}

		// Reconciliation: two independent counts of the same fact. A mismatch
		// means a write path the rollup does not see, which is exactly the bug
		// class that makes dashboards lie quietly.
		const verified = captures === capturesCheck;

		// Activation: new users with a capture ≤24h / a score ≤7d.
		let activatedCapture24h = 0;
		let activatedScored7d = 0;
		for (const u of newUsers) {
			const s = sliceOf(String(u._id));
			if (!s) continue;
			if (s.ideas.some((i) => i.createdAt <= u._creationTime + DAY_MS)) activatedCapture24h++;
			if (
				s.ev28.some(
					(e) =>
						e.kind === 'scored' &&
						e.createdAt >= u._creationTime &&
						e.createdAt < u._creationTime + 7 * DAY_MS
				)
			)
				activatedScored7d++;
		}

		// Retention: cohorts created exactly N days ago, active on the rolled day.
		const retention = (daysAgo: number): number => {
			const cStart = start - daysAgo * DAY_MS;
			const cohort = users.filter(
				(u) => !optedOut.has(String(u._id)) && u._creationTime >= cStart && u._creationTime < cStart + DAY_MS
			);
			if (cohort.length === 0) return 0;
			let back = 0;
			for (const u of cohort) {
				const s = sliceOf(String(u._id));
				if (s && sliceActive(s, start, end)) back++;
			}
			return Math.round((back / cohort.length) * 100);
		};

		// Feature adoption: % of MAU touching each in the trailing 28 days.
		const adoption = (match: (kinds: Set<string>, hasTasks: boolean) => boolean): number => {
			if (mau.size === 0) return 0;
			let n = 0;
			for (const id of mau) {
				const s = sliceOf(id);
				if (!s) continue;
				if (match(new Set(s.ev28.map((e) => e.kind)), s.hasTasks)) n++;
			}
			return Math.round((n / mau.size) * 100);
		};
		const has = (k: string) => (kinds: Set<string>) => kinds.has(k);
		const favUsersPct = adoption(has('favorited'));
		const snoozeUsersPct = adoption(has('snoozed'));
		const letGoUsersPct = adoption(has('letGo'));
		const taskUsersPct = adoption((_kinds, hasTasks) => hasTasks);

		// Reminder return: reminded in the prior 48h, active any time since.
		let reminded = 0;
		let returned = 0;
		for (const s of slices.values()) {
			const reminders = s.ev28.filter((e) => e.kind === 'reminder' && e.createdAt >= start - 2 * DAY_MS);
			if (reminders.length === 0) continue;
			reminded++;
			const firstReminder = Math.min(...reminders.map((e) => e.createdAt));
			if (sliceActive(s, firstReminder, end + DAY_MS)) returned++;
		}

		// Auth health: summed attempt counts whose window covers today.
		const attempts = await ctx.db.query('authAttempts').take(SCAN_LIMIT);
		const authFailures = attempts
			.filter((a) => a.windowStart >= start - DAY_MS && a.windowStart < end)
			.reduce((sum, a) => sum + a.count, 0);

		const dau = dauSet.size;
		const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));
		const platform = { web: 0, android: 0, ios: 0 };
		let aiSetup = 0;
		for (const b of beats) {
			platform[b.platform]++;
			if (b.aiConfigured) aiSetup++;
		}

		const existing = await ctx.db
			.query('dailyOwnerStats')
			.withIndex('by_day', (q) => q.eq('day', day))
			.unique();
		const row = {
			day,
			computedAt: Date.now(),
			verified,
			newUsers: newUsers.filter((u) => !optedOut.has(String(u._id))).length,
			dau,
			wau: wau.size,
			mau: mau.size,
			activatedCapture24h,
			activatedScored7d,
			retD1: retention(1),
			retD7: retention(7),
			retD30: retention(30),
			captures,
			capturesPerDau: dau === 0 ? 0 : Math.round((captures / dau) * 10) / 10,
			scoredIdeasPct: pct(scored, ideasTotal),
			favUsersPct,
			snoozeUsersPct,
			letGoUsersPct,
			taskUsersPct,
			dictatedPct: pct(dictated, ideasTotal),
			archivedPct: pct(archived, ideasTotal),
			aiSetupPct: pct(aiSetup, dau),
			platformWeb: platform.web,
			platformAndroid: platform.android,
			platformIos: platform.ios,
			statusInbox: statusCounts['inbox'] ?? 0,
			statusParked: statusCounts['parked'] ?? 0,
			statusReviewing: statusCounts['reviewing'] ?? 0,
			statusReady: statusCounts['ready'] ?? 0,
			statusBuilding: statusCounts['building'] ?? 0,
			statusDone: statusCounts['done'] ?? 0,
			reminderReturnPct: reminded === 0 ? 0 : Math.round((returned / reminded) * 100),
			authFailures
		};
		if (existing) await ctx.db.patch(existing._id, row);
		else await ctx.db.insert('dailyOwnerStats', row);

		// Prune heartbeats past 90 days: per-user detail has served its purpose
		// once rolled up, and keeping it would grow the table without bound. Loops
		// while full so a large backlog drains instead of leaving its tail behind.
		const cutoff = utcDay(start - 90 * DAY_MS);
		for (;;) {
			const old = await ctx.db.query('clientHeartbeats').withIndex('by_day').take(500);
			if (old.length === 0) break;
			let deleted = 0;
			for (const h of old) {
				if (h.day < cutoff) {
					await ctx.db.delete(h._id);
					deleted++;
				}
			}
			if (old.length < 500) break;
			if (deleted === 0) break;
		}

		return { day, verified, dau, captures };
	}
});
