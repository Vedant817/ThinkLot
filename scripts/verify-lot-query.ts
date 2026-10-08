import assert from 'node:assert/strict';
import { readFilters, writeFilters, type Filters } from '../src/lib/filters.svelte';

/**
 * The lot keeps its search, tag filters, archive toggle, sort and view choice in
 * the query string instead of component state.
 *
 * That is what makes the detail page's "← Back to the lot" return to the list you
 * actually left, what makes a filtered view shareable, and what stops a refresh
 * from silently emptying your filters. All three of those were broken before,
 * independently on three routes.
 *
 * These assertions run against the real module rather than a copy of it, so they
 * cannot pass while the route does something else. Only `syncFilters` is untested
 * here: it needs a mounted component, because it registers an `$effect`.
 */

const DEFAULTS: Filters = {
  search: '',
  tags: [],
  archived: false,
  sort: 'capture',
  view: 'cards',
  reason: null
};

function serialise(filters: Partial<Filters>): string {
  const url = new URL('https://example.test/ideas');
  writeFilters(url, { ...DEFAULTS, ...filters });
  return url.search;
}

function readBack(filters: Partial<Filters>): Filters {
  return readFilters(new URL(`https://example.test/ideas${serialise(filters)}`));
}

// A default list writes nothing at all, so the URL stays clean and shareable and
// does not accumulate `?q=&sort=capture` noise.
assert.equal(serialise({}), '', 'a default lot writes no query string at all');

assert.equal(serialise({ search: 'offline' }), '?q=offline', 'a search is carried');

// Whitespace is not a search. Trimming is what stops a trailing space typed into
// the box from producing a filter that matches nothing while looking active.
assert.equal(serialise({ search: '   ' }), '', 'a whitespace-only search is not written');

// Repeated params, not one comma-joined value: `normaliseTags` permits commas
// inside a tag, so joining on that character would split a tag called
// `work, urgent` into two the moment the page reloaded.
assert.deepEqual(readFilters(new URL('https://example.test/ideas?tags=work%2C%20urgent')).tags, [
  'work, urgent'
]);
assert.equal(serialise({ tags: ['work, urgent'] }), '?tags=work%2C+urgent', 'a comma in a tag is encoded');

// Sorted, so picking the same tags in a different order yields the same link.
// Without this, two people filtering identically get two different URLs to the
// same view and there is no way to tell that they are the same.
assert.equal(
  serialise({ tags: ['urgent', 'infra'] }),
  serialise({ tags: ['infra', 'urgent'] }),
  'tag order does not change the URL'
);

assert.equal(serialise({ archived: true }), '?archived=1', 'archive is carried');
assert.equal(serialise({ sort: 'priority' }), '?sort=priority', 'sort is carried');
assert.equal(serialise({ view: 'list' }), '?view=list', 'view is carried');
assert.equal(serialise({ reason: 'strong' }), '?reason=strong', 'the review reason is carried');

// Defaults stay implicit rather than being written out. A plain list should have
// a clean URL, and turning a default back on is expressed as absence, not as
// `?sort=capture`.
assert.equal(serialise({ sort: 'capture' }), '', 'the default sort stays implicit');
assert.equal(serialise({ view: 'cards' }), '', 'the default view stays implicit');
assert.equal(serialise({ reason: null }), '', 'no reason filter stays implicit');

// ROUND TRIP. A write that cannot be read back is as broken as one that is never
// written: it produces a link that looks shareable and is not.
assert.deepEqual(readBack({ search: 'offline sync' }), {
  ...DEFAULTS,
  search: 'offline sync'
});
assert.deepEqual(readBack({ tags: ['infra', 'urgent'] }), { ...DEFAULTS, tags: ['infra', 'urgent'] });
assert.deepEqual(readBack({ archived: true }), { ...DEFAULTS, archived: true });
assert.deepEqual(readBack({ sort: 'priority' }), { ...DEFAULTS, sort: 'priority' });
assert.deepEqual(readBack({ view: 'list' }), { ...DEFAULTS, view: 'list' });
assert.deepEqual(readBack({ reason: 'strong' }), { ...DEFAULTS, reason: 'strong' });

// Every control at once - which is what a real shared link looks like.
assert.deepEqual(
  readBack({
    search: 'offline sync',
    tags: ['infra'],
    archived: true,
    sort: 'priority',
    view: 'list',
    reason: 'strong'
  }),
  {
    search: 'offline sync',
    tags: ['infra'],
    archived: true,
    sort: 'priority',
    view: 'list',
    reason: 'strong'
  }
);

// A search containing a space, an ampersand and an equals sign must survive, or a
// filter can be silently mangled by the URL that carries it. Asserted as a round
// trip rather than a literal, because the exact encoding is an implementation
// detail and pinning it would make the test fail on a harmless change.
{
  const nasty = 'a b&c=d';
  assert.equal(new URLSearchParams(serialise({ search: nasty })).get('q'), nasty);
  assert.equal(new URLSearchParams(serialise({ tags: ['a&b=c'] })).getAll('tags')[0], 'a&b=c');
}

// UNPARSEABLE INPUT FALLS BACK, IT DOES NOT THROW. A truncated or hand-edited
// link should show an unfiltered list, not an error page - and a bad value must
// not be able to select a filter the UI does not have.
assert.deepEqual(readFilters(new URL('https://example.test/ideas?sort=sideways&view=grid&archived=yes')), DEFAULTS, 'nonsense values fall back to the defaults');

// Blank and whitespace-only tags are dropped rather than becoming filters that
// match nothing and cannot be unticked.
assert.deepEqual(
  readFilters(new URL('https://example.test/ideas?tags=&tags=%20%20&tags=ok')).tags,
  ['ok'],
  'blank tags are dropped'
);

// `reason` is deliberately NOT validated here. The set of review reasons belongs
// to the review route, not to this module, so the module passes the string
// through and the route narrows it against its own list. Pinned here because that
// asymmetry is easy to misread as "the module validates everything" - it does not,
// and a caller that renders `reason` directly would be trusting unchecked input.
assert.equal(
  readFilters(new URL('https://example.test/review?reason=sideways')).reason,
  'sideways',
  'reason is passed through unvalidated; the review route is what validates it'
);

// Reading must not mutate: `readFilters` is called during setup, and a component
// that reads its own defaults back must not find them changed.
{
  const url = new URL('https://example.test/ideas?sort=sideways');
  const before = url.search;
  readFilters(url);
  assert.equal(url.search, before, 'reading filters does not rewrite the URL');
}

console.log('PASS: lot filters live in the URL and read back identically (no database operations).');
