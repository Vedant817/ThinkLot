import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { Button, Failure, Note, useFontMult, usePalette } from "./ui";
import {
  callModel,
  providerById,
  validateConfig,
  type AiFailure,
  type ChatMessage,
  type Provider,
} from "../lib/api";
import { loadConfig, loadKey, type StorageMode } from "../lib/ai-credentials";

/**
 * One AI action: configure, consent, run, explain.
 *
 * The same rules as the web `AiAction`, because the rules are the point and they
 * do not change across clients:
 *
 * - Nothing runs until the user presses the button. A model call costs the user
 *   money and sends their words to a third party; there is no "helpful"
 *   background call.
 * - The button says exactly what will be sent, before it is sent.
 * - Unconfigured is a link to settings, not a disabled control with no
 *   explanation.
 * - Failure is a sentence plus what to try. Never a raw status.
 * - The answer is shown. The web version of this component once awaited the call
 *   and discarded the result, so pressing "Summarise" spent money and displayed
 *   nothing; both clients now take a `parseResult` that turns raw model text into
 *   what the user reads, and unusable output is reported as a failure rather than
 *   silence.
 *
 * Two platform adaptations: config and key reads are async (keychain and
 * AsyncStorage), so readiness resolves at press time; and the settings link
 * pushes the in-app route rather than an href.
 */
export function AiAction({
  label,
  consent,
  messages,
  parseResult,
  timeoutMs = 45_000,
}: {
  label: string;
  consent: string;
  messages: ChatMessage[];
  parseResult: (raw: string) => string | null;
  timeoutMs?: number;
}) {
  const c = usePalette();
  const fm = useFontMult();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [hint, setHint] = useState<string>();
  const [answer, setAnswer] = useState<{ text: string; ms: number; model: string } | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  /*
   * Check setup on mount, not only after a press.
   *
   * The first version only discovered "no provider configured" when the user
   * pressed the button - which is backwards: the web client says so up front,
   * and a button that silently does nothing until pressed twice teaches people
   * it is broken. Read-only, no side effects, abandoned if unmounted.
   */
  useEffect(() => {
    let active = true;
    void ready().then((config) => {
      if (active) setNeedsSetup(!config);
    });
    return () => {
      active = false;
    };
  }, []);

  /** Read at press time, so a key saved in settings just now is picked up. */
  async function ready(): Promise<{
    provider: Provider;
    baseUrl: string;
    key: string;
    model: string;
  } | null> {
    for (const mode of ["persistent", "session"] as StorageMode[]) {
      const config = await loadConfig(mode);
      if (!config) continue;
      if (!config.providerId || !config.model.trim()) continue;
      let provider: Provider;
      try {
        provider = providerById(config.providerId as Provider["id"]);
      } catch {
        continue;
      }
      const baseUrl = provider.id === "custom" ? config.baseUrl : provider.baseUrl;
      const key = await loadKey(provider.id, mode);
      if (validateConfig({ provider, baseUrl, key, model: config.model })) continue;
      return { provider, baseUrl, key, model: config.model };
    }
    return null;
  }

  async function onRun() {
    if (running) return;
    setRunning(true);
    setError(undefined);
    setHint(undefined);
    setAnswer(null);
    setNeedsSetup(false);
    try {
      const config = await ready();
      if (!config) {
        setNeedsSetup(true);
        return;
      }
      const result = await callModel({ ...config, messages, timeoutMs });
      const text = parseResult(result.text);
      if (text) {
        setAnswer({ text, ms: result.ms, model: result.model });
      } else {
        setError("The model answered, but not in a form this check can use.");
        setHint("Try again — or try a different model. Short, literal answers work best here.");
      }
    } catch (caught) {
      const failure = caught as AiFailure;
      setError(failure.message);
      setHint(failure.hint);
    } finally {
      setRunning(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button
          compact
          title={running ? "Working…" : label}
          primary
          disabled={running}
          onPress={() => void onRun()}
        />
        {needsSetup ? (
          <Text style={{ color: c.ink2, fontSize: Math.round(13 * fm), flex: 1 }}>
            Needs a provider and key.{" "}
            <Text style={{ color: c.signal }} onPress={() => router.push("/ai-settings")}>
              Set one up
            </Text>
          </Text>
        ) : !running && !answer ? (
          <Text style={{ color: c.ink2, fontSize: Math.round(13 * fm), flex: 1 }}>{consent}</Text>
        ) : null}
      </View>
      <Failure message={error} />
      {hint ? <Note>{hint}</Note> : null}
      {answer ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: c.line,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 10,
            gap: 4,
          }}
          accessibilityLiveRegion="polite"
        >
          <Text style={{ color: c.ink, fontSize: Math.round(14 * fm), lineHeight: Math.round(21 * fm) }}>{answer.text}</Text>
          <Text style={{ color: c.muted, fontSize: Math.round(11 * fm) }}>
            {answer.model} · {answer.ms}ms
          </Text>
        </View>
      ) : null}
    </View>
  );
}
