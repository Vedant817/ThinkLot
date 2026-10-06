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