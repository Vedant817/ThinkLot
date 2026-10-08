/**
 * Maturity invariants.
 *
 * Offline, no database. Maturity is derived from fields an idea already has, which
 * makes it the easiest thing in this app to get subtly wrong: no error, just a
 * number that flatters an undeveloped idea.
 *
 * The properties below are the ones that make the number mean something - that it
 * cannot be gamed by writing prose, that an unconsidered idea cannot outrank a
 * considered one, and that it always says what to do next.
 */
import assert from 'node:assert/strict';
import { maturityOf, maturityLabel, MATURITY_STAGES, type MaturityInput } from '../src/lib/maturity';

const bare: MaturityInput = { title: 'Offline-first capture' };

// THE BASELINE: a title and nothing else.
{
  const m = maturityOf(bare);
  assert.equal(m.stage, 'spark', 'a bare title is a spark');
  assert.equal(m.percent, 0, 'and scores nothing');
  assert.ok(m.next.length > 0, 'and says what to do about it');
  assert.deepEqual(m.missing, [
    'the problem it solves',
    'who it is for',
    'the outcome it should produce',
    'a score',
    'what prompted it',
    'a next step'
  ]);
}

// A DICTATED WALL OF TEXT IS NOT A CONSIDERED IDEA.
//
// This is the trap worth guarding. The description is where dictation lands, so if
// length counted, the longest unconsidered idea in the lot would look the most
// mature. `problem`, `audience` and `outcome` are the fields that count instead.
{
  const wordy = maturityOf({ ...bare, description: 'word '.repeat(2000) });
  assert.equal(wordy.percent, 0, 'a long description adds nothing to maturity');
}

// THE THREE CORE QUESTIONS DOMINATE.
//
// An idea with every field filled but no score must beat an idea with a score and
// no thought behind it, because the first can be decided on and the second cannot.
{
  const written = maturityOf({
    title: 'x',
    problem: 'p',
    audience: 'a',
    outcome: 'o',
    description: 'word '.repeat(500)
  });
  const scoredOnly = maturityOf({ title: 'x', impact: 10, confidence: 10, effort: 1 });
  assert.ok(
    written.percent > scoredOnly.percent,
    `writing it down should beat merely scoring it (${written.percent} vs ${scoredOnly.percent})`
  );
}

// AN UNSCORED IDEA CANNOT OUTRANK A SCORED ONE.
{
  const shaped = maturityOf({ title: 'x', problem: 'p', audience: 'a', outcome: 'o' });
  const shapedAndScored = maturityOf({
    title: 'x',
    problem: 'p',
    audience: 'a',
    outcome: 'o',
    impact: 7,
    confidence: 7,
    effort: 3
  });
  assert.ok(shapedAndScored.percent > shaped.percent);
  assert.equal(shaped.next, 'Score impact, confidence and effort');
}

// STAGES ONLY EVER GO UP, AND EACH NEEDS THE ONE BEFORE IT.
{
  const ladder = [
    maturityOf(bare),
    maturityOf({ ...bare, problem: 'p' }),
    maturityOf({ ...bare, problem: 'p', audience: 'a' }),
    maturityOf({ ...bare, problem: 'p', audience: 'a', outcome: 'o' }),
    maturityOf({ ...bare, problem: 'p', audience: 'a', outcome: 'o', impact: 8, confidence: 8, effort: 2 }),
    maturityOf({
      title: 'x',
      problem: 'p',
      audience: 'a',
      outcome: 'o',
      impact: 8,
      confidence: 8,
      effort: 2,
      totalTasks: 2,
      doneTasks: 1,
      trigger: 'a postmortem'
    })
  ];
  let previous = -1;
  for (const m of ladder) {
    const rank = MATURITY_STAGES.indexOf(m.stage);
    assert.ok(rank >= previous, `stage went backwards: ${m.stage} after rank ${previous}`);
    previous = rank;
  }
  assert.equal(ladder[0].stage, 'spark');
  assert.equal(ladder[4].stage, 'judged', 'written and scored but no task yet is judged');
  assert.equal(ladder[5].stage, 'actioned', 'with tasks defined it is actioned');
}

// JUDGING AND ACTIONING ARE DIFFERENT JOBS, AND THE STAGES MUST NOT CONFLATE THEM.
//
// The first implementation demanded a checklist row before reporting "judged", so
// a fully written, fully scored idea with nothing to do yet said "shaped". The
// check that caught it is the one below.
{
  const writtenAndScored = maturityOf({
    title: 'x',
    problem: 'p',
    audience: 'a',
    outcome: 'o',
    impact: 9,
    confidence: 9,
    effort: 2
  });
  assert.equal(writtenAndScored.stage, 'judged', 'no task is needed to have judged it');

  const withTasks = maturityOf({
    title: 'x',
    problem: 'p',
    audience: 'a',
    outcome: 'o',
    impact: 9,
    confidence: 9,
    effort: 2,
    totalTasks: 2
  });
  assert.equal(withTasks.stage, 'actioned', 'a planned task moves it to being actioned');
}

// A PERFECT SCORE WITH NO IDEA OF WHO IT IS FOR IS NOT "JUDGED".
//
// Measured before written: this was the case that made the stage name wrong.
{
  const measured = maturityOf({ title: 'x', impact: 10, confidence: 10, effort: 1, totalTasks: 3 });
  assert.notEqual(measured.stage, 'judged', 'a score alone does not make an idea judged');
  assert.equal(measured.stage, 'spark');
}

// FINISHING THE WORK COUNTS.
{
  const complete = maturityOf({
    title: 'x',
    problem: 'p',
    audience: 'a',
    outcome: 'o',
    impact: 8,
    confidence: 8,
    effort: 2,
    totalTasks: 3,
    doneTasks: 3,
    trigger: 't'
  });
  assert.equal(complete.stage, 'committed', 'a finished checklist is committed');
  assert.equal(complete.percent, 100, `a finished idea should be complete, got ${complete.percent}`);
  assert.equal(complete.next, '', 'nothing left to suggest');
}

// ONE TICKED TASK IS NOT A COMMITMENT.
{
  const started = maturityOf({
    title: 'x',
    problem: 'p',
    audience: 'a',
    outcome: 'o',
    impact: 8,
    confidence: 8,
    effort: 2,
    totalTasks: 5,
    doneTasks: 1,
    trigger: 't'
  });
  assert.equal(started.stage, 'actioned', 'one of five done is in progress, not committed');
}

{
  const committed = maturityOf({
    title: 'x',
    problem: 'p',
    audience: 'a',
    outcome: 'o',
    impact: 8,
    confidence: 8,
    effort: 2,
    totalTasks: 2,
    doneTasks: 2,
    trigger: 't',
    status: 'building'
  });
  assert.equal(committed.stage, 'committed');
}

// PERCENT IS ALWAYS IN RANGE, INCLUDING ON JUNK INPUT.
{
  const hostile: MaturityInput[] = [
    {},
    { problem: '   ', audience: '\n', outcome: '' },
    { impact: 0, confidence: 0, effort: 0 },
    { impact: Number.NaN, confidence: 5, effort: 5 },
    { totalTasks: 0, doneTasks: 5 },
    { tags: [], status: 'nonsense' }
  ];
  for (const input of hostile) {
    const m = maturityOf(input);
    assert.ok(
      Number.isFinite(m.percent) && m.percent >= 0 && m.percent <= 100,
      `percent out of range for ${JSON.stringify(input)}: ${m.percent}`
    );
    assert.ok(MATURITY_STAGES.includes(m.stage), `unknown stage ${m.stage}`);
    assert.ok(maturityLabel(m.stage).length > 0, 'every stage has a label');
  }
}

// A ZERO OR NEGATIVE EFFORT IS NOT A SCORE.
//
// `priorityScore` already refuses these, and maturity must agree with it rather
// than counting a division by zero as a judgement.
{
  const zeroEffort = maturityOf({
    title: 'x',
    problem: 'p',
    audience: 'a',
    outcome: 'o',
    impact: 9,
    confidence: 9,
    effort: 0
  });
  assert.equal(zeroEffort.stage, 'shaped', 'a zero effort does not make it judged');
  assert.equal(zeroEffort.next, 'Score impact, confidence and effort', 'and the score is still outstanding');
  assert.ok(zeroEffort.missing.includes('a score'));
}

// AND THE NEXT STEP IS CHOSEN BY LEVERAGE, NOT BY THE ORDER OF THE GAPS.
//
// With nothing written, "describe the problem" beats "score it": you cannot rank
// an idea you have not worked out. Asserted because the two orderings are easy to
// conflate and only one of them is useful.
{
  const nothingWritten = maturityOf({ title: 'x' });
  assert.equal(nothingWritten.next, 'Describe the problem');
  assert.notEqual(nothingWritten.next, 'Score impact, confidence and effort');
}

// MORE MISSING THINGS NEVER MAKES AN IDEA LOOK BETTER.
{
  const nearly = maturityOf({ title: 'x', problem: 'p', audience: 'a', outcome: 'o' });
  const totallyBare = maturityOf(bare);
  assert.ok(nearly.percent > totallyBare.percent);
  assert.ok(nearly.missing.length < totallyBare.missing.length);
}

console.log('PASS: maturity is derived, bounded, and cannot be flattered by prose (no database operations).');
