import { useState } from "react";
import { Alert, Share, Text, View } from "react-native";
import {
  Button,
  Failure,
  Field,
  Heading,
  Label,
  Note,
  Page,
  useFontMult,
  useTheme,
  type ThemeMode,
} from "../components/ui";
import {
  DEFAULT_THEME,
  FONT_SCALES,
  parseThemeImport,
  serializeTheme,
  validateTheme,
  type ThemeDef,
  type TokenKey,
} from "../lib/api";

/**
 * Appearance: mode, themes, import, and type size.
 *
 * Same contract as web `/settings/appearance`, adapted to what a phone has:
 * no `<input type=color>`, so each editable token gets a row of preset swatches
 * plus a hex field; export goes through the share sheet, like every other
 * mobile export, because there is no file picker to save into.
 *
 * The builder edits six tokens per mode - background, text, action, number,
 * border, surface - and everything else follows the built-in. Six is a stated
 * limit, not a secret one: a phone screen cannot hold 42 color rows without
 * becoming the thing people abandon, and accents plus surfaces are what make a
 * theme read as theirs. The full 21-token shape still imports and exports
 * byte-identically with web, so a phone-built theme opens on the browser whole.
 */

const EDITABLE: { key: TokenKey; label: string }[] = [
  { key: "paper", label: "Background" },
  { key: "ink", label: "Text" },
  { key: "signal", label: "Action" },
  { key: "lot", label: "Number" },
  { key: "line", label: "Border" },
  { key: "panel", label: "Surface" },
];

/** One shared swatch set for every token: neutrals, the two accents, status hues. */
const SWATCHES = [
  "#ffffff",
  "#f6f6f4",
  "#e4e4de",
  "#8b93a3",
  "#171920",
  "#1f232b",
  "#0e0e11",
  "#5b4bdb",
  "#8b7cf6",
  "#8a5300",
  "#f0b429",
  "#a81f14",
  "#0f6b45",
  "#1c6b3a",
];

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

export default function Appearance() {
  const theme = useTheme();
  const fm = useFontMult();
  const [error, setError] = useState<string>();

  // --- builder ---------------------------------------------------------------
  const [name, setName] = useState("");
  const [editMode, setEditMode] = useState<"light" | "dark">(
    theme.scheme,
  );
  const [draft, setDraft] = useState<Record<"light" | "dark", Record<string, string>>>({
    light: { ...DEFAULT_THEME.light },
    dark: { ...DEFAULT_THEME.dark },
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const warnings = validateTheme({
    id: "draft",
    name: name || "draft",
    light: { ...DEFAULT_THEME.light, ...draft.light },
    dark: { ...DEFAULT_THEME.dark, ...draft.dark },
  } as ThemeDef)[editMode];

  function startNew() {
    setName("");
    setDraft({ light: { ...DEFAULT_THEME.light }, dark: { ...DEFAULT_THEME.dark } });
    setEditMode(theme.scheme);
    setEditingId(null);
    setError(undefined);
  }

  function startEdit(def: ThemeDef) {
    setName(def.name);
    setDraft({ light: { ...def.light }, dark: { ...def.dark } });
    setEditMode(theme.scheme);
    setEditingId(def.id);
    setError(undefined);
  }

  function saveDraft() {
    if (!name.trim()) {
      setError("Give the theme a name first.");
      return;
    }
    const id =
      editingId ??
      `${name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "theme"}-${Math.random().toString(36).slice(2, 8)}`;
    theme.saveCustom({
      id,
      name: name.trim(),
      light: { ...DEFAULT_THEME.light, ...draft.light },
      dark: { ...DEFAULT_THEME.dark, ...draft.dark },
    });
    startNew();
  }

  // --- import ------------------------------------------------------------------
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<
    | { ok: true; theme: ThemeDef; filled: string[]; warnings: string[] }
    | { ok: false; error: string }
    | null
  >(null);

  function runImport() {
    const result = parseThemeImport(paste);
    if (!result.ok) {
      setPreview({ ok: false, error: result.error });
      return;
    }
    setPreview({ ok: true, theme: result.theme, filled: result.filled, warnings: result.warnings });
  }

  async function shareTheme(def: ThemeDef) {
    setError(undefined);
    try {
      await Share.share({ title: `thinklot-theme-${def.id}.json`, message: serializeTheme(def) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not share that theme.");
    }
  }

  function confirmDelete(def: ThemeDef) {
    Alert.alert("Delete this theme?", `"${def.name}" goes back to paint, not data - but the choice is permanent.`, [
      { text: "Keep it", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => theme.deleteCustom(def.id) },
    ]);
  }

  const allThemes = [DEFAULT_THEME, ...theme.customs];

  return (
    <Page>
      <Heading
        title="Appearance"
        subtitle="How the app looks on this phone. Themes stay on this device and never sync."
      />
      <Failure message={error} />

      <Label>Mode</Label>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {MODES.map((m) => (
          <Button
            key={m.id}
            compact
            primary={theme.mode === m.id}
            title={m.label}
            onPress={() => theme.setMode(m.id)}
          />
        ))}
      </View>
      <Note>
        {theme.mode === "system"
          ? `Following this phone (${theme.scheme} right now).`
          : `Always ${theme.mode}, regardless of the phone.`}
      </Note>

      <Label>Type size</Label>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {FONT_SCALES.map((s) => (
          <Button
            key={s.id}
            compact
            primary={theme.fontScale === s.id}
            title={s.label}
            onPress={() => theme.setFontScale(s.id)}
          />
        ))}
      </View>
      <Note>Phone text size still applies on top of this setting.</Note>

      <Label>Themes</Label>
      {allThemes.map((def) => {
        const tokens = def[theme.scheme];
        const dots = [tokens.paper, tokens.signal, tokens.lot, tokens.ink, tokens.panel];
        const isActive = theme.activeId === def.id;
        return (
          <View
            key={def.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              borderWidth: 1,
              borderColor: theme.tokens.line,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <View style={{ flexDirection: "row" }}>
              {dots.map((color) => (
                <View
                  key={color}
                  style={{ width: 16 * fm, height: 16 * fm, borderRadius: 8 * fm, backgroundColor: color, marginRight: -4, borderWidth: 1, borderColor: theme.tokens.line }}
                />
              ))}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.tokens.ink, fontSize: Math.round(15 * fm), fontWeight: "600" }}>
                {def.name}
                {isActive ? " · active" : ""}
              </Text>
              <Text style={{ color: theme.tokens.muted, fontSize: Math.round(12 * fm) }}>
                {def.id === "default" ? "Built in." : "Yours."}
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              {!isActive ? (
                <Button compact title="Use" onPress={() => theme.setActive(def.id)} />
              ) : null}
              <Button compact title="Share" onPress={() => void shareTheme(def)} />
              {def.id !== "default" ? (
                <>
                  <Button compact title="Edit" onPress={() => startEdit(def)} />
                  <Button compact title="Delete" danger onPress={() => confirmDelete(def)} />
                </>
              ) : null}
            </View>
          </View>
        );
      })}

      <Label>{editingId ? "Edit theme" : "Build a theme"}</Label>
      <Note>
        Six accents and surfaces per mode; the rest follows Default. Contrast notes
        are advice, not a lock.
      </Note>
      <Field label="Name" placeholder="Evening paper" value={name} onChangeText={setName} maxLength={60} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["light", "dark"] as const).map((m) => (
          <Button
            key={m}
            compact
            primary={editMode === m}
            title={m === "light" ? "Light" : "Dark"}
            onPress={() => setEditMode(m)}
          />
        ))}
      </View>
      {EDITABLE.map(({ key, label }) => (
        <View key={key} style={{ gap: 6 }}>
          <Label>
            {label} · {editMode}
          </Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {SWATCHES.map((color) => (
              <Text
                key={color}
                onPress={() => setDraft((d) => ({ ...d, [editMode]: { ...d[editMode], [key]: color } }))}
                accessibilityRole="button"
                accessibilityLabel={`${label} ${color}`}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: color,
                  borderWidth: draft[editMode][key] === color ? 3 : 1,
                  borderColor: draft[editMode][key] === color ? theme.tokens.signal : theme.tokens.line,
                  textAlign: "center",
                }}
              >
                {" "}
              </Text>
            ))}
          </View>
          <Field
            placeholder="#8b7cf6"
            value={draft[editMode][key]}
            onChangeText={(v) =>
              setDraft((d) => ({ ...d, [editMode]: { ...d[editMode], [key]: v } }))
            }
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={7}
          />
        </View>
      ))}
      {warnings.length > 0 ? (
        <View style={{ gap: 2 }}>
          <Label>Contrast notes · {editMode}</Label>
          {warnings.map((w) => (
            <Note key={w}>{w}</Note>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button primary title={editingId ? "Save changes" : "Save theme"} onPress={saveDraft} />
        {editingId ? <Button title="Start fresh" onPress={startNew} /> : null}
      </View>

      <Label>Import a theme</Label>
      <Note>Paste a theme file - from here, the browser, or a friend. Gaps fill from Default and are named.</Note>
      <Field placeholder='{"name": ...}' value={paste} onChangeText={setPaste} multiline maxLength={20000} />
      <Button title="Preview import" disabled={!paste.trim()} onPress={runImport} />
      {preview ? (
        preview.ok ? (
          <View style={{ gap: 6 }}>
            <Note>
              “{preview.theme.name}” reads clean.
              {preview.filled.length > 0
                ? ` ${preview.filled.length} colors filled from Default.`
                : ""}
            </Note>
            {preview.warnings.slice(0, 4).map((w) => (
              <Note key={w}>{w}</Note>
            ))}
            <Button
              primary
              title="Keep this theme"
              onPress={() => {
                theme.saveCustom(preview.theme);
                setPaste("");
                setPreview(null);
              }}
            />
          </View>
        ) : (
          <Failure message={preview.error} />
        )
      ) : null}
    </Page>
  );
}
