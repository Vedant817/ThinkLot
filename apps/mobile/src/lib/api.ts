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
