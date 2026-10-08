import assert from 'node:assert/strict';
import { list } from '../src/convex/ideas';

// Execute the actual handler with an in-memory DB boundary: no deployed writes.
const base = { userId: 'owner', title: 'Idea', status: 'inbox', tags: [], favorite: false, archived: false, source: 'typed', createdAt: 1, updatedAt: 1 };
const rows = Array.from({ length: 252 }, (_, seq) => ({ ...base, _id: `idea-${seq}`, seq }));
rows[0] = { ...rows[0], archived: true, favorite: true };
const strong = { ...rows[1], impact: 10, confidence: 10, effort: 1 };
rows[1] = strong;
const ranges: unknown[][] = [];
/** How many documents each read asked for, so the fast path can be asserted. */
const reads: Array<{ index: string; taken: number | 'all' }> = [];

/**
 * `seqDesc` mirrors `seq` inverted, as the schema's `by_user_archived_seq` index
 * requires. The fixture builds it rather than the handler, because the handler only
 * ever writes it in `capture`.
 */
function withDerived(doc: (typeof rows)[number]) {
  return { ...doc, seqDesc: -doc.seq };
}

function matches(name: string, filters: unknown[]): (typeof rows)[number][] {
  const conditions = new Map<string, unknown>();
  for (const [key, value] of filters as [string, unknown][]) conditions.set(key, value);
  let out = rows.filter((row) => {
    for (const [key, value] of conditions) {
      if ((row as unknown as Record<string, unknown>)[key] !== value) return false;
    }
    return true;
  });
  // Every index the handler uses ends in an ascending sort field, and
  // `by_user_archived_seq` ends in `seqDesc` which is inverted, so ascending there
  // is newest-first.
  if (name === 'by_user_archived_seq') {
    out = [...out].sort((a, b) => (a as unknown as { seqDesc: number }).seqDesc - (b as unknown as { seqDesc: number }).seqDesc);
  } else if (name === 'by_user_seq') {
    out = [...out].sort((a, b) => a.seq - b.seq);
  }
  return out;
}

const ctx = {
  auth: { getUserIdentity: async () => ({ subject: 'owner|session' }) },
  db: { query: (table: string) => {
    assert.equal(table, 'ideas');
    return { withIndex: (name: string, select: (query: { eq: (key: string, value: unknown) => unknown }) => unknown) => {
      const filters: unknown[] = [];
      const builder = { eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; } };
      select(builder); ranges.push([name, ...filters]);
      const found = matches(name, filters);
      const shaped = found.map(withDerived);
      return {
        collect: async () => { reads.push({ index: name, taken: 'all' }); return shaped; },
        take: async (n: number) => { reads.push({ index: name, taken: n }); return shaped.slice(0, n); }
      };
    } };
  } },
};
const handler = (list as unknown as { _handler: (context: unknown, args: Record<string, unknown>) => Promise<{ ideas: { _id: string }[]; total: number; truncated: boolean }> })._handler;
const archive = await handler(ctx, { archivedOnly: true });
assert.deepEqual(archive.ideas.map((idea) => idea._id), ['idea-0']);
const favorites = await handler(ctx, { favoriteOnly: true, includeArchived: true });
assert.deepEqual(favorites.ideas.map((idea) => idea._id), ['idea-0']);
const ranked = await handler(ctx, { sortPriority: true });
assert.equal(ranked.ideas[0]._id, strong._id, 'Older strongest idea is ranked before cap');
assert.equal(ranked.ideas.length, 250);
assert.equal(ranked.truncated, true);
assert.ok(ranges.every((range) => JSON.stringify(range).includes('["userId","owner"]')), 'Every read is owner-scoped');
await assert.rejects(() => handler({ ...ctx, auth: { getUserIdentity: async () => null } }, {}), /must be signed in/);

/**
 * The optimisation this exists to prove.
 *
 * 252 rows exist and the cap is 250, so a handler that reads everything to sort
 * it shows up as `taken: 'all'`. The plain lot request must instead ask for
 * `cap + 1` from the archived-filtered, newest-first index - and must exclude the
 * archived row in the index rather than discarding it in JavaScript.
 */
reads.length = 0;
const plain = await handler(ctx, {});
assert.deepEqual(plain.ideas.map((idea) => idea._id).slice(0, 2).sort(), ['idea-1', 'idea-2']);
assert.equal(plain.truncated, true, 'over the cap, so truncated');
assert.equal(reads.length, 1, 'one read');
assert.equal(reads[0].taken, 251, `asked for cap + 1 rows, not the whole table (asked for ${reads[0].taken})`);
assert.equal(
  reads[0].index,
  'by_user_archived_seq',
  `the hot path uses the newest-first archived-filtered index, used ${reads[0].index}`
);
assert.ok(
  !plain.ideas.some((idea) => idea._id === 'idea-0'),
  'the archived idea is excluded by the index, not filtered after the read'
);

// A search still has to scan, because a substring match over six text columns
// cannot be indexed - but it must not silently become the default behaviour.
reads.length = 0;
await handler(ctx, { search: 'Idea' });
assert.equal(reads[0].taken, 'all', 'a text search still reads the candidate set');

console.log('PASS: actual list handler archive/favorites/priority-before-cap, index-filtered fast path, and unauthenticated rejection; no database operations.');
