/**
 * A dependency-free Chrome DevTools Protocol driver.
 *
 * Why this exists: the desktop browser tool reports `browser.disconnected` for
 * this whole session, so no rendered web UI had ever been seen - not the
 * dashboard, not the list view, not a single pixel of the app. Chrome is
 * installed on this machine and Node 24 ships a global `WebSocket`, so a real
 * browser can be driven with no new dependency and no test runner.
 *
 * Deliberately small. It does the four things the verification needs - navigate,
 * wait, evaluate, screenshot - and it fails loudly rather than hanging, because a
 * verification harness that quietly times out is worse than none.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;

export type ConsoleEntry = { level: string; text: string };

/** One page target, with the CDP plumbing behind it. */
export class Page {
	private nextId = 1;
	private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
	readonly console: ConsoleEntry[] = [];
	readonly pageErrors: string[] = [];
	private ws!: WebSocket;

	constructor(private sessionId: string, private send0: (method: string, params?: any, sid?: string) => Promise<any>) {}

	static async connect(ws: WebSocket): Promise<Page> {
		// A throwaway tab, attached to, then used.
		const created: any = await rpc(ws, 'Target.createTarget', { url: 'about:blank' });
		const attached: any = await rpc(ws, 'Target.attachToTarget', {
			targetId: created.targetId,
			flatten: true
		});
		const sessionId = attached.sessionId;
		return new Page(sessionId, (method, params, sid) => rpc(ws, method, params, sid));
	}

	private call(method: string, params: any = {}): Promise<any> {
		return this.send0(method, params, this.sessionId);
	}

	async init(): Promise<void> {
		await this.call('Page.enable');
		await this.call('Runtime.enable');
		await this.call('Log.enable');
		this.ws = undefined as never;
	}

	/** Drain CDP events for `ms`, collecting console output and page errors. */
	async observe(ms: number): Promise<void> {
		await sleep(ms);
	}

	async goto(url: string): Promise<void> {
		await this.call('Page.navigate', { url });
		// Poll for readiness rather than a fixed sleep: a fixed sleep is either
		// too short on a cold start (screenshot of a blank page) or wasteful.
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			const state = await this.evaluate('document.readyState');
			if (state === 'complete') return;
			await sleep(250);
		}
		throw new Error(`navigation to ${url} never reached readyState=complete`);
	}

	async evaluate<T = unknown>(expression: string): Promise<T> {
		const result: any = await this.call('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise: true
		});
		if (result?.exceptionDetails) {
			throw new Error(`evaluate threw: ${result.exceptionDetails.text ?? 'unknown'}`);
		}
		return result?.result?.value as T;
	}

	async setViewport(width: number, height: number): Promise<void> {
		await this.call('Emulation.setDeviceMetricsOverride', {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: false
		});
	}

	/**
	 * Press a real key, through Chrome's input pipeline.
	 *
	 * Not `dispatchEvent(new KeyboardEvent(...))`. A synthetic event has
	 * `isTrusted === false`, so any handler that - correctly - ignores untrusted
	 * events makes the app look broken when it is fine, and a test that silently
	 * proves nothing is worse than no test. `Input.dispatchKeyEvent` produces the
	 * same trusted event a person pressing the key would.
	 */
	async press(key: string): Promise<void> {
		for (const type of ['keyDown', 'keyUp'] as const) {
			await this.call('Input.dispatchKeyEvent', {
				type,
				key,
				// `key` alone is not enough for shortcuts that read `event.key` on
				// a real keyboard layout; text makes Chrome match its own mapping.
				text: key.length === 1 ? key : undefined,
				windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0
			});
		}
		await sleep(60);
	}

	/** Go offline or back online, leaving the page and its state intact. */
	async network(offline: boolean): Promise<void> {
		await this.call('Network.enable');
		await this.call('Network.emulateNetworkConditions', {
			offline,
			latency: 0,
			downloadThroughput: offline ? 0 : -1,
			uploadThroughput: offline ? 0 : -1
		});
	}

	/**
	 * Force the colour scheme.
	 *
	 * Headless Chrome reports `prefers-color-scheme: dark` by default, so every
	 * "light mode" screenshot came out dark - which makes the light theme
	 * permanently unverified and hides light-mode contrast bugs behind a palette
	 * nobody ships. Set explicitly so both are captured deliberately.
	 */
	async setColorScheme(scheme: 'light' | 'dark'): Promise<void> {
		await this.call('Emulation.setEmulatedMedia', {
			features: [{ name: 'prefers-color-scheme', value: scheme }]
		});
	}

	async screenshot(path: string): Promise<void> {
		const shot: any = await this.call('Page.captureScreenshot', { format: 'png' });
		if (!shot?.data) throw new Error(`no screenshot data for ${path}`);
		writeFileSync(path, Buffer.from(shot.data, 'base64'));
	}

	/** Text of the rendered page, with runs of whitespace collapsed. */
	async text(): Promise<string> {
		return this.evaluate<string>(
			`(document.body.innerText || '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim()`
		);
	}

	async url(): Promise<string> {
		return this.evaluate<string>('location.pathname + location.search');
	}
}

let ws: WebSocket;
let chrome: ChildProcess | null = null;

/**
 * Open another tab in the same browser.
 *
 * Shares the profile, so it shares `localStorage` and therefore the session - which
 * is the whole point for anything involving two clients. `Page` alone can only ever
 * make one target, and a "second client" made by reusing the same page is not a
 * second client at all.
 */
export async function newTab(): Promise<Page> {
	const page = await Page.connect(ws);
	await page.init();
	return page;
}

/**
 * Cut the network without closing the tab.
 *
 * This is how "what does the app do when the connection drops" gets asked. The
 * alternative - closing the page - destroys the in-memory state, so it tests
 * nothing about recovery.
 */
export async function setOffline(page: Page, offline: boolean): Promise<void> {
	await page.network(offline);
}

/** Raw CDP. `sessionId` omitted targets the browser, present targets a page. */
function rpc(target: WebSocket, method: string, params: any = {}, sessionId?: string): Promise<any> {
	const id = (rpc as any).counter = ((rpc as any).counter ?? 0) + 1;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30_000);
		const onMessage = (event: MessageEvent) => {
			const message = JSON.parse(String(event.data));
			if (message.id !== id) return;
			clearTimeout(timer);
			target.removeEventListener('message', onMessage);
			if (message.error) reject(new Error(`${method}: ${message.error.message}`));
			else resolve(message.result);
		};
		target.addEventListener('message', onMessage);
		target.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
	});
}

export async function launch(outDir: string): Promise<Page> {
	mkdirSync(outDir, { recursive: true });

	// A throwaway profile in the system temp directory - never the user's real
	// profile, and never inside the repository. This process writes to localStorage
	// to establish a session, so it must not touch anything that already exists,
	// and a Chrome profile is thousands of files that have no business in git.
	const profile = join(tmpdir(), 'thinklot-chrome-profile');

	chrome = spawn(
		CHROME,
		[
			'--headless=new',
			`--remote-debugging-port=${PORT}`,
			`--user-data-dir=${profile}`,
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-gpu',
			'--hide-scrollbars',
			'--window-size=1280,1000',
			'about:blank'
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] }
	);

	// Chrome's own stderr is the only explanation for most launch failures, and
	// `stdio: 'ignore'` throws that away - which is how the first run of this file
	// reported "Chrome never exposed its debugging endpoint" with no reason at all.
	let chromeError = '';
	chrome.stderr?.on('data', (chunk) => {
		chromeError += String(chunk);
	});
	chrome.on('error', (error) => {
		chromeError += `spawn failed: ${error.message}`;
	});

	// Poll the debug endpoint rather than sleeping a fixed amount: Chrome's start
	// time varies by an order of magnitude depending on disk and antivirus.
	let version: any;
	const deadline = Date.now() + 45_000;
	while (Date.now() < deadline) {
		try {
			version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
			break;
		} catch {
			await sleep(300);
		}
	}
	if (!version) {
		throw new Error(`Chrome never exposed its debugging endpoint on ${PORT}. Its stderr was:\n${chromeError.slice(0, 800)}`);
	}

	ws = new WebSocket(version.webSocketDebuggerUrl);
	await new Promise<void>((resolve, reject) => {
		ws.addEventListener('open', () => resolve(), { once: true });
		ws.addEventListener('error', () => reject(new Error('devtools socket failed')), { once: true });
	});

	// Route events to the page for console/error collection.
	ws.addEventListener('message', (event) => {
		const message = JSON.parse(String(event.data));
		if (message.method === 'Runtime.consoleAPICalled') {
			const text = (message.params.args ?? [])
				.map((a: any) => a.value ?? a.description ?? a.type)
				.join(' ');
			events.console.push({ level: message.params.type, text });
		}
		if (message.method === 'Runtime.exceptionThrown') {
			const d = message.params.exceptionDetails;
			events.errors.push(d.exception?.description ?? d.text);
		}
	});

	const page = await Page.connect(ws);
	await page.init();
	return page;
}

export const events = { console: [] as ConsoleEntry[], errors: [] as string[] };

export async function close(): Promise<void> {
	try {
		chrome?.kill();
	} catch {
		/* already gone */
	}
}
