import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient, useConvexAuth } from "convex/react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme } from "react-native";
import { tokenStorage } from "../lib/auth";
import { Heading, Note, Page, usePalette } from "../components/ui";

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
