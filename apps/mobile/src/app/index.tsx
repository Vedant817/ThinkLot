import { useState } from "react";
import { useConvexAuth, useAction } from "convex/react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Button,
  Failure,
  Field,
  Heading,
  Loading,
  Note,
  Page,
} from "../components/ui";
import { errorMessage } from "../lib/auth";
import { api } from "../lib/api";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Tokens = { token: string; refreshToken: string };

export default function SignIn() {
  /**
   * Signs in through `signInProxy`, not `useAuthActions().signIn`.
   *
   * The library's own helper calls `auth:signIn` directly, which is the endpoint
   * that still answers "InvalidSecret" or "InvalidAccountId" and so still leaks
   * whether an address has an account, and which is not metered for addresses that
   * have none. Routing this client through the proxy means a phone gets the same
   * uniform message and the same attempt budget as the web app.
   *
   * `useAuthActions` also stores the tokens itself; calling the proxy means this
   * screen has to do that part itself, which is why `signInProxy` returns the same
   * `{ tokens: { token, refreshToken } }` shape the library returns.
   */
  const signInProxy = useAction(api.signInProxy.signInProxy);
  const { isLoading } = useConvexAuth();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await signInProxy({
        provider: "password",
        params: { email: email.trim().toLowerCase(), password, flow },
      });
      // Same keys the library persists, so `useAuthToken` picks it up unchanged.
      const tokens = (result as { tokens?: Tokens | null }).tokens;
      if (!tokens) throw new Error("Sign-in did not return a session.");
      await AsyncStorage.setItem("__convexAuthJWT", tokens.token);
      await AsyncStorage.setItem("__convexAuthRefreshToken", tokens.refreshToken);
      setPassword("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <Page>
        <Heading
          title="A place for the next thing."
          subtitle="Capture a spark. Decide what deserves your time."
        />
        {isLoading ? (
          <Loading />
        ) : (
          <>
            <Note>
              {flow === "signIn"
                ? "Sign in to your lot."
                : "Create your private idea lot."}
            </Note>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              editable={!busy}
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={
                flow === "signIn" ? "current-password" : "new-password"
              }
              editable={!busy}
              onSubmitEditing={() => void submit()}
            />
            <Failure message={error} />
            <Button
              title={
                busy
                  ? "Connecting…"
                  : flow === "signIn"
                    ? "Sign in"
                    : "Create account"
              }
              primary
              disabled={busy || !email.trim() || password.length < 8}
              onPress={() => void submit()}
            />
            <Note>Use a password with at least 8 characters.</Note>
            <Button
              title={
                flow === "signIn"
                  ? "Create an account"
                  : "Already have an account? Sign in"
              }
              disabled={busy}
              onPress={() => {
                setFlow(flow === "signIn" ? "signUp" : "signIn");
                setError(undefined);
              }}
            />
          </>
        )}
      </Page>
    </SafeAreaView>
  );
}
