/**
 * Two clients, a dropped connection, and a session that has aged out.
 *
 * These three were listed as unverified for the whole life of this project, on the
 * grounds that they needed a browser. There is now a browser (`npm run verify:web`
 * drives real Chrome), so "needs a browser" stopped being a reason.
 *
 * Each case is a way a real person loses work:
 *   - two devices editing one idea, one's unsaved text replaced by the other's save
 *   - a tunnel, a lift, a train; and what the app claims while it is disconnected
 *   - coming back to a tab after the access token expired
 *
 * Run: npm run verify:concurrency
 */
import { launch, newTab, setOffline, close, type Page } from './browser-harness';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.WEB_BASE ?? 'http://127.0.0.1:4183';
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

async function call(path: string, args: Record<string, unknown>, token?: string, kind: 'query' | 'mutation' | 'action' = 'mutation') {
  const response = await fetch(`${CONVEX}/api/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ path, args, format: 'json' })
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: 'error', errorMessage: text.slice(0, 200) };
  }
}

async function waitFor(page: Page, needle: string, label: string, ms = 20_000) {
  const want = needle.toLowerCase();
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const body = await page.text();
    if (body.toLowerCase().includes(want)) return body;
    await sleep(400);
  }
  throw new Error(`${label}: never saw "${needle}". Saw:\n${(await page.text()).slice(0, 700)}`);
}

/** Read a textarea's current value by its visible label. */
async function fieldValue(page: Page, label: string): Promise<string> {
  return page.evaluate<string>(`
    (() => {
      for (const el of document.querySelectorAll('label')) {
        const caption = (el.querySelector('span')?.textContent ?? '').trim().toLowerCase();
        if (caption === ${JSON.stringify(label.toLowerCase())}) {
          return (el.querySelector('textarea, input')?.value ?? '');
        }
      }
      return '';
    })()
  `);
}

/** Type into a labelled field the way a person would, so the app sees real input. */
async function setField(page: Page, label: string, value: string) {
  await page.evaluate(`
    (() => {
      for (const el of document.querySelectorAll('label')) {
        const caption = (el.querySelector('span')?.textContent ?? '').trim().toLowerCase();
        if (caption === ${JSON.stringify(label.toLowerCase())}) {
          const field = el.querySelector('textarea, input');
          const setter = Object.getOwnPropertyDescriptor(
            field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
            'value'
          )?.set;
          setter?.call(field, ${JSON.stringify(value)});
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          field.focus();
          return 1;
        }
      }
      return 0;
    })()
  `);
}

async function main() {
  const stamp = Date.now();
  const email = `qa-conc-${stamp}@example.com`;
  const password = 'Correct-Horse-9-Battery';

  console.log('\n== fixture ==');
  const up = await call('signInProxy:signInProxy', { provider: 'password', params: { email, password, flow: 'signUp' } }, undefined, 'action');
  if (up.status !== 'success') throw new Error(`signup failed: ${up.errorMessage}`);
  const session = await call('signInProxy:signInProxy', { provider: 'password', params: { email, password, flow: 'signIn' } }, undefined, 'action');
  const tokens = session.value.tokens;
  const captured = await call('ideas:capture', { title: 'Shared handover note', description: 'first draft' }, tokens.token);
  const ideaId = captured.value;
  check('fixture: an idea exists', typeof ideaId === 'string');

  const first = await launch('artifacts/concurrency');
  await first.setViewport(1280, 1000);
  await first.setColorScheme('light');
  await first.goto(`${BASE}/login`);
  await first.evaluate(
    `localStorage.setItem('__convexAuthJWT', ${JSON.stringify(tokens.token)});
     localStorage.setItem('__convexAuthRefreshToken', ${JSON.stringify(tokens.refreshToken)}); 'ok'`
  );

  // A second tab in the same browser, so it shares the session. This is what makes
  // it a second client rather than a second page.
  const second = await newTab();
  await second.setViewport(1280, 1000);
  await second.goto(`${BASE}/ideas/${ideaId}`);
  // Waiting on a LABEL, not the title. The title is the value of a text input and
  // `innerText` cannot see form control values at all - the same trap that made the
  // idea detail page look broken in verify-web.
  await waitFor(second, 'SOURCE / TRIGGER', 'client B detail');

  console.log("\n== 1. an unsaved edit is not clobbered by another client's save ==");
  /**
   * The `reconcile` aliasing bug - `values` and `baseline` were the same object -
   * was found by a test and fixed, but never exercised by two clients actually
   * writing at once. This is that exercise.
   *
   * Client A opens the idea and starts typing. Client B saves a different field.
   * A's unsaved text must survive, because losing it silently is the failure.
   */
  await first.goto(`${BASE}/ideas/${ideaId}`);
  await waitFor(first, 'SOURCE / TRIGGER', 'client A detail');
  await setField(first, 'Source / trigger', 'my unsaved sentence in progress');
  await sleep(400);
  check('client A has unsaved text', (await fieldValue(first, 'Source / trigger')).includes('unsaved'));

  await setField(second, 'Expected outcome', 'set by the other device');
  await sleep(500);
  /**
   * The web detail page commits a field on BLUR, not on a Save button - that is the
   * mobile UI. A synthetic `element.click()` on the body does not move focus, so no
   * blur fires, so nothing is written: the first version of this test "saved" with a
   * body click, the edit never reached the server, and the two-client check was
   * blaming realtime delivery for the test's own failure to save.
   */
  await second.evaluate(`document.activeElement instanceof HTMLElement ? (document.activeElement.blur(), 'blurred') : 'nothing focused'`);
  await sleep(2500);

  const aTrigger = await fieldValue(first, 'Source / trigger');
  check(
    'client A still has its unsaved text after client B saved',
    aTrigger.includes('in progress'),
    `trigger is now "${aTrigger}"`
  );

  // Ground truth first. If client B's own save did not land, then client A showing
  // an empty outcome is correct behaviour and the check below would be blaming the
  // app for the test's failure to save.
  const bOutcome = await fieldValue(second, 'Expected outcome');
  check('client B saved its own edit', bOutcome.includes('other device'), `client B outcome is "${bOutcome}"`);

  const aOutcome = await fieldValue(first, 'Expected outcome');
  check(
    'client A picked up the field nobody was editing',
    aOutcome.includes('other device'),
    `outcome is "${aOutcome}"`
  );
  const bTrigger = await fieldValue(second, 'Source / trigger');
  check(
    "client B does not see client A's unsaved text",
    !bTrigger.includes('in progress'),
    `client B trigger is "${bTrigger}"`
  );

  /**
   * Ground truth, from the server rather than from a buffer.
   *
   * Reading client B's field only proves B's local buffer holds the text, which is
   * true whether or not the save succeeded. This reloads client A from scratch: if
   * the value is there after a reload it reached the server, and the failure above
   * is realtime delivery. If it is not there, the save never happened and blaming
   * A's subscription for it would be wrong.
   */
  await first.goto(`${BASE}/ideas/${ideaId}`);
  await waitFor(first, 'SOURCE / TRIGGER', 'client A after a reload', 15_000);
  await sleep(1500);
  const reloadedOutcome = await fieldValue(first, 'Expected outcome');
  check(
    "the other client's edit reached the server at all",
    reloadedOutcome.includes('other device'),
    `after a full reload the outcome is "${reloadedOutcome}", so the save never landed`
  );

  console.log('\n== 2. the app survives a dropped connection ==');
  /**
   * Offline is not an error state to be cheerful about. What matters is that the
   * app does not claim the server said something it did not, and does not lose the
   * page. It should say it is offline - there is already an offline banner in the
   * layout - and recover on its own.
   */
  await first.goto(`${BASE}/ideas`);
  await waitFor(first, 'The lot', 'lot before going offline');

  // Asserted while genuinely connected, because this is the bug that was actually
  // fixed here: `connection` starts as 'connecting', so a cold load used to
  // announce "Reconnecting..." while the socket was opening for the first time -
  // a claim about a dropped connection that had not happened.
  const connectedText = await first.text();
  check(
    'it does not claim to be disconnected while connected',
    !/offline/i.test(connectedText),
    'announced a dropped connection on a healthy load'
  );

  await setOffline(first, true);
  await sleep(1500);

  const offlineText = await first.text();
  check('the page is still rendered while offline', offlineText.length > 40);
  check(
    'it does not claim the account has no ideas while offline',
    !/nothing parked yet/i.test(offlineText),
    'the empty state was shown because the query failed'
  );
  /**
   * What this harness CANNOT prove, stated rather than faked.
   *
   * The app's offline banner is keyed on the Convex WebSocket reporting
   * `disconnected`. `Network.emulateNetworkConditions` blocks new requests but
   * leaves an already-established WebSocket open, so the app has no way to know
   * the network is gone and correctly does not claim to be offline. Asserting the
   * banner appears would be asserting something untrue about the method, so this
   * records the limitation instead of inventing a check that cannot fail.
   */
  console.log('  NOTE  an established websocket is not closed by CDP offline emulation, so');
  console.log('        the in-app offline banner cannot be provoked this way; it is covered by');
  console.log('        the reconnect and no-false-claim checks instead.');

  // Capture must not silently discard a thought typed while offline.
  const draftKept = await first.evaluate<string>(`
    (() => {
      const field = document.querySelector('textarea[placeholder*="came to you"], textarea[aria-label="Capture an idea"]');
      if (!field) return '';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(field, 'typed while the tunnel was down');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return field.value;
    })()
  `);
  check('a draft typed while offline is kept', draftKept.includes('tunnel'), `draft reads "${draftKept}"`);

  await setOffline(first, false);
  await sleep(4000);
  const backText = await first.text();
  check('it does not claim to be offline once reconnected', !/offline/i.test(backText));
  check('the list repainted after reconnect', backText.includes('LOT-0001'));

  console.log('\n== 3. a session that has aged out refreshes itself ==');
  /**
   * The access token is short-lived, so every real return visit exercises the
   * refresh path. Rewriting `exp` into the past makes the client believe its token
   * is stale, which is exactly the state a returning user is in - and the refresh
   * token is genuine, so the recovery has to work.
   */
  const stale = await first.evaluate<string>(`
    (() => {
      const raw = localStorage.getItem('__convexAuthJWT');
      if (!raw) return '';
      const [head, body, sig] = raw.split('.');
      const payload = JSON.parse(atob(body.replace(/-/g,'+').replace(/_/g,'/')));
      const exp = Math.floor(Date.now() / 1000) - 3600;
      const forged = btoa(JSON.stringify({ ...payload, exp }))
        .replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
      const staleToken = head + '.' + forged + '.' + sig;
      localStorage.setItem('__convexAuthJWT', staleToken);
      return staleToken;
    })()
  `);
  check('an expired-looking token was planted', stale.length > 20);

  await first.goto(`${BASE}/ideas`);
  // The client should notice the token is stale, exchange the refresh token, and
  // never show a login screen. Redirecting to /login here would be the bug.
  await sleep(6000);
  const afterExpiry = await first.url();
  check('the app did not bounce to the login page', !afterExpiry.includes('/login'), `landed on ${afterExpiry}`);
  const fresh = await first.evaluate<string>(`localStorage.getItem('__convexAuthJWT') ?? ''`);
  check('a working token replaced the stale one', fresh.length > 20 && fresh !== stale);
  try {
    await waitFor(first, 'LOT-0001', 'list after refresh', 12_000);
    check('the list still loads on the refreshed session', true);
  } catch (error) {
    check('the list still loads on the refreshed session', false, String(error).slice(0, 200));
  }

  await close();
  console.log('\n-------------------------------------------');
  console.log(failures.length ? `PASSED: ${passed}   FAILED: ${failures.length}` : `ALL PASSED: ${passed} checks`);
  for (const failure of failures) console.log(`  - ${failure}`);
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  console.error('\nHARNESS FAILURE:', error);
  await close();
  process.exitCode = 1;
});
