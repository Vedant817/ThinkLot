/**
 * Scoring invariants.
 *
 * Offline, no database, no network. These are the properties that were violated
 * three times over while looking correct: the score is drawn as a bar length on
 * three screens, and all three screens had independently guessed a divisor, so
 * the best possible idea rendered at 62% of a full bar.
 */
import assert from 'node:assert/strict';
import {
  MAX_SCORE,
  displayScore,
  priorityScore,
  scoreBand,
  scoreBarWidth,
} from '../src/lib/scoring';

// A maximum-scoring idea fills its bar. A score above the maximum clamps rather
// than overflowing its track.
assert.equal(scoreBarWidth(MAX_SCORE), 100, 'a maximum score fills the bar');
assert.equal(scoreBarWidth(MAX_SCORE * 4), 100, 'a score past the maximum clamps, not overflows');

// The inputs are 1..10, so 10 x 10 / 1 is genuinely reachable and is the top.
assert.equal(priorityScore({ impact: 10, confidence: 10, effort: 1 }), MAX_SCORE);

// Unscored is not zero. Drawing a stub for it would claim a judgement nobody
// made, so it renders at genuinely zero width.
assert.equal(scoreBarWidth(null), 0);

// A scored-but-tiny idea stays visible, because "scored 0.2" and "not scored
// yet" are different states and must not look identical.
assert.ok(scoreBarWidth(0.2) > 0, 'a low but real score is still drawn');

// The scale must span the range the bands actually discriminate. This is the
// assertion the /40 version failed: every real score landed below 25% of the
// track, in the flat part where differences are invisible.
const bandFloor = scoreBarWidth(10); // the "solid" threshold
assert.ok(
  bandFloor >= 10,
  `the lowest band threshold should occupy a visible share of the track, got ${bandFloor}%`
);

// Bands agree with the scale: every score in a band sits above every score in
// the band below it once drawn.
for (const [score, band] of [
  [0.5, 'low'],
  [9.9, 'low'],
  [10, 'solid'],
  [23.9, 'solid'],
  [24, 'strong'],
  [100, 'strong'],
] as const) {
  assert.equal(scoreBand(score), band, `score ${score} should be in the ${band} band`);
  const drawn = scoreBarWidth(score);
  assert.ok(drawn <= 100 && drawn >= 0, `score ${score} draws out of range: ${drawn}%`);
}

// Monotonic: a higher score never draws a shorter bar. A non-monotonic scale is
// the failure mode of a hand-tuned divisor, and it silently misranks.
let previous = -1;
for (const score of [0.1, 1, 5, 10, 24, 50, 100]) {
  const drawn = scoreBarWidth(score);
  assert.ok(drawn >= previous, `bar shrank at score ${score}: ${drawn}% after ${previous}%`);
  previous = drawn;
}

// Degenerate inputs are not scores.
assert.equal(priorityScore({ impact: 10, confidence: 10, effort: 0 }), null);
assert.equal(priorityScore({}), null);
assert.equal(scoreBarWidth(NaN), 0, 'NaN must not paint a bar');
assert.equal(scoreBand(null), 'unscored');

console.log('PASS: scoring scale, bands and bar widths are consistent (no database operations).');
