import assert from 'node:assert/strict';
import { list } from '../src/convex/ideas';

// Execute the actual handler with an in-memory DB boundary: no deployed writes.
const base = { userId: 'owner', title: 'Idea', status: 'inbox', tags: [], favorite: false, archived: false, source: 'typed', createdAt: 1, updatedAt: 1 };
const rows = Array.from({ length: 252 }, (_, seq) => ({ ...base, _id: `idea-${seq}`, seq }));
rows[0] = { ...rows[0], archived: true, favorite: true };
const strong = { ...rows[1], impact: 10, confidence: 10, effort: 1 };
rows[1] = strong;
const ranges: unknown[][] = [];
const ctx = {
  auth: { getUserIdentity: async () => ({ subject: 'owner|session' }) },
  db: { query: (table: string) => {
    assert.equal(table, 'ideas');
    return { withIndex: (name: string, select: (query: { eq: (key: string, value: unknown) => unknown }) => unknown) => {
      const filters: unknown[] = [];
      const builder = { eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; } };
      select(builder); ranges.push([name, ...filters]);
      return { collect: async () => rows };
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
console.log('PASS: actual list handler archive/favorites/priority-before-cap and unauthenticated rejection; no database operations.');
