import { useState } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../components/ui";
import { useConnectionStatus } from "./connection-state";
import { client } from "./convex";

/**
 * The offline banner.
 *
 * ## Why it is a sibling of the navigator and not a screen
 *
 * It started as a `<Stack.Screen name="connection">`. Declaring a route does not mount
 * it, so the banner would only ever render if something pushed it - which nothing does.
 * Worse, the first attempt mounted it as a bare child of `Stack`, which React Navigation
 * rejected outright: logcat on a real Samsung A22 showed
 * `Unknown child element passed to Stack: function ConnectionBanner(a0)` and nothing was
 * drawn. Two wrong shapes, both found by running it on hardware rather than reasoning
 * about it.
 *
 * A sibling of the navigator, absolutely positioned, is the shape that cannot be
 * optimised away by the router: it is inside the root layout's own tree, so it renders
 * whenever the app does, on the sign-in screen included.
 *
 * ## Why it overlays rather than pushes
 *
 * A transport failure is not a destination. Pushing it would steal the back stack and
 * bury whatever the user was doing. An overlay keeps the screen underneath usable and
 * simply says "this may not have saved".
 *
 * ## Why `pointerEvents="box-none"`
 *
 * The banner must not eat taps meant for the content below it. `box-none` lets the
 * banner itself pass touches through while keeping its own Dismiss target live.
 * `box-only` would swallow the whole row.
 */
export function ConnectionBanner() {
	const c = usePalette();
	const status = useConnectionStatus(client);
	/*
	 * Below the status bar, not under it.
	 *
	 * The banner is absolutely positioned over the whole root view, which extends
	 * under the translucent status bar. Without the top inset it rendered its text
	 * on top of the clock and signal icons - visible in the first screenshot taken
	 * of it on a real device, where "Offline — ideas may not save" collided with
	 * the status row. The screens below already get their insets from the
	 * SafeAreaProvider; this sibling has to take its own.
	 */
	const insets = useSafeAreaInsets();

	/*
	 * Dismissal is per-outage, so it has to forget itself once the connection recovers.
	 *
	 * State adjusted during render rather than in an effect - the documented React
	 * pattern for "adjust state when a prop changes", and synchronous, so the banner
	 * cannot flash for a frame after a recovery. In a `useEffect` it is both a lint
	 * error here and a render behind. That was the original and it was flagged.
	 */
	const [wasConnected, setWasConnected] = useState(status.connected);
	const [gone, setGone] = useState(false);
	if (wasConnected !== status.connected) {
		setWasConnected(status.connected);
		setGone(false);
	}

	// `idle` is what a cold start looks like. Announcing "offline" during a first load is
	// a false alarm, and a banner that cries wolf gets dismissed once and never seen again.
	if (status.idle || gone || !status.reconnecting) return null;

	return (
		<View
			pointerEvents="box-none"
			style={{
				position: "absolute",
				top: 0,
				left: 0,
				right: 0,
				backgroundColor: c.sunk,
				borderBottomWidth: 1,
				borderColor: c.line,
				paddingHorizontal: 16,
				paddingTop: insets.top + 8,
				paddingBottom: 8,
			}}
			accessibilityRole="alert"
			accessibilityLiveRegion="polite"
			data-testid="connection-banner"
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
