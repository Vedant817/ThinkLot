export { api } from "../../../../src/convex/_generated/api";
export type { Id } from "../../../../src/convex/_generated/dataModel";
export { IDEA_STATUSES } from "../../../../src/lib/types";
export type {
  Idea,
  IdeaTask,
  TimelineEvent,
  IdeaStats,
} from "../../../../src/lib/types";
export {
  priorityScore,
  displayScore,
  lotPlate,
  byPriority,
  scoreBand,
  scoreBarWidth,
} from "../../../../src/lib/scoring";
/*
 * Maturity and timeline are shared rather than reimplemented.
 *
 * Both are pure functions over fields that already exist, so the Android client gets
 * the same answers the web client does for free - and, more importantly, there is no
 * second copy to drift. `maturity.ts` in particular had to be fixed once already for a
 * reason that applies here too: a list row omits problem/audience/outcome, so maturity
 * computed from a list must use the `coreFields` COUNT the server now sends. That count
 * is on the shared `Idea` type, which is what makes it reachable from here.
 */
export { maturityOf, maturityLabel } from "../../../../src/lib/maturity";
export type { Maturity, MaturityStage } from "../../../../src/lib/maturity";
export { describeEvent } from "../../../../src/lib/timeline";
export { relativeDay } from "../../../../src/lib/dates";
/*
 * The capture pipeline, shared rather than reimplemented.
 *
 * This is the Wispr Flow path. Wispr - and every system-wide dictation tool -
 * injects finished text into the focused field in one shot, so an idea dictated on
 * the move arrives as one long run-on paragraph. `parseCapture` splits that into a
 * title and a body WITHOUT discarding the tail, and keeps the utterance verbatim as
 * a transcript when it was dictated.
 *
 * Before this, the Android client sent the entire draft as the title. The server caps
 * a title at 300 characters, so anything longer - which is exactly what a dictated
 * idea is - was rejected outright and the thought was lost. There is no second copy
 * of the parser here because that would be a second thing to drift.
 */
export {
  parseCapture,
  looksDictated,
  looksInjected,
  extractTrigger,
  TITLE_MAX,
  DRAFT_LIMIT,
} from "../../../../src/lib/capture";
export type {
  CaptureSource,
  ParsedCapture,
} from "../../../../src/lib/capture";
