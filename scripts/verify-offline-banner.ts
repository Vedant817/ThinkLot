/**
 * Offline-banner invariants.
 *
 * The failure this catches is specific: an app that says nothing when its transport
 * drops, while edits are being queued. Two device runs found this the honest way.
 *
 * Run 1: a Samsung A22 with no network sat on "Connecting..." forever with nothing on
 * screen to say why.
 *
 * Run 2: the fix I wrote for run 1 was itself broken in two ways, and only logcat and
 * the view hierarchy caught it:
 *   - mounting the banner as a bare child of `Stack` produced "Unknown child element
 *     passed to Stack" and rendered nothing;
 *   - declaring it as `<Stack.Screen name="connection">` instead would never have
 *     mounted at all, because declaring a route does not focus it.
 *
 * So the tests below are as much about the banner being REACHABLE as about when it
 * speaks. A banner that is correctly silent in every wrong case is still no banner.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { connectionStatus, connectionSnapshot, IDLE_STATUS } from '../apps/mobile/src/lib/connection-state';

const stub = (isConnected: boolean, hasEver: boolean) => ({
	connectionState: () => ({ isWebSocketConnected: isConnected, hasEverConnected: hasEver }),
	subscribeToConnectionState: () => () => {}
});

// ---------------------------------------------------------------- state rules

// 1. A cold start is silent. "Offline" on a first load is a false alarm that trains
//    people to dismiss the banner and never see it again.
{
	const idle = connectionStatus(stub(false, false));
	assert.equal(idle.idle, true, 'never connected is idle, not offline');
	assert.equal(idle.reconnecting, false, 'and must not announce a problem');
}

// 2. A working connection is silent.
{
	const live = connectionStatus(stub(true, true));
	assert.equal(live.connected, true);
	assert.equal(live.idle, false);
	assert.equal(live.reconnecting, false);
}

// 3. A drop AFTER a working connection announces itself.
{
	const dropped = connectionStatus(stub(false, true));
	assert.equal(dropped.reconnecting, true, 'a real reconnection shows the banner');
	assert.equal(dropped.idle, false, 'and is not confused with a first load');
	assert.equal(dropped.connected, false);
}

// 4. No client (bad deployment URL) is idle, so the layout's own message wins.
{
	const none = connectionStatus(null);
	assert.equal(none.idle, true, 'a missing client is a cold start, not an outage');
	assert.equal(none.reconnecting, false);
}

// 5. `idle` and `reconnecting` can never both be true, or the banner renders on first
//    load. Checked exhaustively because the component's early return depends on it.
for (const connected of [true, false]) {
	for (const ever of [true, false]) {
		const s = connectionStatus(stub(connected, ever));
		assert.equal(
			s.idle && s.reconnecting,
			false,
			`idle and reconnecting both true for connected=${connected} ever=${ever}`
		);
	}
}

// 6. Recovery is observable, so the banner can clear itself.
{
	const recovered = connectionStatus(stub(true, true));
	assert.equal(recovered.connected, true);
}

// --------------------------------------------------- snapshot cache stability

// `useSyncExternalStore` throws "The result of getSnapshot should be cached to avoid an
// infinite loop" if getSnapshot returns a fresh object each call. The raw status does.
// The cached one must not.
{
	const first = connectionSnapshot(stub(true, true));
	const second = connectionSnapshot(stub(true, true));
	assert.equal(first, second, 'an unchanged connection must return the SAME object');

	// And it must swap when a flag really turns over.
	const after = connectionSnapshot(stub(false, true));
	assert.notEqual(first, after, 'a real change must produce a new object');
	assert.equal(after.reconnecting, true);
}

// 7. A null client must not blow the cache up.
{
	const none = connectionSnapshot(null);
	assert.equal(none.idle, true);
	assert.equal(none, IDLE_STATUS, 'the idle status is a shared singleton');
}

// --------------------------------------------------------------- reachability

// These are the two shapes the device proved do not work, plus the one that does.
//
// Comments are stripped first, because the layout's prose explains why the broken
// shapes were abandoned by naming them - and a test that reads its own rationale as a
// failure is a test that has to be updated every time the code gets a better comment.
const stripComments = (src: string) =>
	src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

const layout = stripComments(readFileSync('apps/mobile/src/app/_layout.tsx', 'utf8'));

assert.ok(
	layout.includes('<ConnectionBanner />'),
	'the banner must be rendered somewhere in the root layout'
);

assert.ok(
	!layout.includes('<Stack.Screen name="connection"'),
	'a declared screen never mounts, so the banner would be invisible'
);

assert.ok(
	!layout.includes('Unknown child element'),
	'no left-over claim that the old broken mounting still applies'
);

// The banner must sit OUTSIDE the <Stack> element, because React Navigation rejects any
// child that is not a Stack.Screen. Extracting the Stack subtree and asserting the banner
// is not inside it is the only way to prove this holds, since the whole point is that the
// Stack's own props are unchanged.
const stackStart = layout.indexOf('<Stack');
const stackEnd = layout.indexOf('</Stack>');
assert.ok(stackStart >= 0 && stackEnd > stackStart, 'the Stack element must still be there');
const stackBody = layout.slice(stackStart, stackEnd);
assert.ok(
	!stackBody.includes('ConnectionBanner'),
	'the banner must not be inside <Stack>; React Navigation rejects it there'
);

// The banner must be outside the auth guard, or it is missing exactly when it is needed
// most: the sign-in screen with no network was the original bug.
assert.ok(
	layout.indexOf('<ConnectionBanner />') > stackEnd,
	'the banner must render after the Stack, outside the auth guard'
);

// The component file must exist and carry the overlay shape that lets taps through.
const banner = readFileSync('apps/mobile/src/lib/connection.tsx', 'utf8');
assert.match(banner, /pointerEvents="box-none"/, 'the banner must not swallow taps meant for content below');
assert.match(banner, /position: "absolute"/, 'the banner overlays rather than pushing');
assert.match(banner, /useConnectionStatus\(/, 'the banner must read a subscribed value, not a render-time snapshot');

// It must subscribe through the client's real API. Reading connectionState() during
// render only refreshes when some unrelated query happens to re-run.
const stateModule = readFileSync('apps/mobile/src/lib/connection-state.ts', 'utf8');
assert.match(
	stateModule,
	/subscribeToConnectionState/,
	'the reactive value must come from the subscription the client actually publishes'
);
assert.match(stateModule, /useSyncExternalStore/, 'and be delivered by useSyncExternalStore');

console.log('PASS: the banner speaks only on a real reconnection, and cannot be optimised away by the navigator.');
