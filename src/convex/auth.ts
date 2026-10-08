import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';

/**
 * Email + password sign-in.
 *
 * Password hashing is handled internally (scrypt) and the account secret is only
 * ever reachable from inside a Convex mutation, so unlike the original
 * hand-rolled implementation there is no public surface that can leak a hash.
 *
 * ## Account enumeration: half fixed, and the half that remains is measured
 *
 * Convex Auth v1's credential provider rethrows two distinguishable sentinels
 * verbatim from its `auth:signIn` action:
 *
 *   "InvalidAccountId" - the address is not registered
 *   "InvalidSecret"    - it is registered, the password is wrong
 *
 * Both are reachable from the public Convex HTTP API, and there is no timing
 * channel to blunt them (measured 422ms vs 428ms, inside noise), so the error
 * message is the whole oracle.
 *
 * ### What an earlier version of this file concluded, and why it was half wrong
 *
 * It listed three dead ends:
 *
 * 1. A wrapper action delegating to the library's action. Claimed impossible
 *    because "Convex forbids one function calling another". **That is wrong.**
 *    `ActionCtx` does have `runAction`, and `api.auth.signIn` is a valid public
 *    action reference. The original attempt passed the value returned by
 *    `convexAuth()` rather than the generated reference, which is why it threw
 *    `is not a functionReference` and broke sign-up once.
 * 2. Pre-checking inside the `profile` hook. Correct - the library calls it
 *    without awaiting, so it must return synchronously and cannot query first.
 * 3. Taking over `crypto` with Web Crypto PBKDF2. Correct that it cannot close
 *    the oracle from inside the hook, and it would invalidate every existing
 *    scrypt hash.
 *
 * So `signInProxy.ts` now does what approach 1 was reaching for, and the app's
 * own sign-in path - web, mobile and every test - is metered and uniform.
 *
 * ### The residual, stated precisely
 *
 * `convexAuth` registers `auth:signIn` as a **public** action and offers no
 * internal-only mode (checked against the installed package). So the raw action
 * stays directly callable, and stays distinguishable:
 *
 *   POST /api/action { "path": "auth:signIn", ... }
 *     known address, wrong password -> "InvalidSecret"
 *     unknown address, wrong password -> "InvalidAccountId"
 *
 * Verified against the live deployment rather than inferred, because "we could
 * not fix it" and "we fixed it" are both easy to assert and hard to believe.
 * `npm run verify:authproxy` asserts both halves: the proxy path is uniform, and
 * the raw path is not.
 *
 * Closing the raw path means Convex Auth v2, or owning the provider. Owning it
 * looks closer than it did - `lucia`'s `Scrypt` is in `node_modules`, so password
 * verification could be reproduced faithfully. What blocks it is the other half:
 * minting a session token needs the library's *internal* JWT signing, which is
 * not importable. Reimplementing that to hide an error string is a bad trade for
 * a personal idea app, so it is recorded rather than attempted.
 *
 * ### The second risk, now closed
 *
 * The limiter below keys on the ACCOUNT ID, and an address that was never
 * registered has no account row and therefore no limit - so guesses against
 * unknown addresses were completely unmetered, and password spraying across them
 * was free. `signInProxy` meters on the address the caller chose, which exists
 * whether or not an account does.
 *
 * Email normalisation below IS fixed, because it is the half of enumeration that
 * also splits accounts and enables squatting.
 */

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
	/**
	 * Failed-sign-in throttle, tightened from the library default.
	 *
	 * @convex-dev/auth already rate-limits credential sign-in at 10 failures per
	 * hour, refilling one attempt every 6 minutes. That is on by default and was
	 * simply never configured, so it was doing real work unremarked - 240 guesses
	 * a day against a known account is not a rate limit in any useful sense.
	 * Five per hour halves it with no real cost to one honest user who fumbles
	 * their password twice.
	 *
	 * ## The limit is keyed on the ACCOUNT ID, not on the request
	 *
	 * `retrieveAccountWithCredentialsImpl` looks the account up first and only
	 * then checks the limiter against `existingAccount._id`. There is no record
	 * for an address that was never registered, so:
	 *
	 *   - brute force against a KNOWN account -> throttled, as above
	 *   - guesses against UNKNOWN addresses     -> NOT throttled at all
	 *
	 * That second case is precisely what makes account enumeration cheap, and it
	 * cannot be fixed from config. It also cannot be fixed from the `profile` hook
	 * that receives the database handle, because that hook must return
	 * synchronously and so cannot await the counter increment. Recorded here
	 * rather than left to be discovered.
	 */
	signIn: { maxFailedAttempsPerHour: 5 },

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
