/**
 * Turning one message into an HTTP request, and an HTTP response into text.
 *
 * Three API shapes cover every provider in `providers.ts`:
 *
 * - **openai** - `{ model, messages }` in, `choices[0].message.content` out. Also the
 *   shape most local runtimes and most third-party aggregators implement, which is why
 *   one adapter covers eight providers.
 * - **anthropic** - `system` is a top-level field rather than a message, `max_tokens` is
 *   REQUIRED rather than optional, and the key is `x-api-key` not `Authorization: Bearer`.
 * - **gemini** - `contents`/`parts` rather than `messages`, the key is a query parameter,
 *   and the response nests text under `candidates[0].content.parts[].text`.
 *
 * Pure and offline: no network, so the request shape and the response parsing are both
 * testable without a key, a provider account, or a cent.
 */

import { normaliseBaseUrl, type Provider } from './providers';

export type ChatMessage = {
	role: 'system' | 'user' | 'assistant';
	content: string;
};

export type ModelCall = {
	provider: Provider;
	baseUrl: string;
	key: string;
	model: string;
	messages: ChatMessage[];
	/** Hard ceiling so a model cannot run away with a huge bill on the user's card. */
	maxTokens?: number;
	temperature?: number;
	/** Caller-driven cancellation. */
	signal?: AbortSignal;
	timeoutMs?: number;
};

export type PreparedRequest = {
	url: string;
	init: RequestInit;
	/** Just the headers, for debugging and for the settings screen's "test" button. */
	headerNames: string[];
};

export const DEFAULT_MAX_TOKENS = 600;
export const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Build the request.
 *
 * Each branch constructs its own URL rather than sharing a helper, because Gemini puts
 * the model in the PATH and needs the key as a query parameter - both of which make a
 * shared "append the path" helper wrong for it.
 */
export function prepare(call: ModelCall): PreparedRequest {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	const root = normaliseBaseUrl(call.baseUrl);

	// Provider-mandated headers first, so nothing can overwrite them.
	for (const [name, value] of Object.entries(call.provider.requiredBrowserHeaders ?? {})) {
		headers[name.toLowerCase()] = value;
	}

	if (call.provider.authStyle === 'bearer') {
		headers.authorization = `Bearer ${call.key}`;
	} else if (call.provider.authStyle === 'x-api-key') {
		headers['x-api-key'] = call.key;
		headers['anthropic-version'] = '2023-06-01';
	}

	switch (call.provider.apiShape) {
		case 'openai': {
			return {
				url: `${root}/chat/completions`,
				init: {
					method: 'POST',
					headers,
					body: JSON.stringify({
						model: call.model,
						messages: call.messages,
						max_tokens: call.maxTokens ?? DEFAULT_MAX_TOKENS,
						temperature: call.temperature ?? 0.3
					})
				},
				headerNames: Object.keys(headers)
			};
		}

		case 'anthropic': {
			// `system` is NOT a message role in this API. Sending it inside `messages`
			// is accepted-and-ignored by some shims and rejected by others, so it is
			// lifted out properly here.
			const system = call.messages
				.filter((m) => m.role === 'system')
				.map((m) => m.content)
				.join('\n\n');
			const messages = call.messages
				.filter((m) => m.role !== 'system')
				.map((m) => ({ role: m.role, content: m.content }));

			return {
				url: `${root}/messages`,
				init: {
					method: 'POST',
					headers,
					body: JSON.stringify({
						model: call.model,
						max_tokens: call.maxTokens ?? DEFAULT_MAX_TOKENS,
						temperature: call.temperature ?? 0.3,
						...(system ? { system } : {}),
						messages
					})
				},
				headerNames: Object.keys(headers)
			};
		}

		case 'gemini': {
			// Gemini's model id names its own path segment: `gemini-2.0-flash` lives at
			// /models/gemini-2.0-flash, but a TUNED model lives at /tunedModels/..., and
			// those are different collections, not a prefix on one. Hardcoding `models/`
			// sent every tuned model to a URL that does not exist.
			//
			// So a model id that already names a collection is used as-is; anything else
			// is treated as a plain model name. Only the final segment is escaped, because
			// escaping the slashes would turn a deliberate collection prefix into
			// `models%2FtunedModels%2F...`.
			const trimmed = call.model.trim().replace(/^\/+|\/+$/g, '');
			const isTuned = /^tunedModels\//i.test(trimmed);
			const segment = isTuned ? trimmed : `models/${trimmed}`;
			const escaped = segment
				.split('/')
				.map((part) => encodeURIComponent(part))
				.join('/');

			const url = new URL(`${root}/${escaped}:generateContent`);
			if (call.provider.authStyle === 'query-key') {
				url.searchParams.set('key', call.key);
			}
			const system = call.messages
				.filter((m) => m.role === 'system')
				.map((m) => m.content)
				.join('\n\n');
			const contents = call.messages
				.filter((m) => m.role !== 'system')
				.map((m) => ({
					role: m.role === 'assistant' ? 'model' : 'user',
					parts: [{ text: m.content }]
				}));

			return {
				url: url.toString(),
				init: {
					method: 'POST',
					headers,
					body: JSON.stringify({
						contents,
						...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
						generationConfig: {
							maxOutputTokens: call.maxTokens ?? DEFAULT_MAX_TOKENS,
							temperature: call.temperature ?? 0.3
						}
					})
				},
				headerNames: Object.keys(headers)
			};
		}
	}
}

/**
 * Pull the assistant text out of a response body.
 *
 * Returns `null` rather than an empty string when the shape is not what we expect, so
 * a caller can tell "the model said nothing" from "we mis-parsed the reply". Silently
 * returning `''` is how a summarisation feature ends up blank with no error.
 */
export function extractText(provider: Provider, body: unknown): string | null {
	if (!body || typeof body !== 'object') return null;

	switch (provider.apiShape) {
		case 'openai': {
			const choices = (body as { choices?: unknown }).choices;
			if (!Array.isArray(choices) || choices.length === 0) return null;
			const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
			return typeof content === 'string' && content.trim() ? content : null;
		}
		case 'anthropic': {
			const blocks = (body as { content?: unknown }).content;
			if (!Array.isArray(blocks)) return null;
			const text = blocks
				.map((block) => (block as { text?: unknown })?.text)
				.filter((t): t is string => typeof t === 'string')
				.join('');
			return text.trim() ? text : null;
		}
		case 'gemini': {
			const candidates = (body as { candidates?: unknown }).candidates;
			if (!Array.isArray(candidates) || candidates.length === 0) return null;
			const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
			if (!Array.isArray(parts)) return null;
			const text = parts
				.map((part) => (part as { text?: unknown })?.text)
				.filter((t): t is string => typeof t === 'string')
				.join('');
			return text.trim() ? text : null;
		}
	}
}

/** Best-effort human message from an error body, which is often plain text. */
export function extractErrorMessage(body: unknown): string | null {
	if (typeof body === 'string' && body.trim()) return body.slice(0, 400);
	if (!body || typeof body !== 'object') return null;

	const record = body as Record<string, unknown>;
	// OpenAI: { error: { message } }. Anthropic: { error: { message } } too.
	const nested = record.error as { message?: unknown } | undefined;
	if (nested && typeof nested.message === 'string') return nested.message;
	// Gemini: { error: { message } } or { error: string }.
	if (typeof record.error === 'string') return record.error;
	if (typeof record.message === 'string') return record.message;
	if (typeof record.detail === 'string') return record.detail;
	return null;
}