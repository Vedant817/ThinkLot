import { env } from '$env/dynamic/public';
import { BaseConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';
import type { Value } from 'convex/values';
import { api } from '../../convex/_generated/api';

/**
 * Convex connection + auth, as a Svelte 5 rune-backed singleton.
 *
 * Convex ships official React bindings but nothing for Svelte. The React one is
 * a context provider plus hooks; porting that shape into Svelte would mean a
 * `<Provider>` in the root layout and `getContext` in every component - ceremony
 * Svelte has no use for. So this reimplements the small part of Convex Auth that
 * actually matters:
 *
 *   signIn -> store tokens -> client.setAuth(tokenFetcher) -> Convex handles the rest
 *
 * The token fetcher is the whole integration. Convex calls it whenever it needs
 * a token, passing `forceRefreshToken` when the current one has expired, and we
 * exchange the stored refresh token for a fresh access token. Convex owns retry,
 * backoff and the auth state machine from that point on.
 *
 * This uses `BaseConvexClient` rather than `ConvexClient`. The latter keeps its
 * base client in a private field, which would put `subscribe` and
 * `localQueryResult` - the two methods reactive queries need - out of reach.
 *
 * Tokens live in localStorage under the same key names Convex Auth's own
 * bindings use, so web and the React Native client share one convention.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type AuthState = {
	status: AuthStatus;
	email: string | null;
};

type Tokens = { token: string; refreshToken: string };

/**
 * Argument shape for Convex calls.
 *
 * Convex drops keys whose value is undefined before validation, so optional
 * arguments have to be permitted to be explicitly undefined. That is not
 * cosmetic: inside `ideas.update`, passing `{ description: undefined }` clears
 * the description, while omitting the key leaves it untouched.
 */
export type ConvexArgs = Record<string, Value | undefined>;

/**
 * Convex's own client signatures type args as `Record<string, Value>`, which
 * excludes undefined, yet `v.optional()` arguments genuinely accept it on the
 * wire (the key is dropped before validation). Rather than sprinkle casts, the
 * conversion happens once here, next to the explanation of why it is sound.
 */
function asWire(args: ConvexArgs): Record<string, Value> {
	return args as Record<string, Value>;
}

const TOKEN_KEY = '__convexAuthJWT';
const REFRESH_KEY = '__convexAuthRefreshToken';

/** Read a JWT's `exp` without verifying it. Only used to decide when to refresh. */
function isExpired(jwt: string, skewSeconds = 30) {
	const payload = jwt.split('.')[1];
	if (!payload) return true;
	try {
		const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
		const { exp } = JSON.parse(json) as { exp?: number };
		if (typeof exp !== 'number') return true;
		return Date.now() >= (exp - skewSeconds) * 1000;
	} catch {
		return true;
	}
}

function readTokens(): Partial<Tokens> {
	try {
		return {
			token: localStorage.getItem(TOKEN_KEY) ?? undefined,
			refreshToken: localStorage.getItem(REFRESH_KEY) ?? undefined
		};
	} catch {
		// Private browsing / storage disabled. Auth simply will not persist.
		return {};
	}
}

function writeTokens(tokens: Tokens | null) {
	try {
		if (tokens) {
			localStorage.setItem(TOKEN_KEY, tokens.token);
			localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
		} else {
			localStorage.removeItem(TOKEN_KEY);
			localStorage.removeItem(REFRESH_KEY);
		}
	} catch {
		/* storage unavailable; session lasts until reload */
	}
}

/** Turn a Convex error into something worth showing a human. */
function readableError(error: unknown): Error {
	const raw = error instanceof Error ? error.message : String(error);
	if (/already exists|already registered|unique/i.test(raw)) {
		return new Error('That email already has an account. Sign in instead.');
	}
	if (/invalid.*password|password.*invalid|incorrect/i.test(raw)) {
		return new Error('That email and password do not match.');
	}
	if (/must be at least 8 characters/i.test(raw)) {
		return new Error('Password must be at least 8 characters.');
	}
	return error instanceof Error ? error : new Error(raw);
}

class ConvexContext {
	readonly url = env.PUBLIC_CONVEX_URL ?? '';

	client: BaseConvexClient | null = null;

	auth = $state<AuthState>({ status: 'loading', email: null });

	connection = $state<ConnectionStatus>('connecting');

	private started = false;
	private email = $state<string | null>(null);

	/**
	 * Connect once and begin tracking auth.
	 *
	 * Guarded by `started` so the WebSocket opens exactly once no matter how
	 * many components call this.
	 */
	start() {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;

		if (!this.url) {
			this.connection = 'disconnected';
			this.auth = { status: 'unauthenticated', email: null };
			console.error(
				'PUBLIC_CONVEX_URL is missing. Run `npx convex dev`, then restart the dev server.'
			);
			return;
		}

		this.connection = 'connecting';
		this.client = new BaseConvexClient(this.url, () => {});

		// Convex calls this whenever it needs a token. `forceRefreshToken` is set
		// once the access token is close to expiry.
		const fetchToken = async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
			const { token, refreshToken } = readTokens();

			if (!forceRefreshToken && token && !isExpired(token)) {
				return token;
			}

			if (!refreshToken) return null;

			const result = await this.action<{ tokens?: Tokens | null }>(api.auth.signIn, {
				refreshToken
			});
			if (result.tokens) {
				writeTokens(result.tokens);
				return result.tokens.token;
			}
			return null;
		};

		this.client.setAuth(fetchToken, (isAuthenticated) => {
			if (!isAuthenticated) {
				this.email = null;
				this.auth = { status: 'unauthenticated', email: null };
				return;
			}
			void this.refreshProfile();
		});

		// Returns a disposer, not a promise - the callback is the only update path.
		this.client.subscribeToConnectionState((state) => {
			this.connection = state.isWebSocketConnected ? 'connected' : 'connecting';
		});
	}

	/**
	 * Read the signed-in user's profile.
	 *
	 * Kept separate from `start()` so a slow or failing profile query can never
	 * stall the auth state transition - an authenticated user with no email to
	 * show is fine; an app stuck on "signing in" is not.
	 */
	private async refreshProfile() {
		try {
			const user = await this.fetchOnce<{ email: string | null } | null>(api.users.current);
			this.email = user?.email ?? null;
		} catch {
			this.email = null;
		}
		this.auth = { status: 'authenticated', email: this.email };
	}

	async signIn(email: string, password: string) {
		this.ensure();
		try {
			const result = await this.action<{ tokens?: Tokens | null }>(api.auth.signIn, {
				provider: 'password',
				params: { email: email.trim(), password }
			});
			this.remember(result.tokens ?? null);
		} catch (error) {
			throw readableError(error);
		}
	}

	async signUp(email: string, password: string) {
		this.ensure();
		try {
			const result = await this.action<{ tokens?: Tokens | null }>(api.auth.signIn, {
				provider: 'password',
				params: { email: email.trim(), password, flow: 'signUp' }
			});
			this.remember(result.tokens ?? null);
		} catch (error) {
			throw readableError(error);
		}
	}

	async signOut() {
		this.ensure();
		try {
			await this.action(api.auth.signOut, {});
		} catch {
			// Already signed out, or the session expired. Clear locally regardless.
		}
		writeTokens(null);
		this.email = null;
		this.auth = { status: 'unauthenticated', email: null };
	}

	/**
	 * Store freshly issued tokens and force Convex to pull one immediately,
	 * otherwise the UI sits in its previous auth state until the next request.
	 */
	private remember(tokens: Tokens | null) {
		writeTokens(tokens);
		if (!tokens) {
			this.auth = { status: 'unauthenticated', email: null };
			return;
		}
		this.client!.setAuth(
			async () => readTokens().token ?? null,
			(isAuthenticated) => {
				if (isAuthenticated) void this.refreshProfile();
			}
		);
	}

	private ensure() {
		if (!this.client) this.start();
		if (!this.client) {
			throw new Error('ThinkLot is not connected yet. Reload and try again.');
		}
	}

	/**
	 * One-shot read.
	 *
	 * `BaseConvexClient` has no one-shot `query` - everything is a subscription -
	 * so this opens one, waits for the first value, and tears it down. Used for
	 * the handful of reads that are genuinely point-in-time (profile, form
	 * submission side effects) where keeping a live subscription would be waste.
	 */
	async fetchOnce<T>(reference: unknown, args: ConvexArgs = {}): Promise<T> {
		this.ensure();
		const name = getFunctionName(reference as never);

		return new Promise<T>((resolve, reject) => {
			const { queryToken, unsubscribe } = this.client!.subscribe(name, asWire(args));

			let settled = false;
			const finish = (value: T) => {
				if (settled) return;
				settled = true;
				removeHandler();
				unsubscribe();
				resolve(value);
			};

			const removeHandler = this.client!.addOnTransitionHandler((transition) => {
				if (!transition.queries.some((q) => q.token === queryToken)) return;
				const value = this.client!.localQueryResult(name, asWire(args));
				if (value !== undefined) finish(value as T);
			});

			// A cached value may already be present from an earlier subscription.
			const cached = this.client!.localQueryResult(name, asWire(args));
			if (cached !== undefined) {
				finish(cached as T);
				return;
			}

			// A query that legitimately returns `undefined` would otherwise hang
			// here forever, so give up rather than leak the subscription.
			setTimeout(() => {
				if (settled) return;
				settled = true;
				removeHandler();
				unsubscribe();
				reject(new Error('ThinkLot did not respond. Check your connection.'));
			}, 10_000);
		});
	}

	mutation<ReturnType>(reference: unknown, args: ConvexArgs = {}) {
		this.ensure();
		return this.client!.mutation(getFunctionName(reference as never), asWire(args)) as Promise<ReturnType>;
	}

	action<ReturnType>(reference: unknown, args: ConvexArgs = {}) {
		this.ensure();
		return this.client!.action(getFunctionName(reference as never), asWire(args)) as Promise<ReturnType>;
	}
}

export const convex = new ConvexContext();