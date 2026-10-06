import { signIn } from './auth';
import { action } from './_generated/server';
import { v } from 'convex/values';

/**
 * A sign-in wrapper that does not tell an attacker whether an address is
 * registered.
 *
 * Convex Auth's credential provider rethrows two distinct sentinels verbatim:
 *
 *   registered email  + wrong password -> "InvalidSecret"
 *   unknown email     + any password  -> "InvalidAccountId"
 *
 * Both are reachable from the public Convex HTTP API with no rate limit, and
 * there is no timing channel to blunt them (measured 422ms vs 428ms, inside
 * noise). The error *message* is the whole oracle, so probing whether somebody
 * has an account here was unlimited and reliable - and, combined with an
 * unrate-limited signUp, it is the reconnaissance half of an email-squatting
 * attack.
 *
 * The library's own message cannot be changed from here, so this collapses every
 * authentication failure into one sentence. Legitimate users lose nothing: they
 * only ever needed to know that the pair did not work.
 *
 * `signUp` is included deliberately. "That email already has an account" is
 * genuinely useful feedback during signup, but it is also a free enumeration
 * oracle, so it is folded into the same generic failure.
 */
const GENERIC_AUTH_FAILURE = 'That email and password do not match an account.';

export const signInAttempt = action({
	args: {
		provider: v.optional(v.string()),
		verifier: v.optional(v.string()),
		params: v.optional(v.any())
	},
	handler: async (ctx, args) => {
		try {
			// `runAction` wants a function reference and Convex Auth's `signIn` is a
			// RegisteredAction, which is structurally close but not identical. The
			// cast is confined to this one delegation.
			return await ctx.runAction(signIn as never, args as never);
		} catch (error) {
			// Log the real reason for ourselves; show the caller nothing useful.
			console.warn('ThinkLot: sign-in attempt failed.', error);
			throw new Error(GENERIC_AUTH_FAILURE);
		}
	}
});