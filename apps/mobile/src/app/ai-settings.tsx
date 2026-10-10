import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { router } from "expo-router";
import {
  Button,
  Failure,
  Field,
  Heading,
  Label,
  Loading,
  Note,
  Page,
  usePalette,
} from "../components/ui";
import {
  PROVIDERS,
  providerById,
  validateConfig,
  callModel,
  type AiFailure,
  type ProviderId,
} from "../lib/api";
import {
  loadKey,
  saveKey,
  forgetAll,
  forgetConfigs,
  storedKeyIds,
  loadConfig,
  saveConfig,
  maskKey,
  type StorageMode,
} from "../lib/ai-credentials";

/**
 * AI provider settings: bring your own key, entirely on this phone.
 *
 * The web client has the same screen, and the contract is the same: the request
 * goes from this device straight to the provider the user chose, so no key and no
 * idea ever reaches a server this project runs, and there is nothing here to bill.
 *
 * Three adaptations, each forced by the platform rather than chosen:
 *
 * 1. Everything is async. Web reads localStorage synchronously; the keychain and
 *    AsyncStorage are both async, so saved state loads on mount and refreshes
 *    whenever the provider or mode changes - never read during render.
 * 2. No `confirm()`. Destructive choices (remembering a key on-device, forgetting
 *    everything) go through `Alert.alert`, which is the native confirm that
 *    actually blocks on a phone.
 * 3. No `<select>` or `<datalist>`. Providers are a list of buttons with the
 *    selection marked primary; model suggestions are chips that fill the field.
 *    The field still accepts any typed id, because with BYOK the user pays and
 *    the list is suggestions, not permission.
 */
export default function AiSettings() {
  const c = usePalette();
  const sorted = [...PROVIDERS].sort((a, b) => {
    if (!!a.local !== !!b.local) return a.local ? -1 : 1;
    if (!!a.recommended !== !!b.recommended) return a.recommended ? -1 : 1;
    return 0;
  });

  const [providerId, setProviderId] = useState<ProviderId>("openrouter");
  const [model, setModel] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [mode, setMode] = useState<StorageMode>("session");
  const [savedKey, setSavedKey] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string; hint?: string } | null>(null);
  const [storedCount, setStoredCount] = useState(0);

  const provider = providerById(providerId);
  const baseUrl = provider.id === "custom" ? customBaseUrl : provider.baseUrl;
  const key = savedKey || keyInput;

  /*
   * Saved state follows the provider and the mode, and the typed key never
   * survives a switch: leaving a pasted key sitting in the field after changing
   * provider is exactly the accident this screen exists to make hard.
   *
   * The resets live in these wrappers rather than in the loading effect below:
   * writing state synchronously inside an effect is a cascading-render lint error
   * here, and it also reads worse - the reset belongs to the user's tap, not to
   * the load that follows it.
   */
  function pickProvider(id: ProviderId) {
    if (id === providerId) return;
    setProviderId(id);
    setKeyInput("");
    setTestResult(null);
    setError(undefined);
    setLoaded(false);
  }

  function pickMode(m: StorageMode) {
    if (m === mode) return;
    setMode(m);
    setKeyInput("");
    setTestResult(null);
    setError(undefined);
    setLoaded(false);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [stored, config, ids] = await Promise.all([
          loadKey(providerId, mode),
          loadConfig(mode),
          storedKeyIds(),
        ]);
        if (!active) return;
        setSavedKey(stored);
        if (config && config.providerId === providerId) {
          setModel(config.model);
          setCustomBaseUrl(config.baseUrl);
        }
        setStoredCount(ids.length);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Could not read saved settings.");
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [providerId, mode]);

  // The config (provider, model, endpoint - nothing secret) is remembered as it
  // is chosen, so the per-idea action finds it without this screen being open.
  useEffect(() => {
    if (!loaded) return;
    void saveConfig({ providerId, baseUrl: customBaseUrl, model }, mode).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Could not remember these settings."),
    );
  }, [loaded, providerId, customBaseUrl, model, mode]);

  const problem = validateConfig({ provider, baseUrl, key, model });
  const canTest = !problem && !testing;

  async function onSaveKey() {
    if (!keyInput.trim()) return;
    const persist = async () => {
      setError(undefined);
      const ok = await saveKey(providerId, keyInput, mode);
      if (!ok) {
        setError("This device refused the keychain write, so the key was not saved.");
        return;
      }
      setSavedKey(keyInput);
      setKeyInput("");
      setStoredCount((await storedKeyIds()).length);
    };
    if (mode === "persistent") {
      // Deliberate, hard-to-reverse action: writing a secret to disk. The web
      // client confirms with confirm(); there is no confirm() here, so the
      // native dialog carries the same warning instead.
      Alert.alert(
        "Remember this key on the device?",
        "It will be kept in the platform keychain. Session-only is safer; you can change this later.",
        [
          { text: "Keep it for this session", style: "cancel" },
          { text: "Save it", onPress: () => void persist() },
        ],
      );
      return;
    }
    await persist();
  }

  async function onForget() {
    setError(undefined);
    await saveKey(providerId, "", mode);
    setSavedKey("");
    setKeyInput("");
    setTestResult(null);
    setStoredCount((await storedKeyIds()).length);
  }

  function onForgetAll() {
    Alert.alert(
      "Remove every stored AI key?",
      "Keys in this session and on this device are all deleted. Settings stay as they are.",
      [
        { text: "Keep them", style: "cancel" },
        {
          text: "Remove all",
          style: "destructive",
          onPress: () =>
            void (async () => {
              await forgetAll();
              await forgetConfigs();
              setSavedKey("");
              setKeyInput("");
              setTestResult(null);
              setStoredCount(0);
            })(),
        },
      ],
    );
  }

  /**
   * The cheapest end-to-end proof a setup works: a real model call with a handful
   * of output tokens, not a synthetic "list models" request. A provider can accept
   * a key and still refuse the app or the model, and those are the failures worth
   * catching here rather than on an idea.
   */
  async function onTest() {
    if (problem || testing) return;
    setTesting(true);
    setTestResult(null);
    setError(undefined);
    try {
      const result = await callModel({
        provider,
        baseUrl,
        key,
        model,
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
        maxTokens: 8,
        temperature: 0,
        timeoutMs: 30_000,
      });
      setTestResult({ ok: true, text: `Replied in ${result.ms}ms: “${result.text.trim()}”` });
    } catch (caught) {
      const failure = caught as AiFailure;
      setTestResult({ ok: false, text: failure.message, hint: failure.hint });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Page>
      <Heading
        title="AI"
        subtitle="Summaries and duplicate checks run on this phone, using a provider and key that are yours. Nothing is sent to a server this app runs."
      />
      <Failure message={error} />
      {!loaded ? (
        <Loading />
      ) : (
        <>
          <Label>Where is the key kept?</Label>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["session", "persistent"] as StorageMode[]).map((m) => (
              <Button
                key={m}
                compact
                primary={mode === m}
                title={m === "session" ? "This session" : "This device"}
                onPress={() => pickMode(m)}
              />
            ))}
          </View>
          <Note>
            {mode === "session"
              ? "Recommended. Gone when the app restarts; you re-paste it next time."
              : "Convenient, and it writes the key to the platform keychain. Anyone holding your unlocked phone inherits it."}
          </Note>

          <Label>Provider</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {sorted.map((p) => (
              <Button
                key={p.id}
                compact
                primary={providerId === p.id}
                title={p.local ? `${p.label} · free` : p.label}
                onPress={() => pickProvider(p.id)}
              />
            ))}
          </View>
          <Note>{provider.blurb}</Note>

          {provider.id === "custom" ? (
            <Field
              label="Endpoint"
              placeholder="https://api.example.com/v1"
              value={customBaseUrl}
              onChangeText={setCustomBaseUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}

          <Label>{provider.needsKey ? "API key" : "API key (not needed)"}</Label>
          {savedKey ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Note>{maskKey(savedKey)} · saved</Note>
              <View style={{ flex: 1 }} />
              <Button compact title="Forget" onPress={() => void onForget()} />
            </View>
          ) : (
            <View style={{ gap: 8 }}>
              <Field
                placeholder={provider.needsKey ? "Paste your key" : "Not required"}
                value={keyInput}
                onChangeText={setKeyInput}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={provider.needsKey}
              />
              {provider.needsKey ? (
                <Button compact title="Save key" disabled={!keyInput.trim()} onPress={() => void onSaveKey()} />
              ) : null}
            </View>
          )}

          <Label>Model</Label>
          <Field
            placeholder="Type any model id this provider accepts"
            value={model}
            onChangeText={setModel}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {provider.models.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {provider.models.map((m) => (
                <Button key={m} compact title={m} onPress={() => setModel(m)} />
              ))}
            </View>
          ) : null}
          <Note>Suggestions only — any id the provider accepts works.</Note>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Button
              title={testing ? "Testing…" : "Test connection"}
              primary
              disabled={!canTest}
              onPress={() => void onTest()}
            />
          </View>
          {problem && !testing ? <Note>{problem}</Note> : null}
          {testResult ? (
            <View
              style={{
                borderWidth: 1,
                borderRadius: 8,
                borderColor: testResult.ok ? c.ok : c.danger,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
              accessibilityLiveRegion="polite"
            >
              <Note>{testResult.text}</Note>
              {testResult.hint ? <Note>{testResult.hint}</Note> : null}
            </View>
          ) : null}

          {storedCount > 0 ? (
            <Button title="Remove all stored keys" danger onPress={onForgetAll} />
          ) : null}

          <Button title="Back to your lot" onPress={() => router.back()} />
        </>
      )}
    </Page>
  );
}
