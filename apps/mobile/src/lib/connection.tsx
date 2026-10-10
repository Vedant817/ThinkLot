import { useState, useEffect } from "react";
import { Text, View } from "react-native";
import { usePalette } from "../components/ui";
import { connectionStatus, type ConnectionStatus } from "./connection-state";

export { connectionStatus };

/**
 * The offline banner.
 *
 * ## Why it reads the Convex client and not a network module
 *
 * A device can have full Wi-Fi and still fail to reach Convex, and the transport can
 * drop mid-request. What the user needs to know is "are my edits saving", not "is
 * there a signal icon".
 *
 * `@react-native-community/netinfo` would be the idiomatic choice, but it is not
 * installed, the npm script policy on this machine blocks `npx expo install`, and a
 * native dependency for one banner is not worth that. The Convex client already
 * subscribes to connection state and re-runs queries when it turns over, so the honest
 * signal is already there.
 *
 * Found by a real device run: a Samsung A22 with no network sat on "Connecting…"
 * forever with nothing to tell the user why.
 */
export function ConnectionBanner({ status }: { status: ConnectionStatus }) {
	const c = usePalette();
	const [gone, setGone] = useState(false);

	// Clear the dismissal on recovery, so a second outage produces a second banner.
	useEffect(() => {
		if (status.connected) setGone(false);
	}, [status.connected]);

	// Only for a RECONNECT. `idle` is what a cold start looks like, and "offline"
	// during a first load is a false alarm that trains people to dismiss the banner.
	if (status.idle || gone || !status.reconnecting) return null;

	return (
		<View
			accessibilityRole="alert"
			accessibilityLiveRegion="polite"
			data-testid="connection-banner"
			style={{
				backgroundColor: c.sunk,
				borderBottomWidth: 1,
				borderColor: c.line,
				paddingHorizontal: 16,
				paddingVertical: 8,
			}}
		>
			<View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
				<Text style={{ color: c.ink, fontSize: 13, flex: 1, fontWeight: 500 }}>
					Offline — ideas may not save
				</Text>
				{/*
					Dismissible, because a banner that cannot be closed is a banner that
					gets ignored. It clears itself on reconnect anyway.
				*/}
				<Text onPress={() => setGone(true)} style={{ color: c.muted, fontSize: 12 }}>
					Dismiss
				</Text>
			</View>
		</View>
	);
}