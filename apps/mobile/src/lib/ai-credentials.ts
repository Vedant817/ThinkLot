/**
 * Where a bring-your-own AI key lives on a phone.
 *
 * ## It is not the web implementation
 *
 * The web client stores keys in `sessionStorage` or `localStorage`, which is the right
 * answer on a page running in a browser and the WRONG answer here for two reasons:
 *
 * 1. `sessionStorage` does not exist in React Native. There is `sessionStorage` in a
 *    browser only because a tab has a lifetime; a phone has a process, not a tab.
 * 2. A phone is a device the user carries around all day. Writing an API key to
 *    AsyncStorage - which is a plain JSON file on disk - would be worse than the
 *    honest trade-off the web client already states, and this app is deliberately
 *    honest about that trade-off.
 *
 * So the default here is the platform KEYCHAIN (iOS Keychain / Android Keystore via
 * `expo-secure-store`), which keeps the key out of the app's own data directory and
 * out of a device backup that is not encrypted with the user's credential. That is a
 * materially better security posture than the web client has, and saying so plainly is
 * the point: the two clients are NOT the same, and pretending they are would mean
 * quietly degrading one to match the other.
 *
 * The session-only option still exists, via `SecureStore`'s in-memory fallback, so a
 * user who does not want the key surviving a restart has a real choice.
 */

import * as SecureStore from "expo-secure-store";

const PREFIX = "thinklot.ai.v1.";

export type StorageMode = "session" | "persistent";

/**
 * `expo-secure-store` is a native module, which means it is NOT available in every
 * context - only in a binary that includes it. Expo Go includes it, and this app ships
 * a native release build, so it is present in every path we run; the guard exists for
 * the unit-test / SSR case where it is not, and so the app says "no keychain" rather
 * than crashing on touch.
 */
function available(): boolean {
  try {
    return typeof SecureStore.getItem === "function";
  } catch {
    return false;
  }
}

/** Keys never cross the JS bridge except as exactly this string. */
const keyName = (providerId: string) => `${PREFIX}key.${providerId}`;

export async function loadKey(providerId: string, mode: StorageMode): Promise<string> {
  if (!available()) return "";
  if (mode === "session") {
    // Session keys live in memory only. A module-level map rather than a module-level
    // single slot, because the app can legitimately configure more than one provider
    // across its lifetime.
    return sessionKeys.get(providerId) ?? "";
  }
  try {
    return (await SecureStore.getItemAsync(keyName(providerId), getOptions())) ?? "";
  } catch {
    return "";
  }
}

const sessionKeys = new Map<string, string>();

export async function saveKey(providerId: string, key: string, mode: StorageMode): Promise<boolean> {
  if (!key.trim()) {
    sessionKeys.delete(providerId);
    // Clearing must clear the OTHER store too, or a user who "forgets" a key still has
    // it on disk from an earlier session. The same rule the web client uses.
    if (available() && mode === "persistent") {
      try {
        await SecureStore.deleteItemAsync(keyName(providerId), getOptions());
      } catch {
        /* nothing useful to do */
      }
    }
    return true;
  }

  if (mode === "session") {
    sessionKeys.set(providerId, key);
    if (available()) {
      try {
        await SecureStore.deleteItemAsync(keyName(providerId), getOptions());
      } catch {
        /* nothing useful to do */
      }
    }
    return true;
  }

  if (!available()) {
    // The only failure mode worth surfacing. A user who chooses "remember on this
    // device" and is silently given session-only would be surprised later.
    return false;
  }
  try {
    await SecureStore.setItemAsync(keyName(providerId), key, getOptions());
    sessionKeys.delete(providerId);
    return true;
  } catch {
    return false;
  }
}

export async function forgetAll(): Promise<void> {
  sessionKeys.clear();
  if (!available()) return;
  for (const provider of KNOWN_PROVIDERS) {
    try {
      await SecureStore.deleteItemAsync(keyName(provider), getOptions());
    } catch {
      /* nothing useful to do */
    }
  }
}

/** Every provider the registry knows, so a full forget is a full forget. */
const KNOWN_PROVIDERS = [
  "openrouter",
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "ollama",
  "lmstudio",
  "custom"
] as const;

/**
 * Which providers currently have a persistent key.
 *
 * Keychain APIs expose no "list all keys", unlike `localStorage`, so this is checked
 * per provider rather than enumerated. That is a limitation of the platform, not a
 * choice, and it means a provider added to the registry later is covered
 * automatically - whereas an enumeration-based approach would silently miss it.
 */
export async function storedKeyIds(): Promise<string[]> {
  if (!available()) return [];
  const found: string[] = [];
  for (const provider of KNOWN_PROVIDERS) {
    try {
      const value = await SecureStore.getItemAsync(keyName(provider), getOptions());
      if (value) found.push(provider);
    } catch {
      /* A single unreadable key must not hide the rest. */
    }
  }
  return found;
}

/**
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` rather than the default.
 *
 * The default makes a keychain item eligible to be included in an *encrypted device
 * backup*, which means an API key would leave the phone in a file the user did not
 * choose to export. `THIS_DEVICE_ONLY` keeps it on the device. That is deliberately
 * stricter than the web client, which has no equivalent control.
 */
function getOptions(): SecureStore.SecureStoreOptions {
  return {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false
  };
}

/** A mask, never the key itself. */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 8) return "•".repeat(trimmed.length);
  return `${trimmed.slice(0, 4)}${"•".repeat(8)}${trimmed.slice(-2)}`;
}