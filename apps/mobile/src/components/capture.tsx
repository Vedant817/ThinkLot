import { useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuthToken } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api, extractTrigger, looksDictated, looksInjected, parseCapture } from "../lib/api";
import { errorMessage } from "../lib/auth";
import { Button, Failure, Field, Note } from "./ui";
export function Capture() {
  const capture = useMutation(api.ideas.capture);
  const token = useAuthToken();
  let owner = "";
  try {
    owner = JSON.parse(
      atob(token!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    ).sub.split("|")[0];
  } catch {
    /* Only namespace local drafts; never used as auth. */
  }
  const storageKey = `thinklot:capture:${owner}`;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  /*
   * Says what actually happened, and is honest about the limit.
   *
   * The detection is a timing heuristic, so a user who dictated something and saw
   * "Idea parked" might reasonably wonder whether their words were kept. Saying which
   * way it went is the cheapest possible way to be trustworthy here.
   */
  const [notice, setNotice] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  /*
   * Dictation detection, shared with the web client.
   *
   * Wispr Flow and the Android keyboard's own dictation both inject a finished block
   * of text in one shot. Two signals, because neither alone is sufficient:
   *
   * - TIMING: a person types at a median of roughly 150-250ms between changes, a
   *   dictation engine well under 60ms. A gap over 1200ms resets the run, because
   *   that is a person thinking, not an engine injecting.
   * - SHAPE: a single injection produces ONE change event, so timing has zero or one
   *   sample and `looksDictated` refuses to guess. Timing alone therefore MISSES the
   *   exact case Wispr creates - and missing it meant the verbatim transcript was
   *   discarded while the title and body were split correctly. No human types 200
   *   characters between two events, so shape closes the gap.
   */
  const gaps = useRef<number[]>([]);
  const lastChange = useRef<number>(0);
  const previousLength = useRef(0);
  const injectedBlock = useRef(false);

  function onChangeText(next: string) {
    const now = Date.now();
    injectedBlock.current = looksInjected(Math.max(0, next.length - previousLength.current));
    previousLength.current = next.length;

    if (lastChange.current > 0) {
      const gap = now - lastChange.current;
      gaps.current = gap > 1200 ? [gap] : [...gaps.current, gap].slice(-40);
    }
    lastChange.current = now;
    setDraft(next);
    // A confirmation from the PREVIOUS save must not sit under the next draft.
    // The notice ("Idea parked") stayed visible across tab switches and later
    // saves on a real device, reading as current news about nothing. Typing
    // retires it; the timeout below retires it when the user just reads.
    setNotice(undefined);
  }
  /*
   * Confirmations expire.
   *
   * Without this, "Idea parked" survives tab switches indefinitely (tab screens
   * stay mounted), and a stale confirmation is worse than none: it claims a save
   * just happened when the user may have come back an hour later. Ten seconds is
   * long enough to read and short enough to never greet a return visit.
   */
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 10000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(storageKey)
      .then((saved) => {
        if (active) {
          setDraft((current) => current || saved || "");
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [storageKey]);
  useEffect(() => {
    if (!loaded || !owner) return;
    const timer = setTimeout(() => {
      void AsyncStorage.setItem(storageKey, draft).catch(() =>
        setError(
          "Could not keep a local draft. Keep this screen open until your idea is saved.",
        ),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, loaded, owner, storageKey]);
  async function submit() {
    if (busy || !draft.trim()) return;
    setBusy(true);
    setError(undefined);
    const submitted = draft;
    try {
      /*
       * Parse rather than send the whole draft as a title.
       *
       * The server caps a title at 300 characters, so sending a dictated paragraph
       * straight through was REJECTED - the thought was silently lost, and the user
       * was left looking at their own words refusing to save. parseCapture splits the
       * run-on utterance into a title and a body, keeps the tail, and preserves the
       * utterance verbatim as a transcript when it was dictated, so the context that
       * made the idea worth writing down survives with it.
       */
      const dictated = looksDictated(gaps.current) || injectedBlock.current;
      /*
       * A dictated thought usually also says WHY it occurred - who they were talking
       * to, what had just happened - and that is the part nobody can reconstruct weeks
       * later. Asking for it in a form at capture time is the fastest way to lose the
       * idea, so a spoken "trigger:" clause is lifted straight into the field. Only
       * accepted from dictation: a typed "trigger:" is far more likely to be part of
       * the idea's own content than a label.
       */
      const { text, trigger } = dictated ? extractTrigger(submitted) : { text: submitted, trigger: undefined };
      const parsed = parseCapture(text, dictated ? "dictated" : "typed");
      if (!parsed) throw new Error("Nothing to park.");

      await capture({
        title: parsed.title,
        ...(parsed.description ? { description: parsed.description } : {}),
        ...(parsed.transcript ? { transcript: parsed.transcript } : {}),
        ...(trigger ? { trigger } : {}),
        source: parsed.source
      });
      setDraft((current) => (current === submitted ? "" : current));
      gaps.current = [];
      lastChange.current = 0;
      previousLength.current = 0;
      injectedBlock.current = false;
      setNotice(parsed.source === "dictated" ? "Dictated idea parked" : "Idea parked");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {/*
        No `label` above the field.

        The placeholder already says what to do, so a caption above a single input is
        exactly the clutter a device run flagged. Capture is the one screen that has
        to be usable in under five seconds, and it now carries one control instead of
        three labels. The accessibility label falls back to the placeholder, so the
        control keeps its name for a screen reader.
      */}
      <Field
        placeholder="What's on your mind? Dictation works too."
        value={draft}
        onChangeText={onChangeText}
        multiline
        maxLength={20000}
      />
      {/*
        The hint only appears once there is enough text for the split to matter.
        Showing it on an empty field would be noise on the one screen that has to be
        usable in under five seconds.
      */}
      {draft.trim().length > 300 ? (
        <Note>
          This is longer than a title. It will be parked with the first line as the
          title and the rest kept as notes — including any dictated wording.
        </Note>
      ) : null}
      <Button
        title={busy ? "Parking…" : "Park this idea"}
        primary
        disabled={busy || !draft.trim()}
        onPress={() => void submit()}
      />
      {notice ? <Note>{notice}</Note> : null}
      <Failure message={error} />
    </>
  );
}
