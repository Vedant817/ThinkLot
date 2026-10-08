import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
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
          contentContainerStyle={{ gap: 16 }}
          showsHorizontalScrollIndicator
        >
          <>
            {IDEA_STATUSES.map((stage) => (
              <View
                key={stage}
                ref={(view) => {
                  columns.current[stage] = view;
                }}
                style={{
                  width: 270,
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
                        <Note>{lotPlate(idea.seq)}</Note>
                        <Label>{idea.title}</Label>
                        <Button
                          title="Open idea"
                          onPress={() =>
                            router.push({
                              pathname: "/idea/[id]",
                              params: { id: idea._id },
                            })
                          }
                        />
                        <Button
                          title={
                            selected === idea._id
                              ? "Selected to move ✓"
                              : "Move idea"
                          }
                          disabled={busy}
                          onPress={() => setSelected(idea._id as Id<"ideas">)}
                        />
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
