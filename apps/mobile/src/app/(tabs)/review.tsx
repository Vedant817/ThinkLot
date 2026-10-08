import { useState } from "react";
import { useMutation } from "convex/react";
import { router } from "expo-router";
import { View } from "react-native";
import { api, type Id, lotPlate } from "../../lib/api";
import { useLiveQuery } from "../../lib/live-query";
import { errorMessage } from "../../lib/auth";
import {
  Button,
  Failure,
  Heading,
  Label,
  Loading,
  Note,
  Page,
  styles,
} from "../../components/ui";
const reasons = {
  stale: "Untouched for a week",
  parked: "Waiting in parked",
  strong: "Strong priority score",
  snoozed: "Revisit date reached",
  untouched_inbox: "Still waiting for a decision",
};
export default function Review() {
  const query = useLiveQuery(api.review.queue, {});
  const snooze = useMutation(api.review.snooze);
  const promote = useMutation(api.ideas.setStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function act(id: Id<"ideas">, kind: "snooze" | "promote") {
    setBusy(true);
    setError(undefined);
    try {
      if (kind === "snooze") await snooze({ ideaId: id, days: 7 });
      else await promote({ ideaId: id, status: "ready" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page>
      <Heading
        title="Worth a second look."
        subtitle="Make a decision, or give it another week."
      />
      <Failure message={query.error} retry={query.retry} />
      <Failure message={error} />
      {query.data ? (
        <>
          <Note>
            {query.data.items.length} shown of {query.data.total}
            {query.data.truncated ? " · more ideas need review" : ""}
          </Note>
          {query.data.items.length === 0 && (
            <Note>Your review queue is clear.</Note>
          )}
          {query.data.items.map((item) => (
            <View key={item.id} style={styles.section}>
              <Note>
                {lotPlate(item.seq)} / {item.status}
              </Note>
              <Label>{item.title}</Label>
              <Note>
                {item.reasons.map((reason) => reasons[reason]).join(" · ")}
              </Note>
              <View style={styles.row}>
                <Button
                  title="Open idea"
                  onPress={() =>
                    router.push({
                      pathname: "/idea/[id]",
                      params: { id: item.id },
                    })
                  }
                />
                <Button
                  title="Ready to build"
                  disabled={busy}
                  onPress={() => void act(item.id, "promote")}
                />
                <Button
                  title="Snooze 7 days"
                  disabled={busy}
                  onPress={() => void act(item.id, "snooze")}
                />
              </View>
            </View>
          ))}
        </>
      ) : (
        !query.error && <Loading />
      )}
    </Page>
  );
}
