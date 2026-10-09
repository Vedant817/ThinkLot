import { useState } from "react";
import { useMutation } from "convex/react";
import { router } from "expo-router";
import { Text, TextInput, View } from "react-native";
import { api, type Id, lotPlate } from "../../lib/api";
import { useLiveQuery } from "../../lib/live-query";
import { errorMessage } from "../../lib/auth";
import { validateDecision } from "../../../../../src/lib/review";
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
  due_back: "Came back — you parked this and its date arrived",
  untouched_inbox: "Still waiting for a decision",
};

export default function Review() {
  const c = usePalette();
  const query = useLiveQuery(api.review.queue, {});
  const decide = useMutation(api.review.decide);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /*
   * Which card is showing the "let it go" reason, and what was typed.
   *
   * Inline rather than a dialog, for the same reason the web build does it that way: a
   * modal over a list the user is working through is the fastest way to make them
   * abandon the whole session.
   */
  const [lettingGo, setLettingGo] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  /**
   * One decision, validated before it is sent.
   *
   * `validateDecision` is the shared pure rule, so what the phone refuses is exactly what
   * the server refuses - rather than the app discovering it on a round trip and showing
   * the user a network-shaped error for a problem they caused locally.
   */
  async function act(id: Id<"ideas">, outcome: "try" | "park" | "letGo" | "skip", inDays = 7) {
    // The reason belongs to exactly one outcome. The other three must not be
    // asked for a sentence they do not need, which is what makes "let it go"
    // stand out when it asks.
    const supplied = outcome === "letGo" ? reason : "";
    const problem = validateDecision({ outcome, reason: supplied, inDays });
    if (problem) {
      setError(problem);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      await decide({
        ideaId: id,
        outcome,
        inDays,
        ...(outcome === "letGo" ? { reason } : {}),
      });
      if (outcome === "letGo") {
        setLettingGo(null);
        setReason("");
      }
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
        subtitle="Four decisions. None of them is 'archive'."
      />
      <Failure message={query.error} retry={query.retry} />
      <Failure message={error} />
      {query.data ? (
        <>
          <Note>
            {query.data.items.length} shown of {query.data.total}
            {query.data.truncated ? " — more ideas need review" : ""}
          </Note>
          {query.data.items.length === 0 && <Note>Your review queue is clear.</Note>}
          {query.data.items.map((item) => (
            /* A card, not a wall of text. Each queue entry is one decision the user has
               to make, so it gets a surface and a border to read as a unit. */
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
                  indistinguishable from noise, so the reason stays visible rather than
                  being hidden behind an info button. */}
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
                  title="Try this week"
                  disabled={busy}
                  onPress={() => void act(item.id, "try", 7)}
                />
                <Button
                  compact
                  title="Park 7d"
                  disabled={busy}
                  onPress={() => void act(item.id, "park", 7)}
                />
                <Button
                  compact
                  title="Park 30d"
                  disabled={busy}
                  onPress={() => void act(item.id, "park", 30)}
                />
              </View>

              {/* The fourth decision, and the one that needed a reason. */}
              {lettingGo === item.id ? (
                <View>
                  <Label>Why are you letting it go?</Label>
                  <Reason
                    onChangeText={setReason}
                    placeholder="Same thing as the 2024 attempt, which shipped"
                  />
                  <Note>
                    Kept with your reason, not deleted — and reversible from the archive.
                  </Note>
                  <View style={styles.row}>
                    <Button
                      compact
                      title="Let it go for good"
                      disabled={busy || !reason.trim()}
                      onPress={() => void act(item.id, "letGo", 7)}
                    />
                    <Button
                      compact
                      title="Keep it"
                      disabled={busy}
                      onPress={() => {
                        setLettingGo(null);
                        setReason("");
                        setError(undefined);
                      }}
                    />
                  </View>
                </View>
              ) : (
                <Button
                  compact
                  title="Let it go"
                  disabled={busy}
                  onPress={() => {
                    setLettingGo(item.id);
                    setReason("");
                    setError(undefined);
                  }}
                />
              )}
            </Card>
          ))}
        </>
      ) : (
        !query.error && <Loading />
      )}
    </Page>
  );
}

/**
 * The reason field, defined out here so the screen body stays readable.
 *
 * A multiline input rather than a single line, because the sentence a person wants to
 * write is often "already tried, it failed for X" and one line on a phone does not hold
 * that without scrolling.
 */
function Reason({
  onChangeText,
  placeholder,
}: {
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  const c = usePalette();
  return (
    <TextInput
      multiline
      numberOfLines={2}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={c.muted}
      style={{
        marginTop: 6,
        borderWidth: 1,
        borderColor: c.line,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        color: c.ink,
        fontSize: 15,
        minHeight: 56,
        textAlignVertical: "top",
      }}
    />
  );
}
