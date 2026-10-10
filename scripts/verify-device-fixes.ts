/**
 * The sign-in screen must never be able to hang silently.
 *
 * On a real Samsung A22, tapping "Create account" left the button permanently disabled.
 * The backend was provably healthy - a live `signInProxy` signUp returns tokens in about
 * 1.1 seconds - so the stall was in the client, not the server. `busy` was set and
 * never cleared, which means the async function's continuation never ran.
 *
 * A user in that state has no way to tell a lost race from a dead network, cannot
 * retry, and gets no message. That is the failure being guarded.
 *
 * The banner's reachability is covered by `verify-offline-banner.ts`; this file is about
 * the auth flow's ability to finish, one way or the other.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const signIn = readFileSync('apps/mobile/src/app/index.tsx', 'utf8');

// 1. Every path out of submit() must reset `busy`. A `finally` is the only construct
//    that guarantees this for both the success and the failure path.
assert.match(signIn, /finally\s*\{/, 'submit() must reset busy in a finally block');
assert.match(signIn, /setBusy\(false\)/, 'and the reset must actually be there');

// 2. The session must be established by the auth library, not by writing the token
//    by hand. Hand-writing was the original bug: this screen wrote `__convexAuthJWT`
//    into AsyncStorage, while the library stores through its `storage` adapter
//    (expo-secure-store) under a NAMESPACED key. The token landed nowhere the client
//    looks, so `isAuthenticated` never flipped and the button sat disabled forever.
assert.match(
	signIn,
	/await signIn\("password"/,
	'the session must be created by the auth library, which owns the storage key'
);
assert.doesNotMatch(
	signIn,
	/AsyncStorage\.setItem\("__convexAuthJWT"/,
	'hand-writing the JWT writes to the wrong store under the wrong key and never authenticates'
);
assert.doesNotMatch(
	signIn,
	/waitForAuth/,
	'polling isAuthenticated from an unmounting screen always reads false and lied about success'
);
assert.doesNotMatch(
	signIn,
	/while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/,
	'an unbounded loop in the sign-in flow is a hang with extra steps'
);

// 5. The failure must be VISIBLE, not swallowed. A thrown error inside the try lands in
//    the catch, which sets the message the user reads.
assert.match(signIn, /setError\(errorMessage\(e\)\)/, 'a failed sign-in must set an error');

// 6. There must be no unhandled-promise path out of submit. The async function's failure
//    surface is its rejection, and the catch is what the user reads.
assert.doesNotMatch(signIn, /\.catch\(\(\) => \{\}\)/, 'no silent swallow of a sign-in failure');

// 7. The proxy, not the raw library action, must authorise the credentials. The raw
//    `auth:signIn` still answers InvalidAccountId/InvalidSecret and is unmetered for
//    addresses that have no account.
assert.match(
	signIn,
	/useAction\(api\.signInProxy\.signInProxy\)/,
	'the client must go through the rate-limited, error-normalising proxy'
);

// 9. A re-entrant submit must be refused. Two concurrent taps would both set busy and
//    could leave the flag latched from the second call.
assert.match(signIn, /if \(busy\) return;/, 'submit() must refuse to run twice concurrently');

console.log('PASS: a lost sign-in race is a visible error, not an eternally disabled button.');
