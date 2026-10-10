import { useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useMutation } from "convex/react";
import { api, IDEA_STATUSES, lotPlate, type Id } from "../../lib/api";
import { useLiveQuery } from "../../lib/live-query";
import { errorMessage } from "../../lib/auth";
import { DraggableCard } from "../../components/draggable-card";
import {
  Button,
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
export default function Board() {
  const c = usePalette();
  const query = useLiveQuery(api.ideas.list, {});
  const setStatus = useMutation(api.ideas.setStatus);
  const [selected, setSelected] = useState<Id<"ideas"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  /**
   * The board's own viewport, measured rather than assumed.
   *
   * The column width used to be a hard-coded 300dp, on the reasoning that it showed
   * "a full column plus a deliberate peek of the next one". On a 384dp-wide phone that
   * is not true, and a real device proved it: the page's own 20dp side padding clips the
   * scroll viewport to 344dp, so a 300dp column leaves a 28dp sliver for the second
   * column. A card in that sliver has its `[Open][Move]` row laid out past the clip edge
   * - the accessibility tree reported the Move button with an inverted bounds rect and no
   * text child, the screenshot showed only "Open", and tapping its coordinates did
   * nothing at all.
   *
   * 88% of the measured width leaves one dominant column with a real peek, and works on
   * every screen size instead of the one this was tuned against by hand.
   */
  const [viewport, setViewport] = useState(0);
  const columnWidth = viewport > 0 ? Math.round(viewport * 0.88) : 300;
  const columns = useRef<
    Partial<Record<(typeof IDEA_STATUSES)[number], View | null>>
  >({});
  async function move(
    stage: (typeof IDEA_STATUSES)[number],
    ideaId = selected,
  ) {
    if (!ideaId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await setStatus({ ideaId, status: stage });
      setSelected(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function drop(ideaId: Id<"ideas">, x: number, y: number) {
    setDragging(false);
    // Measure after horizontal scrolling, so visible drop targets are accurate.
    for (const stage of IDEA_STATUSES)
      columns.current[stage]?.measureInWindow((left, top, width, height) => {
        if (x >= left && x < left + width && y >= top && y < top + height)
          void move(stage, ideaId);
      });
  }
  return (
    <Page>
      <Heading
        title="From spark to done."
        subtitle="Select an idea, then choose its destination stage."
      />
      <Failure message={query.error} retry={query.retry} />
      <Failure message={error} />
      {query.data?.truncated && (
        <Note>
          Showing {query.data.ideas.length} of {query.data.total}. Use the lot’s
          stage filter to find more.
        </Note>
      )}
      {selected && (
        <Button
          title="Cancel move"
          disabled={busy}
          onPress={() => setSelected(null)}
        />
      )}
      {query.data ? (
        <ScrollView
          horizontal
          scrollEnabled={!dragging}
          onLayout={(event) => setViewport(event.nativeEvent.layout.width)}
          contentContainerStyle={{ gap: 16 }}
          showsHorizontalScrollIndicator
          /*
           * Snap to a column boundary.
           *
           * Without this the scroll rests wherever the fling ends, and on a phone that
           * routinely parks a card's action row outside the clipped viewport - which is
           * the defect that made the board's Move control unreachable on a real device.
           * `decelerationRate="fast"` is required for `snapToInterval` to take effect on
           * Android.
           */
          decelerationRate="fast"
          snapToInterval={columnWidth + 16}
          disableIntervalMomentum
        >
          <>
            {IDEA_STATUSES.map((stage) => (
              <View
                key={stage}
                ref={(view) => {
                  columns.current[stage] = view;
                }}
                style={{
                  // Derives from the measured viewport rather than a hard-coded 300dp.
                  // The constant was tuned against a wide phone and silently broke the
                  // narrow one: see the `viewport` note above.
                  width: columnWidth,
                  borderRadius: 8,
                  backgroundColor: c.panel,
                  borderWidth: 1,
                  borderColor: c.line,
                  padding: 16,
                  gap: 14,
                }}
              >
                <Label>
                  {stage} /{" "}
                  {
                    query.data!.ideas.filter((idea) => idea.status === stage)
                      .length
                  }
                </Label>
                {selected && (
                  <Button
                    title={`Move here: ${stage}`}
                    primary
                    disabled={busy}
                    onPress={() => void move(stage)}
                  />
                )}
                {query
                  .data!.ideas.filter((idea) => idea.status === stage)
                  .map((idea) => (
                    <View
                      key={idea._id}
                      style={{
                        gap: 10,
                        borderTopWidth: 1,
                        borderColor: c.line,
                        paddingTop: 14,
                      }}
                    >
                      <DraggableCard
                        disabled={busy}
                        onStart={() => setDragging(true)}
                        onCancel={() => setDragging(false)}
                        onDrop={(x, y) => drop(idea._id as Id<"ideas">, x, y)}
                      >
                        <Plate>{lotPlate(idea.seq)}</Plate>
                        {/* This was a <Label>, which is the 11px uppercase mono
                            caption style - so the idea's title rendered smaller
                            and quieter than its own metadata. A title on a board
                            is the thing you are scanning for. */}
                        <Text
                          style={{
                            color: c.ink,
                            fontSize: 15,
                            lineHeight: 20,
                            fontWeight: "600",
                          }}
                        >
                          {idea.title}
                        </Text>
                        <View style={styles.row}>
                          <Button
                            compact
                            title="Open"
                            onPress={() =>
                              router.push({
                                pathname: "/idea/[id]",
                                params: { id: idea._id },
                              })
                            }
                          />
                          <Button
                            compact
                            title={selected === idea._id ? "Selected" : "Move"}
                            disabled={busy}
                            onPress={() => setSelected(idea._id as Id<"ideas">)}
                          />
                        </View>
                      </DraggableCard>
                    </View>
                  ))}
              </View>
            ))}
          </>
        </ScrollView>
      ) : (
        !query.error && <Loading />
      )}
    </Page>
  );
}
