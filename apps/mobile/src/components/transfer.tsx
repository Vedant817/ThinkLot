import { useState } from "react";
import { Share } from "react-native";
import { useMutation } from "convex/react";
import {
  api,
  importFromPmSource,
  exportFilename,
  findImportDuplicates,
  partitionForImport,
  toBackupJson,
  toCsv,
  toNotionMarkdown,
  type ImportCandidate,
} from "../lib/api";
import { useLiveQuery } from "../lib/live-query";
import { errorMessage } from "../lib/auth";
import { Button, Failure, Field, Label, Note } from "./ui";

/**
 * Import and export, on a phone.
 *
 * ## Why export goes through the SHARE SHEET
 *
 * There is no filesystem picker installed, and adding `expo-file-system` is blocked by
 * this machine's npm script policy. Rather than ship a feature that needs a dependency
 * I cannot install, this uses React Native's built-in `Share`, which is already there:
 * on Android it hands the text to whatever app the user picks - Notes, Mail, Drive,
 * messaging - which is exactly the destination they wanted anyway.
 *
 * The honest limitation: sharing large text through a chooser is less pleasant than
 * saving a file, and there is no "save to Downloads" button. The JSON BACKUP still
 * works, because a user can paste it anywhere; the friction is real but the data is not
 * trapped.
 */
export function Transfer() {
  const importMany = useMutation(api.portability.importMany);
  const query = useLiveQuery(api.portability.exportAll, {});
  const lot = query.data;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<{
    fileName: string;
    /** What this app thought the file was. Shown, because a guess presented as a
     *  fact is a lie the user cannot check. */
    detected: { source: string; label: string; confidence: string; matched: string[]; note?: string };
    /** Every column this app had no field for. Named, never dropped silently. */
    unmapped: string[];
    fresh: ImportCandidate[];
    duplicates: { candidate: ImportCandidate; matchesExisting: { id: string; title: string }[] }[];
    unreadable: { source: string; reason: string }[];
  } | null>(null);

  // --- export -------------------------------------------------------------------
  const share = async (kind: "markdown" | "csv" | "json") => {
    if (!lot) return;
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const body =
        kind === "markdown"
          ? toNotionMarkdown(lot.ideas, lot.exportedAt)
          : kind === "csv"
            ? toCsv(lot.ideas)
            : toBackupJson(lot.ideas, lot.exportedAt);

      const result = await Share.share({
        title: exportFilename(kind, lot.exportedAt),
        message: body,
      });

      setNote(
        result.action === Share.sharedAction
          ? `Shared ${lot.ideas.length} idea${lot.ideas.length === 1 ? "" : "s"}.`
          : "Export cancelled. Nothing left this device.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // --- import -------------------------------------------------------------------
  const onPreview = () => {
    setError(undefined);
    setNote(undefined);
    setPreview(null);

    const text = paste.trim();
    if (!text) {
      setError("Paste a Markdown file, a CSV, or a JSON backup first.");
      return;
    }

    const { parsed, detected, unmapped } = detectAndParse(text);
    const titles = (lot?.ideas ?? []).map((idea) => ({ _id: idea._id, title: idea.title }));
    const { fresh, duplicates } = partitionForImport(
      findImportDuplicates(parsed.candidates, titles),
    );

    setPreview({
      fileName: `${fresh.length + duplicates.length} found`,
      detected,
      unmapped,
      fresh,
      duplicates,
      unreadable: parsed.skipped,
    });
  };

  const onImport = async () => {
    if (!preview || preview.fresh.length === 0 || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      // Batched at the server's own limit, each call verified - a large paste is a
      // sequence of small steps rather than one transaction that fails having written
      // nothing.
      let imported = 0;
      const skipped: { title: string; reason: string }[] = [];
      let remaining = 0;

      for (let i = 0; i < preview.fresh.length; i += 200) {
        const batch = preview.fresh.slice(i, i + 200);
        const outcome = await importMany({
          entries: batch.map((entry) => ({
            title: entry.title,
            ...(entry.description ? { description: entry.description } : {}),
            ...(entry.problem ? { problem: entry.problem } : {}),
            ...(entry.audience ? { audience: entry.audience } : {}),
            ...(entry.outcome ? { outcome: entry.outcome } : {}),
            ...(entry.trigger ? { trigger: entry.trigger } : {}),
            ...(entry.transcript ? { transcript: entry.transcript } : {}),
            ...(entry.tags.length ? { tags: entry.tags } : {}),
            ...(entry.revisitAt ? { revisitAt: entry.revisitAt } : {}),
            ...(entry.letGoAt ? { letGoAt: entry.letGoAt } : {}),
            ...(entry.letGoReason ? { letGoReason: entry.letGoReason } : {}),
          })),
        });
        imported += outcome.imported;
        skipped.push(...outcome.skipped);
        remaining = outcome.remaining;
      }

      setNote(
        `Imported ${imported}.` +
          (skipped.length ? ` ${skipped.length} skipped as duplicates.` : "") +
          (remaining ? ` ${remaining} left for a second pass.` : ""),
      );
      setPaste("");
      setPreview(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const ideaCount = lot?.ideas.length ?? 0;

  return (
    <>
      <Label>Export</Label>
      {!lot ? (
        <Note>Loading…</Note>
      ) : ideaCount === 0 ? (
        <Note>Nothing to export yet.</Note>
      ) : (
        <>
          <Note>
            {ideaCount} idea{ideaCount === 1 ? "" : "s"}
            {lot?.archivedCount ? ` · ${lot.archivedCount} archived, included` : ""}
            {lot?.taskCount ? ` · ${lot.taskCount} checklist items, included` : ""}
          </Note>

          {/* A capped export that looked complete would be the worst outcome here: the
              user would believe they had a backup and not have one. */}
          {lot?.truncated ? (
            <Failure message="This lot is larger than one export covers, so this is only part of it." />
          ) : null}

          <Button
            title={busy ? "Working…" : "Share as Markdown (paste into Notion)"}
            primary
            disabled={busy}
            onPress={() => void share("markdown")}
          />
          <Button
            title="Share as JSON backup"
            disabled={busy}
            onPress={() => void share("json")}
          />
          <Button
            title="Share as CSV"
            disabled={busy}
            onPress={() => void share("csv")}
          />
          <Note>
            The JSON backup is the lossless one — every field, archived ideas and
            checklists included.
          </Note>
          {note ? <Note>{note}</Note> : null}
        </>
      )}

      <Label>Import</Label>
      <Note>
        Open a Markdown or CSV file (or a JSON backup) in any app, copy it, and paste it
        here. You will see exactly what would be added before anything is.
      </Note>
      <Field
        label="Paste the file contents"
        placeholder="## My idea&#10;&#10;Some notes"
        value={paste}
        onChangeText={setPaste}
        multiline
        maxLength={200000}
      />
      <Button title="Preview what would be imported" disabled={busy} onPress={onPreview} />

      {preview ? (
        <>
          <Note>
            {preview.fresh.length} new
            {preview.duplicates.length ? ` · ${preview.duplicates.length} already look like something you have` : ""}
            {preview.unreadable.length ? ` · ${preview.unreadable.length} unreadable` : ""}
          </Note>

          {/* What this app thought the file was, and how sure it is. Shown because a
              guess presented as a fact is a lie the user cannot check - "Read as Jira"
              is an invitation to correct it, and either way the import works. */}
          <Note>
            Read as {preview.detected.label}
            {preview.detected.confidence !== "exact" ? " (probably)" : ""}
            {preview.detected.matched.length > 0 ? ` — saw ${preview.detected.matched.join(", ")}` : ""}
            {preview.detected.note ? ` — ${preview.detected.note}` : ""}
          </Note>

          {/* Every column this app had NO field for.
            Every column this app had NO field for.

            On a phone this matters MORE than on the web, because the phone is where a
            Jira export usually lands first, and a real one has around 200 columns. A
            blank version of this line would claim every column was understood, which
            is never true of a real export - and the importer that says nothing is the
            one with a bug.
            one with a bug. */}
          {preview.unmapped.length > 0 ? (
            <Note>
              {preview.unmapped.length} column{preview.unmapped.length === 1 ? "" : "s"} not imported:{" "}
              {preview.unmapped.slice(0, 12).join(", ")}
              {preview.unmapped.length > 12 ? ` and ${preview.unmapped.length - 12} more` : ""}
            </Note>
          ) : (
            <Note>Every column in it mapped to a ThinkLot field.</Note>
          )}

          {/* The description and tags are shown too, so the mapping can be verified
              before committing to it rather than after. */}
          {preview.fresh.slice(0, 5).map((entry) => (
            <Note key={entry.title}>
              {entry.title}
              {entry.description || entry.problem
                ? ` — ${entry.description ?? entry.problem}`
                : ""}
              {entry.tags.length ? ` [#${entry.tags.join(" #")}]` : ""}
            </Note>
          ))}

          {/* Collisions are shown and NOT imported. Skipping silently loses a real
              idea; importing silently doubles the lot. */}
          {preview.duplicates.length > 0 ? (
            <Note>
              Skipped as duplicates:{" "}
              {preview.duplicates
                .slice(0, 5)
                .map((d) => `${d.candidate.title} (matches "${d.matchesExisting[0]?.title}")`)
                .join("; ")}
              {preview.duplicates.length > 5 ? ` and ${preview.duplicates.length - 5} more` : ""}
            </Note>
          ) : null}

          {preview.fresh.length > 0 ? (
            <>
              <Note>Will add: {preview.fresh.slice(0, 8).map((f) => f.title).join("; ")}
                {preview.fresh.length > 8 ? ` and ${preview.fresh.length - 8} more` : ""}
              </Note>
              <Button
                title={`Import ${preview.fresh.length} idea${preview.fresh.length === 1 ? "" : "s"}`}
                primary
                disabled={busy}
                onPress={() => void onImport()}
              />
            </>
          ) : null}
        </>
      ) : null}

      <Failure message={error} />
    </>
  );
}

/**
 * Everything about a file, decided the same way for every source.
 *
 * Mobile used to have its own three-path guesser (JSON backup, CSV, Markdown). The
 * shared `pm-import` module replaces it, because a product manager's phone is where
 * the Jira CSV and the Notion export actually arrive and the differences between
 * those are which columns they ship - which is what that module knows and this did
 * not. One implementation, both clients, no drift.
 *
 * Returns the parse AND the detection, so the caller keeps no module-level state.
 */
function detectAndParse(text: string): {
  parsed: { candidates: ImportCandidate[]; skipped: { source: string; reason: string }[] };
  detected: { source: string; label: string; confidence: string; matched: string[]; note?: string };
  unmapped: string[];
} {
  const outcome = importFromPmSource(text, "");
  return {
    parsed: { candidates: outcome.entries, skipped: outcome.skipped },
    detected: {
      source: outcome.detection.source.id,
      label: outcome.detection.source.label,
      confidence: outcome.detection.confidence,
      matched: outcome.detection.matched,
      note: outcome.detection.note,
    },
    unmapped: outcome.unmappedColumns,
  };
}
