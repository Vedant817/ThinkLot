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

/**
 * The spec fields added late: who it is for, expected outcome, source/trigger.
 *
 * The clear semantics are the part worth pinning down here, offline and free.
 * A cleared field must send `null`, not "", because the backend contract is
 * omit = leave alone and null = clear - sending "" would store an empty string
 * where the field was meant to be unset, and omitting would make the field
 * impossible to clear at all.
 *
 * The reconcile behaviour is the other half: a live update must not overwrite
 * a field the user is mid-way through typing, but must win for fields nobody
 * touched. Both halves existed for the original three fields and had to be
 * re-established for these three rather than assumed to follow.
 */
const specFields = { audience: 'field engineers', outcome: 'no more lost notes', trigger: 'a conversation' };
const seeded = { _id: 'spec', title: 'Spec idea', ...specFields };
const specBuffer = reconcile(null, seeded);
assert.equal(specBuffer.values.audience, 'field engineers');

specBuffer.values.trigger = 'My in-progress edit';
const specRemote = reconcile(specBuffer, { ...seeded, audience: 'someone else' });
assert.equal(specRemote.values.trigger, 'My in-progress edit', 'A live update must not clobber an uncommitted edit');
assert.equal(specRemote.values.audience, 'someone else', 'Untouched fields take the server value');
assert.deepEqual(textPatch(specRemote), { trigger: 'My in-progress edit' });

for (const field of ['audience', 'outcome', 'trigger'] as const) {
  const cleared = reconcile(reconcile(null, seeded), seeded);
  cleared.values[field] = '';
  cleared.values[field === 'audience' ? 'outcome' : 'audience'] = '';
  assert.deepEqual(
    textPatch(cleared),
    { [field]: null, [field === 'audience' ? 'outcome' : 'audience']: null },
    `clearing ${field} sends null so the backend clears it rather than storing ""`
  );
}

// Whitespace is not content. "   " should clear the field, not save three spaces.
const spaced = reconcile(reconcile(null, seeded), seeded);
spaced.values.outcome = '   ';
assert.deepEqual(textPatch(spaced), { outcome: null }, 'a whitespace-only edit clears rather than saving blank padding');

console.log('PASS: capture preservation, concurrent mobile editor, and spec-field clear regressions (no database operations).');
