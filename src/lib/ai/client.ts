/**
 * Calling a model, and explaining every way it can fail.
 *
 * Runs entirely in the browser. No Convex function, no key on a server, no spend from
 * this project: the user brings a key and pays their own provider.
 *
 * ## Why the error handling here is unusually careful
 *
 * Because of a measured, provider-specific fact rather than a general worry. Several
 * providers answer the CORS preflight correctly but attach NO
 * `Access-Control-Allow-Origin` to an authentication failure. The browser then discards
 * the 401 body completely and hands JavaScript a bare `TypeError: Failed to fetch`.
 *
 * So the single most common user action - pasting a key that is expired, wrong, or a
 * ChatGPT subscription key instead of an API key - produces a network error that looks
 * identical to a dead connection. Reporting "Failed to fetch" there would be a lie by
 * omission: we know more than we are saying. `describeFailure` converts it into an
 * actual explanation, using the measured flag on each provider.
 */

import { prepare, extractText, extractErrorMessage, DEFAULT_TIMEOUT_MS, type ModelCall } from './adapters';
import type { Provider } from './providers';

export type AiFailure = {
	/** Short sentence to show the user. Never a raw stack or a bare status. */
	message: string;
	/** What to try next. Separate from the message so the UI can set it apart. */
	hint?: string;
	/** True when the user's key is the most likely cause. */
	likelyKeyProblem: boolean;
};

export type AiResult = {
	text: string;
	/** Which model actually answered, echoed back - providers may substitute. */
	model: string;
	providerId: string;
	/** Wall-clock duration, for the settings screen and for spotting slow models. */
	ms: number;
};

/**
 * Turn anything that went wrong into something worth reading.
 *
 * `fetch` rejects with a `TypeError` for a genuine network drop AND for a response the
 * browser refused to hand over. Those are different problems with different fixes, and
 * the browser deliberately does not tell them apart - so this function does, using what
 * we know about the provider.
 */
export function describeFailure(provider: Provider, error: unknown): AiFailure {
	const name = error instanceof Error ? error.name : '';
	const raw = error instanceof Error ? error.message : String(error);
	const aborted = name === 'AbortError' || /abort/i.test(raw);

	if (aborted) {
		return {
			message: 'Cancelled before the model replied.',
			hint: 'Nothing was charged unless the provider had already started.',
			likelyKeyProblem: false
		};
	}

	// The opaque case: a response existed but the browser withheld it.
	if (name === 'TypeError' && /fetch|network|load failed/i.test(raw)) {
		if (!provider.errorsReadableInBrowser && provider.needsKey) {
			return {
				message: `${provider.label} did not let the browser read the reply.`,
				hint: 'Almost always a rejected API key: check it is a real API key, not a chat subscription, and that it has credit. Some providers also block browser calls entirely - try OpenRouter, or a local model.',
				likelyKeyProblem: true
			};
		}
		return {
			message: `Could not reach ${provider.label}.`,
			hint: provider.local
				? 'Is the local server running? Start Ollama with `ollama serve`, then reload.'
				: 'Check the endpoint URL and your connection, then try again.',
			likelyKeyProblem: false
		};
	}

	return { message: raw.slice(0, 200) || 'Something went wrong.', likelyKeyProblem: false };
}

/** Turn a non-2xx response into a sentence, when the body is actually readable. */
export function describeHttpFailure(provider: Provider, status: number, body: unknown): AiFailure {
	const detail = extractErrorMessage(body);
	const base = `${provider.label} returned ${status}`;

	if (status === 401 || status === 403) {
		return {
			message: `${base} - the key was rejected.`,
			hint: 'Check the key was copied whole, belongs to this provider, and has not been revoked.',
			likelyKeyProblem: true
		};
	}
	if (status === 404) {
		return {
			message: `${base} - that endpoint or model was not found.`,
			hint: provider.id === 'custom'
				? 'Check the base URL - it usually needs to end in /v1.'
				: 'Check the model id. Provider catalogues change; any id the provider accepts will work.',
			likelyKeyProblem: false
		};
	}
	if (status === 429) {
		return {
			message: `${base} - rate limited or out of credit.`,
			hint: 'Wait a moment, or check the provider account for a spending cap.',
			likelyKeyProblem: false
		};
	}
	if (status >= 500) {
		return {
			message: `${base} - the provider's own error.`,
			hint: 'Not your key. Try again shortly, or switch provider.',
			likelyKeyProblem: false
		};
	}
	return { message: detail ? `${base} - ${detail}` : base, likelyKeyProblem: false };
}

/**
 * One model call, end to end.
 *
 * A bounded timeout on every call, because a user staring at a spinner with no ceiling
 * is a worse experience than a clear failure - and because a provider that accepts a
 * request and never answers would otherwise hold the request open indefinitely.
 */
export async function callModel(call: ModelCall): Promise<AiResult> {
	const started = Date.now();
	const { url, init } = prepare(call);

	const timeout = call.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);

	// Honour a caller-supplied signal as well as our own timeout, so a user clicking
	// "cancel" aborts the same request our timer would have.
	const onExternalAbort = () => controller.abort();
	call.signal?.addEventListener('abort', onExternalAbort);

	try {
		const response = await fetch(url, { ...init, signal: controller.signal });

		let body: unknown = null;
		try {
			body = await response.json();
		} catch {
			// A non-JSON body on an error path is common (HTML error pages, plain text).
			// Leaving `body` null is fine - the status alone is informative.
			body = null;
		}

		if (!response.ok) {
			throw Object.assign(new Error('http-failure'), { status: response.status, body });
		}

		const text = extractText(call.provider, body);
		if (text === null) {
			// A 200 we cannot read is a real failure mode: some providers return a
			// safety block or an empty candidates array. Saying "no summary" would be
			// indistinguishable from the model choosing to be brief.
			throw Object.assign(new Error('unreadable-body'), { status: response.status, body });
		}

		return { text, model: call.model, providerId: call.provider.id, ms: Date.now() - started };
	} catch (error) {
		const withStatus = error as { status?: number; body?: unknown };
		if (typeof withStatus.status === 'number' && error instanceof Error) {
			throw describeHttpFailure(call.provider, withStatus.status, withStatus.body ?? null);
		}
		if (error instanceof Error && error.message === 'unreadable-body') {
			throw {
				message: `${call.provider.label} replied, but the answer could not be read.`,
				hint: 'The model may have refused the request, or the response shape is not one this app knows. Try a different model.',
				likelyKeyProblem: false
			} satisfies AiFailure;
		}
		throw describeFailure(call.provider, error);
	} finally {
		clearTimeout(timer);
		call.signal?.removeEventListener('abort', onExternalAbort);
	}
}