import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation } from "convex/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";
import { tokenStorage } from "../lib/auth";
import { Heading, Note, Page, ThemeProvider, usePalette, useTheme } from "../components/ui";
import { ConnectionBanner } from "../lib/connection";
import { client } from "../lib/convex";
import { api, dayBucket } from "../lib/api";
import { storedKeyIds } from "../lib/ai-credentials";

export { client };
function Routes() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const heartbeat = useMutation(api.telemetry.heartbeat);
  /*
   * Once-daily product heartbeat: platform + whether an AI key is set.
   *
   * Guarded by a stored date so it fires at most once a day, and wrapped so
   * telemetry can never break the app - a throw here must not touch auth state
   * or navigation. The server enforces the opt-out and the once-per-day upsert;
   * the client guard is only thrift (no wasted round trip). No content, no key,
   * no PII: the shape is the privacy story.
   */
  useEffect(() => {
    if (!isAuthenticated) return;
    void (async () => {
      try {
        const today = dayBucket(Date.now());
        if ((await AsyncStorage.getItem("thinklot:telemetry:heartbeat")) === today) return;
        await heartbeat({
          platform: Platform.OS === "ios" ? "ios" : "android",
          aiConfigured: (await storedKeyIds()).length > 0,
        });
        await AsyncStorage.setItem("thinklot:telemetry:heartbeat", today);
      } catch {
        /* Telemetry is best-effort by design. */
      }
    })();
  }, [isAuthenticated, heartbeat]);
  const c = usePalette();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: c.paper },
        headerTintColor: c.ink,
        contentStyle: { backgroundColor: c.paper },
      }}
    >
      <Stack.Protected guard={isLoading || !isAuthenticated}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!isLoading && isAuthenticated}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="idea/[id]" options={{ title: "Idea details" }} />
        <Stack.Screen name="ai-settings" options={{ title: "AI" }} />
        <Stack.Screen name="appearance" options={{ title: "Appearance" }} />
      </Stack.Protected>
      <Stack.Screen name="+not-found" options={{ title: "Page not found" }} />
    </Stack>
  );
}
/**
 * The root, with the offline banner sitting over the navigator.
 *
 * The banner is a sibling of `Routes`, not a child of the `Stack` and not a declared
 * screen. A `<Stack.Screen name="connection">` would never mount, because declaring a
 * route does not focus it; a bare child of `Stack` is rejected with
 * "Unknown child element passed to Stack", which is exactly what logcat showed on a
 * real device before this was fixed.
 *
 * It is also outside the auth guard on purpose. The original bug was a device with no
 * network sitting on "Connecting..." on the SIGN-IN screen - so the banner is most
 * needed precisely where authentication has not succeeded.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/*
        Theme first, above everything including auth. The sign-in screen uses
        themed primitives, and a theme that only applies past login would flash
        defaults at exactly the user who just installed the app.
      */}
      <ThemeProvider>
        <ThemedRoot />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedRoot() {
  const { scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {client ? (
        <>
          <ConvexAuthProvider
            client={client}
            storage={tokenStorage}
            shouldHandleCode={false}
          >
            <Routes />
          </ConvexAuthProvider>
          <ConnectionBanner />
        </>
      ) : (
        <Page>
          <Heading title="Connect your lot" />
          <Note>
            Set EXPO_PUBLIC_CONVEX_URL in the mobile app’s .env.local file, then
            restart Expo.
          </Note>
        </Page>
      )}
    </>
  );
}
