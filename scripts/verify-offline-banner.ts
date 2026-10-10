/**
 * Offline-banner invariants.
 *
 * Offline. The failure this catches is specific: an app that says nothing when its
 * transport drops, while edits are being queued. The device run found it the honest
 * way - the phone had no network, and the sign-in screen sat on "Connecting…" forever
 * with nothing to tell the user why.
 *
 * Three rules, each a real behaviour:
 *   1. A first load is `idle` and shows nothing. "Offline" on a cold start is a false
 *      alarm, and a banner that cries wolf gets dismissed once and never seen again.
 *   2. Only a RECONNECT after a working connection shows the banner.
 *   3. A null client (misconfigured deployment URL) is `idle`, not "offline" - the
 *      layout already renders its own explicit misconfiguration screen.
 */
import assert from 'node:assert/strict';
import { connectionStatus } from '../apps/mobile/src/lib/connection-state';

const stub = (isConnected, hasEver) => ({
	connectionState: () => ({ isWebSocketConnected: isConnected, hasEverConnected: hasEver })
});

// 1. A cold start is silent.
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

// 5. The flags are mutually exclusive as the banner assumes: `idle` and
//    `reconnecting` must never both be true, or the banner renders on first load.
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

// 6. Reconnected means the banner can clear. The component's effect resets on
//    recovery; the state must actually report it.
{
	const recovered = connectionStatus(stub(true, true));
	assert.equal(recovered.connected, true, 'recovery is observable, so the banner clears');
}

console.log('PASS: the banner is silent on a cold start, loud on a real reconnection, and cannot emit a false alarm.');