/**
 * Where the user's provider keys live, in the browser.
 *
 * ## The honest trade-off
 *
 * A key supplied in the browser cannot be kept secret from the browser. Any storage
 * this app uses is reachable by script running on the page, so a cross-site scripting
 * bug would be able to read a stored key. There is no arrangement of `localStorage`,
 * IndexedDB or Web Crypto that changes that while still letting the browser call the
 * provider directly - which is the architecture the owner asked for, and which is worth
 * having, because it means no key and no idea ever touches a server we run.
 *
 * So the design does not pretend to offer protection it cannot deliver. It defaults to
 * **session-only**: `sessionStorage`, gone when the tab closes. Persisting to
 * `localStorage` is available but is an explicit, separately-labelled choice, because
 * that is the line between "this key lives until you close the tab" and "this key lives
 * on this disk indefinitely", and only the user can decide which they want.
 *
 * Keys are never sent anywhere except the provider the user selected, and never logged.
 */

/** localStorage / sessionStorage prefix. Versioned so a future change can migrate. */
const PREFIX = 'thinklot.ai.v1.';

export type StoredConfig = {
	providerId: string;
	baseUrl: string;
	model: string;
};

export type StorageMode = 'session' | 'persistent';

function storage(mode: StorageMode): Storage | null {
	try {
		const store = mode === 'persistent' ? localStorage : sessionStorage;
		// Probe writability: Safari private mode and some embedded webviews expose
		// localStorage and then throw on write, which would otherwise fail on the very
		// action that looks harmless.
		const probe = `${PREFIX}__probe`;
		store.setItem(probe, '1');
		store.removeItem(probe);
		return store;
	} catch {
		return null;
	}
}

function readJson<T>(mode: StorageMode, key: string): T | null {
	const store = storage(mode);
	if (!store) return null;
	try {
		const raw = store.getItem(PREFIX + key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

function writeJson(mode: StorageMode, key: string, value: unknown): boolean {
	const store = storage(mode);
	if (!store) return false;
	try {
		store.setItem(PREFIX + key, JSON.stringify(value));
		return true;
	} catch {
		// Quota exceeded, or a hostile storage policy. Never fatal - the user can
		// always re-enter a key, and losing the preference is better than a crash.
		return false;
	}
}

function remove(mode: StorageMode, key: string): void {
	try {
		storage(mode)?.removeItem(PREFIX + key);
	} catch {
		/* nothing useful to do */
	}
}

/** The key for one provider. Stored separately so removing one leaves the rest. */
const keyName = (providerId: string) => `key.${providerId}`;

export function loadKey(providerId: string, mode: StorageMode): string {
	return readJson<string>(mode, keyName(providerId)) ?? '';
}

export function saveKey(providerId: string, key: string, mode: StorageMode): boolean {
	if (!key.trim()) {
		remove(mode, keyName(providerId));
		// Clearing in one mode must clear the other, or a user who "forgets" a key
		// still has it on disk from an earlier session.
		remove(other(mode), keyName(providerId));
		return true;
	}
	const saved = writeJson(mode, keyName(providerId), key);
	if (mode === 'session') remove('persistent', keyName(providerId));
	if (mode === 'persistent') remove('session', keyName(providerId));
	return saved;
}

export function forgetAll(mode: StorageMode): void {
	const store = storage(mode);
	if (!store) return;
	try {
		const doomed: string[] = [];
		for (let i = 0; i < store.length; i++) {
			const k = store.key(i);
			if (k?.startsWith(PREFIX)) doomed.push(k);
		}
		for (const k of doomed) store.removeItem(k);
	} catch {
		/* nothing useful to do */
	}
}

/** Which providers currently have a stored key, for the settings list. */
export function storedKeyIds(mode: StorageMode): string[] {
	const store = storage(mode);
	if (!store) return [];
	const found: string[] = [];
	try {
		for (let i = 0; i < store.length; i++) {
			const k = store.key(i);
			if (k?.startsWith(`${PREFIX}key.`)) found.push(k.slice(`${PREFIX}key.`.length));
		}
	} catch {
		/* nothing useful to do */
	}
	return found;
}

export function loadConfig(mode: StorageMode): StoredConfig | null {
	return readJson<StoredConfig>(mode, 'config');
}

export function saveConfig(config: StoredConfig, mode: StorageMode): boolean {
	return writeJson(mode, 'config', config);
}

const other = (mode: StorageMode): StorageMode => (mode === 'session' ? 'persistent' : 'session');

/**
 * A short hint of the key, never the key.
 *
 * Shown so the settings screen can confirm "a key is saved" without rendering the
 * secret into the DOM, where it would survive in view-source, screenshots and
 * accessibility trees.
 */
export function maskKey(key: string): string {
	const trimmed = key.trim();
	if (!trimmed) return '';
	if (trimmed.length <= 8) return '•'.repeat(trimmed.length);
	return `${trimmed.slice(0, 4)}${'•'.repeat(8)}${trimmed.slice(-2)}`;
}