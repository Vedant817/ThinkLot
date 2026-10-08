/**
 * AI adapter and failure-translation tests.
 *
 * Offline: no key, no provider account, no cent. Everything here is either a request
 * shape we build or a response we parse, so it is fully testable without a network.
 *
 * The failure-translation half is the part worth this much attention. The measured fact
 * driving it is that several providers send no `Access-Control-Allow-Origin` on an
 * auth failure, so the browser throws a bare `TypeError` and the user is told the
 * network broke. These checks exist so that regression is impossible to miss.
 */
import assert from 'node:assert/strict';
import { prepare, extractText, extractErrorMessage, type ModelCall } from '../src/lib/ai/adapters';
import { providerById, normaliseBaseUrl, validateConfig, PROVIDERS } from '../src/lib/ai/providers';
import { describeFailure, describeHttpFailure } from '../src/lib/ai/client';
import { maskKey } from '../src/lib/ai/credentials';
import {
	parseModelJson,
	parseSummary,
	parseDuplicatePairs,
	summariseMessages,
	duplicateMessages
} from '../src/lib/ai/prompts';
import { duplicateCandidates, candidateReason, titleSimilarity } from '../src/lib/duplicates';

const call = (over: Partial<ModelCall> = {}): ModelCall => ({
	provider: providerById('openai'),
	baseUrl: 'https://api.openai.com/v1',
	key: 'sk-test',
	model: 'gpt-4.1-mini',
	messages: [
		{ role: 'system', content: 'Be terse.' },
		{ role: 'user', content: 'Summarise this idea.' }
	],
	...over
});

// ---------------------------------------------------------------------------
// 1. REQUEST SHAPE PER API FAMILY. The three are genuinely different, and sending one
//    provider's shape to another is a silent 400 at best.
// ---------------------------------------------------------------------------
{
	const openai = prepare(call());
	assert.equal(openai.url, 'https://api.openai.com/v1/chat/completions');
	assert.equal(openai.init.headers?.['content-type'], 'application/json');
	assert.equal((openai.init.headers as Record<string, string>).authorization, 'Bearer sk-test');
	const openaiBody = JSON.parse(openai.init.body as string);
	assert.equal(openaiBody.messages.length, 2, 'system stays a message in the OpenAI shape');

	// Anthropic: system is lifted OUT of messages, and max_tokens is mandatory.
	const anthropic = prepare(
		call({ provider: providerById('anthropic'), baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' })
	);
	assert.equal(anthropic.url, 'https://api.anthropic.com/v1/messages');
	const ah = anthropic.init.headers as Record<string, string>;
	assert.equal(ah['x-api-key'], 'sk-test');
	assert.equal(ah['anthropic-version'], '2023-06-01');
	assert.equal(
		ah['anthropic-dangerous-direct-browser-access'],
		'true',
		'without this header the browser handshake fails before the key is checked'
	);
	const aBody = JSON.parse(anthropic.init.body as string);
	assert.equal(aBody.system, 'Be terse.', 'system is a top-level field, not a message');
	assert.equal(aBody.messages.length, 1, 'the system message is not duplicated into messages');
	assert.ok(typeof aBody.max_tokens === 'number', 'max_tokens is required by this API');

	// Gemini: contents/parts, model in the PATH, key in the QUERY.
	const gemini = prepare(
		call({ provider: providerById('gemini'), baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' })
	);
	assert.match(gemini.url, /\/models\/gemini-2\.0-flash:generateContent\?key=/, 'model lives in the path, then the key');
	assert.match(gemini.url, /[?&]key=sk-test/, 'and the key is a query parameter, the only auth Gemini allows');
	const gBody = JSON.parse(gemini.init.body as string);
	assert.ok(Array.isArray(gBody.contents));
	assert.equal(gBody.contents.length, 1, 'system goes to systemInstruction, not contents');
	assert.equal(gBody.systemInstruction.parts[0].text, 'Be terse.');
	assert.equal(gBody.contents[0].parts[0].text, 'Summarise this idea.');
}

// A tuned model names a DIFFERENT collection, and hardcoding `models/` sent it to a
// URL that does not exist. Caught by a test rather than by reading the code.
{
	const tuned = prepare(
		call({
			provider: providerById('gemini'),
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			model: 'tunedModels/my-tuned-model'
		})
	);
	assert.match(
		tuned.url,
		/\/tunedModels\/my-tuned-model:generateContent\?key=/,
		`a tuned model must keep its own collection, got ${tuned.url}`
	);

	// A plain name still gets the models/ prefix, and slashes inside the id are escaped
	// rather than silently becoming extra path segments.
	const plain = prepare(
		call({
			provider: providerById('gemini'),
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			model: 'gemini-2.0-flash'
		})
	);
	assert.match(plain.url, /\/models\/gemini-2\.0-flash:generateContent\?key=/);

	// A collection-looking id keeps its slashes as separators, not %2F.
	const collection = prepare(
		call({
			provider: providerById('gemini'),
			baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
			model: '/tunedModels/nested-name/'
		})
	);
	assert.match(collection.url, /\/tunedModels\/nested-name:generateContent\?key=/, `got ${collection.url}`);
	assert.ok(!collection.url.includes('%2F'), 'collection separators are not escaped');
}

// ---------------------------------------------------------------------------
// 2. RESPONSE PARSING, INCLUDING THE SHAPES THAT ARE NOT WHAT WE EXPECT.
// ---------------------------------------------------------------------------
{
	assert.equal(
		extractText(providerById('openai'), { choices: [{ message: { content: 'hello' } }] }),
		'hello'
	);
	assert.equal(
		extractText(providerById('anthropic'), { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }),
		'ab',
		'multiple content blocks join'
	);
	assert.equal(
		extractText(providerById('gemini'), { candidates: [{ content: { parts: [{ text: 'x' }] } }] }),
		'x'
	);

	// A 200 we cannot read must return null, NOT ''. Blank and unparsed are different
	// failures and the caller has to be able to tell them apart.
	assert.equal(extractText(providerById('openai'), { choices: [] }), null);
	assert.equal(extractText(providerById('openai'), {}), null);
	assert.equal(extractText(providerById('anthropic'), { content: [] }), null);
	assert.equal(extractText(providerById('gemini'), { candidates: [] }), null);
	// A safety block from Gemini arrives with no candidates at all.
	assert.equal(extractText(providerById('gemini'), { promptFeedback: { blockReason: 'SAFETY' } }), null);
	assert.equal(extractText(providerById('openai'), { choices: [{ message: { content: '   ' } }] }), null, 'whitespace is not content');
	assert.equal(extractText(providerById('openai'), null), null);
	assert.equal(extractText(providerById('openai'), 'a string'), null);
}

// Error bodies are shaped differently per provider; get the message out of each.
{
	assert.equal(extractErrorMessage({ error: { message: 'Incorrect API key' } }), 'Incorrect API key');
	assert.equal(extractErrorMessage({ error: 'quota exceeded' }), 'quota exceeded');
	assert.equal(extractErrorMessage({ message: 'flat' }), 'flat');
	assert.match(extractErrorMessage('plain text body') ?? '', /plain text/);
	assert.equal(extractErrorMessage({ nothing: true }), null);
	assert.equal(extractErrorMessage(null), null);
}

// ---------------------------------------------------------------------------
// 3. THE OPAQUE CORS FAILURE - the finding this module exists for.
// ---------------------------------------------------------------------------
{
	// Exactly what a browser hands over when a provider withholds the error body.
	const opaque = new TypeError('Failed to fetch');

	// OpenAI withholds it, so a wrong key must NOT be reported as a dead network.
	const openai = describeFailure(providerById('openai'), opaque);
	assert.equal(openai.likelyKeyProblem, true, 'a wrong OpenAI key presents as Failed to fetch');
	assert.match(openai.message, /did not let the browser read/i);
	assert.match(openai.hint ?? '', /API key/i);

	// OpenRouter returns ACAO on a 401, so the same exception means something else.
	const openrouter = describeFailure(providerById('openrouter'), opaque);
	assert.equal(openrouter.likelyKeyProblem, false, 'a real network drop on OpenRouter is a network problem');
	assert.match(openrouter.message, /Could not reach/i);

	// A local runtime needs the local diagnosis, not a key one.
	const ollama = describeFailure(providerById('ollama'), opaque);
	assert.equal(ollama.likelyKeyProblem, false);
	assert.match(ollama.hint ?? '', /ollama serve/i, 'tell the user how to start it');

	// Cancellation is neither of those.
	const cancelled = describeFailure(providerById('openai'), Object.assign(new Error('aborted'), { name: 'AbortError' }));
	assert.match(cancelled.message, /Cancelled/i);
	assert.equal(cancelled.likelyKeyProblem, false);
}

// HTTP statuses, which only arrive from providers that let the browser read them.
{
	assert.equal(describeHttpFailure(providerById('openai'), 401, null).likelyKeyProblem, true);
	assert.equal(describeHttpFailure(providerById('openai'), 403, null).likelyKeyProblem, true);
	assert.match(describeHttpFailure(providerById('custom'), 404, null).hint ?? '', /\/v1/);
	assert.match(describeHttpFailure(providerById('openai'), 429, null).message, /rate limited/i);
	assert.match(describeHttpFailure(providerById('openai'), 503, null).hint ?? '', /Not your key/);
	// A 400 with a provider message keeps the provider's own words.
	assert.match(
		describeHttpFailure(providerById('openai'), 400, { error: { message: 'model not supported' } }).message,
		/model not supported/
	);
}

// ---------------------------------------------------------------------------
// 4. VALIDATION, so an unusable setup is a sentence rather than a TypeError.
// ---------------------------------------------------------------------------
{
	assert.match(validateConfig({ provider: providerById('custom'), baseUrl: '', key: 'k', model: 'm' }) ?? '', /endpoint URL/i);
	assert.match(validateConfig({ provider: providerById('openai'), baseUrl: 'api.openai.com/v1', key: 'k', model: 'm' }) ?? '', /http/i);
	assert.match(validateConfig({ provider: providerById('openai'), baseUrl: 'https://x/v1', key: '', model: 'm' }) ?? '', /Paste/i);
	assert.match(validateConfig({ provider: providerById('openai'), baseUrl: 'https://x/v1', key: 'k', model: '' }) ?? '', /model id/i);
	assert.equal(validateConfig({ provider: providerById('openai'), baseUrl: 'https://x/v1', key: 'k', model: 'm' }), null);
	// A local runtime needs no key at all, and asking for one would be wrong.
	assert.equal(validateConfig({ provider: providerById('ollama'), baseUrl: 'http://127.0.0.1:11434/v1', key: '', model: 'llama3.2' }), null);
}

// ---------------------------------------------------------------------------
// 5. KEYS ARE NEVER RENDERED, ONLY HINTED AT.
// ---------------------------------------------------------------------------
{
	assert.equal(maskKey(''), '');
	assert.match(maskKey('sk-1234567890abcdef'), /^sk-1•{8}ef$/, 'only the ends survive');
	assert.ok(!maskKey('sk-1234567890abcdef').includes('3456789'), 'the middle is not recoverable');
	// A short key must not be echoed in full.
	assert.ok(!maskKey('short').includes('short'));
}

// ---------------------------------------------------------------------------
// 6. REGISTRY INTEGRITY. Every provider must be internally consistent, because these
//    are hand-written facts and a typo becomes a confusing failure at request time.
// ---------------------------------------------------------------------------
{
	const ids = new Set(PROVIDERS.map((p) => p.id));
	assert.equal(ids.size, PROVIDERS.length, 'no duplicate provider ids');
	for (const p of PROVIDERS) {
		assert.ok(p.baseUrl || p.id === 'custom', `${p.id} needs a base URL`);
		assert.ok(p.blurb.length > 10, `${p.id} needs a blurb for the settings screen`);
		assert.ok(Array.isArray(p.models), `${p.id} needs a model list`);
		assert.equal(
			p.needsKey,
			p.authStyle !== 'none',
			`${p.id}: needsKey and authStyle disagree`
		);
		if (p.authStyle === 'bearer' || p.authStyle === 'x-api-key' || p.authStyle === 'query-key') {
			assert.equal(p.needsKey, true, `${p.id} authenticates, so it needs a key`);
		}
	}
	// Anthropic is the one provider whose browser calls need an extra header; if that is
	// ever dropped, every Anthropic user gets a handshake failure.
	assert.ok(
		providerById('anthropic').requiredBrowserHeaders?.['anthropic-dangerous-direct-browser-access'] === 'true',
		'Anthropic must declare its required browser header'
	);
	assert.equal(normaliseBaseUrl('https://x/v1///'), 'https://x/v1', 'trailing slashes are normalised once, not repeatedly');
}

// ---------------------------------------------------------------------------
// 7. MODEL OUTPUT IS UNTRUSTED INPUT.
// ---------------------------------------------------------------------------
{
	// The three shapes models actually emit.
	assert.deepEqual(parseModelJson('{"a":1}'), { a: 1 });
	assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 }, 'fenced JSON is what models emit almost always');
	assert.deepEqual(parseModelJson('```\n{"a":1}\n```'), { a: 1 }, 'and an unlabelled fence too');
	assert.deepEqual(parseModelJson('Here you go:\n{"a":1}\nHope that helps.'), { a: 1 }, 'with preamble and postamble');
	assert.deepEqual(parseModelJson('[{"id":"x"}]'), [{ id: 'x' }]);

	// Braces inside strings must not end the span early.
	assert.deepEqual(
		parseModelJson('prose {"reason":"use } and { carefully","id":"a"} trailing'),
		{ reason: 'use } and { carefully', id: 'a' },
		'a brace inside a quoted string is not the end of the object'
	);
	// Escaped quotes too.
	assert.deepEqual(parseModelJson('{"reason":"say \\"hi\\"","id":"b"}'), { reason: 'say "hi"', id: 'b' });

	// Genuinely unusable output is null, never a half-parsed guess.
	assert.equal(parseModelJson('I could not answer that.'), null);
	assert.equal(parseModelJson(''), null);
	assert.equal(parseModelJson('not json at all'), null);
}

// Summaries: prose only, bounded, and a heading is not content.
{
	assert.deepEqual(parseSummary('A short summary.'), { summary: 'A short summary.', truncated: false });
	assert.deepEqual(parseSummary('```\nA short summary.\n```'), { summary: 'A short summary.', truncated: false });
	assert.equal(parseSummary('Summary: A short summary.')?.summary, 'A short summary.', 'a label is stripped');
	assert.equal(parseSummary('   '), null);
	assert.equal(parseSummary(''), null);
	assert.equal(parseSummary('{"summary":"json leaked"}'), null, 'JSON is not a summary');
	// Markup is refused, not rendered. The first version of this assertion expected HTML
	// to pass through as "prose", which would have meant a model could hand the UI a
	// tag it renders.
	assert.equal(parseSummary('<html>hi</html>'), null, 'HTML is not prose');
	const long = parseSummary('x'.repeat(2000));
	assert.equal(long?.truncated, true, 'and says so rather than silently clipping');
	assert.ok((long?.summary.length ?? 0) <= 900);
}

// Duplicates: an id that was never offered is dropped, not rendered.
{
	const allowed = new Set(['a', 'b']);
	const good = parseDuplicatePairs(
		'{"matches":[{"id":"a","title":"A","confidence":"high","reason":"same action"},{"id":"zzz","title":"Ghost","confidence":"high","reason":"invented"}]}',
		allowed
	);
	assert.equal(good.length, 1, 'a model-invented id is refused');
	assert.equal(good[0].id, 'a');
	assert.equal(good[0].confidence, 'high');

	// Nonsense confidence degrades to low rather than passing through.
	assert.equal(
		parseDuplicatePairs('{"matches":[{"id":"b","confidence":"certain","reason":"x"}]}', allowed)[0].confidence,
		'low'
	);
	// A missing reason gets a stated one, never a blank.
	assert.match(
		parseDuplicatePairs('{"matches":[{"id":"b"}]}', allowed)[0].reason,
		/possible duplicate/
	);
	// Duplicates in the model's own output collapse.
	assert.equal(parseDuplicatePairs('{"matches":[{"id":"a"},{"id":"a"}]}', allowed).length, 1);
	// Markup in the reason is stripped, length capped.
	const markup = parseDuplicatePairs('{"matches":[{"id":"a","reason":"<b>x</b> y"}]}', allowed)[0];
	assert.ok(!markup.reason.includes('<b>'));
	// No matches is a real, valid answer - not an error.
	assert.deepEqual(parseDuplicatePairs('{"matches":[]}', allowed), []);
	assert.deepEqual(parseDuplicatePairs('sorry, no', allowed), [], 'prose instead of JSON is empty, not a crash');
	assert.deepEqual(parseDuplicatePairs('{"matches":"none"}', allowed), [], 'wrong type is refused');
}

// Only fields the user actually filled are sent - empty strings would waste tokens and
// imply an emptiness that is not there.
{
	const msgs = summariseMessages({
		title: 'Stale field notes',
		problem: 'Notes are lost',
		tags: ['field']
	});
	const user = msgs[1].content;
	assert.match(user, /Stale field notes/);
	assert.match(user, /Notes are lost/);
	assert.ok(!/Audience:/i.test(user), 'an unfilled field is omitted, not sent blank');
	assert.ok(!/Intended outcome:/i.test(user));
	assert.equal(summariseMessages({ title: 'Only a title', tags: [] })[1].content, 'Title: Only a title');
	assert.equal(msgs[0].role, 'system', 'instructions come first, and are not part of the facts');
}

// The prompt must warn the model that tags are weak evidence, because inventing a false
// duplicate is the most likely failure of this feature.
{
	const msgs = duplicateMessages({ title: 'New' }, [{ id: 'a', title: 'Existing', tags: ['handover'] }]);
	assert.match(msgs[0].content, /WEAK evidence/i);
	assert.match(msgs[1].content, /id=a/);
}

// ---------------------------------------------------------------------------
// 8. THE SHORTLIST. Retrieval must be allowed to be wrong; judgement must not be
//    polluted by everything else.
// ---------------------------------------------------------------------------
{
	const i = (id: string, title: string, ...tags: string[]) => ({ _id: id, title, tags });

	// A near-identical title is a candidate regardless of tags.
	const same = duplicateCandidates(i('a', 'Handover checklist'), [
		i('b', 'Handover checklist'),
		i('c', 'Something else entirely')
	]);
	assert.deepEqual(same.map((c) => c.idea._id), ['b'], 'an identical title is the strongest candidate');
	assert.equal(same[0].lexical, 1);

	// A typo and a reworded title are still close - which is what trigrams are for.
	const typo = duplicateCandidates(i('a', 'Handover checklist'), [i('b', 'Hand-over check list')]);
	assert.ok(typo.length >= 1, `a reworded title should survive, got ${typo.length}`);
	assert.ok((typo[0]?.lexical ?? 0) > 0.4, `and score close, got ${typo[0]?.lexical}`);

	// THE RULE THAT MATTERS: a shared tag alone is NEVER a candidate.
	//
	// Two postmortems can both be tagged #handover and describe different incidents.
	// Offering that pair to a model is how you manufacture a false duplicate.
	const tagOnly = duplicateCandidates(i('a', 'Solar array debris warning'), [
		i('b', 'Forklift battery replacement log', 'handover'),
		i('c', 'Pallet racking inspection', 'handover')
	]);
	assert.deepEqual(tagOnly, [], 'shared tags must not create a candidate');

	// But tags CAN raise a candidate that already qualifies on wording.
	const both = duplicateCandidates(i('a', 'Handover checklist for field crews', 'field'), [
		i('b', 'Field handover checklist', 'field')
	]);
	assert.equal(both.length, 1);
	assert.ok(both[0].tagOverlap > 0, 'and contribute to the ranking');

	// A lot of exactly TWO ideas must still be checked. The first version of this had an
// `all.length < 2` guard, which meant the smallest lot where the question is most
// obviously worth asking could never ask it.
{
	const pair = duplicateCandidates(i('a', 'Handover checklist'), [i('b', 'Handover checklist')]);
	assert.equal(pair.length, 1, 'two ideas is enough to have a duplicate question');
}

// Nothing similar at all is an honest empty, not a weak guess.
	assert.deepEqual(duplicateCandidates(i('a', 'Zebra crossing paint'), [i('b', 'Espresso grinder burrs')]), []);

	// The idea itself is never its own duplicate.
	assert.deepEqual(duplicateCandidates(i('a', 'Same'), [i('a', 'Same'), i('b', 'Same')]).map((c) => c.idea._id), ['b']);

	// Shortlist is bounded, so cost stays bounded.
	const many = Array.from({ length: 50 }, (_, n) => i(`x${n}`, 'Handover checklist'));
	assert.ok(duplicateCandidates(i('a', 'Handover checklist'), many).length <= 5, 'never more than the limit');

	// Deterministic - a shortlist that reshuffles is not reviewable.
	const list = [i('a', 'Handover checklist'), i('b', 'Handover checklists'), i('c', 'Handover checklist items')];
	assert.deepEqual(
		duplicateCandidates(list[0], list).map((c) => c.idea._id),
		duplicateCandidates(list[0], [...list].reverse()).map((c) => c.idea._id)
	);
}

// A reason must not quote a similarity figure - it implies a confidence the lexical
// method has no basis for, which is what judgement is for.
{
	const c = duplicateCandidates({ _id: 'a', title: 'Handover checklist', tags: [] }, [
		{ _id: 'b', title: 'Handover checklist', tags: [] }
	])[0];
	const reason = candidateReason(c);
	assert.ok(!/\d+%|\d+\.\d+/.test(reason), `reason quotes a number: ${reason}`);
	assert.match(reason, /same words|Nearly/i);
}

// Empty and single inputs are not errors.
{
	assert.deepEqual(duplicateCandidates({ _id: 'a', title: 'x', tags: [] }, []), []);
	assert.deepEqual(duplicateCandidates({ _id: 'a', title: 'x', tags: [] }, [{ _id: 'a', title: 'x', tags: [] }]), []);
	assert.equal(titleSimilarity('', ''), 0);
	assert.equal(titleSimilarity('x', ''), 0);
	// A title made ENTIRELY of stopwords normalises to nothing, so it cannot match
	// even itself. That is the safe direction: there is no wording to compare, and
	// returning 1 would call two unrelated ideas duplicates on the strength of
	// "the" and "of".
	assert.equal(titleSimilarity('the and of', 'the and of'), 0, 'no words to compare is not a match');
	assert.equal(titleSimilarity('the and of', 'forklift batteries'), 0);
	// But stopword removal must not make real titles dissimilar.
	assert.ok(titleSimilarity('field notes', 'notes for the field') > 0.3, 'stopwords must not drown out real words');
}

console.log('PASS: three API shapes build correctly, every failure becomes a sentence, model output is validated, and only plausible pairs reach judgement.');