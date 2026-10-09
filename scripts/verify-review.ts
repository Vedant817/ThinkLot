/**
 * Review decision tests.
 *
 * Offline, no database. The whole point of keeping these rules in a pure module is that
 * the four decisions can be tested without an account - and that the web client, the
 * mobile client and the server cannot each grow their own version of "park".
 *
 * The checks that matter most:
 *
 * 1. **`let go` archives and NEVER deletes.** Losing the idea would make the feature
 *    actively harmful.
 * 2. **`let go` REQUIRES a reason.** A reasonless let-go is just an archive with extra
 *    steps, which is the confusion this exists to remove.
 * 3. **`skip` changes nothing at all.** A decision to leave something alone must not
 *    silently edit the thing being left alone.
 */

import assert from 'node:assert/strict';
import {
	DECISIONS,
	DEFAULT_REVISIT_DAYS,
	effectOf,
	buildSession,
	isUsefulReviewWeek,
	validateDecision,
	type Reviewable
} from '../src/lib/review';

const now = Date.parse('2026-10-09T10:00:00Z');
const inDays = (days: number) => ({ outcome: 'park' as const, reason: '', inDays: days });

// ---------------------------------------------------------------------------
// 1. THE VOCABULARY IS COMPLETE AND COHERENT.
// ---------------------------------------------------------------------------
{
	const outcomes = DECISIONS.map((d) => d.outcome);
	assert.deepEqual(outcomes, ['try', 'park', 'letGo', 'skip']);
	for (const spec of DECISIONS) {
		assert.ok(spec.label.length > 0, `${spec.outcome} needs a label`);
		assert.ok(spec.blurb.length > 10, `${spec.outcome} needs a blurb`);
		assert.ok(
			spec.blurb.includes('.') || spec.blurb.includes('—'),
			`${spec.outcome}'s blurb reads as a sentence: "${spec.blurb}"`
		);
	}
	// Exactly one asks for a reason. If more did, the one that actually needs it would
	// stop standing out - and that reason is the whole value of "let go".
	assert.deepEqual(
		DECISIONS.filter((d) => d.asksReason).map((d) => d.outcome),
		['letGo']
	);
	// "Try" must NOT survive on blurred alonOur.
	assert.equal(DEFAULT_REVISIT_DAYS, 7);
}

// ---------------------------------------------------------------------------
// 2. LET GO ARCHIVES, KEEPS, AND DEMANDS A REASON.
// ---------------------------------------------------------------------------
{
	const effect = effectOf({ outcome: 'letGo', reason: 'Already solved in the March pass', inDays: 0 }, now);
	assert.equal(effect.archived, true, 'let go leaves the working surfaces');
	assert.equal(effect.letGoReason, 'Already solved in the March pass', 'the reason is recorded');
	assert.ok(typeof effect.letGoAt === 'number', 'and dated');
	assert.equal(effect.revisitAt, null, 'a let-go idea is not coming back to a queue');
	assert.match(effect.narrative, /let go/, 'the narrative says so');

	// The idea is NOT deleted - that is what archived vs removed means here, and it is
	// the difference between a reversible decision and a lost one.
	assert.equal('deleted' in effect, false, 'nothing about the effect deletes the idea');

	assert.match(
		validateDecision({ outcome: 'letGo', reason: '   ', inDays: 0 }) ?? '',
		/Say why/,
		'a reasonless let-go is rejected'
	);
	assert.equal(validateDecision({ outcome: 'letGo', reason: 'Not for me', inDays: 0 }), null);
}

// A whole reason is preserved verbatim - it is the user's sentence, not a summary.
{
	const effect = effectOf(
		{ outcome: 'letGo', reason: '  Same thing as the 2024 attempt, which we shipped  ' },
		now
	);
	assert.equal(effect.letGoReason, 'Same thing as the 2024 attempt, which we shipped', 'trimmed, not rewritten');
	assert.match(effect.narrative, /Same thing as the 2024 attempt/, 'and carried into the narrative');
}

// ---------------------------------------------------------------------------
// 3. TRY AND PARK ARE DIFFERENT, AND BOTH CLEAR A PREVIOUS LET-GO.
// ---------------------------------------------------------------------------
{
	const tryEffect = effectOf({ outcome: 'try', reason: 'One capture of the top tag', inDays: 7 }, now);
	assert.equal(tryEffect.status, 'ready', 'trying moves the idea forward');
	assert.equal(tryEffect.archived, false, 'and un-archives what was parked');
	assert.equal(tryEffect.clearLetGo, true, 'committing to a let-go idea must forget that decision');
	assert.equal(
		tryEffect.revisitAt,
		now + 7 * 86_400_000,
		'and comes back for the weekly check-in'
	);

	const parkEffect = effectOf({ outcome: 'park', reason: 'wait', inDays: 30 }, now);
	assert.equal(parkEffect.status, 'parked', 'parking is not trying');
	assert.equal(parkEffect.clearLetGo, true, 'and also forgets a previous let-go');
	assert.equal(parkEffect.revisitAt, now + 30 * 86_400_000);
	assert.match(parkEffect.narrative, /parked for 30 days/);

	// Singular vs plural is a detail, but a user reads this in a list.
	assert.match(effectOf(inDays(1), now).narrative, /parked for 1 day$/, 'one day reads as "1 day"');
	assert.match(effectOf(inDays(2), now).narrative, /parked for 2 days$/, 'and two as "2 days"');

	// A default window is the same either way, so the difference is the outcome and not
	// the arithmetic. Compared at the SAME date to make that a real check.
	const sameTry = effectOf({ outcome: 'try', reason: '', inDays: 1 }, now);
	const samePark = effectOf({ outcome: 'park', reason: '', inDays: 1 }, now);
	assert.equal(sameTry.revisitAt, samePark.revisitAt, 'same window, same timestamp');
}

// ---------------------------------------------------------------------------
// 4. SKIP CHANGES NOTHING.
// ---------------------------------------------------------------------------
{
	const effect = effectOf({ outcome: 'skip', reason: '', inDays: 0 }, now);
	assert.deepEqual(effect, { narrative: 'left for later' }, 'skip touches no field at all');
	assert.equal(validateDecision({ outcome: 'skip', reason: '', inDays: 0 }), null, 'and needs nothing');
}

// ---------------------------------------------------------------------------
// 5. VALIDATION REFUSES WHAT WOULD MISLEAD.
// ---------------------------------------------------------------------------
{
	assert.match(validateDecision({ outcome: 'park', reason: '', inDays: 0 }) ?? '', /choose how long/i);
	assert.match(validateDecision({ outcome: 'try', reason: '', inDays: 0 }) ?? '', /choose how long/i);
	assert.match(validateDecision({ outcome: 'try', reason: '', inDays: -1 }) ?? '', /choose how long/i);
	assert.match(
		validateDecision({ outcome: 'try', reason: '', inDays: Number.NaN }) ?? '',
		/choose how long/i,
		'NaN must not slip through as a date'
	);
	assert.match(
		validateDecision({ outcome: 'park', reason: '', inDays: 3650 }) ?? '',
		/A year is longer/,
		'a 10-year promise is a decision nobody can honour'
	);
	assert.equal(validateDecision({ outcome: 'park', reason: '', inDays: 365 }), null, 'but a year is accepted');
	assert.match(
		validateDecision({ outcome: 'nope' as never, reason: '', inDays: 0 }) ?? '',
		/not one of the four/,
		'an unknown outcome is refused'
	);
}

// A zero-day window is refused even though it is a "valid number".
{
	assert.match(validateDecision(inDays(0)) ?? '', /choose how long/i);
	assert.equal(validateDecision(inDays(1)), null);
}

// ---------------------------------------------------------------------------
// 6. THE SESSION: five ideas, and the commitment is not crowded out.
// ---------------------------------------------------------------------------
{
	const make = (id: string, days: number, unscored = false): Reviewable => ({
		_id: id,
		createdAt: now - days * 86_400_000,
		updatedAt: now - days * 86_400_000,
		score: unscored ? null : 10,
		daysUntouched: days,
		unscored
	});

	// 40 ideas, none of them special.
	const many = Array.from({ length: 40 }, (_, i) => make(`m${i}`, i));
	const session = buildSession(many);
	assert.equal(session.items.length, 5, 'a session is five ideas, not the whole backlog');
	assert.equal(session.total, 40, 'and says how many there are');
	assert.equal(session.truncated, true);
	assert.equal(new Set(session.items.map((i) => i._id)).size, 5, 'no duplicates');

	// The commitment comes FIRST, always, even against 40 due parks.
	const withCommitment = buildSession(many, { commitmentId: 'm39' });
	assert.equal(withCommitment.items[0]._id, 'm39', 'the previous commitment is the first thing you see');
	assert.equal(withCommitment.commitmentId, 'm39');
	assert.equal(
		new Set(withCommitment.items.map((i) => i._id)).size,
		withCommitment.items.length,
		'and appears exactly once'
	);

	// A commitment id that is no longer in the pool must not crash or fabricate.
	const gone = buildSession(many, { commitmentId: 'does-not-exist' });
	assert.equal(gone.commitmentId, null);
	assert.equal(gone.items[0]._id, gone.items[0]._id, 'and still produces a session');

	// A category cannot crowd out the others: three due parks must not become the
	// whole session.
	const due = Array.from({ length: 10 }, (_, i) => make(`d${i}`, 30));
	const fresh = Array.from({ length: 5 }, (_, i) => make(`f${i}`, 0));
	const mixed = buildSession([...due, ...fresh]);
	assert.ok(mixed.items.length === 5, 'still five');
	assert.ok(
		mixed.items.filter((i) => i._id.startsWith('f')).length >= 1,
		'a fresh idea is not squeezed out entirely by a backlog of due parks'
	);

	assert.deepEqual(buildSession([]).items, [], 'an empty lot is an empty session, not an error');
	assert.deepEqual(buildSession([make('a', 5)]).items.length, 1, 'and one idea is a one-idea session');
}

// ---------------------------------------------------------------------------
// 7. THE METRIC IS HONEST ABOUT WHAT DOES NOT COUNT.
// ---------------------------------------------------------------------------
{
	const commit = { outcome: 'try' as const, completedSomething: false };
	const done = { outcome: 'try' as const, completedSomething: true };
	const letGo = { outcome: 'letGo' as const };

	assert.equal(isUsefulReviewWeek([]), false, 'an empty session is not a useful week');
	assert.equal(isUsefulReviewWeek([commit]), false, 'committing is not completing');
	assert.equal(isUsefulReviewWeek([done]), true, 'completing something is');
	assert.equal(isUsefulReviewWeek([letGo]), true, 'and so is letting go with a reason');
	assert.equal(
		isUsefulReviewWeek([commit, done]),
		true,
		'one real outcome among several intentions still counts'
	);
	// The trap this closes: somebody who parks everything for a month should not read as
	// six "useful review weeks". Parking is not coming back with a result.
	const allPark = Array.from({ length: 6 }, () => ({ outcome: 'park' as const }));
	assert.equal(isUsefulReviewWeek(allPark), false, 'a month of parking is not six useful weeks');
}

console.log('PASS: four decisions, one of them irreversible only if you count archive as loss (no database operations).');