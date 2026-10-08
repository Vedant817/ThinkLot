/**
 * Roadmap invariants.
 *
 * Offline, no database. The failure mode here is not a crash - it is a plan that
 * looks decisive and is wrong. Every check below targets one specific way that
 * happens: telling you to start something unstartable, forgetting what you already
 * started, or padding a column to look full.
 */
import assert from 'node:assert/strict';
import { buildRoadmap } from '../src/lib/roadmap';

type Idea = Parameters<typeof buildRoadmap>[0][number];

let seq = 0;

/** A fully developed, scored idea: judged and ready to plan. */
function ready(title: string, impact: number, effort = 1, confidence = 3) {
	return {
		_id: `i${seq++}`,
		title,
		seq: seq,
		problem: 'p',
		audience: 'a',
		outcome: 'o',
		trigger: 't',
		impact,
		effort,
		confidence
	} as unknown as Idea;
}

/** A title and nothing else: real, kept, but unplannable. */
function spark(title: string) {
	return { _id: `i${seq++}`, title, seq: seq++ } as unknown as Idea;
}

/** Judged, and with tasks half done - i.e. genuinely in progress. */
function started(title: string, impact: number, done = 1, total = 2) {
	return {
		...ready(title, impact),
		totalTasks: total,
		doneTasks: done
	} as unknown as Idea;
}

// ---------------------------------------------------------------------------
// 1. AN UNSTARTABLE IDEA NEVER REACHES `now`, HOWEVER HIGH IT SCORES.
// ---------------------------------------------------------------------------
//
// The headline failure. A well-described, unscored idea with a huge impact number
// is NOT a priority-1 item - it has not been decided on. Equal-bucket sorting puts
// it in `now` and the roadmap tells you to begin it.
{
	const plan = buildRoadmap([{ ...spark('huge but undecided'), impact: 10, effort: 1, confidence: 3 }]);
	assert.equal(plan.now.length, 0, 'an unstartable idea cannot be told to start now');
	assert.equal(plan.unready.length, 1);
	assert.equal(plan.empty, true, 'with nothing plannable, say so rather than show empty columns');
	assert.match(
		plan.unready[0].reason,
		/still needs: describe the problem/,
		'and name the missing step - this idea IS scored, its description is what it lacks'
	);
}

// The same idea with NO score at all gets a different, equally specific reason.
// Both halves matter: "not ready" without saying what is missing is the padding
// this module exists to avoid.
{
	const plan = buildRoadmap([spark('bare title')]);
	assert.equal(plan.now.length, 0);
	assert.match(plan.unready[0].reason, /not scored, so it cannot be ranked/);
	assert.ok(
		/still needs/.test(plan.unready[0].reason),
		'and it is missing more than one thing, so it says both'
	);
}

// A scored idea whose core questions are unanswered is equally unplannable.
{
	const half = { ...ready('scored but unshaped'), problem: '' } as unknown as Idea;
	const plan = buildRoadmap([half]);
	assert.equal(plan.now.length, 0, 'a score alone does not make an idea plannable');
	assert.equal(plan.unready.length, 1);
	assert.match(plan.unready[0].reason, /still needs/i, 'it names the missing step');
}

// ---------------------------------------------------------------------------
// 2. WORK ALREADY STARTED IS NOT DISPLACED BY A HIGHER SCORE.
// ---------------------------------------------------------------------------
//
// A low-scoring idea with half its tasks done is the most expensive thing in the
// lot to abandon. No score should be able to evict it from `now`.
{
	const plan = buildRoadmap([
		ready('tenth', 10),
		ready('ninth', 9),
		ready('eighth', 8),
		started('already underway', 1)
	]);
	// The started idea scores LOWEST of the four and still leads `now`. Capacity is
	// three, so `now` is full - which is exactly the condition under which a
	// score-ordered implementation would have evicted it.
	assert.equal(plan.now.length, 3, 'now is at capacity');
	assert.equal(plan.now[0].idea.title, 'already underway', 'the started idea leads, despite scoring last');
	assert.match(plan.now[0].reason, /does not justify stopping/, 'and the reason says why');
	assert.ok(
		!plan.now.some((i) => i.idea.title === 'eighth'),
		'the LOWEST-scoring idea is the one displaced, not the one already underway'
	);
	assert.deepEqual(plan.overflow.map((i) => i.idea.title), ['eighth'], 'and the displacement is reported');
}

// And when more is started than the capacity, the overflow is everything that did
// not fit - not a silently truncated list.
{
	const inFlightTitles = new Set(['s1', 's2', 's3', 's4']);
	const plan = buildRoadmap([
		started('s1', 1),
		started('s2', 1),
		started('s3', 1),
		started('s4', 1),
		ready('fresh', 10)
	], { nowCapacity: 2 });
	assert.equal(plan.now.length, 2, 'capacity is a hard limit');
	// Everything plannable that did not get a `now` slot: the two displaced started
	// ideas AND the candidate that never had room. The first version reported only
	// the candidate, so displaced work in flight vanished from the count.
	assert.equal(plan.overflow.length, 3, 'displaced work in progress is counted, not lost');
	const displaced = plan.overflow.filter((i) => inFlightTitles.has(i.idea.title));
	assert.equal(displaced.length, 2, 'both squeezed-out started ideas are reported');
	assert.ok(
		plan.overflow.every((i) => /now` is full/.test(i.reason)),
		'the overflow says it was a capacity decision'
	);
}

// ---------------------------------------------------------------------------
// 3. COLUMNS ARE NOT PADDED TO LOOK FULL.
// ---------------------------------------------------------------------------
//
// Equal-bucket splitting fills `later` with entries nobody deferred. Here `later`
// must contain only ideas that genuinely scored and genuinely lost.
{
	const plan = buildRoadmap([ready('a', 5), ready('b', 4)], { nowCapacity: 3, nextCapacity: 7 });
	assert.equal(plan.now.length, 2, 'everything plannable fits, and is not padded to 3');
	assert.equal(plan.later.length, 0, 'later stays empty rather than being filled for looks');
}

// An unscored idea must NOT show up in `later` either - that is the padding, just
// with different wording.
{
	const plan = buildRoadmap([spark('untouched'), ready('one real idea', 3)]);
	assert.ok(
		!plan.later.some((i) => i.idea.title === 'untouched'),
		'an unranked idea is never presented as a deliberate deferral'
	);
	assert.equal(plan.unready.length, 1);
}

// ---------------------------------------------------------------------------
// 4. COMMITTED IDEAS ARE NOT FUTURE PLAN ITEMS.
// ---------------------------------------------------------------------------
{
	const done = { ...ready('shipped', 9), status: 'done', totalTasks: 3, doneTasks: 3 } as unknown as Idea;
	const plan = buildRoadmap([done, ready('live', 3)]);
	assert.equal(plan.skipped, 1, 'a finished idea is counted as skipped, not filed under later');
	assert.ok(!plan.items.some((i) => i.idea.title === 'shipped'));

	const included = buildRoadmap([done], { includeCommitted: true });
	assert.equal(included.skipped, 0, 'opt-in works');
	assert.equal(included.items.length, 1);
}

// ---------------------------------------------------------------------------
// 5. THE PLAN IS DETERMINISTIC, because one that reshuffles stops being believed.
// ---------------------------------------------------------------------------
{
	const ideas = [ready('a', 3), ready('b', 9), ready('c', 6), started('d', 1), spark('e')];
	const first = buildRoadmap(ideas).items.map((i) => i.idea._id);
	const second = buildRoadmap([...ideas].reverse()).items.map((i) => i.idea._id);
	assert.deepEqual(first, second, 'input order does not change the plan');
}

// ---------------------------------------------------------------------------
// 6. EVERY PLACEMENT EXPLAINS ITSELF, and no reason is ever empty.
// ---------------------------------------------------------------------------
{
	const plan = buildRoadmap([
		ready('a', 9), ready('b', 8), ready('c', 7), ready('d', 6), ready('e', 5), spark('f')
	], { nowCapacity: 2, nextCapacity: 1 });
	for (const item of plan.items) {
		assert.ok(item.reason.length > 0, `${item.lane} item has no reason`);
	}
	assert.equal(plan.later.length, 2, 'the remainder lands in later');
	assert.match(plan.later[0].reason, /behind the ideas ahead/, 'and later admits it is a ranking result');
}

// ---------------------------------------------------------------------------
// 7. NOTHING IS LOST OR DUPLICATED.
// ---------------------------------------------------------------------------
{
	const ideas = [
		ready('a', 9), ready('b', 8), ready('c', 7), ready('d', 6), ready('e', 5),
		ready('f', 4), started('g', 1), spark('h'), spark('i'),
		{ ...ready('shipped', 9), status: 'done', totalTasks: 1, doneTasks: 1 } as unknown as Idea
	];
	const plan = buildRoadmap(ideas);
	const ids = plan.items.map((i) => i.idea._id);
	assert.equal(new Set(ids).size, ids.length, 'no idea appears in two lanes');
	// 10 input ideas, one committed and skipped.
	assert.equal(ids.length + plan.skipped, ideas.length, 'every idea is either placed or counted as skipped');
	assert.equal(plan.empty, false);
}

// ---------------------------------------------------------------------------
// 8. AN EMPTY LOT IS NOT AN ERROR.
// ---------------------------------------------------------------------------
{
	const plan = buildRoadmap([]);
	assert.deepEqual(plan.items, []);
	assert.equal(plan.empty, true);
	assert.equal(plan.skipped, 0);
}

// ---------------------------------------------------------------------------
// 9. A LIST ROW IS NOT A WHOLE IDEA - AND MUST NOT BE READ AS ONE.
// ---------------------------------------------------------------------------
//
// The bug this suite did not have. `ideas:list` deliberately omits problem, audience
// and outcome, because they are long free text and the list is capped. `maturityOf`
// cannot tell an omitted field from an empty one, so every idea in every
// list-derived view computed as `spark`: the dashboard's maturity badge read "Spark"
// for every idea in "Worth building first", and the roadmap judged the whole lot
// unplannable.
//
// The unit tests above all passed, because they fed whole objects. This block feeds
// what `list` actually returns.
{
	const fullyShaped = {
		_id: 'x1',
		title: 'Surface stale field notes',
		seq: 1,
		trigger: 'Saw it on the farm',
		coreFields: 3,
		impact: 3,
		effort: 1,
		confidence: 3
	} as unknown as Idea;

	const plan = buildRoadmap([fullyShaped]);
	assert.equal(plan.empty, false, 'a shaped, scored list row must be plannable');
	assert.equal(plan.now.length, 1, 'and it must reach `now`, not the unready lane');
	assert.equal(plan.unready.length, 0);
}

// A COUNT says how many are answered, NOT which. Naming a specific missing field
// from a count alone is a confident guess, and it guesses wrong: an idea that has
// answered audience and outcome would be told to "describe the problem" - the one
// thing it has already done.
{
	const partial = {
		_id: 'x2',
		title: 'Half described',
		seq: 2,
		coreFields: 2,
		impact: 3,
		effort: 1,
		confidence: 3
	} as unknown as Idea;

	const plan = buildRoadmap([partial]);
	assert.equal(plan.unready.length, 1, 'two of three core questions is not plannable');
	assert.match(
		plan.unready[0].reason,
		/answer 1 more of the three core question/i,
		'counts honestly instead of naming a field it cannot know is missing'
	);
	assert.ok(
		!/describe the problem|who it is for|the outcome it should produce/i.test(plan.unready[0].reason),
		'never names a specific field from a count alone'
	);
}

// A whole row, which the detail page holds, still gets precise advice.
{
	const whole = {
		_id: 'x3',
		title: 'Named gap',
		audience: 'field crews',
		outcome: 'notes are current',
		seq: 3
	} as unknown as Idea;
	const plan = buildRoadmap([whole]);
	assert.match(plan.unready[0].reason, /describe the problem/i, 'with the field in hand, name it');
}

console.log('PASS: a plan that admits what it cannot rank, and will not abandon work in progress.');