import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme } from "react-native";
import { tokenStorage } from "../lib/auth";
import { Heading, Note, Page, usePalette } from "../components/ui";
import { ConnectionBanner, connectionStatus } from "../lib/connection";

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
const configured = !!url && /^https:\/\/[^/]+\.convex\.cloud\/?$/.test(url);
const client = configured
  ? new ConvexReactClient(url!, { unsavedChangesWarning: false })
  : null;
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

      {/*
        The offline banner.

        Mounted here, above every screen, because a transport failure is not a screen
        problem: it applies to the whole app and must not be duplicated per-tab.

        `client` is read at subscribe time rather than at render time - the Convex
        client re-runs queries when its connection state turns over, so this is always
        current without a timer. On the first connection the state is `idle`, and the
        banner deliberately stays silent: "offline" during a cold start is a false
        alarm.
      */}
      {client ? <ConnectionBanner status={connectionStatus(client)} /> : null}
    </Stack>
  );
}
export default function RootLayout() {
  const dark = useColorScheme() === "dark";
  return (
    <SafeAreaProvider>
      <StatusBar style={dark ? "light" : "dark"} />
      {client ? (
        <ConvexAuthProvider
          client={client}
          storage={tokenStorage}
          shouldHandleCode={false}
        >
          <Routes />
        </ConvexAuthProvider>
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
