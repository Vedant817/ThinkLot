/**
 * Render the web app in real Chrome and look at every screen.
 *
 * This exists because no rendered web UI had ever been verified for this project.
 * The desktop browser tool reports `browser.disconnected` throughout the session,
 * so for a long time every web claim rested on a production build, an HTTP 200, and
 * pure-function tests. This drives real Chrome over the DevTools protocol instead.
 *
 * It signs in with a throwaway QA account created against the live dev
 * deployment, then walks every route, captures a screenshot of each, and fails on
 * any console error, uncaught exception, missing route or missing expected text.
 *
 * Run: npm run verify:web
 */
import { launch, close, events, type Page } from './browser-harness';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.env.WEB_BASE ?? 'http://127.0.0.1:4183';
const CONVEX = process.env.PUBLIC_CONVEX_URL ?? 'https://posh-chihuahua-240.convex.cloud';
const SHOTS = process.env.WEB_SHOTS ?? 'artifacts/web-verify';

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

type Kind = 'query' | 'mutation' | 'action';

/**
 * Convex HTTP call. Returns the parsed envelope, never throws on a refused call.
 *
 * The endpoint is `/api/{kind}` and the function goes in the body. Putting the
 * function name in the URL instead returns a 200 with an empty body, which
 * `response.json()` rejects with "Unexpected end of JSON input" - an error that
 * says nothing about the actual mistake.
 */
async function call(path: string, args: Record<string, unknown>, token?: string, kind: Kind = 'mutation') {
	const response = await fetch(`${CONVEX}/api/${kind}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {})
		},
		body: JSON.stringify({ path, args, format: 'json' })
	});
	const text = await response.text();
	if (!text) {
		return { status: 'error', errorMessage: `empty body from ${kind} ${path} (HTTP ${response.status})` };
	}
	try {
		return JSON.parse(text);
	} catch {
		return { status: 'error', errorMessage: `non-JSON from ${kind} ${path}: ${text.slice(0, 200)}` };
	}
}

/**
 * Sign in, or create the account first.
 *
 * Convex Auth exposes ONE action, `auth:signIn`, with the flow chosen by a
 * `flow` param - there is no `auth:signUpWithPassword`. It answers with
 * `value.tokens.{token,refreshToken}`, not with the pair at the top level. Both
 * were wrong on the first run of this file.
 */
async function signIn(email: string, password: string, flow: 'signUp' | 'signIn') {
	const result = await call(
		'auth:signIn',
		{ provider: 'password', params: { email, password, flow } },
		undefined,
		'action'
	);
	if (result.status !== 'success') throw new Error(`${flow} failed: ${result.errorMessage}`);
	return result.value.tokens as { token: string; refreshToken: string };
}

/**
 * Wait until EVERY needle is on screen, then return the text.
 *
 * Case-insensitively, and that is not cosmetic. `innerText` returns text as
 * *rendered*, so any label with `text-transform: uppercase` comes back uppercased.
 * Every stat on the dashboard is styled that way, so a lowercase needle against
 * "1 PARKED" fails on a screen that is working perfectly.
 *
 * Waiting for *all* of them rather than the first is the other half. This app is
 * a client-rendered shell over a Convex websocket, so the page chrome - headings,
 * field labels, the empty-state markup - paints long before any idea data
 * arrives. Waiting only for the heading meant the assertions ran against a screen
 * that was still loading: "The lot" was there, "LOT-0001" was not yet, and the
 * check failed on a screen that was about to be correct.
 */
async function waitForAll(page: Page, needles: string[], label: string, ms = 20_000) {
	const wants = needles.map((n) => n.toLowerCase());
	const deadline = Date.now() + ms;
	let body = '';
	while (Date.now() < deadline) {
		body = await page.text();
		const lower = body.toLowerCase();
		if (wants.every((w) => lower.includes(w))) return body;
		await sleep(400);
	}
	const missing = wants.filter((w) => !body.toLowerCase().includes(w));
	throw new Error(
		`${label}: never saw ${missing.map((m) => `"${m}"`).join(', ')}. Rendered text was:\n${body.slice(0, 900)}`
	);
}

/** Same, for an assertion - so uppercase styling cannot fail a check either. */
function has(body: string, needle: string): boolean {
	return body.toLowerCase().includes(needle.toLowerCase());
}

/**
 * The value of every labelled text area, keyed by its label.
 *
 * `innerText` cannot see form control values at all - a `<textarea>` holding
 * "field engineers" contributes nothing to the page's text. That is not a quirk of
 * this harness: it is why the first run of this file reported the idea detail page
 * as failing to show the three spec fields, when the fields were rendered and
 * populated. Only the DOM property has the answer.
 *
 * Keyed by the visible label so a value cannot be "found" in the wrong field.
 */
async function textareaValues(page: Page): Promise<Record<string, string>> {
	return page.evaluate<Record<string, string>>(`
		(() => {
			const out = {};
			for (const el of document.querySelectorAll('label')) {
				const caption = (el.querySelector('span')?.textContent ?? '').trim().toLowerCase();
				const field = el.querySelector('textarea, input');
				if (caption && field) out[caption] = field.value;
			}
			return out;
		})()
	`);
}

async function main() {
	mkdirSync(SHOTS, { recursive: true });

	const stamp = Date.now();
	const email = `qa-web-${stamp}@example.com`;
	const password = 'Correct-Horse-9-Battery';

	console.log(`\n== creating a throwaway account (${email}) ==`);
	const created = await signIn(email, password, 'signUp');
	check('created a throwaway account', Boolean(created?.token));
	const tokens = await signIn(email, password, 'signIn');
	check('signed in against the live deployment', Boolean(tokens.token));

	// Seed data so the screens have something to show. A dashboard with no ideas
	// exercises the empty state, which is not what the populated screens need.
	// `capture` deliberately accepts no tags - its validator rejects unknown fields
	// outright - so the spec's three fields are set at capture time and the tags are
	// added afterwards with `update`. Worth stating, because the error is a
	// validator rejection naming every field it *does* accept.
	const captured = await call('ideas:capture', {
		title: 'Surface stale field notes during handover',
		description:
			'Notes taken on site get buried. A handover view would list what is still unconfirmed.',
		audience: 'field engineers',
		outcome: 'no unconfirmed note survives a shift change',
		trigger: 'a postmortem in March',
		problem: 'Field notes are lost between shifts',
		source: 'typed'
	}, tokens.token);
	if (captured.status !== 'success') throw new Error(`capture failed: ${captured.errorMessage}`);
	check('captured an idea with the three spec fields', captured.status === 'success');

	const tagged = await call('ideas:update', { ideaId: captured.value, tags: ['handover', 'field'] }, tokens.token);
	check('added tags', tagged.status === 'success', String(tagged.errorMessage ?? ''));

	// A deliberately UNFORMED idea: a title and nothing else.
	//
	// Without one of these, the roadmap's "not ready" lane is never rendered and the
	// honesty feature goes untested - the dashboard would look identical whether the
	// lane worked or the code were silently padding `later` with it.
	const bare = await call('ideas:capture', { title: 'Bare note, never developed', source: 'typed' }, tokens.token);
	check('captured an unformed idea for the not-ready lane', bare.status === 'success', String(bare.errorMessage ?? ''));

	const scored = await call('ideas:update', {
		ideaId: captured.value,
		impact: 8,
		confidence: 7,
		effort: 3
	}, tokens.token);
	check('scored it, so the ranking is not empty', scored.status === 'success');

	console.log('\n== launching Chrome ==');
	const page = await launch(SHOTS);
	await page.setViewport(1280, 1000);
	// Light is the default theme under test; the dark pass is explicit below.
	await page.setColorScheme('light');

	// Establish the session the way a returning visitor would have it: tokens in
	// localStorage, which is exactly what the app's Convex client reads on boot.
	await page.goto(`${BASE}/login`);
	await page.evaluate(
		`localStorage.setItem('__convexAuthJWT', ${JSON.stringify(tokens.token)});
		 localStorage.setItem('__convexAuthRefreshToken', ${JSON.stringify(tokens.refreshToken)});
		 'seeded'`
	);

	console.log('\n== every route, rendered ==');
	const routes: { path: string; label: string; expect: string[] }[] = [
		{ path: '/', label: 'landing', expect: ['ThinkLot'] },
		// "Parked" is styled uppercase, which `innerText` reflects - hence the
		// case-insensitive comparison.
		{ path: '/dashboard', label: 'dashboard', expect: ['Dashboard', 'Parked', 'Worth building first'] },
		{ path: '/ideas', label: 'lot', expect: ['The lot', 'LOT-0001'] },
		// Labels only. The VALUES of the three spec fields live in text areas, and
		// their text is invisible to `innerText`; they are asserted separately
		// below by reading the DOM.
		{ path: `/ideas/${captured.value}`, label: 'idea detail', expect: ['Who is it for', 'Expected outcome', 'Source / trigger'] },
		{ path: '/board', label: 'board', expect: ['board'] },
		{ path: '/review', label: 'review', expect: ['review'] },
		{ path: '/archive', label: 'archive', expect: ['archive'] },
		{ path: '/settings/ai', label: 'AI settings', expect: ['Provider', 'Model'] }
	];

	for (const route of routes) {
		await page.goto(`${BASE}${route.path}`);
		try {
			// Waits for every needle, so the assertions below cannot run against a
			// screen that has painted its chrome but not its data.
			const body = await waitForAll(page, route.expect, route.label);
			for (const needle of route.expect) {
				check(`${route.label}: shows "${needle}"`, has(body, needle));
			}
			// The redirect guard sends unauthenticated visitors to /login. If that
			// happened, the seed failed and every "pass" above would be the login
			// page quietly containing the word "ThinkLot".
			const where = await page.url();
			check(`${route.label}: stayed on the route`, where.startsWith(route.path.split('?')[0]), `landed on ${where}`);
			await page.screenshot(`${SHOTS}/${route.label}.png`);
		} catch (error) {
			check(`${route.label}: rendered`, false, String(error).slice(0, 400));
		}
	}

	console.log('\n== AI settings: the honesty and safety of a BYOK key ==');

	await page.goto(`${BASE}/settings/ai`);
	const aiBody = await waitForAll(page, ['Provider', 'Model'], 'AI settings');

	// The storage trade-off must be stated BEFORE the key field, not hidden behind a
	// tooltip. A key pasted into a browser cannot be kept from that browser, and the
	// only honest response to that is to say so and let the user choose.
	check(
		'AI settings offers session-only as the default',
		/this tab only/i.test(aiBody) && /remember on this device/i.test(aiBody),
		'the two storage choices must both be visible'
	);
	check(
		'AI settings warns that a stored key is readable by scripts on this site',
		/could read it/i.test(aiBody),
		'the risk of persisting must be stated plainly'
	);
	check(
		'AI settings explains requests go straight to the provider',
		/nothing is sent to a server this app runs|no server this app runs/i.test(aiBody),
		'the privacy claim must be on the page, not only in a commit message'
	);

	// A configured provider must never require a key it does not need.
	const localNoKey = await page.evaluate<{ label: string; disabled: boolean; placeholder: string }>(`
		(() => {
			const select = document.querySelector('#provider');
			const options = [...select.querySelectorAll('option')].map(o => ({ value: o.value, label: o.textContent }));
			const ollama = options.find(o => /ollama/i.test(o.value));
			if (!ollama) return { label: '', disabled: false, placeholder: '' };
			select.value = ollama.value;
			select.dispatchEvent(new Event('change', { bubbles: true }));
			return new Promise(r => setTimeout(() => {
				const key = document.querySelector('#key');
				r({ label: ollama.label, disabled: key?.disabled ?? false, placeholder: key?.placeholder ?? '' });
			}, 250));
		})()
	`);
	check('AI settings lists a genuinely free local provider', /ollama/i.test(localNoKey.label), localNoKey.label);
	check(
		'a local provider does not demand a key it will not use',
		localNoKey.disabled && /not required/i.test(localNoKey.placeholder),
		`disabled=${localNoKey.disabled} placeholder=${JSON.stringify(localNoKey.placeholder)}`
	);

	// An incomplete setup must disable the test button AND say what is missing, rather
	// than letting the user fire a request that cannot work.
	const gated = await page.evaluate<{ disabled: boolean; reason: string }>(`
		(() => {
			const btn = [...document.querySelectorAll('button')].find(b => /test connection/i.test(b.textContent));
			return { disabled: btn?.disabled ?? true, reason: document.body.innerText };
		})()
	`);
	check('AI settings blocks a test with no model chosen', gated.disabled, 'the test button must be disabled');

	// A key must never be rendered back in full, in any state.
	check(
		'AI settings renders no pasted key back in full',
		!/sk-[A-Za-z0-9]{12,}/.test(gated.reason),
		'a raw API key is visible in the page text'
	);

	await page.screenshot(`${SHOTS}/ai-settings.png`);

	console.log('\n== AI actions on an idea: inert until configured, and honest about it ==');

	await page.goto(`${BASE}/ideas/${captured.value}`);
	// Wait on a STATIC label, not on the idea's problem text. That text lives in a
	// textarea, and `innerText` cannot see form-control values - the same trap this
	// harness documents elsewhere, hit again here.
	await waitForAll(page, ['WHO IS IT FOR'], 'idea detail');

	// The account running this suite has NO AI key configured, which is the state every
	// user starts in. The buttons must be visibly disabled AND must explain why, with a
	// route to fix it. A greyed-out button with no explanation is the failure this checks.
	const aiIdle = await page.evaluate<{ disabled: boolean; hint: string }>(`
		(() => {
			const btn = document.querySelector('[data-ai-action="Summarise"]');
			const panel = document.querySelector('[data-ai-panel]');
			return {
				disabled: btn?.disabled ?? false,
				hint: (panel?.innerText ?? '').trim()
			};
		})()
	`);
	check('the AI panel renders on an idea', aiIdle.hint.length > 0);
	check('Summarise is disabled with no provider configured', aiIdle.disabled, 'a model call must not be possible unconfigured');
	check(
		'an unconfigured AI button explains itself and links to settings',
		/set one up/i.test(aiIdle.hint),
		`panel: ${JSON.stringify(aiIdle.hint.slice(0, 200))}`
	);
	check(
		'no AI call is attempted without configuration',
		!(await page.evaluate<boolean>(`
			(() => !!document.querySelector('[data-ai-error]'))()
		`)),
		'an error appeared even though nothing was pressed'
	);

	// The duplicate check must NOT appear for an idea with no similar title. Offering
	// the button when there is nothing to judge invites a call that cannot conclude
	// anything, and "no duplicates" is a claim the shortlist cannot support.
	const dupButton = await page.evaluate<boolean>(`
		(() => !!document.querySelector('[data-ai-action="Check for duplicates"]'))()
	`);
	check(
		'the duplicate check is absent when there is nothing to judge',
		!dupButton,
		'offered a judgement with an empty shortlist'
	);

	// Consent must be stated before anything is sent, so it has to be visible in the
	// CONFIGURED state - which is the only state where a send is possible.
	//
	// Configured here with Ollama, which needs no key. That enables the button without
	// a secret and without any provider being reachable, so the copy can be asserted
	// honestly. The button is deliberately NOT clicked: there is no local model server,
	// and a test that fires a real request at a non-existent endpoint proves nothing.
	await page.evaluate(`
		(() => {
			sessionStorage.setItem('thinklot.ai.v1.config', JSON.stringify({
				providerId: 'ollama', baseUrl: '', model: 'llama3.2'
			}));
			return true;
		})()
	`);
	// Navigate rather than reload: this harness has no reload(), and a plain goto is the
	// same thing for this purpose - a fresh document reading the storage we just wrote.
	await page.goto(`${BASE}/ideas/${captured.value}`);
	await waitForAll(page, ['WHO IS IT FOR'], 'idea detail, configured');

	const armed = await page.evaluate<{ enabled: boolean; panel: string }>(`
		(() => {
			const btn = document.querySelector('[data-ai-action="Summarise"]');
			return {
				enabled: btn ? !btn.disabled : false,
				panel: document.querySelector('[data-ai-panel]')?.innerText ?? ''
			};
		})()
	`);
	check('a configured provider enables the action', armed.enabled, `panel: ${JSON.stringify(armed.panel.slice(0, 160))}`);
	check(
		'the panel states exactly what will be sent',
		/sends? this idea|title/i.test(armed.panel),
		`panel: ${JSON.stringify(armed.panel.slice(0, 200))}`
	);
	check(
		'nothing was sent just because the provider became configured',
		!/Working|error/i.test(armed.panel),
		'a call fired on load, which would cost the user money unbidden'
	);

	// Clear it again so the rest of the suite runs as it was.
	await page.evaluate(`sessionStorage.removeItem('thinklot.ai.v1.config'); true`);

	await page.screenshot(`${SHOTS}/idea-ai.png`);

	console.log('\n== the dashboard tells the truth about this account ==');
	/**
	 * This started as a screenshot and a suspicion.
	 *
	 * The first dashboard screenshot showed "0 ideas parked" and "Nothing scored
	 * yet" on a run whose own account had just captured and scored an idea - and
	 * whose lot page, in the same run, listed LOT-0001. Either the screenshot was
	 * taken before the query resolved, or the dashboard is reading something other
	 * than this user's data. A picture cannot distinguish those, so this asserts the
	 * numbers instead.
	 *
	 * Both failure modes are real bugs if true: a dashboard that reports zero for an
	 * account with ideas is worse than no dashboard, because it is confidently
	 * wrong.
	 */
	{
		await page.goto(`${BASE}/dashboard`);
		await waitForAll(page, ['Dashboard'], 'dashboard for counts');

		// Wait for the count to stop being zero, rather than sampling once. A
		// dashboard that renders its zeros before its data is the exact bug above,
		// so it has to settle first.
		const deadline = Date.now() + 15_000;
		let body = await page.text();
		while (Date.now() < deadline && !/parked\s*\n?\s*1\b/i.test(body)) {
			await sleep(400);
			body = await page.text();
		}

		// Both ideas sit in INBOX, so that is the row that should read 2. Asserting on
	// `parked` was asserting on an assumption about where scoring puts an idea, which
	// is a different question and was quietly wrong once a second idea existed.
	check('the dashboard counts the ideas', /inbox\s*\n?\s*2\b/i.test(body), body.slice(0, 200));
		check('the dashboard does not claim nothing is scored', !has(body, 'Nothing scored yet'), 'the ranking is empty despite a scored idea');
		check('the dashboard ranks the scored idea', has(body, 'Surface stale field notes'), 'the idea is missing from "worth building first"');

		// --- Roadmap ---------------------------------------------------------------
		//
		// Read structurally with a data attribute, for the same reason the pipeline is:
		// lane headings are uppercased by CSS, so a text match on "Now" against "NOW" is
		// a formatting accident, not a fact about the page.
		const lanes = await page.evaluate<Array<{ lane: string; titles: string[] }>>(`
			(() => {
				const out = [...document.querySelectorAll('[data-lane]')].map((section) => ({
					lane: section.getAttribute('data-lane') ?? '',
					titles: [...section.querySelectorAll('[data-idea]')].map((a) => (a.textContent ?? '').trim())
				}));
				return out;
			})()
		`);

		check('the roadmap renders lanes', lanes.length >= 1, `lanes: ${JSON.stringify(lanes)}`);
		const nowTitles = lanes.find((l) => l.lane === 'now')?.titles ?? [];
		check('the roadmap does not pad `now` to its capacity', nowTitles.length <= 3, `now holds ${nowTitles.length}`);
		check(
			'the roadmap puts the only plannable idea in `now`',
			nowTitles.some((t) => t.startsWith('Surface stale field notes')),
			JSON.stringify(lanes)
		);
		// The unformed idea must NOT reach `now`, and must be disclosed as unready
		// with a reason - not silently filed under `later` as if it were a deferral.
		check(
			'the roadmap does not let an unformed idea into `now`',
			!nowTitles.some((t) => t.includes('Bare note')),
			JSON.stringify(lanes)
		);
		check(
			'the roadmap explains what is not ready',
			/not ready yet/i.test(body),
			'no "not ready yet" disclosure for ideas that cannot be ranked'
		);
		// Read via textContent, not innerText. The not-ready lane lives in a collapsed
		// <details>, and `innerText` returns text *as rendered* - collapsed children
		// are display:none, so they are genuinely not in it. Asserting on innerText
		// here would fail on a page that is working perfectly, or worse, pass because
		// the reason is missing entirely and the summary happens to match.
		const notReadyText = await page.evaluate<string>(`
			(() => (document.querySelector('[data-lane="unready"], details')?.textContent ?? ''))()
		`);
		check(
			'the roadmap says why the unformed idea is not ready',
			/not scored/i.test(notReadyText),
			`not-ready lane text: ${JSON.stringify(notReadyText.slice(0, 200))}`
		);
		check(
			'the roadmap names the unformed idea in the not-ready lane',
			/Bare note/i.test(notReadyText),
			JSON.stringify(notReadyText.slice(0, 200))
		);

		// The pipeline, read structurally rather than by regex over text. `innerText`
		// collapses the bar element between the stage label and its count, so the
		// characters between "INBOX" and "1" are formatting, not content - which is
		// why a pattern match over the text was the wrong tool.
		const pipeline = await page.evaluate<Array<[string, string]>>(`
			(() => {
				const rows = [...document.querySelectorAll('[data-stage]')];
				return rows.map(row => [
					row.getAttribute('data-stage'),
					(row.querySelector('[data-numeric]')?.textContent ?? '').trim()
				]);
			})()
		`);
		check('the pipeline lists every stage', pipeline.length === 6, `${pipeline.length} rows: ${JSON.stringify(pipeline)}`);
		const total = pipeline.reduce((sum, [, count]) => sum + (Number(count) || 0), 0);
		// TWO ideas exist in this account: the developed, scored one, and the bare note
		// added for the not-ready lane. Both sit in `inbox`, because scoring an idea
		// does not advance it to `parked` - worth being explicit, since a count that
		// does not move when it is expected to reads as a pipeline bug.
		check('the pipeline accounts for both ideas', total === 2, `pipeline sums to ${total}: ${JSON.stringify(pipeline)}`);
		check('the inbox row holds both', pipeline.find(([stage]) => stage === 'inbox')?.[1] === '2', JSON.stringify(pipeline));
		await page.screenshot(`${SHOTS}/dashboard-desktop.png`);
	}

	console.log('\n== the three spec fields actually hold their values ==');
	{
		// The Inbox model in spec section 2 lists "who is it for", "expected
		// outcome" and "source / trigger". These were absent from the schema, the
		// mutations and both clients for the whole project, so asserting that a
		// round trip through the database and back into the editor is worth more
		// than asserting the labels are on screen.
		await page.goto(`${BASE}/ideas/${captured.value}`);
		await waitForAll(page, ['Who is it for'], 'idea detail for values');

		// The values arrive over the websocket, so wait for them rather than
		// asserting immediately after the labels appear.
		const deadline = Date.now() + 15_000;
		let fields: Record<string, string> = {};
		while (Date.now() < deadline) {
			fields = await textareaValues(page);
			if (has(fields['who is it for'] ?? '', 'field engineers')) break;
			await sleep(400);
		}
		check('"who is it for" holds the saved value', has(fields['who is it for'] ?? '', 'field engineers'), `got "${fields['who is it for'] ?? ''}"`);
		check('"expected outcome" holds the saved value', has(fields['expected outcome'] ?? '', 'no unconfirmed note'), `got "${fields['expected outcome'] ?? ''}"`);
		check('"source / trigger" holds the saved value', has(fields['source / trigger'] ?? '', 'a postmortem in March'), `got "${fields['source / trigger'] ?? ''}"`);

		/**
		 * Maturity, which is spec section 8's "idea maturity tracking".
		 *
		 * The fixture has all three core questions and a score, and no tasks, so the
		 * expected stage is "Judged" and the expected next step is the task. Both are
		 * asserted rather than just "a maturity panel exists" - a panel that renders
		 * the wrong stage is worse than no panel, because it is believed.
		 */
		const detail = await page.text();
		check('the idea shows its maturity', has(detail, 'Maturity'));
		check('maturity is judged for a written, scored, taskless idea', has(detail, 'Judged'), detail.slice(0, 300).replace(/\n+/g, ' | '));
		check('maturity suggests the next step', has(detail, 'Add one task'), detail.slice(0, 300).replace(/\n+/g, ' | '));

		await page.screenshot(`${SHOTS}/idea-detail-fields.png`);
	}

	console.log('\n== the two views of the lot ==');
	await page.goto(`${BASE}/ideas?view=list`);
	try {
		const body = await waitForAll(page, ['The lot', 'LOT-0001'], 'lot list view');
		check('list view renders', has(body, 'The lot'));
		// The list view drops the description. If the card layout has leaked into
		// this branch, the preview text is the thing that gives it away.
		check(
			'list view omits the card preview',
			!has(body, 'Notes taken on site get buried'),
			'the card layout rendered in the list branch'
		);
		check('list view still shows the plate', has(body, 'LOT-0001'));
		await page.screenshot(`${SHOTS}/lot-list-view.png`);
	} catch (error) {
		check('list view renders', false, String(error).slice(0, 300));
	}

	console.log('\n== a filtered lot survives a reload, which is the point of the URL work ==');
	await page.goto(`${BASE}/ideas?q=handover&sort=priority&view=list`);
	try {
		await waitForAll(page, ['Surface stale field notes'], 'filtered lot');
		const before = await page.url();
		check('filters are in the URL', before.includes('q=handover') && before.includes('sort=priority'), before);
		await page.screenshot(`${SHOTS}/lot-filtered.png`);

		// The whole reason for the last change: a full reload must not lose them.
		await page.goto(`${BASE}/ideas?q=handover&sort=priority&view=list`);
		const after = await waitForAll(page, ['Surface stale field notes'], 'filtered lot after reload');
		check('the filter still matches after a reload', has(after, 'Surface stale field notes'));
		check('the URL survived the reload', (await page.url()).includes('q=handover'));
	} catch (error) {
		check('a filtered lot renders', false, String(error).slice(0, 300));
	}

	console.log('\n== opening an idea and coming back keeps the filters ==');
	try {
		await page.goto(`${BASE}/ideas?q=handover`);
		await waitForAll(page, ['Surface stale field notes'], 'lot for click-through');
		// Click the title link, the way a person would.
		const clicked = await page.evaluate<boolean>(
			`(() => {
				const link = [...document.querySelectorAll('a')].find(a => a.href.includes('/ideas/') && a.href.indexOf('/ideas?') === -1);
				if (!link) return false;
				link.click();
				return true;
			})()`
		);
		check('found and clicked an idea link', clicked);
		await sleep(1200);
		const onDetail = await page.url();
		check('the link carried the filters', onDetail.includes('q=handover'), onDetail);

		// Now the app's own back link, which used to discard everything.
		const back = await page.evaluate<boolean>(
			`(() => {
				const link = [...document.querySelectorAll('a')].find(a => a.textContent.includes('Back to the lot'));
				if (!link) return false;
				link.click();
				return true;
			})()`
		);
		check('found the back link', back);
		await sleep(1200);
		const backTo = await page.url();
		check('back returned to the filtered lot', backTo.includes('q=handover'), backTo);
		const body = await page.text();
		check('the filtered idea is still listed', has(body, 'Surface stale field notes'));
	} catch (error) {
		check('round trip preserves filters', false, String(error).slice(0, 300));
	}

	console.log('\n== keyboard on a page that has just loaded ==');
	/**
	 * This block exists because it found a bug nothing else could.
	 *
	 * The capture textarea had `autofocus`, so `document.activeElement` was that
	 * textarea on load, so `isTyping(event.target)` was true for every keystroke, so
	 * the layout's key handler returned early for all of them. Every one of the 43
	 * shortcuts was dead on the lot page. The offline suite passed throughout
	 * because it injects its own handler and never has focus.
	 */
	try {
		await page.goto(`${BASE}/ideas`);
		await waitForAll(page, ['The lot', 'LOT-0001'], 'lot for keyboard test');

		// The precondition, asserted rather than assumed. If something focuses a
		// field on load again, this says so instead of the chords failing obscurely.
		const focused = await page.evaluate<string>(
			`document.activeElement?.tagName ?? 'none'`
		);
		check(
			'no field holds focus on load',
			!['INPUT', 'TEXTAREA'].includes(focused),
			`focus was on ${focused}, which suppresses every shortcut`
		);

		// Trusted events through Chrome's own input pipeline.
		await page.press('g');
		await page.press('d');
		await sleep(1400);
		const chord = await page.url();
		check('g then d reaches the dashboard', chord.startsWith('/dashboard'), `landed on ${chord}`);
		await page.screenshot(`${SHOTS}/dashboard-via-keyboard.png`);

		// `/` must still be the way into the capture box - that is what replacing
		// autofocus rests on, so it is checked rather than assumed.
		await page.goto(`${BASE}/ideas`);
		await waitForAll(page, ['The lot'], 'lot for the capture shortcut');
		await page.press('/');
		await sleep(500);
		const nowFocusing = await page.evaluate<string>(
			`document.activeElement?.tagName ?? 'none'`
		);
		check('/ focuses the capture box', nowFocusing === 'TEXTAREA', `focus is on ${nowFocusing}`);

		// And with focus in that box, typing must win over shortcuts. This is the
		// behaviour the `isTyping` guard exists to protect, and the reason it must
		// not simply be deleted.
		await page.evaluate(
			`(() => { const el = document.activeElement; el.value = ''; el.focus(); return 1; })()`
		);
		await page.press('l');
		await sleep(300);
		check(
			'a letter typed into capture does not navigate',
			(await page.url()).startsWith('/ideas'),
			`navigated to ${await page.url()}`
		);
	} catch (error) {
		check('keyboard works on a freshly loaded page', false, String(error).slice(0, 300));
	}

	console.log('\n== narrow viewport, the layout claim ==');
	await page.setViewport(390, 844);
	await page.goto(`${BASE}/ideas`);
	try {
		const body = await waitForAll(page, ['The lot', 'LOT-0001'], 'lot on a phone');
		// No horizontal overflow: the single most common responsive bug, and one
		// that a screenshot taken at desktop width can never reveal.
		const overflow = await page.evaluate<number>(
			'document.documentElement.scrollWidth - document.documentElement.clientWidth'
		);
		check('no horizontal overflow at 390px', overflow <= 1, `${overflow}px of overflow`);

		// The search field being *present* is not the same as being usable. At 390px
		// it once collapsed to about thirty pixels - a sliver you cannot type into -
		// which is why "the lot renders on a phone" passed while search was
		// impossible there. The spec asks the list view to "scan and search quickly".
		const searchWidth = await page.evaluate<number>(
			`document.querySelector('[data-testid="lot-search"]')?.getBoundingClientRect().width ?? 0`
		);
		check(
			'the search field is usable on a phone',
			searchWidth >= 200,
			`only ${Math.round(searchWidth)}px wide at 390px`
		);

		// And typing in it actually filters, at that width.
		await page.press('/');
		await page.evaluate(
			`(() => {
				const el = document.querySelector('[data-testid="lot-search"]');
				el.focus();
				el.value = 'handover';
				el.dispatchEvent(new Event('input', { bubbles: true }));
				return 1;
			})()`
		);
		await sleep(1200);
		check('search filters on a phone', has(await page.text(), 'Surface stale field notes'));

		await page.screenshot(`${SHOTS}/lot-390.png`);
		check('lot renders on a phone', has(body, 'The lot'));
	} catch (error) {
		check('lot renders at 390px', false, String(error).slice(0, 300));
	}

	await page.setViewport(1280, 1000);

	console.log('\n== dark mode ==');
	await page.setColorScheme('dark');
	await page.goto(`${BASE}/dashboard`);
	try {
		await waitForAll(page, ['Dashboard'], 'dashboard in dark mode');
		await sleep(600);
		await page.screenshot(`${SHOTS}/dashboard-dark.png`);
		const theme = await page.evaluate<string>('document.documentElement.dataset.theme');
		check('dark theme applies', theme === 'dark', theme);
		// A dark-mode screenshot that is silently light proves nothing about dark
		// mode, which is exactly what headless Chrome's default caused.
		const background = await page.evaluate<string>(
			`getComputedStyle(document.body).backgroundColor`
		);
		check('the dark surface is actually dark', background !== 'rgb(255, 255, 255)', background);
	} catch (error) {
		check('dark mode renders', false, String(error).slice(0, 200));
	}

	console.log('\n== console output ==');
	// Warnings are reported but do not fail: a React Native-flavoured library
	// logging a deprecation is not a broken app. Errors do fail.
	const errors = events.console.filter((e) => e.level === 'error');
	const exceptions = events.errors;
	check('no uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));
	check('no console errors', errors.length === 0, errors.slice(0, 3).map((e) => e.text).join(' | '));
	if (events.console.length) {
		console.log('  console output seen:');
		for (const entry of events.console.slice(0, 12)) console.log(`    ${entry.level}: ${entry.text.slice(0, 160)}`);
	}

	await close();

	console.log('\n-------------------------------------------');
	console.log(failures.length ? `PASSED: ${passed}   FAILED: ${failures.length}` : `ALL PASSED: ${passed} checks`);
	for (const failure of failures) console.log(`  - ${failure}`);
	console.log(`\nScreenshots: ${SHOTS}`);
	if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
	console.error('\nHARNESS FAILURE:', error);
	await close();
	process.exitCode = 1;
});
