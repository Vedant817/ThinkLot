import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../lib/api";
import { useLiveQuery } from "../../lib/live-query";
import { errorMessage } from "../../lib/auth";
import { Transfer } from "../../components/transfer";
import { YourNumbers } from "../../components/your-numbers";
import { Integrations } from "../../components/integrations";
import {
  Button,
  Failure,
  Heading,
  Label,
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
      {/*
        Profile: who is signed in, and the way out, together. The sign-out button
        used to sit at the bottom of a long screen, below import/export - the one
        control people look for when something is wrong with their account was the
        furthest from the account it belongs to.
      */}
      <Label>Profile</Label>
      {profile.data ? (
        <Note>{profile.data.email}</Note>
      ) : (
        !profile.error && <Loading />
      )}
      <Button
        title={busy ? "Signing out…" : "Sign out"}
        disabled={busy}
        onPress={() => void logout()}
      />
      <Failure message={error} />
      <Note>
        Your ideas sync with the same account on web and mobile. Theme follows
        your device.
      </Note>
      {/*
        Integrations: what this app connects to, and what it holds for each.
        Status loads on every focus rather than once: a key forgotten on the AI
        screen and a status here that still claims it is the exact staleness this
        section exists to prevent.
      */}
      <Integrations />
      {/*
        Four personal numbers, computed from rows the lot query already holds.
        Placed before import/export: this screen is about the user's data, and
        these four sentences are the most-read thing on it.
      */}
      <YourNumbers />

      {/*
        Import and export live here rather than on their own tab: they are about the
        user's data, which is what this screen is about, and a fifth tab for something
        used twice a year would be a worse trade.
      */}
      <Transfer />
    </Page>
  );
}
