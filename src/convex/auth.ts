import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';

/**
 * Email + password sign-in.
 *
 * Password hashing is handled internally (scrypt) and the account secret is only
 * ever reachable from inside a Convex mutation, so unlike the original
 * hand-rolled implementation there is no public surface that can leak a hash.
 *
 * ## Known, accepted residual risk: account enumeration
 *
 * Convex Auth v1's credential provider rethrows two distinguishable sentinels
 * verbatim from its `auth:signIn` action:
 *
 *   "InvalidAccountId" - the address is not registered
 *   "InvalidSecret"    - it is registered, the password is wrong
 *
 * Both are reachable from the public Convex HTTP API with no rate limit, and
 * there is no timing channel to blunt them (measured 422ms vs 428ms, inside
 * noise), so the error message is the whole oracle.
 *
 * ### Why it is not fixed here
 *
 * Three approaches were built and rejected:
 *
 * 1. A wrapper action delegating to the library's action. Impossible - Convex
 *    forbids one function calling another, so `ctx.runAction(signIn, ...)`
 *    throws "is not a functionReference". (This was shipped by mistake once and
 *    it broke sign-up entirely.)
 * 2. Pre-checking inside the `profile` hook, which is the only place the library
 *    exposes a database handle. Impossible - `profile` must return the profile
 *    synchronously, so no query can be awaited before the library performs its
 *    own distinguishing lookup.
 * 3. Taking over `crypto` with Web Crypto PBKDF2 so the password could be
 *    verified in the hook. This builds and deploys, but verification is still
 *    `await`ed inside an async hook that the type forbids, so it cannot close
 *    the oracle either - and it would invalidate every existing scrypt hash.
 *
 * Closing it properly means owning the provider via `ConvexCredentials` and
 * writing our own sign-in action, or moving to Convex Auth v2. Both are larger
 * than the exposure warrants for a single-user idea app, and reimplementing auth
 * internals to shave off an error message is a bad trade. Tracked rather than
 * papered over.
 *
 * Email normalisation below IS fixed, because it is the half of this that also
 * splits accounts and enables squatting.
 */

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
	providers: [
		Password({
			/**
			 * Normalise the email before it is stored.
			 *
			 * The default profile returns `params.email` verbatim and uses it directly
			 * as the provider account id, so `A@b.com`, `a@b.com`, ` a@b.com ` and
			 * `a@b.com ` are four distinct ids and "already exists" never fires for
			 * any of them. That produced four accounts with four different passwords
			 * for one mailbox - and a squatting primitive, since a variant spelling
			 * could be claimed before the real owner arrived.
			 *
			 * This hook must be synchronous, so it is also the only validation that
			 * can run before an account is created.
			 */
			profile(params) {
				const email = String(params.email ?? '').trim().toLowerCase();
				if (!email || !email.includes('@')) {
					throw new Error('That does not look like an email address.');
				}
				return { email };
			},

			// Reject anything that would make a weak account later. Runs on sign-up and
			// password reset.
			validatePasswordRequirements(password) {
				if (password.length < 8) {
					throw new Error('Password must be at least 8 characters.');
				}
				if (password.length > 200) {
					throw new Error('Password must be 200 characters or fewer.');
				}
			}
		})
	]
});