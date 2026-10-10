import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  api,
  byPriority,
  displayScore,
  IDEA_STATUSES,
  lotPlate,
  maturityLabel,
  maturityOf,
  priorityScore,
} from "../lib/api";
import { useLiveQuery } from "../lib/live-query";
import {
  Button,
  ChipRow,
  Failure,
  Field,
  Heading,
  Loading,
  mono,
  Note,
  Page,
  Plate,
  styles,
  useFontMult,
  usePalette,
} from "./ui";
import { Capture } from "./capture";
import type { IdeaStatus } from "../../../../src/lib/types";

export function IdeaList({
  archive = false,
  board = false,
}: {
  archive?: boolean;
  board?: boolean;
}) {
  const c = usePalette();
  const fm = useFontMult();
  const [search, setSearch] = useState("");
  const [needle, setNeedle] = useState("");
  const [status, setStatus] = useState<IdeaStatus>();
  const [favorites, setFavorites] = useState(false);
  const [priority, setPriority] = useState(false);
  const [cards, setCards] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useLiveQuery(api.ideas.list, {
    archivedOnly: archive,
    favoriteOnly: favorites,
    sortPriority: priority,
    status,
    search: needle || undefined,
  });
  const ideas = useMemo(() => {
    const rows =
      query.data?.ideas.filter(
        (idea) => idea.archived === archive && (!favorites || idea.favorite),
      ) ?? [];
    return priority ? [...rows].sort(byPriority) : rows;
  }, [query.data, archive, favorites, priority]);
  const header = (
    <View style={{ padding: 20, gap: 18 }}>
      <Heading
        title={
          archive
            ? "The archive."
            : board
              ? "From spark to done."
              : "Your idea lot."
        }
        subtitle={
          board
            ? "Choose a stage. Open an idea to move it forward."
            : archive
              ? "Ideas you can bring back when the time is right."
              : "Capture first. Judge later."
        }
      />
      {!archive && !board && <Capture />}
      {/*
        No `label` on search. The placeholder ("Title, notes or a tag") already names
        the field, and a second caption above it was a screen-run flag: two labels and
        one input. The accessibility label falls back to the placeholder, so a
        screen-reader user keeps the control's name.
      */}
      <Field
        placeholder="Title, notes or a tag"
        value={search}
        onChangeText={setSearch}
        returnKeyType="search"
      />
      <ChipRow>
        <Button
          compact
          title={cards ? "List view" : "Card view"}
          onPress={() => setCards(!cards)}
        />
        <Button
          compact
          title={status ?? "All stages"}
          onPress={() =>
            setStatus(
              status === undefined
                ? "inbox"
                : IDEA_STATUSES[IDEA_STATUSES.indexOf(status) + 1],
            )
          }
        />
        <Button
          compact
          title={favorites ? "Favorites only" : "Favorites"}
          onPress={() => setFavorites(!favorites)}
        />
        <Button
          compact
          title={priority ? "Priority" : "Newest"}
          onPress={() => setPriority(!priority)}
        />
      </ChipRow>
      {board && (
        <ChipRow>
          {IDEA_STATUSES.map((stage) => (
            <Button
              key={stage}
              compact
              title={stage + (status === stage ? " ✓" : "")}
              onPress={() => setStatus(status === stage ? undefined : stage)}
            />
          ))}
        </ChipRow>
      )}
      <Failure message={query.error} retry={query.retry} />
      {query.data?.truncated && (
        <Note>
          Showing a limited set of {query.data.total} matches. Search or choose
          a stage to narrow the results.
        </Note>
      )}
      {/* "0 shown of 0" is a fact about nobody. It only earns its line once
          there is something to count, and the count is the thing being
          truncated - so a matching result set is the only case that needs it. */}
      {query.data && ideas.length > 0 && (
        <Note>
          {ideas.length} shown
          {favorites || archive ? " in this view" : ` of ${query.data.total}`}
        </Note>
      )}
    </View>
  );
  return (
    <Page scroll={false}>
      <FlatList
        data={ideas}
        keyExtractor={(idea) => idea._id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        // Must clear the tab bar, not just the screen edge. At 360x640dp the last
        // idea's title sat underneath it, because 30 is far less than the 58dp
        // bar plus its safe-area inset.
        contentContainerStyle={{ paddingBottom: 100 }}
        ListEmptyComponent={
          !query.error ? (
            query.data ? (
              <View style={{ padding: 20 }}>
                <Note>
                  {search || status || favorites
                    ? "No ideas match these filters."
                    : archive
                      ? "No archived ideas yet."
                      : "Nothing parked yet. Capture your first spark above."}
                </Note>
              </View>
            ) : (
              <Loading />
            )
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title}`}
            onPress={() =>
              router.push({ pathname: "/idea/[id]", params: { id: item._id } })
            }
            style={({ pressed }) => ({
              marginHorizontal: 20,
              paddingVertical: 14,
              paddingHorizontal: cards ? 14 : 0,
              marginVertical: cards ? 6 : 0,
              // Card view matches the <Card> primitive exactly - paper on a 1px
              // rule with an 8px radius. It was c.panel, which on the new palette
              // is #f6f6f4 against #ffffff paper: a border drawn round a surface
              // the eye cannot see.
              backgroundColor: c.paper,
              borderWidth: cards ? 1 : 0,
              borderTopWidth: 1,
              borderColor: c.line,
              borderRadius: cards ? 8 : 0,
              opacity: pressed ? 0.6 : 1,
              gap: 8,
            })}
          >
            <View style={styles.row}>
              {/* The plate is the one element allowed amber: it is a number the
                  user reads and quotes. Rendered as a stamp so it reads as a
                  label rather than as body text. */}
              <Plate>{lotPlate(item.seq)}</Plate>
              <Text
                style={{
                  color: c.muted,
                  fontFamily: mono,
                  fontSize: Math.round(12 * fm),
                }}
              >
                {item.status}
              </Text>
              <Text
                style={{
                  color: priorityScore(item) === null ? c.muted : c.lot,
                  fontFamily: mono,
                  fontSize: Math.round(12 * fm),
                }}
              >
                {displayScore(priorityScore(item))}
              </Text>
              {/*
                Maturity beside the score, because they answer different halves of
                "what deserves attention": the score says which idea is worth most,
                maturity says how close it is to being actionable. A high score on an
                undeveloped idea is the one worth noticing.

                Computed from `coreFields` rather than the three free-text fields,
                because a LIST row omits those - so reading them here would make every
                idea in the lot report as an undeveloped spark. That is not a
                hypothetical: the web client had exactly that bug until the count was
                added to the summary.
              */}
              <Text
                style={{
                  color: c.muted,
                  fontFamily: mono,
                  fontSize: Math.round(12 * fm),
                }}
              >
                {maturityLabel(maturityOf(item).stage).toLowerCase()}
              </Text>
              {item.favorite ? <Feather name="star" size={13} color={c.lot} /> : null}
            </View>
            <Text style={{ color: c.ink, fontSize: Math.round(17 * fm), lineHeight: Math.round(23 * fm), fontWeight: "600" }}>
              {item.title}
            </Text>
            {item.preview && <Note>{item.preview}</Note>}
            {/*
              Why an idea was let go, on the archive row rather than only behind a tap.

              The web archive shows it; this one did not, so the phone and the browser
              disagreed about whether a reason was readable. It is only ever rendered for
              ideas that HAVE one, and the server only ships the field for those, so the
              common case is free.
            */}
            {item.letGoReason ? (
              <Note>let go because — {item.letGoReason}</Note>
            ) : null}
            {item.tags.length > 0 && (
              <Note>{item.tags.map((tag) => `#${tag}`).join(" ")}</Note>
            )}
          </Pressable>
        )}
      />
    </Page>
  );
}
