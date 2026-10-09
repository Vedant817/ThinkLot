import assert from 'node:assert/strict';
import { parseCapture, looksDictated, looksInjected, extractTrigger } from '../src/lib/capture';
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

// ---------------------------------------------------------------------------
// WISPR FLOW: the case the timing heuristic structurally cannot see.
//
// Wispr injects the finished utterance in ONE input event. That is one gap at best,
// so `looksDictated` refuses to guess and returns false. The consequence was not
// cosmetic: `parseCapture` keeps a verbatim transcript ONLY when the source is
// 'dictated', so a Wispr-captured idea had its title and body split correctly while
// its original wording was silently discarded - the one input path the transcript
// field exists for was the one it failed on.
// ---------------------------------------------------------------------------
{
  // Timing genuinely cannot see it. This is the whole reason shape detection exists.
  assert.equal(looksDictated([30]), false, 'one gap is not enough evidence');
  assert.equal(looksDictated([]), false);

  // Shape does see it: nobody types three words between two events.
  assert.equal(looksInjected(240), true, 'a block injection is detected');
  assert.equal(looksInjected(24), true, 'at the threshold exactly');
  assert.equal(looksInjected(23), false);

  // A SHORT Wispr injection must be caught too. The first threshold of 200 missed
  // this case entirely, and a dictated sentence is often shorter than 200 characters.
  const short = parseCapture('waitlist for cancellations', looksInjected(28) ? 'dictated' : 'typed');
  assert.equal(short.source, 'dictated', 'a 28-character injection is still an injection');
  assert.equal(short.transcript, 'waitlist for cancellations');

  // And the consequence is fixed: with the source correctly 'dictated', the verbatim
  // utterance is kept.
  const utterance =
    'so I was walking with Priya and she said empty appointment slots are costing her money, ' +
    'we should have a cancellation waitlist that fills them automatically';
  const detected = looksInjected(utterance.length);
  assert.equal(detected, true, 'Wispr injects the whole utterance in one go');
  const parsed = parseCapture(utterance, detected ? 'dictated' : 'typed');
  assert.equal(parsed.source, 'dictated');
  assert.equal(parsed.transcript, utterance.trim(), 'the verbatim wording survives');
  assert.ok((parsed.title + (parsed.description ?? '')).length > 0);
}

// Being wrong in the risky direction is harmless, which is why the bar is high.
{
  // A pasted link or a short phrase is not a human typist either, but if the
  // heuristic fires the only consequence is a verbatim copy of what the user typed
  // being stored alongside the parsed title - nothing is invented and none is lost.
  assert.equal(looksInjected(12), false, 'ordinary typing is not an injection');
  assert.equal(looksInjected(0), false, 'deleting text is not an injection');
  assert.equal(looksInjected(-5), false, 'and neither is a negative delta');
}

// ---------------------------------------------------------------------------
// INLINE CONTEXT: "… Trigger: …" spoken out loud.
// ---------------------------------------------------------------------------
{
  // A trailing full stop belongs to the trigger clause itself - it is the end of what
  // the user said. Only strip a terminal comma, which is what a spoken "trigger," is
  // followed by.
  const spoken = 'idea, a cancellation waitlist. trigger, walking with Priya, she said empty slots cost her money.';
  const { text, trigger } = extractTrigger(spoken);
  assert.equal(trigger, 'walking with Priya, she said empty slots cost her money.', 'the trigger keeps its own punctuation');
  assert.ok(!/trigger/i.test(text), 'the clause is not left in the body to be stored twice');
  assert.match(text, /cancellation waitlist/, 'and the idea itself survives');
  // Pinned because the earlier version stripped the full stop, and with no sentence
  // boundary left in the body `parseCapture` then cut the title at "money" instead of
  // at "waitlist" - a title that named the wrong half of the idea.
  assert.equal(
    parseCapture(text, 'dictated').title,
    'idea, a cancellation waitlist',
    'removing the trigger must leave the idea a clean, parsable sentence'
  );

  // A spoken "trigger," IS followed by a comma, and that comma belongs to the clause.
  const spokenComma = 'idea, a cancellation waitlist. trigger, walking with Priya';
  assert.equal(extractTrigger(spokenComma).trigger, 'walking with Priya');

  // Case and a full-width colon, because dictated text is punctuated by ear.
  assert.equal(extractTrigger('thing. Trigger: raining').trigger, 'raining');
  assert.equal(extractTrigger('thing. trigger：raining').trigger, 'raining');
  assert.equal(extractTrigger('thing. TRIGGER: raining').trigger, 'raining');

  // Nothing to extract means undefined, so a caller can tell "no trigger" from
  // "an empty one".
  assert.equal(extractTrigger('just a plain idea').trigger, undefined);
  assert.equal(extractTrigger('just a plain idea').text, 'just a plain idea');

  // A stray colon is a typo, not a label.
  assert.equal(extractTrigger('idea trigger: ').trigger, undefined);

  // The word appearing mid-thought is content, not a label.
  assert.equal(
    extractTrigger('the trigger for the pipeline failed and nobody noticed').trigger,
    undefined,
    'a trigger word in the middle of a sentence is not a trigger field'
  );
}

// ---------------------------------------------------------------------------
// 8. THE THREE DEFECTS AN ADVERSARIAL QA AGENT FOUND IN THE CAPTURE BAR.
//    All three silently destroyed or dropped user text. Each is asserted here at
//    the pure-function level; the wiring is asserted in the web suite.
// ---------------------------------------------------------------------------
{
	// (a) A 20,000-character capture must survive PARSING WHOLE.
	//
	// The input handler used to slice the draft to DRAFT_LIMIT (4,000) on every
	// keystroke, so a pasted 20k wall lost 16k characters with nothing recoverable.
	// The server accepts a 20,000-character body, so the honest answer is to keep
	// the text and split it - not to trim it.
	const long = 'x'.repeat(20_000);
	const parsedLong = parseCapture(long, 'typed')!;
	assert.ok(parsedLong.title.length <= 300, 'title stays within the server cap');
	assert.equal(
		(parsedLong.title + (parsedLong.description ?? '')).replace(/\s/g, ''),
		long.replace(/\s/g, ''),
		'every one of the 20,000 characters survives parsing'
	);

	// (b) The spoken trigger must be extractable AND removable without eating the
	//     sentence that preceded it.
	const spoken = 'a cancellation waitlist. trigger, walking with Priya';
	const extracted = extractTrigger(spoken);
	assert.equal(extracted.trigger, 'walking with Priya', 'the trigger is recovered');
	assert.equal(
		extracted.text,
		'a cancellation waitlist',
		'and the idea sentence survives, with no stray punctuation from the removed clause'
	);

	// A trigger that follows a real sentence must not take the sentence's full stop.
	const withIdea = 'a cancellation waitlist. trigger, walking with Priya, she said empty slots cost money';
	assert.equal(extractTrigger(withIdea).trigger, 'walking with Priya, she said empty slots cost money');
	assert.match(extractTrigger(withIdea).text, /^a cancellation waitlist/, 'and the idea sentence survives intact');

	// (c) One injection must not be forgotten by a later keystroke. This is the
	//     latch, expressed as the property it guarantees: a shape signal observed
	//     once stays observed.
	assert.equal(looksInjected(24), true, 'the threshold fires at 24');
	assert.equal(looksInjected(23), false, 'and not at 23');
	// The bug was that the SECOND call overwrote the first with false. A latch has
	// the property that `latched(a) || latched(b)` is true if either was injected.
	const latched = (a: number, b: number) => looksInjected(a) || looksInjected(b);
	assert.equal(latched(24, 1), true, 'a late keystroke must not erase an earlier injection');
	assert.equal(latched(1, 24), true, 'in either order');
	assert.equal(latched(1, 1), false, 'and pure typing is still pure typing');
}

console.log('PASS: capture preservation, concurrent mobile editor, spec-field clear, Wispr block injection, inline trigger context, and the three QA capture defects (no database operations).');
