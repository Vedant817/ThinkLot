import { useEffect, useRef, useState } from "react";
import { Alert, Platform, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation } from "convex/react";
import { useNavigation, usePreventRemove } from "expo-router/react-navigation";
import {
  api,
  type Id,
  IDEA_STATUSES,
  lotPlate,
  priorityScore,
  displayScore,
} from "../../lib/api";
import { useLiveQuery } from "../../lib/live-query";
import { errorMessage } from "../../lib/auth";
import { fields, textPatch, type TextFields } from "../../lib/edit-buffer";
import {
  Button,
  Failure,
  Field,
  Heading,
  Label,
  Loading,
  Note,
  Page,
  styles,
} from "../../components/ui";

export default function IdeaDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // Convex ids can be passed through a deep link; query errors stay visible.
  const query = useLiveQuery(api.ideas.get, { ideaId: id as Id<"ideas"> });
  const update = useMutation(api.ideas.update);
  const status = useMutation(api.ideas.setStatus);
  const favorite = useMutation(api.ideas.toggleFavorite);
  const archive = useMutation(api.ideas.setArchived);
  const remove = useMutation(api.ideas.remove);
  const addTask = useMutation(api.tasks.addTask);
  const toggleTask = useMutation(api.tasks.toggleTask);
  const removeTask = useMutation(api.tasks.removeTask);
  const renameTask = useMutation(api.tasks.updateTask);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState("");
  const [audience, setAudience] = useState("");
  const [outcome, setOutcome] = useState("");
  const [trigger, setTrigger] = useState("");
  const [tag, setTag] = useState("");
  const [task, setTask] = useState("");
  const [editingTask, setEditingTask] = useState<Id<"ideaTasks"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const seeded = useRef<string | null>(null);
  const baseline = useRef<TextFields>({
    title: "",
    description: "",
    problem: "",
    audience: "",
    outcome: "",
    trigger: "",
  });
  const navigation = useNavigation();
  usePreventRemove(dirty, ({ data }) => {
    if (Platform.OS === "web") {
      if (window.confirm("Discard your unsaved text edits?"))
        navigation.dispatch(data.action);
    } else {
      Alert.alert(
        "Discard unsaved text?",
        "Save your text before leaving to keep these edits.",
        [
          { text: "Keep editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => navigation.dispatch(data.action),
          },
        ],
      );
    }
  });
  const idea = query.data?.idea;
  useEffect(() => {
    if (idea && seeded.current !== idea._id) {
      seeded.current = idea._id;
      setTitle(idea.title);
      setDescription(idea.description ?? "");
      setProblem(idea.problem ?? "");
      setAudience(idea.audience ?? "");
      setOutcome(idea.outcome ?? "");
      setTrigger(idea.trigger ?? "");
      setDirty(false);
      setTag("");
      setTask("");
      setEditingTask(null);
      setError(undefined);
      baseline.current = fields(idea);
    } else if (idea) {
      const old = baseline.current;
      const next = fields(idea);
      setTitle((current) => (current === old.title ? next.title : current));
      setDescription((current) =>
        current === old.description ? next.description : current,
      );
      setProblem((current) =>
        current === old.problem ? next.problem : current,
      );
      setAudience((current) =>
        current === old.audience ? next.audience : current,
      );
      setOutcome((current) =>
        current === old.outcome ? next.outcome : current,
      );
      setTrigger((current) =>
        current === old.trigger ? next.trigger : current,
      );
      baseline.current = next;
    }
  }, [idea]);
  useEffect(() => {
    if (Platform.OS !== "web" || !dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  async function act(work: () => Promise<unknown>, success?: () => void) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await work();
      success?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function deleteIdea() {
    const execute = () =>
      void act(
        () => remove({ ideaId: id as Id<"ideas"> }),
        () => {
          setDirty(false);
          requestAnimationFrame(() => router.replace("/ideas"));
        },
      );
    if (Platform.OS === "web") {
      if (window.confirm("Permanently delete this idea and its tasks?"))
        execute();
    } else
      Alert.alert(
        "Delete this idea?",
        "Its tasks will also be permanently deleted.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: execute },
        ],
      );
  }
  return (
    <Page safeTop={false}>
      <Failure message={query.error} retry={query.retry} />
      {!query.data ? (
        query.data === null ? (
          <>
            <Heading title="Idea not found." />
            <Note>It may have been removed or belong to another account.</Note>
          </>
        ) : (
          !query.error && <Loading />
        )
      ) : (
        idea && (
          <>
            <Heading
              title={lotPlate(idea.seq)}
              subtitle={`${idea.status} · priority ${displayScore(priorityScore(idea))}`}
            />
            <Failure message={error} />
            <Field
              label="Title"
              value={title}
              maxLength={300}
              editable={!busy}
              onChangeText={(v) => {
                setTitle(v);
                setDirty(true);
              }}
            />
            <Field
              label="Description"
              value={description}
              multiline
              maxLength={20000}
              editable={!busy}
              onChangeText={(v) => {
                setDescription(v);
                setDirty(true);
              }}
            />
            <Field
              label="Problem to solve"
              value={problem}
              multiline
              maxLength={20000}
              editable={!busy}
              onChangeText={(v) => {
                setProblem(v);
                setDirty(true);
              }}
            />
            {/*
              The three fields the product spec asks for in its Inbox model,
              which were missing from this screen entirely. They sit with the
              problem statement rather than further down because the four of them
              together are what separate an actionable idea from a sentence.
            */}
            <Field
              label="Who is it for"
              value={audience}
              multiline
              maxLength={20000}
              editable={!busy}
              onChangeText={(v) => {
                setAudience(v);
                setDirty(true);
              }}
            />
            <Field
              label="Expected outcome"
              value={outcome}
              multiline
              maxLength={20000}
              editable={!busy}
              onChangeText={(v) => {
                setOutcome(v);
                setDirty(true);
              }}
            />
            <Field
              label="Source / trigger"
              value={trigger}
              multiline
              maxLength={20000}
              editable={!busy}
              onChangeText={(v) => {
                setTrigger(v);
                setDirty(true);
              }}
            />
            <Button
              title={busy ? "Saving…" : "Save text"}
              primary
              disabled={busy || !dirty || !title.trim()}
              onPress={() =>
                void act(
                  () =>
                    update({
                      ideaId: idea._id,
                      ...textPatch({
                        id: idea._id,
                        values: {
                          title,
                          description,
                          problem,
                          audience,
                          outcome,
                          trigger,
                        },
                        baseline: baseline.current,
                      }),
                    }),
                  () => setDirty(false),
                )
              }
            />
            <Note>
              {dirty
                ? "Text edits are waiting to be saved."
                : "Text saved. Other controls save immediately."}
            </Note>
            <Label>Stage</Label>
            <View style={styles.row}>
              {IDEA_STATUSES.map((stage) => (
                <Button
                  key={stage}
                  title={stage + (idea.status === stage ? " ✓" : "")}
                  disabled={busy}
                  onPress={() =>
                    void act(() => status({ ideaId: idea._id, status: stage }))
                  }
                />
              ))}
            </View>
            <Label>Priority</Label>
            <Note>(Impact × Confidence) / Effort. Each score is 1–10.</Note>
            {(["impact", "effort", "confidence"] as const).map((key) => (
              <View key={key} style={styles.section}>
                <Label>
                  {key}: {idea[key] ?? "unscored"}
                </Label>
                <View style={styles.row}>
                  <Button
                    title={`Decrease ${key}`}
                    disabled={busy || (idea[key] ?? 0) <= 1}
                    onPress={() =>
                      void act(() =>
                        update({ ideaId: idea._id, [key]: idea[key]! - 1 }),
                      )
                    }
                  />
                  <Button
                    title={`Increase ${key}`}
                    disabled={busy || (idea[key] ?? 0) >= 10}
                    onPress={() =>
                      void act(() =>
                        update({
                          ideaId: idea._id,
                          [key]: (idea[key] ?? 0) + 1,
                        }),
                      )
                    }
                  />
                  <Button
                    title={`Clear ${key}`}
                    disabled={busy || idea[key] === undefined}
                    onPress={() =>
                      void act(() => update({ ideaId: idea._id, [key]: null }))
                    }
                  />
                </View>
              </View>
            ))}
            <Label>Tags</Label>
            <View style={styles.row}>
              {idea.tags.map((value) => (
                <Button
                  key={value}
                  title={`Remove #${value}`}
                  disabled={busy}
                  onPress={() =>
                    void act(() =>
                      update({ ideaId: idea._id, removeTag: value }),
                    )
                  }
                />
              ))}
            </View>
            <Field
              label="New tag"
              value={tag}
              onChangeText={setTag}
              editable={!busy}
            />
            <Button
              title="Add tag"
              disabled={busy || !tag.trim()}
              onPress={() =>
                void act(
                  () => update({ ideaId: idea._id, addTag: tag.trim() }),
                  () => setTag(""),
                )
              }
            />
            <Label>Turn this into action</Label>
            <Note>
              {query.data.tasks.filter((t) => t.completed).length} of{" "}
              {query.data.tasks.length} tasks completed
            </Note>
            {query.data.tasks.map((item) => (
              <View key={item._id} style={styles.section}>
                <Label>
                  {item.completed ? "✓ " : "○ "}
                  {item.title}
                </Label>
                <View style={styles.row}>
                  <Button
                    title={item.completed ? "Mark unfinished" : "Complete task"}
                    disabled={busy}
                    onPress={() =>
                      void act(() => toggleTask({ taskId: item._id }))
                    }
                  />
                  <Button
                    title="Rename task"
                    disabled={busy}
                    onPress={() => {
                      setEditingTask(item._id);
                      setTask(item.title);
                    }}
                  />
                  <Button
                    title="Delete task"
                    danger
                    disabled={busy}
                    onPress={() =>
                      void act(() => removeTask({ taskId: item._id }))
                    }
                  />
                </View>
              </View>
            ))}
            <Field
              label={editingTask ? "Rename task" : "Next task"}
              value={task}
              onChangeText={setTask}
              maxLength={500}
              editable={!busy}
            />
            <Button
              title={editingTask ? "Save task name" : "Add task"}
              disabled={busy || !task.trim()}
              onPress={() =>
                void act(
                  () =>
                    editingTask
                      ? renameTask({ taskId: editingTask, title: task.trim() })
                      : addTask({ ideaId: idea._id, title: task.trim() }),
                  () => {
                    setTask("");
                    setEditingTask(null);
                  },
                )
              }
            />
            {editingTask && (
              <Button
                title="Cancel rename"
                disabled={busy}
                onPress={() => {
                  setEditingTask(null);
                  setTask("");
                }}
              />
            )}
            <Label>Keep or let go</Label>
            <Button
              title={idea.favorite ? "Remove favorite" : "Mark as favorite"}
              disabled={busy}
              onPress={() => void act(() => favorite({ ideaId: idea._id }))}
            />
            <Button
              title={idea.archived ? "Restore to inbox" : "Archive idea"}
              disabled={busy}
              onPress={() =>
                void act(() =>
                  archive({ ideaId: idea._id, archived: !idea.archived }),
                )
              }
            />
            <Button
              title="Delete idea permanently"
              danger
              disabled={busy}
              onPress={deleteIdea}
            />
          </>
        )
      )}
    </Page>
  );
}
