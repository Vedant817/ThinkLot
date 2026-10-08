export type TextFields = {
  title: string;
  description: string;
  problem: string;
};
export type EditBuffer = {
  id: string;
  values: TextFields;
  baseline: TextFields;
};
export function fields(idea: {
  title: string;
  description?: string;
  problem?: string;
}): TextFields {
  return {
    title: idea.title,
    description: idea.description ?? "",
    problem: idea.problem ?? "",
  };
}
export function reconcile(
  buffer: EditBuffer | null,
  idea: { _id: string; title: string; description?: string; problem?: string },
): EditBuffer {
  const incoming = fields(idea);
  if (!buffer || buffer.id !== idea._id)
    return { id: idea._id, values: incoming, baseline: incoming };
  const values = { ...buffer.values };
  for (const key of ["title", "description", "problem"] as const) {
    if (buffer.values[key] === buffer.baseline[key])
      values[key] = incoming[key];
  }
  return { id: idea._id, values, baseline: incoming };
}
export function textPatch(buffer: EditBuffer): {
  title?: string;
  description?: string | null;
  problem?: string | null;
} {
  const patch: ReturnType<typeof textPatch> = {};
  if (buffer.values.title !== buffer.baseline.title)
    patch.title = buffer.values.title.trim();
  for (const key of ["description", "problem"] as const) {
    if (buffer.values[key] !== buffer.baseline[key])
      patch[key] = buffer.values[key].trim() || null;
  }
  return patch;
}
