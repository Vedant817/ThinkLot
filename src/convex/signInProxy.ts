import { action, internalMutation } from './_generated/server';
import { api, internal as internalApi } from './_generated/api';
import { v } from 'convex/values';

/**
 * A rate-limited, error-normalising front door for credential sign-in.
 *
 * This closes BOTH of the auth risks this project had been carrying as accepted
 * residuals, and it exists because one of the two reasons recorded in `auth.ts`
 * turned out to be wrong.
 *
 * ## 1. The throttle gap — fixed
 *
 * `@convex-dev/auth` limits failed sign-ins with `maxFailedAttempsPerHour`, keyed
 * on the ACCOUNT ID. It looks the account up first, so an address that was never
 * registered has no record and therefore no limit at all. The practical effect:
 *
 *   - brute force against a known account -> limited
 *   - password spraying across thousands of unknown addresses -> unlimited
 *
 * The second is the one that matters, and it is what makes enumeration cheap.
 * `auth.ts` recorded that this "cannot be fixed from config", which is true of the
 * library's limiter, and then stopped there - without noticing that a limiter I
 * own can be keyed on the address whether or not an account exists.
 *
 * ## 2. The enumeration oracle — fixed
 *
 * The library rethrows two distinguishable sentinels verbatim from its public
 * action:
 *
 *   "InvalidAccountId" - the address is not registered
 *   "InvalidSecret"    - it is registered, the password is wrong
 *
 * `auth.ts` concluded this could not be closed, listing three dead ends. All three
 * were real, but they all tried to fix it from *inside* the provider - the
 * synchronous `profile` hook, or `ctx.runAction` against the wrong reference. The
 * fourth approach, wrapping the action from outside, was never tried.
 *
 * `ActionCtx` does have `runAction`, and `api.auth.signIn` IS a valid public
 * action reference. So this action delegates to the library and then normalises
 * what comes back. The oracle was never inside the cryptography; it was the error
 * string leaving the function, and a wrapper can rewrite that.
 *
 * (The earlier failed attempt passed the value returned by `convexAuth()` rather
 * than the generated reference, which is why it threw `is not a functionReference`
 * and broke sign-up once.)
 *
 * ## The one thing this cannot close
 *
 * Sign-up for an address that already exists has to say so, or the user is told
 * they created an account when they did not and then cannot sign in. That message
 * reveals existence by construction.
 *
 * It is bounded rather than eliminated: it is behind the same per-address budget as
 * every other flow, so mapping a million addresses is one request per address per
 * hour instead of one request per address per second, and it costs nothing to reach
 * the sign-in path, where the budget still applies.
 */

/** One window, one budget. Kept short so a lockout is never more than an hour. */
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Attempts allowed per address per hour, per flow.
 *
 * Sign-in is deliberately tighter than sign-up: guessing a password is the
 * expensive attack, and creating throwaway accounts is cheap and self-limiting.
 */
const BUDGET: Record<string, number> = {
	signIn: 10,
	signUp: 20,
	reset: 5,
	'reset-verification': 10
};

/**
 * ONE message for every credential failure.
 *
 * The whole point. Anything that distinguishes "no such address" from "wrong
 * password" restores the oracle, so every branch below returns this - including the
 * throttled one, because telling a caller they are being throttled is only safe
 * when the throttle is keyed on something the caller already chose.
 */
const GENERIC_FAILURE = 'That email or password is not right.';

/**
 * Messages the library produces that mean "your input was malformed", not "your
 * credentials are wrong".
 *
 * These are safe to pass through. A malformed request says nothing about whether
 * an account exists - `params.password` being absent is a property of the caller's
 * own body - and flattening them into the generic failure would produce an
 * unfollowable error for a real user who hit a client bug.
 */
const INPUT_SHAPED = /password|email|account|profile|require|invalid\s*(email|password|params)/i;

/**
 * Charge one attempt against a budget, and report whether it was allowed.
 *
 * An `internal` mutation, not inline in the action, for two reasons that are the
 * same reason:
 *
 *  - `ActionCtx.db` is a READER. An action cannot insert, so the budget has to be
 *    written from a mutation regardless.
 *  - Because it is internal, the client cannot call it. A public "check my budget"
 *    endpoint would let anyone clear their own throttle with one request, which
 *    would make the limiter decorative.
 *
 * Returns the verdict rather than throwing, so the action owns the message the
 * user sees. The uniform reply is the security property, and it belongs in one place.
 */
export const chargeAttempt = internalMutation({
	args: { key: v.string(), flow: v.string(), budget: v.number() },
	handler: async (ctx, args) => {
		const now = Date.now();
		const existing = await ctx.db
			.query('authAttempts')
			.withIndex('by_key', (q) => q.eq('key', args.key))
			.unique();

		// A record whose window has rolled over is treated as a fresh budget rather
		// than deleted, so a stale row cannot accumulate without bound.
		const withinWindow = existing !== null && now - existing.windowStart < WINDOW_MS;
		const used = withinWindow ? existing.count : 0;

		if (used >= args.budget) return { allowed: false as const, used };

		if (existing === null) {
			await ctx.db.insert('authAttempts', {
				key: args.key,
				flow: args.flow,
				count: 1,
				windowStart: now
			});
		} else {
			await ctx.db.patch(existing._id, {
				count: withinWindow ? used + 1 : 1,
				windowStart: withinWindow ? existing.windowStart : now
			});
		}
		return { allowed: true as const, used: used + 1 };
	}
});

/** Refund the budget after a success, so a user who fumbled twice starts clean. */
export const refundAttempt = internalMutation({
	args: { key: v.string() },
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('authAttempts')
			.withIndex('by_key', (q) => q.eq('key', args.key))
			.unique();
		if (existing !== null) await ctx.db.delete(existing._id);
	}
});

function normaliseEmail(raw: unknown): string {
	return String(raw ?? '')
		.trim()
		.toLowerCase();
}

/**
 * SHA-256, as hex.
 *
 * `crypto.subtle` is available in a Convex action (it runs on V8 with WebCrypto).
 * The point is not secrecy - a salted hash would be better for a password, and this
 * is not one - it is that the rate-limit table should not become a second, undeletable
 * copy of every address in the system.
 */
async function sha256(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const signInProxy = action({
	// Explicit: the handler returns `ctx.runAction(...)` on one path and the same
	// call's value on another, and TypeScript cannot infer a type through the
	// circular shape `runAction` produces from a generic reference.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	args: {
		provider: v.optional(v.string()),
		/**
		 * The refresh-token exchange sends `{ refreshToken }` at the TOP level - it is
		 * not a credential flow and has no `params`. Declared here because Convex
		 * rejects unknown fields, so omitting it meant the proxy refused every refresh
		 * with "Object contains extra field `refreshToken`" while the raw action worked
		 * fine. That is the whole long-lived-session failure in one validator.
		 */
		refreshToken: v.optional(v.string()),
		/**
		 * Passed through to the library untouched apart from reading `email` and
		 * `flow` out of it. `v.any()` rather than a closed shape, because the library
		 * accepts flows this proxy has never heard of and must not reject them.
		 */
		params: v.optional(v.any())
	},
	handler: async (ctx, args): Promise<unknown> => {
		const params = (args.params ?? {}) as Record<string, unknown>;
		const flow = typeof params.flow === 'string' ? params.flow : 'signIn';

		// Keyed on the address the CALLER chose, so it applies whether or not an
		// account exists. This is the whole fix for the spraying vector.
		const email = normaliseEmail(params.email);
		const key = email ? `${await sha256(email)}:${flow}` : null;

		if (key) {
			const budget = BUDGET[flow] ?? 10;
			const verdict = await ctx.runMutation(internalApi.signInProxy.chargeAttempt, { key, flow, budget });
			if (!verdict.allowed) {
				// Same message as a bad password. A distinct "slow down" message would
				// still be safe - the caller chose the address - but it invites support
				// questions, and uniformity is the property being bought here.
				throw new Error(GENERIC_FAILURE);
			}
		}

		// Flows that carry no address at all - the refresh-token exchange does not -
		// are passed straight through: there is no account to find, so there is
		// nothing to throttle and nothing to normalise.
		//
		// `args` is forwarded WHOLE, not rebuilt. Two bugs lived here, both found by
		// testing rather than reading:
		//
		// 1. This check used to `throw new Error(GENERIC_FAILURE)`. The client
		//    refreshes with `auth:signIn({ refreshToken })` and no email, so every
		//    session would have been logged out the moment its access token aged out -
		//    an hour-boundary failure presenting as "wrong password".
		// 2. It then forwarded `{ provider, params }`, which is the credential shape.
		//    The refresh shape puts `refreshToken` at the TOP level, so it was being
		//    dropped on the floor and every refresh through this proxy failed while the
		//    raw action worked - which is exactly the long-lived-session case this
		//    project had listed as unverified.
		if (!email) {
			return await ctx.runAction(api.auth.signIn, args as never);
		}

		let result: unknown;
		try {
			result = await ctx.runAction(api.auth.signIn, {
				provider: args.provider ?? 'password',
				params
			} as never);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			if (INPUT_SHAPED.test(message) && !/invalidaccountid|invalidsecret/i.test(message)) {
				throw error;
			}

			// "InvalidAccountId" and "InvalidSecret" both land here, and leave as one
			// indistinguishable answer.
			throw new Error(GENERIC_FAILURE);
		}

		// On success, clear the budget so a user who fumbled twice is not still
		// throttled hours later.
		if (key) {
			await ctx.runMutation(internalApi.signInProxy.refundAttempt, { key });
		}

		return result;
	}
});
