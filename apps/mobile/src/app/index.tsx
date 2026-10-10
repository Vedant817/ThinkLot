import { useState } from "react";
import { useConvexAuth, useAction } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
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

export default function SignIn() {
  /**
   * Signs in through `signInProxy`, then hands the session to the auth library.
   *
   * ## Why there are two calls
   *
   * `useAuthActions().signIn` calls `auth:signIn` directly. That is the endpoint that
   * answers "InvalidAccountId" or "InvalidSecret" and so still leaks whether an address
   * has an account, and which is not metered for addresses that have none. Routing the
   * CREDENTIAL CHECK through the proxy means a phone gets the same uniform message and
   * the same per-address attempt budget as the web app.
   *
   * But the library's helper is also the only thing that stores a session correctly, and
   * this screen used to try doing that itself - writing `__convexAuthJWT` into
   * AsyncStorage and hoping. It never worked, and a real device proved it:
   *
   *   - the library stores through the `storage` adapter it was given, which here is
   *     `expo-secure-store`; AsyncStorage is a different, non-secure store entirely;
   *   - and it NAMESPACES every key - `` `${key}_${escapedNamespace}` ``, defaulting to
   *     the deployment URL - so even in the right store the raw key is never read.
   *
   * So the token landed exactly nowhere the auth client looks, `isAuthenticated` never
   * flipped, and the button sat disabled forever with `busy` latched. The trace from the
   * device was unambiguous: `signInProxy` resolved with tokens in 0.8s, both writes
   * "succeeded", and a 4-second wait on `isAuthenticated` still returned false.
   *
   * The honest split is: the proxy authorises, the library establishes. Two round trips,
   * and the second one is only reached when the credentials are already known good.
   */
  const signInProxy = useAction(api.signInProxy.signInProxy);
  const { signIn } = useAuthActions();
  /*
   * Only `isLoading` is read here.
   *
   * This screen used to poll `isAuthenticated` after signing in, to confirm the client
   * had picked the session up. It was always false, and a real device run showed why:
   * the moment auth flips, `Routes` satisfies `guard={!isLoading && isAuthenticated}` and
   * THIS screen unmounts - so the effect that maintained the ref never runs, and the poll
   * times out against a value that stopped being written.
   *
   * The consequence was a user who had just signed up successfully being told "Signed in,
   * but the app did not pick it up", because the poll was reading a component that had
   * already been switched away from. Sign-up worked; the confirmation lied.
   *
   * The right signal is the one `signIn` already returns: it resolves when the session
   * is established, and rejects when it is not. Anything after that is the navigator's
   * job, not this screen's.
   */
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
      // Not `const email = email...`: that shadows the state binding into its own
      // temporal dead zone and throws. The local is the normalised copy.
      const address = email.trim().toLowerCase();
      // Step 1: authorise through the metered, error-normalising front door. This is
      // what makes the message uniform and the attempt budget per-address.
      await signInProxy({
        provider: "password",
        params: { email: address, password, flow },
      });

      // Step 2: let the auth library create the session. It stores through the
      // provider's own `storage` adapter with its own namespaced key, which is the
      // only way the client will ever read the token back.
      await signIn("password", { email: address, password, flow });

      /*
       * Stop here.
       *
       * There is deliberately no wait on `isAuthenticated` after this. `signIn`
       * resolving IS the session being established - the library's own docs note a
       * handshake delay, but that delay is not something this screen should block on,
       * and polling it from here is what produced the false "the app did not pick it
       * up" error on a successful sign-up: the poll read a component that the auth
       * guard had already swapped away, so it always saw `false`.
       *
       * `signIn` rejecting is the failure, and it lands in the catch below.
       */
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
