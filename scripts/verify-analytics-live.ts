/**
 * Live accuracy cross-check: the probe account performed a KNOWN history, so the
 * shared module must reproduce it exactly from live rows. If the math is right on
 * fixtures but wrong on the wire (field names, missing columns, casing), this is
 * where it shows.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computePersonal } from '../src/lib/analytics';

const CONVEX = 'https://posh-chihuahua-240.convex.cloud';
const probe = JSON.parse(readFileSync(process.env.TEMP + '\\tl-analytics-probe.json', 'utf8')) as {
	token: string;
	email: string;
};

async function call(path: string, args: unknown, kind: 'query' | 'mutation' = 'query') {
	const r = await fetch(`${CONVEX}/api/${kind}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${probe.token}` },
		body: JSON.stringify({ path, args, format: 'json' })
	});
	const body = (await r.json()) as { status: string; value?: never; errorMessage?: string };
	assert.equal(body.status, 'success', `${path} failed: ${body.errorMessage}`);
	return body.value as never;
}

const lot = (await call('ideas:list', { includeArchived: true })) as {
	ideas: Parameters<typeof computePersonal>[0];
	truncated: boolean;
	total: number;
};
assert.equal(lot.ideas.length, 3, 'probe account holds exactly the 3 captured ideas');
assert.equal(lot.truncated, false, 'nothing truncated at this size');

const events = (await call('analytics:events', {})) as Parameters<typeof computePersonal>[1];
const kinds = new Set(events.map((e) => e.kind));
assert.ok(kinds.has('captured'), 'capture events exist');
assert.ok(kinds.has('scored'), 'the scoring wrote its event');

const stats = (await call('ideas:stats', {})) as { tasksTotal: number; tasksDone: number; tasksTruncated: boolean };
assert.deepEqual(
	{ total: stats.tasksTotal, done: stats.tasksDone },
	{ total: 0, done: 0 },
	'no tasks on the probe account'
);

const a = computePersonal(lot.ideas, events, {
	done: stats.tasksDone,
	total: stats.tasksTotal,
	truncated: stats.tasksTruncated
});

assert.deepEqual(a.streak, { current: 1, best: 1 }, 'all three captured today: streak 1/1');
assert.deepEqual(
	a.voice,
	{ dictated30d: 1, total30d: 3, dictatedAll: 1, totalAll: 3 },
	'exactly the dictated capture counts'
);
assert.deepEqual(a.scoring, { scored: 1, open: 3 }, 'exactly the scored idea counts');
assert.deepEqual(a.verbatimKept, { dictated: 1, withTranscript: 1 }, 'transcript survived the round-trip');
assert.deepEqual(a.favoritesActedOn, { total: 1, active: 0 }, 'favorited inbox idea is not acted on');
assert.deepEqual(a.finishVsLetGo, { done: 0, letGo: 0 }, 'nothing finished or let go');
assert.deepEqual(a.decisionMix30d, { try: 0, park: 1, letGo: 0, skip: 0 }, 'exactly the park decision');
assert.ok(
	a.decisionLatencyMedianDays !== null && a.decisionLatencyMedianDays < 1,
	`same-day decisions read <1 day, got ${a.decisionLatencyMedianDays}`
);
assert.ok(a.oldestUntouched !== null && a.oldestUntouched.days === 0, 'fresh inbox reads 0 days untouched');

console.log('PASS: live rows reproduce the known probe history exactly.');
