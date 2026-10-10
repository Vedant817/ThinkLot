import { useCallback, useState } from "react";
import { useFocusEffect, router } from "expo-router";
import { View } from "react-native";
import { Button, Label, Note } from "./ui";
import { PROVIDERS } from "../lib/api";
import { storedKeyIds } from "../lib/ai-credentials";

/**
 * What this app connects to, and what it holds for each.
 *
 * Today that is two rows: AI providers (keys in the keychain, per provider,
 * removable) and import/export (file formats - nothing held, nothing to
 * remove). The section exists as a section rather than prose so the third,
 * fourth and fifth integrations have somewhere to land without a redesign:
 * each row is status plus one action.
 */
export function Integrations() {
  const [configured, setConfigured] = useState<string[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void storedKeyIds().then((ids) => {
        if (!active) return;
        const labels = new Map(PROVIDERS.map((p) => [p.id, p.label] as const));
        setConfigured([...new Set(ids)].map((id) => labels.get(id as never) ?? id));
      });
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <View style={{ gap: 8 }}>
      <Label>Integrations</Label>
      <Note>
        {configured === null
          ? "Checking what is connected…"
          : configured.length === 0
            ? "AI providers: no keys stored."
            : `AI providers: keys stored for ${configured.join(", ")}.`}
      </Note>
      <Button title="Manage AI providers" onPress={() => router.push("/ai-settings")} />
      <Note>Import/export holds nothing — files, not accounts. It lives below on this screen.</Note>
    </View>
  );
}
