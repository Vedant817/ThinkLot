import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
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

export default function SignIn() {
  const { signIn } = useAuthActions();
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
      await signIn("password", {
        email: email.trim().toLowerCase(),
        password,
        flow,
      });
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
