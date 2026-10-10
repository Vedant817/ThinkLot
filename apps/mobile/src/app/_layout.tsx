import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme } from "react-native";
import { tokenStorage } from "../lib/auth";
import { Heading, Note, Page, usePalette } from "../components/ui";
import { ConnectionBanner } from "../lib/connection";
import { client } from "../lib/convex";

export { client };
function Routes() {
  const { isLoading, isAuthenticated } = useConvexAuth();
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
  const dark = useColorScheme() === "dark";
  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? "light" : "dark"} />
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
    </SafeAreaProvider>
  );
}
