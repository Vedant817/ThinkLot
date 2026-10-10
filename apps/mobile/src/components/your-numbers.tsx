import { useState } from "react";
import { useMutation } from "convex/react";
import { api, computePersonal } from "../lib/api";
import { useLiveQuery } from "../lib/live-query";
import { errorMessage } from "../lib/auth";
import { Button, Failure, Label, Note } from "./ui";

/**
 * Four personal numbers, computed from rows already held.
 *
 * The list query feeds this for free - no extra subscription, no event scan, no
 * writes. The full breakdown (decision latency, mix, conversions) lives on web,
 * where there is room and where the bounded events query can run; these four are
 * the ones that fit a phone and need no events at all. Same pure module, so they
 * can never disagree with the web page.
 */
export function YourNumbers() {
  const lot = useLiveQuery(api.ideas.list, {});
  const prefs = useLiveQuery(api.telemetry.prefs, {});
  const setOptOut = useMutation(api.telemetry.setOptOut);
  const [error, setError] = useState<string>();

  if (!lot.data) {
    return lot.error ? <Failure message={lot.error} retry={lot.retry} /> : null;
  }
  if (lot.data.ideas.length === 0) {
    return <Note>Your numbers appear after your first capture.</Note>;
  }

  const a = computePersonal(
    lot.data.ideas.map((idea) => ({
      _id: String(idea._id),
      title: idea.title,
      status: idea.status,
      archived: idea.archived,
      favorite: idea.favorite,
      source: idea.source as "typed" | "dictated",
      createdAt: idea.createdAt,
      updatedAt: idea.updatedAt,
      impact: idea.impact,
      effort: idea.effort,
      confidence: idea.confidence,
      letGoAt: idea.letGoAt,
      hasTranscript: idea.hasTranscript,
    })),
  );

  const rows: string[] = [];
  rows.push(
    a.streak.current > 0
      ? `${a.streak.current}-day capture streak${a.streak.best > a.streak.current ? ` (best ${a.streak.best})` : ""}.`
      : a.streak.best > 0
        ? `No streak right now — best is ${a.streak.best} days.`
        : "No streak yet — capture something today.",
  );
  rows.push(
    a.voice.total30d > 0
      ? `${Math.round((a.voice.dictated30d / a.voice.total30d) * 100)}% by voice in the last 30 days.`
      : "Nothing dictated lately — voice captures show up here.",
  );
  rows.push(
    a.scoring.open === 0
      ? "Nothing open to score."
      : a.scoring.scored === a.scoring.open
        ? "Every open idea is scored."
        : `${a.scoring.scored} of ${a.scoring.open} open ideas scored.`,
  );
  rows.push(
    a.oldestUntouched
      ? `Oldest untouched idea: ${a.oldestUntouched.days} day${a.oldestUntouched.days === 1 ? "" : "s"}.`
      : "Inbox is clear.",
  );

  const optedOut = prefs.data?.optedOut ?? false;

  return (
    <>
      <Label>Your numbers</Label>
      {rows.map((row) => (
        <Note key={row}>{row}</Note>
      ))}
      {/*
        Product telemetry opt-out. Personal numbers above are unaffected - they
        compute from the user's own rows either way. This governs only the
        once-daily heartbeat (platform + whether an AI key is set) that feeds
        the owner's aggregates.
      */}
      <Button
        compact
        title={optedOut ? "Product telemetry: off" : "Product telemetry: on"}
        onPress={() =>
          void (async () => {
            setError(undefined);
            try {
              await setOptOut({ optedOut: !optedOut });
            } catch (e) {
              setError(errorMessage(e));
            }
          })()
        }
      />
      <Note>Counts the app opens per day for product stats. Your ideas never leave your account.</Note>
      {error ? <Failure message={error} /> : null}
      {prefs.error ? <Failure message={prefs.error} retry={prefs.retry} /> : null}
    </>
  );
}
