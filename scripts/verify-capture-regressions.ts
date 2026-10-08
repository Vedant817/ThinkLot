import assert from 'node:assert/strict';
import { parseCapture } from '../src/lib/capture';
import { reconcile, textPatch } from '../apps/mobile/src/lib/edit-buffer';

for (const raw of ['x'.repeat(350) + '. tail sentence', 'x'.repeat(350) + '\nsecond line', 'x'.repeat(500), 'Ok. ' + 'word '.repeat(100)]) {
  const capture = parseCapture(raw, 'typed')!;
  assert.ok(capture.title.length <= 300);
  assert.equal((capture.title + (capture.description ?? '')).replace(/\s/g, ''), raw.replace(/\s/g, ''), 'Every captured character survives');
}
const initial = { _id: 'first', title: 'Old title', description: 'Original notes', problem: 'Original problem' };
const buffer = reconcile(null, initial);
buffer.values = { ...buffer.values, title: 'My local title' };
const merged = reconcile(buffer, { ...initial, description: 'Remote notes', problem: 'Remote problem' });
assert.equal(merged.values.title, 'My local title');
assert.equal(merged.values.description, 'Remote notes');
assert.deepEqual(textPatch(merged), { title: 'My local title' });
merged.values.description = '';
assert.deepEqual(textPatch(merged), { title: 'My local title', description: null });
const next = reconcile(merged, { _id: 'second', title: 'Second idea' });
assert.equal(next.values.title, 'Second idea');
assert.deepEqual(textPatch(next), {});
console.log('PASS: capture preservation and concurrent mobile editor regressions (no database operations).');
