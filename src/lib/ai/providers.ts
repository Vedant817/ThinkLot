/**
 * Which AI providers this app can talk to, and what each one actually allows.
 *
 * Spec section 8's "AI idea summarization" and "AI duplicate detection", built
 * bring-your-own-key and entirely in the browser: the user supplies their own
 * provider and key, so the app runs at zero marginal cost and no idea ever passes
 * through a server we control. Only the provider the user chose sees their text.
 *
 * ## The fields here are MEASURED, not assumed
 *
 * `errorsReadableInBrowser` and `requiredBrowserHeaders` were established by probing
 * each endpoint, and they are the reason this registry exists as data rather than a
 * switch statement. See `docs/AI-PROVIDERS.md` for the raw responses.
 *
 * The important finding: several providers answer a preflight correctly but attach
 * NO `Access-Control-Allow-Origin` to an AUTH FAILURE. The browser then discards the
 * body entirely and the app sees a bare `TypeError: Failed to fetch` - so a user who
 * pastes a wrong key is told the network broke. The flag lets the client turn that
 * into an actual explanation instead.
 */

export type ApiShape = 'openai' | 'anthropic' | 'gemini';

/** How the key travels. `query` puts it in the URL, which is the only option Gemini offers. */
export type AuthStyle = 'bearer' | 'x-api-key' | 'query-key' | 'none';

export type ProviderId =
	| 'openai'
	| 'anthropic'
	| 'gemini'
	| 'openrouter'
	| 'groq'
	| 'ollama'
	| 'lmstudio'
	| 'custom';

export type Provider = {
	id: ProviderId;
	label: string;
	/** One line on the settings screen: what this is for, or what to paste. */
	blurb: string;
	apiShape: ApiShape;
	authStyle: AuthStyle;
	/** No trailing slash. `custom` and local providers are user-supplied. */
	baseUrl: string;
	/** Whether the user must supply a key at all. */
	needsKey: boolean;
	/**
	 * Measured: does the provider return `Access-Control-Allow-Origin` on a REAL
	 * response when the key is wrong?
	 *
	 * When false the browser hides the error body, so a bad key and a genuinely broken
	 * network look identical to the app. The client uses this to say so.
	 */
	errorsReadableInBrowser: boolean;
	/**
	 * Headers that MUST be in the preflight or the request is refused.
	 *
	 * Anthropic rejects browser calls without
	 * `anthropic-dangerous-direct-browser-access: true`, and since that header has to
	 * appear in `Access-Control-Request-Headers`, omitting it fails the handshake
	 * before any key is ever checked.
	 */
	requiredBrowserHeaders?: Record<string, string>;
	/**
	 * Known model ids to offer. Deliberately a SHORT list: with BYOK the user pays,
	 * so the point is not to enumerate a catalogue but to be wrong only in the
	 * direction of being incomplete. Every field accepts a free-typed model id.
	 */
	models: string[];
	/** Set for local runtimes, which are the genuinely free option. */
	local?: boolean;
	/** Show this one first in the picker. */
	recommended?: boolean;
};

export const PROVIDERS: Provider[] = [
	{
		id: 'openrouter',
		label: 'OpenRouter',
		blurb: 'One key, many models. Best first try: it names models as provider/model.',
		apiShape: 'openai',
		authStyle: 'bearer',
		baseUrl: 'https://openrouter.ai/api/v1',
		needsKey: true,
		// Measured: this one DOES return ACAO on a 401, so a wrong key produces a real
		// message instead of an opaque network failure.
		errorsReadableInBrowser: true,
		models: ['openai/gpt-4.1-mini', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.0-flash'],
		recommended: true
	},
	{
		id: 'openai',
		label: 'OpenAI',
		blurb: 'Direct from OpenAI. Needs an API key with billing - the ChatGPT one will not work.',
		apiShape: 'openai',
		authStyle: 'bearer',
		baseUrl: 'https://api.openai.com/v1',
		needsKey: true,
		errorsReadableInBrowser: false,
		models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini']
	},
	{
		id: 'anthropic',
		label: 'Anthropic',
		blurb: 'Direct from Anthropic, via the native messages API rather than an OpenAI shim.',
		apiShape: 'anthropic',
		authStyle: 'x-api-key',
		baseUrl: 'https://api.anthropic.com/v1',
		needsKey: true,
		errorsReadableInBrowser: false,
		// Without this the handshake fails before the key is even examined.
		requiredBrowserHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
		models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5']
	},
	{
		id: 'gemini',
		label: 'Google Gemini',
		blurb: 'Generous free tier on an API key. The key goes in the URL; Gemini allows no alternative.',
		apiShape: 'gemini',
		authStyle: 'query-key',
		baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
		needsKey: true,
		errorsReadableInBrowser: false,
		models: ['gemini-2.0-flash', 'gemini-2.5-flash-lite']
	},
	{
		id: 'groq',
		label: 'Groq',
		blurb: 'Very fast inference, OpenAI-compatible shape.',
		apiShape: 'openai',
		authStyle: 'bearer',
		baseUrl: 'https://api.groq.com/openai/v1',
		needsKey: true,
		errorsReadableInBrowser: false,
		models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
	},
	{
		id: 'ollama',
		label: 'Ollama (local)',
		blurb: 'Runs on this machine. No key, no cost, nothing leaves the device. Start it with `ollama serve`.',
		apiShape: 'openai',
		authStyle: 'none',
		baseUrl: 'http://127.0.0.1:11434/v1',
		needsKey: false,
		errorsReadableInBrowser: true,
		models: ['llama3.2', 'qwen2.5:3b'],
		local: true
	},
	{
		id: 'lmstudio',
		label: 'LM Studio (local)',
		blurb: 'Local runtime with an OpenAI-compatible server. No key, no cost.',
		apiShape: 'openai',
		authStyle: 'none',
		baseUrl: 'http://127.0.0.1:1234/v1',
		needsKey: false,
		errorsReadableInBrowser: true,
		models: ['local-model'],
		local: true
	},
	{
		id: 'custom',
		label: 'Custom endpoint',
		blurb: 'Anything else that speaks the OpenAI chat shape: Together, Fireworks, vLLM, llama.cpp.',
		apiShape: 'openai',
		authStyle: 'bearer',
		baseUrl: '',
		needsKey: true,
		errorsReadableInBrowser: false,
		models: []
	}
];

export function providerById(id: ProviderId): Provider {
	const found = PROVIDERS.find((p) => p.id === id);
	if (!found) throw new Error(`unknown provider: ${id}`);
	return found;
}

/** Strip a trailing slash so `baseUrl` joins cleanly either way the user typed it. */
export function normaliseBaseUrl(url: string): string {
	return url.trim().replace(/\/+$/, '');
}

/**
 * What "works" means for one provider before a request is attempted.
 *
 * Checked up front so an unusable configuration produces a sentence, rather than a
 * `TypeError` from `fetch` or a 401 with no body.
 */
export function validateConfig(config: {
	provider: Provider;
	baseUrl: string;
	key: string;
	model: string;
}): string | null {
	const { provider, baseUrl, key, model } = config;

	if (!model.trim()) return 'Choose or type a model id.';
	if (!baseUrl.trim()) {
		return provider.id === 'custom'
			? 'Enter the endpoint URL.'
			: `No base URL for ${provider.label}.`;
	}
	if (!/^https?:\/\//i.test(baseUrl.trim())) {
		return 'The endpoint must start with http:// or https://';
	}
	if (provider.needsKey && !key.trim()) return `Paste a ${provider.label} API key.`;
	return null;
}