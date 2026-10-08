/**
 * Clustering invariants.
 *
 * Offline, no database. The failure mode of "group by shared tag" is not a crash -
 * it is a confident, useless answer: one common tag chains the whole lot into a
 * single cluster and the feature claims all your ideas are related. Every check
 * here exists to catch that specific lie.
 */
import assert from 'node:assert/strict';
import { clusterIdeas, relatedIdeas, primaryClusterFor } from '../src/lib/clustering';

const idea = (id: string, ...tags: string[]) => ({ _id: id, tags });

// THE HEADLINE FAILURE: a tag everybody shares must produce NO cluster.
//
// Ten ideas, eight of them tagged #work. The naive implementation returns one
// cluster of eight and calls it a relationship.
{
  const ideas = [
    idea('a', 'work'),
    idea('b', 'work'),
    idea('c', 'work'),
    idea('d', 'work'),
    idea('e', 'work'),
    idea('f', 'work'),
    idea('g', 'work'),
    idea('h', 'work'),
    idea('i'),
    idea('j')
  ];
  const clusters = clusterIdeas(ideas);
  assert.deepEqual(clusters, [], 'a tag on 80% of the lot is the rule, not a signal');
}

// A RARE TAG IS A SIGNAL - INCLUDING IN A SMALL LOT.
//
// Four ideas, three sharing #field. A pure 40% ratio would drop everything, because
// any pair out of four is 50% of the set, and clustering would silently do nothing
// on a young lot. The cap has a floor of two for exactly this reason.
{
  const ideas = [
    idea('a', 'handover', 'field'),
    idea('b', 'handover', 'field'),
    idea('c', 'field'),
    idea('d', 'field')
  ];
  const clusters = clusterIdeas(ideas);
  const tags = clusters.map((c) => c.tag).sort();
  assert.deepEqual(tags, ['handover'], 'two of four binds; three of four is a majority and is dropped');
  const handover = clusters.find((c) => c.tag === 'handover');
  assert.deepEqual(handover?.memberIds, ['a', 'b']);
  assert.equal(handover?.rationale, 'shares #handover', 'a cluster can explain itself');
}

// BUT A MAJORITY IS STILL A MAJORITY, EVEN WHEN SMALL.
//
// Three of four is 75%. The floor must not become a loophole that lets a
// near-universal tag through on a small lot.
{
  const ideas = [
    idea('a', 'work'),
    idea('b', 'work'),
    idea('c', 'work'),
    idea('d')
  ];
  assert.deepEqual(clusterIdeas(ideas), [], 'three of four is a majority, not a signal');
}

// THE 40% BOUNDARY IS EXACTLY WHERE IT CLAIMS TO BE.
//
// Ten ideas; four of them share a tag, five of them share another. A boundary that
// is off by one produces results that look right and cannot be reasoned about.
//
// (The first version of this fixture used `[].map(...)` as filler, which spreads
// nothing - so it was silently testing a four-idea lot and passing for the wrong
// reason.)
{
  const filler = Array.from({ length: 6 }, (_, i) => idea(`f${i}`));

  const four = clusterIdeas([idea('a', 'x'), idea('b', 'x'), idea('c', 'x'), idea('d', 'x'), ...filler]);
  assert.equal(four.length, 1, 'four of ten is exactly at the cap, so it still counts');
  assert.equal(four[0].memberIds.length, 4);

  // Five tagged plus FIVE untagged, so the total is ten. Six would make it eleven
  // and the cap would move with it, which is how this check passed while testing
  // nothing.
  const five = clusterIdeas([
    idea('a', 'x'),
    idea('b', 'x'),
    idea('c', 'x'),
    idea('d', 'x'),
    idea('e', 'x'),
    ...filler.slice(0, 5)
  ]);
  assert.equal(five.length, 0, 'five of ten is one over, and stops being a signal');
}

// EVERY CLUSTER IS BOUND BY A TAG BOTH ITS MEMBERS ACTUALLY CARRY.
//
// The alternative - connected components - produces clusters where no two members
// share anything, which cannot be explained on screen.
{
  const ideas = [
    idea('a', 'x'),
    idea('b', 'x', 'y'),
    idea('c', 'y'),
    idea('d', 'z'),
    idea('e', 'z'),
    idea('f', 'q')
  ];
  const clusters = clusterIdeas(ideas);
  for (const cluster of clusters) {
    for (const id of cluster.memberIds) {
      const member = ideas.find((i) => i._id === id)!;
      assert.ok(
        member.tags.map((t) => t.toLowerCase()).includes(cluster.tag),
        `${id} is in the #${cluster.tag} cluster but does not carry that tag`
      );
    }
  }
}

// AN IDEA MAY APPEAR IN SEVERAL CLUSTERS, AND THAT IS NOT A BUG.
//
// Discarding the weaker relationship would mean silently lying about the user's own
// data, so `primaryClusterFor` picks one only where a single answer is needed.
{
  const ideas = [idea('a', 'x', 'y'), idea('b', 'x'), idea('c', 'y'), idea('d', 'q'), idea('e', 'q')];
  const clusters = clusterIdeas(ideas);
  const aClusters = clusters.filter((c) => c.memberIds.includes('a')).map((c) => c.tag).sort();
  assert.deepEqual(aClusters, ['x', 'y'], 'an idea in two real conversations appears in both');

  const primary = primaryClusterFor(ideas[0], clusters);
  assert.ok(primary, 'a single answer is still available');
}

// THE ORDER IS STABLE, because a list that reshuffles on every render is distrusted.
{
  const ideas = [idea('a', 'x', 'y'), idea('b', 'x', 'y'), idea('c', 'z'), idea('d', 'z'), idea('e', 'q')];
  const once = clusterIdeas(ideas).map((c) => c.tag);
  const twice = clusterIdeas([...ideas].reverse()).map((c) => c.tag);
  assert.deepEqual(once, twice, 'input order does not change the output order');
}

// DUPLICATE AND MESSY TAGS.
{
  const ideas = [idea('a', 'Work', 'work', ' WORK '), idea('b', 'work'), idea('c', 'q'), idea('d', 'q')];
  const clusters = clusterIdeas(ideas);
  // Two clusters, not one: #work on a+b and #q on c+d are both real, and both are
  // pairs - which the small-lot floor correctly admits.
  assert.deepEqual(clusters.map((c) => c.tag).sort(), ['q', 'work'], 'two real pairs');
  const work = clusters.find((c) => c.tag === 'work')!;
  assert.deepEqual(work.memberIds, ['a', 'b'], 'the same tag three times on one idea is still one idea');
  assert.ok(
    !clusters.some((c) => c.tag === 'work ' || c.tag === 'WORK'),
    'case and whitespace do not create separate tags'
  );
}

// NOTHING TO CLUSTER IS NOT AN ERROR.
{
  assert.deepEqual(clusterIdeas([]), []);
  assert.deepEqual(clusterIdeas([idea('solo')]), []);
  assert.deepEqual(clusterIdeas([idea('a'), idea('b')]), [], 'two untagged ideas are not related');
}

// RELATED IDEAS, SAME RULES.
{
  const ideas = [
    idea('me', 'handover'),
    idea('them', 'handover'),
    idea('stranger', 'field'),
    idea('crowd1', 'work'),
    idea('crowd2', 'work'),
    idea('crowd3', 'work')
  ];
  const related = relatedIdeas(ideas[0], ideas);
  assert.deepEqual(related.map((r) => r.idea._id), ['them'], 'only the informative neighbour');
  assert.equal(related[0].via, 'handover', 'and it says why');

  const me = ideas[0];
  assert.deepEqual(relatedIdeas(me, [me]), [], 'an idea is not related to itself');
}

console.log('PASS: clusters bind on informative tags and can explain themselves (no database operations).');
