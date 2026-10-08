import { useState } from "react";
import { useMutation } from "convex/react";
import { router } from "expo-router";
import { Text, View } from "react-native";
import { api, type Id, lotPlate } from "../../lib/api";
import { useLiveQuery } from "../../lib/live-query";
import { errorMessage } from "../../lib/auth";
import {
  Button,
  Card,
  Failure,
  Heading,
  Label,
  Loading,
  Note,
  Page,
  Plate,
  styles,
  usePalette,
} from "../../components/ui";
const reasons = {
  stale: "Untouched for a week",
  parked: "Waiting in parked",
  strong: "Strong priority score",
  snoozed: "Revisit date reached",
  untouched_inbox: "Still waiting for a decision",
};
export default function Review() {
  const c = usePalette();
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
            /* A card, not a wall of text. Each queue entry is one decision the
               user has to make, so it gets a surface and a border to read as a
               unit - three buttons floating on the page background gave the
               items no boundaries at all. */
            <Card key={item.id}>
              <View style={styles.row}>
                <Plate>{lotPlate(item.seq)}</Plate>
                <Label>{item.status}</Label>
              </View>
              <Text
                style={{
                  color: c.ink,
                  fontSize: 17,
                  lineHeight: 23,
                  fontWeight: "600",
                }}
              >
                {item.title}
              </Text>
              {/* WHY it surfaced. A queue that lists without explaining is
                  indistinguishable from noise, so the reason is kept visible
                  rather than hidden in a tooltip like the web build does. */}
              <View style={styles.row}>
                {item.reasons.map((reason) => (
                  <Label key={reason}>{reasons[reason]}</Label>
                ))}
              </View>
              <View style={styles.row}>
                <Button
                  compact
                  title="Open"
                  onPress={() =>
                    router.push({
                      pathname: "/idea/[id]",
                      params: { id: item.id },
                    })
                  }
                />
                <Button
                  compact
                  title="Ready to build"
                  disabled={busy}
                  onPress={() => void act(item.id, "promote")}
                />
                <Button
                  compact
                  title="Snooze 7d"
                  disabled={busy}
                  onPress={() => void act(item.id, "snooze")}
                />
              </View>
            </Card>
          ))}
        </>
      ) : (
        !query.error && <Loading />
      )}
    </Page>
  );
}
