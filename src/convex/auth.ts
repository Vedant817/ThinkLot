import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';

/**
 * Email + password sign-in.
 *
 * Password hashing is handled internally (scrypt) and the account secret is
 * only ever reachable from inside a Convex mutation, so unlike the previous
 * hand-rolled implementation there is no public surface that can leak a hash.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
	providers: [
		Password({
			/**
			 * Normalise the email before it is stored.
			 *
			 * Convex Auth's default profile returns `params.email` verbatim, and the
			 * uniqueness check compares the raw string. That let one mailbox hold
			 * four independent accounts with four different passwords - `A@b.com`,
			 * `a@b.com`, ` a@b.com ` and `a@b.com ` are four distinct provider ids,
			 * so "already exists" never fired for any of them:
			 *
			 *   UPPER          -> NEW ACCOUNT sub=k971d629...
			 *   padded spaces  -> NEW ACCOUNT sub=k9764wgj...
			 *   trailing space -> NEW ACCOUNT sub=k97bfpmg...
			 *   MixedCase      -> NEW ACCOUNT sub=k974v671...
			 *
			 * Beyond the account-splitting, that is a squatting primitive: register
			 * a victim's address in a variant spelling and they can never claim it.
			 */
			profile(params) {
				const email = String(params.email ?? '').trim().toLowerCase();
				if (!email || !email.includes('@')) {
					throw new Error('That does not look like an email address.');
				}
				return { email };
			},

			// Reject anything that would make a weak account later. This runs on
			// sign-up and password reset.
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