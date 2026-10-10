import { useState } from "react";
import { router } from "expo-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../lib/api";
import { useLiveQuery } from "../../lib/live-query";
import { errorMessage } from "../../lib/auth";
import { Transfer } from "../../components/transfer";
import { YourNumbers } from "../../components/your-numbers";
import {
  Button,
  Failure,
  Heading,
  Loading,
  Note,
  Page,
} from "../../components/ui";
export default function Account() {
  const { signOut } = useAuthActions();
  const profile = useLiveQuery(api.users.current, {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function logout() {
    setBusy(true);
    setError(undefined);
    try {
      await signOut();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Heading title="Your lot." />
      <Failure message={profile.error} retry={profile.retry} />
      {profile.data ? (
        <Note>{profile.data.email}</Note>
      ) : (
        !profile.error && <Loading />
      )}
      <Note>
        Your ideas sync with the same account on web and mobile. Theme follows
        your device.
      </Note>
      {/*
        AI settings live on their own screen rather than inline here. The provider
        picker alone is eight buttons plus a key field, a model field and a test -
        inline it would bury import/export, which is what this screen is about.
      */}
      <Button
        title="AI providers & keys"
        onPress={() => router.push("/ai-settings")}
      />
      {/*
        Four personal numbers, computed from rows the lot query already holds.
        Placed before import/export: this screen is about the user's data, and
        these four sentences are the most-read thing on it.
      */}
      <YourNumbers />
      <Failure message={error} />

      {/*
        Import and export live here rather than on their own tab: they are about the
        user's data, which is what this screen is about, and a fifth tab for something
        used twice a year would be a worse trade.
      */}
      <Transfer />

      <Button
        title={busy ? "Signing out…" : "Sign out"}
        disabled={busy}
        onPress={() => void logout()}
      />
    </Page>
  );
}
