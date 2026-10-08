import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { TokenStorage } from "@convex-dev/auth/react";

// SecureStore is native-only. Expo web uses browser storage through the provider.
export const tokenStorage: TokenStorage | undefined =
  Platform.OS === "web"
    ? undefined
    : {
        getItem: (key) => SecureStore.getItemAsync(key),
        setItem: (key, value) => SecureStore.setItemAsync(key, value),
        removeItem: (key) => SecureStore.deleteItemAsync(key),
      };

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/TooManyFailedAttempts/i.test(message))
    return "Too many sign-in attempts. Try again in an hour.";
  if (/InvalidSecret|InvalidAccountId|invalid.*password/i.test(message))
    return "That email and password do not match.";
  if (/already exists|already registered/i.test(message))
    return "That email already has an account. Sign in instead.";
  if (/network|fetch|offline/i.test(message))
    return "Check your connection and try again. Your draft is still here.";
  // Do not expose Convex stack traces in the interface.
  return (
    message
      .split("\n")
      .find((line) => /^(Uncaught (Error|ValidationError):|Error:)/.test(line))
      ?.replace(/^Uncaught (Error|ValidationError):\s*|^Error:\s*/, "") ??
    "Could not finish that request. Try again."
  );
}
