export type TextFields = {
  title: string;
  description: string;
  problem: string;
  /** Spec field: "Who is it for". */
  audience: string;
  /** Spec field: "Expected outcome". */
  outcome: string;
  /** Spec field: "Source / trigger". Not dictation. */
  trigger: string;
};

export type EditBuffer = {
  id: string;
  values: TextFields;
  baseline: TextFields;
};

/**
 * Fields that can be CLEARED, and therefore send `null` rather than "".
 *
 * `title` is absent deliberately: an idea with no title cannot be listed,
 * searched or quoted, so a blank title is refused server-side rather than
 * silently meaning "do not change".
 */
const CLEARABLE = ["description", "problem", "audience", "outcome", "trigger"] as const;

/**
 * The same list, for reconciling an incoming realtime update.
 *
 * A field is taken from the server only when the user has NOT edited it. This is
 * what stops a live update from clobbering text someone is mid-way through
 * typing, while still letting the server's value win for fields nobody touched.
 */
const RECONCILED = ["title", "description", "problem", "audience", "outcome", "trigger"] as const;

export function fields(idea: {
  title: string;
  description?: string;
  problem?: string;
  audience?: string;
  outcome?: string;
  trigger?: string;
}): TextFields {
  return {
    title: idea.title,
    description: idea.description ?? "",
    problem: idea.problem ?? "",
    audience: idea.audience ?? "",
    outcome: idea.outcome ?? "",
    trigger: idea.trigger ?? "",
  };
}

export function reconcile(
  buffer: EditBuffer | null,
  idea: {
    _id: string;
    title: string;
    description?: string;
    problem?: string;
    audience?: string;
    outcome?: string;
    trigger?: string;
  },
): EditBuffer {
  const incoming = fields(idea);
  if (!buffer || buffer.id !== idea._id)
    return { id: idea._id, values: { ...incoming }, baseline: { ...incoming } };
  const values = { ...buffer.values };
  for (const key of RECONCILED) {
    if (buffer.values[key] === buffer.baseline[key]) values[key] = incoming[key];
  }
  // `baseline` is a separate object from `values`, deliberately.
  //
  // These used to be the same reference. Every caller then mutated `values` to
  // record an edit - which also moved `baseline`, because they were one object.
  // The comparison above reads that moved baseline as "this field equals the
  // baseline", concludes the user never touched it, and replaces it with the
  // server value: an in-progress edit silently discarded on the next realtime
  // update. Copying costs one object per reconcile and removes the whole class
  // of bug, rather than relying on every caller remembering not to mutate.
  return { id: idea._id, values, baseline: { ...incoming } };
}

export function textPatch(buffer: EditBuffer): {
  title?: string;
  description?: string | null;
  problem?: string | null;
  audience?: string | null;
  outcome?: string | null;
  trigger?: string | null;
} {
  const patch: ReturnType<typeof textPatch> = {};
  if (buffer.values.title !== buffer.baseline.title)
    patch.title = buffer.values.title.trim();
  for (const key of CLEARABLE) {
    if (buffer.values[key] !== buffer.baseline[key])
      patch[key] = buffer.values[key].trim() || null;
  }
  return patch;
}
