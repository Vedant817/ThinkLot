import { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import {
  api,
  byPriority,
  displayScore,
  IDEA_STATUSES,
  lotPlate,
  priorityScore,
} from "../lib/api";
import { useLiveQuery } from "../lib/live-query";
import {
  Button,
  Failure,
  Field,
  Heading,
  Loading,
  Note,
  Page,
  styles,
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
      <Field
        label="Search title, notes or tags"
        value={search}
        onChangeText={setSearch}
      />
      <View style={styles.row}>
        <Button
          title={cards ? "List view" : "Card view"}
          onPress={() => setCards(!cards)}
        />
        <Button
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
          title={favorites ? "Favorites only ✓" : "Favorites"}
          onPress={() => setFavorites(!favorites)}
        />
        <Button
          title={priority ? "Priority ↓" : "Newest ↓"}
          onPress={() => setPriority(!priority)}
        />
      </View>
      {board && (
        <View style={styles.row}>
          {IDEA_STATUSES.map((stage) => (
            <Button
              key={stage}
              title={stage + (status === stage ? " ✓" : "")}
              onPress={() => setStatus(status === stage ? undefined : stage)}
            />
          ))}
        </View>
      )}
      <Failure message={query.error} retry={query.retry} />
      {query.data?.truncated && (
        <Note>
          Showing a limited set of {query.data.total} matches. Search or choose
          a stage to narrow the results.
        </Note>
      )}
      {query.data && (
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
        contentContainerStyle={{ paddingBottom: 30 }}
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
              paddingVertical: 18,
              paddingHorizontal: cards ? 16 : 0,
              marginVertical: cards ? 6 : 0,
              backgroundColor: cards ? c.panel : c.paper,
              borderWidth: cards ? 1 : 0,
              borderTopWidth: 1,
              borderColor: c.line,
              opacity: pressed ? 0.6 : 1,
              gap: 8,
            })}
          >
            <View style={styles.row}>
              <Text
                style={{
                  color: c.accent,
                  fontFamily: "monospace",
                  fontSize: 12,
                }}
              >
                {lotPlate(item.seq)}
              </Text>
              <Text style={{ color: c.muted }}>
                {item.status} {item.favorite ? "★" : ""} ·{" "}
                {displayScore(priorityScore(item))}
              </Text>
            </View>
            <Text style={{ color: c.ink, fontSize: 21, fontWeight: "600" }}>
              {item.title}
            </Text>
            {item.preview && <Note>{item.preview}</Note>}
            {item.tags.length > 0 && (
              <Note>{item.tags.map((tag) => `#${tag}`).join(" ")}</Note>
            )}
          </Pressable>
        )}
      />
    </Page>
  );
}
