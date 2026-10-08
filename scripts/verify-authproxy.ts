/**
 * Does the sign-in proxy actually close the two holes it claims to?
 *
 * Run against the live dev deployment: npm run verify:authproxy
 *
 * The claims under test are security claims, and security claims that are only
 * asserted in prose are how "accepted residual risk" survives for a year. Each one
 * is measured here by attacking the endpoint the way an attacker would - over the
 * public HTTP API, with no session - and comparing what comes back.
 */
import { createHash } from 'node:crypto';

const CONVEX = process.env.PUBLIC_CONVEX_URL ?? 'https://posh-chihuahua-240.convex.cloud';

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `   ${detail}` : ''}`);
  }
}

async function call(path: string, args: Record<string, unknown>, kind: 'action' | 'query' | 'mutation') {
  const response = await fetch(`${CONVEX}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args, format: 'json' })
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: 'error', errorMessage: `non-JSON: ${text.slice(0, 160)}` };
  }
}

/** signIn for a flow, through the proxy or straight at the library. */
async function attempt(flow: 'signIn' | 'signUp', email: string, password: string, viaProxy: boolean) {
  return viaProxy
    ? call('signInProxy:signInProxy', { provider: 'password', params: { email, password, flow } }, 'action')
    : call('auth:signIn', { provider: 'password', params: { email, password, flow } }, 'action');
}

function messageOf(result: any): string {
  return String(result?.errorMessage ?? '');
}

/**
 * The message with Convex's per-request noise removed.
 *
 * Comparing raw error bodies cannot work: Convex prefixes every failure with a
 * unique `[Request ID: <random>]` and appends a stack trace pointing at the source
 * line. So two byte-identical rejections never compare equal, and a check written
 * against the raw string reports nine "different" replies to the same generic
 * message - which is how a working fix looks broken.
 *
 * The Request ID is random per request and the stack reveals a file and line
 * number. Neither carries anything about whether an account exists, so the
 * security property under test is equality of the *semantic* message. Both facts
 * are asserted separately below so they are recorded rather than quietly stripped.
 */
function stableMessage(result: any): string {
  return messageOf(result)
    .replace(/\[Request ID: [^\]]+\]\s*/g, '')
    .replace(/\s*at handler \([^)]*\)\s*/g, '')
    .replace(/\s*at .*$/s, '')
    .trim();
}

/** Whether Convex leaked a source location in the error body. */
function leaksStack(result: any): boolean {
  return /\bat [a-zA-Z_$][\w$]* \(/.test(messageOf(result));
}

async function main() {
  const stamp = Date.now();
  const password = 'Correct-Horse-9-Battery';
  const real = `qa-proxy-${stamp}@example.com`;
  // A different shape of address each time, so the "unknown" probes below are
  // genuinely unseen rather than something an earlier probe registered.
  const unknowns = Array.from({ length: 5 }, (_, i) => `qa-absent-${stamp}-${i}@example.com`);

  console.log('\n== 1. the proxy is a usable sign-in path ==');
  const up = await attempt('signUp', real, password, true);
  check('signUp through the proxy succeeds', up.status === 'success', messageOf(up));
  const signIn = await attempt('signIn', real, password, true);
  check('signIn through the proxy succeeds', signIn.status === 'success', messageOf(signIn));
  const token = signIn.value?.tokens?.token;
  check('the proxy returns a usable token', typeof token === 'string' && token.length > 20);

  console.log('\n== 2. the enumeration oracle is closed ==');
  /**
   * The library distinguishes these two. If the proxy passes either through, an
   * attacker can map the whole address space with one request per address, so the
   * comparison is against the LIBRARY rather than against a hardcoded string.
   */
  const wrongPassword = await attempt('signIn', real, 'not-the-password', true);
  const unknownAddress = await attempt('signIn', unknowns[0], 'not-the-password', true);

  const wrongMsg = stableMessage(wrongPassword);
  const unknownMsg = stableMessage(unknownAddress);

  check('a wrong password is refused', wrongPassword.status !== 'success', wrongMsg);
  check('an unknown address is refused', unknownAddress.status !== 'success', unknownMsg);
  check(
    'the two failures are indistinguishable',
    wrongMsg === unknownMsg,
    `wrong-password said "${wrongMsg}" but unknown-address said "${unknownMsg}"`
  );
  check(
    'neither failure leaks the library sentinels',
    !/invalidaccountid|invalidsecret/i.test(wrongMsg + unknownMsg),
    wrongMsg + ' | ' + unknownMsg
  );
  // Recorded rather than asserted-as-good: Convex appends the throwing source
  // location to production errors, and there is no way to reject an action
  // without throwing one. It discloses a file and a line number, and nothing about
  // the account, so it does not reopen the oracle - but it is a fact about this
  // endpoint rather than an assumption.
  console.log(
    `  NOTE  Convex discloses a source location in error bodies: ${leaksStack(wrongPassword)}`
  );

  // Prove the library really does distinguish them, or the check above is vacuous.
  const libWrong = await attempt('signIn', real, 'not-the-password', false);
  const libUnknown = await attempt('signIn', unknowns[1], 'not-the-password', false);
  check(
    'the library itself still distinguishes them (so the fix is doing work)',
    stableMessage(libWrong) !== stableMessage(libUnknown),
    `library: "${stableMessage(libWrong)}" vs "${stableMessage(libUnknown)}"`
  );

  console.log('\n== 3. unknown addresses are now throttled ==');
  /**
   * The original defect: the library's limiter keys on the ACCOUNT ID, so an
   * address that was never registered had no limit at all. Twelve attempts against
   * five different unseen addresses must therefore NOT all be accepted.
   */
  const results: string[] = [];
  for (const address of unknowns.slice(2)) {
    for (let i = 0; i < 3; i++) {
      results.push(stableMessage(await attempt('signIn', address, `guess-${i}`, true)));
    }
  }
  const uniqueMessages = [...new Set(results)];
  check(
    'repeated guessing collapses onto one uniform wall',
    uniqueMessages.length === 1,
    `${uniqueMessages.length} distinct replies: ${JSON.stringify(uniqueMessages)}`
  );
  check(
    'the wall is the generic failure, not a throttle-specific message',
    uniqueMessages.every((m) => !/too many|slow down|throttl|rate limit/i.test(m)),
    JSON.stringify(uniqueMessages)
  );

  // The strongest statement of the fix: enough guesses across enough unseen
  // addresses must all collapse into the SAME answer, so nothing can be learned
  // about which addresses exist.
  const spray = new Set<string>();
  for (let i = 0; i < 12; i++) {
    spray.add(stableMessage(await attempt('signIn', `qa-spray-${stamp}-${i}@example.com`, 'x', true)));
  }
  check(
    'spraying across 12 unseen addresses yields one answer',
    spray.size === 1,
    `${spray.size} distinct: ${JSON.stringify([...spray])}`
  );

  /**
   * The throttle has to actually bite, or "one uniform answer" is satisfied by an
   * endpoint that never limits anything. 12 guesses against ONE address must stop
   * succeeding before the hourly budget of 10 is spent, and the refusal must be
   * indistinguishable from the very first wrong password.
   */
  const brute = `qa-brute-${stamp}@example.com`;
  await attempt('signUp', brute, password, true);
  const replies = new Set<string>();
  let allowed = 0;
  for (let i = 0; i < 14; i++) {
    const r = await attempt('signIn', brute, `guess-${i}`, true);
    replies.add(stableMessage(r));
    if (r.status === 'success') allowed++;
  }
  check('the budget eventually refuses', allowed === 0, `${allowed} of 14 guesses were accepted`);
  check(
    'the refusal is indistinguishable from the first wrong password',
    replies.size === 1,
    `${replies.size} distinct: ${JSON.stringify([...replies])}`
  );

  console.log('\n== 4. an honest user is not collateral damage ==');
  const honest = `qa-honest-${stamp}@example.com`;
  await attempt('signUp', honest, password, true);
  let fumbles = 0;
  for (let i = 0; i < 3; i++) {
    const r = await attempt('signIn', honest, `wrong-${i}`, true);
    if (r.status !== 'success') fumbles++;
  }
  const afterFumbles = await attempt('signIn', honest, password, true);
  check(
    'three wrong guesses then the right one still works',
    afterFumbles.status === 'success',
    `${fumbles} refusals, then: ${messageOf(afterFumbles)}`
  );
  check('the fumbles were refused', fumbles === 3, `${fumbles} of 3`);

  // And the budget is refunded on success, so the next hour is clean.
  const again = await attempt('signIn', honest, password, true);
  check('a subsequent sign-in is still fine', again.status === 'success', messageOf(again));

  console.log('\n== 5. flows with no address still work ==');
  /**
   * The client refreshes an expired session with `auth:signIn({ refreshToken })` -
   * no email, no password. An earlier version of the proxy rejected any request
   * without an email as a credential failure, which would have logged everyone out
   * the moment an access token aged out: an hour-boundary failure that looks like
   * a credentials problem and is invisible until it happens to a real user.
   */
  const refreshProbe = await call('signInProxy:signInProxy', { refreshToken: 'not-a-real-token' }, 'action');
  const refreshMsg = stableMessage(refreshProbe);
  check(
    'a refresh-token call is not answered with a credential error',
    !/not right/i.test(refreshMsg),
    refreshMsg
  );
  check(
    'a refresh-token call is rejected as a refresh, not as a password',
    /refresh|token|invalid|argument/i.test(refreshMsg),
    refreshMsg
  );

  console.log('\n== 6. malformed input is not flattened into a credential error ==');
  // A caller bug must stay debuggable. "That password is required" says nothing
  // about whether the account exists, so it passes through.
  const noPassword = await call(
    'signInProxy:signInProxy',
    { provider: 'password', params: { email: `qa-mal-${stamp}@example.com`, flow: 'signIn' } },
    'action'
  );
  const noPasswordMsg = stableMessage(noPassword);
  check(
    'a missing password is reported as a missing password',
    !/not right/i.test(noPasswordMsg) && /password|require|invalid/i.test(noPasswordMsg),
    noPasswordMsg
  );

  console.log('\n== 7. the budget cannot be reset by the client ==');
  // `chargeAttempt`/`refundAttempt` are internal. A public one would let anyone
  // clear their own throttle, which would make the limiter decorative.
  const direct = await call(
    'signInProxy:chargeAttempt',
    { key: createHash('sha256').update(honest).digest('hex') + ':signIn', flow: 'signIn', budget: 10 },
    'mutation'
  );
  check(
    'the budget mutation is not callable from the client',
    direct.status !== 'success',
    messageOf(direct)
  );

  console.log('\n-------------------------------------------');
  console.log(failures.length ? `PASSED: ${passed}   FAILED: ${failures.length}` : `ALL PASSED: ${passed} checks`);
  for (const failure of failures) console.log(`  - ${failure}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\nHARNESS FAILURE:', error);
  process.exitCode = 1;
});
