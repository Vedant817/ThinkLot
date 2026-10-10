import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_THEME,
  fontMult,
  type FontScaleId,
  type ThemeDef,
  type ThemeTokens,
} from "../lib/api";

/**
 * The ThinkLot palette.
 *
 * These are the SAME values as the web app's layout.css, deliberately. Two
 * clients of one product that drift apart on colour are two products, and the
 * drift here was not subtle: this file previously used a sage/olive palette
 * (paper #F5F6ED, ink #22281F, accent #B05B00) with no violet anywhere, so every
 * primary action rendered as a dark olive slab and the app read as a different
 * product from the one the design language describes.
 *
 * The rule the whole system rests on: violet (--signal) means "the action you
 * should take", amber (--lot) means "a number you need to read" (LOT plates and
 * priority scores). Nothing else is allowed to be either colour.
 *
 * Dark is neutral, not blue-black, because this tool gets used at night as often
 * as on a train in daylight.
 */
export type Palette = {
  paper: string;
  panel: string;
  sunk: string;
  line: string;
  lineStrong: string;
  ink: string;
  ink2: string;
  muted: string;
  signal: string;
  signalInk: string;
  signalSoft: string;
  lot: string;
  lotSoft: string;
  ok: string;
  good: string;
  danger: string;
};

export type ThemeMode = "light" | "dark" | "system";

type ThemeState = {
  mode: ThemeMode;
  /** Resolved against the OS when mode is system. */
  scheme: "light" | "dark";
  tokens: Palette;
  fontScale: FontScaleId;
  customs: ThemeDef[];
  activeId: string;
  setMode: (mode: ThemeMode) => void;
  setActive: (id: string) => void;
  saveCustom: (def: ThemeDef) => void;
  deleteCustom: (id: string) => void;
  setFontScale: (id: FontScaleId) => void;
};

const MODE_KEY = "thinklot:theme-mode";
const ACTIVE_KEY = "thinklot:theme-active";
const CUSTOM_KEY = "thinklot:themes-custom";
const FONT_KEY = "thinklot:font-scale";

function tokensToPalette(tokens: ThemeTokens): Palette {
  return {
    paper: tokens.paper,
    panel: tokens.panel,
    sunk: tokens.sunk,
    line: tokens.line,
    lineStrong: tokens.lineStrong,
    ink: tokens.ink,
    ink2: tokens.ink2,
    muted: tokens.muted,
    signal: tokens.signal,
    signalInk: tokens.signalInk,
    signalSoft: tokens.signalSoft,
    lot: tokens.lot,
    lotSoft: tokens.lotSoft,
    ok: tokens.ok,
    good: tokens.good,
    danger: tokens.danger,
  };
}

const ThemeContext = createContext<ThemeState | null>(null);

/**
 * Theme + type ownership for the whole app.
 *
 * Mode (light/dark/system), the active theme (built-in or custom), customs and
 * the font scale persist in AsyncStorage - paint choices, not account data, so
 * they stay on the device and never sync. `usePalette()` below is the only
 * reader screens need; it keeps its exact shape, so all 34 call sites are
 * untouched by themes becoming data.
 */
export function ThemeProvider({ children }: PropsWithChildren) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [activeId, setActiveId] = useState("default");
  const [customs, setCustoms] = useState<ThemeDef[]>([]);
  const [fontScale, setFontScale] = useState<FontScaleId>("default");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [m, a, c, f] = await Promise.all([
          AsyncStorage.getItem(MODE_KEY),
          AsyncStorage.getItem(ACTIVE_KEY),
          AsyncStorage.getItem(CUSTOM_KEY),
          AsyncStorage.getItem(FONT_KEY),
        ]);
        if (!active) return;
        if (m === "light" || m === "dark" || m === "system") setModeState(m);
        if (a) setActiveId(a);
        if (c) {
          const parsed = JSON.parse(c) as ThemeDef[];
          if (Array.isArray(parsed)) setCustoms(parsed);
        }
        if (f === "compact" || f === "default" || f === "large" || f === "xl") setFontScale(f);
      } catch {
        /* storage blocked: defaults stand, painted instantly rather than gated */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const scheme = mode === "system" ? (system === "dark" ? "dark" : "light") : mode;
  const active = customs.find((t) => t.id === activeId) ?? DEFAULT_THEME;
  const tokens = useMemo(() => tokensToPalette(active[scheme]), [active, scheme]);

  const value = useMemo<ThemeState>(
    () => ({
      mode,
      scheme,
      tokens,
      fontScale,
      customs,
      activeId: active.id,
      setMode: (m) => {
        setModeState(m);
        void AsyncStorage.setItem(MODE_KEY, m).catch(() => {});
      },
      setActive: (id) => {
        setActiveId(id);
        void AsyncStorage.setItem(ACTIVE_KEY, id).catch(() => {});
      },
      saveCustom: (def) => {
        setCustoms((prev) => {
          const next = [...prev.filter((t) => t.id !== def.id), def];
          void AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
        setActiveId(def.id);
        void AsyncStorage.setItem(ACTIVE_KEY, def.id).catch(() => {});
      },
      deleteCustom: (id) => {
        setCustoms((prev) => {
          const next = prev.filter((t) => t.id !== id);
          void AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(next)).catch(() => {});
          return next;
        });
        setActiveId((current) => {
          const next = current === id ? "default" : current;
          void AsyncStorage.setItem(ACTIVE_KEY, next).catch(() => {});
          return next;
        });
      },
      setFontScale: (id) => {
        setFontScale(id);
        void AsyncStorage.setItem(FONT_KEY, id).catch(() => {});
      },
    }),
    [mode, scheme, tokens, fontScale, customs, active],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** The full theme state. Prefer `usePalette()` / `useFontMult()` unless building the appearance screen. */
export function useTheme(): ThemeState {
  // Unconditional: calling it only on the fallback path would break hook order
  // for every component that sometimes renders inside the provider.
  const system = useColorScheme();
  const state = useContext(ThemeContext);
  if (!state) {
    // Outside a provider (unit tests, previews): system scheme, built-in theme.
    // A hook that throws here would make every component unrenderable in
    // isolation, which is worse than a default.
    const scheme = system === "dark" ? "dark" : "light";
    return {
      mode: "system",
      scheme,
      tokens: tokensToPalette(DEFAULT_THEME[scheme]),
      fontScale: "default",
      customs: [],
      activeId: "default",
      setMode: () => {},
      setActive: () => {},
      saveCustom: () => {},
      deleteCustom: () => {},
      setFontScale: () => {},
    };
  }
  return state;
}

export function usePalette(): Palette {
  return useTheme().tokens;
}

/**
 * Type scale multiplier for the one place font sizes are decided.
 *
 * Screens with inline `fontSize` read this and multiply, so the appearance
 * setting reaches text the primitives do not own. `Math.round` at the call
 * site, because fractional points shimmer.
 */
export function useFontMult(): number {
  return fontMult(useTheme().fontScale);
}

/**
 * Monospace family for plates, scores and labels.
 *
 * The LOT plate is the product's signature element and it only reads as a
 * *stamp* if it is monospaced. Neither platform has JetBrains Mono bundled, so
 * this picks the platform mono rather than silently falling back to the sans
 * face - which is what made the plate look like an ordinary label before.
 */
export const mono = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
}) as string;

export function Page({
  children,
  scroll = true,
  safeTop = true,
}: PropsWithChildren<{ scroll?: boolean; safeTop?: boolean }>) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const content = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        padding: 20,
        gap: 14,
        paddingBottom: Math.max(insets.bottom, 20) + 24,
      }}
    >
      {children}
    </ScrollView>
  ) : (
    children
  );
  return (
    <KeyboardAvoidingView
      style={{
        flex: 1,
        backgroundColor: c.paper,
        paddingTop: safeTop ? insets.top : 0,
      }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {content}
    </KeyboardAvoidingView>
  );
}

/**
 * The screen header.
 *
 * The display size came down from 34 to 26. At 34 it consumed roughly a third
 * of the first viewport on EVERY screen, which is precisely wrong for a
 * capture-first tool: the user arrived to type a thought, not to read a
 * headline. 26 still reads as a title and leaves the capture field above the
 * fold on a 5" phone.
 */
/**
 * A screen heading.
 *
 * The `eyebrow` is gone. It defaulted to "ThinkLot / Field ledger" and therefore
 * sat above every single screen, which on a phone is a row of chrome that says
 * nothing about the screen it is on - the same treatment the web app can carry,
 * because there a wordmark sits in a persistent header rather than repeating in
 * every scroll view. A device run flagged it directly.
 */
export function Heading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const c = usePalette();
  // Type scale applies here, in the primitives, so every screen inherits it
  // without touching its own styles. `fm` multiplies point sizes; line heights
  // scale with them so larger text does not collide with itself.
  const fm = useFontMult();
  const fs = (px: number) => Math.round(px * fm);
  return (
    <View style={{ gap: 6 }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: fs(26), lineHeight: fs(30), fontWeight: "700", color: c.ink }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ color: c.ink2, fontSize: fs(14), lineHeight: fs(20) }}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

/**
 * A quiet section header.
 *
 * Was 11px monospace, uppercase, +1.4 tracking - the web app's eyebrow style. That
 * is the caption problem a device run flagged: the web client can carry a row of
 * uppercase mono eyebrows because they sit in wide, horizontally-arranged panels,
 * but on a phone nineteen of them stacked down a scroll view read as shouting and
 * pushed the actual content down the page.
 *
 * Sentence case, medium weight, no tracking, muted. Still unmistakably a label;
 * no longer the loudest thing on the screen.
 */
export function Label({ children }: PropsWithChildren) {
  const c = usePalette();
  const fm = useFontMult();
  return (
    <Text
      style={{
        color: c.muted,
        fontSize: Math.round(12 * fm),
        lineHeight: Math.round(16 * fm),
        fontWeight: "600",
      }}
    >
      {children}
    </Text>
  );
}

export function Note({ children }: PropsWithChildren) {
  const c = usePalette();
  const fm = useFontMult();
  return (
    <Text style={{ color: c.ink2, fontSize: Math.round(15 * fm), lineHeight: Math.round(22 * fm) }}>{children}</Text>
  );
}

/**
 * The LOT plate.
 *
 * The one element allowed to be amber, because amber means "a number you need
 * to read". This is the product's signature and its main conversational
 * primitive - "that was LOT-0042" - so it is rendered as a stamp: monospace,
 * tracked out, on a tinted ground, never competing with the title for weight.
 */
export function Plate({ children }: PropsWithChildren) {
  const c = usePalette();
  const fm = useFontMult();
  return (
    <Text
      style={{
        color: c.lot,
        backgroundColor: c.lotSoft,
        fontFamily: mono,
        fontSize: Math.round(12 * fm),
        letterSpacing: 0.6,
        overflow: "hidden",
        borderRadius: 3,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      {children}
    </Text>
  );
}

/** A bordered surface. Structure comes from 1px rules, never from shadow. */
export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: object }>) {
  const c = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: c.paper,
          borderWidth: 1,
          borderColor: c.line,
          borderRadius: 8,
          padding: 14,
          gap: 10,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A hairline. Structure in this design system is carried by rules. */
export function Rule() {
  const c = usePalette();
  return <View style={{ height: 1, backgroundColor: c.line }} />;
}

/**
 * The primary action, in violet.
 *
 * This was `backgroundColor: c.ink` - a near-black slab - which is why every
 * primary button in the app looked heavy, dead, and unlike the web client.
 * Violet is reserved for exactly one thing: the action the user should take
 * next. There is no second violet element competing for it.
 */
export function Button({
  title,
  onPress,
  disabled,
  primary,
  danger,
  compact,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  /** Filter-strip variant: shorter, tighter, never the primary action. */
  compact?: boolean;
}) {
  const c = usePalette();
  const fm = useFontMult();
  const background = danger
    ? "transparent"
    : primary
      ? c.signal
      : "transparent";
  const border = danger ? c.danger : primary ? c.signal : c.lineStrong;
  const foreground = danger ? c.danger : primary ? c.signalInk : c.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        // 48dp for actions, 40dp for filter chips. The chips are not dropped
        // further because they are still touch targets, only secondary ones -
        // and this app is used one-handed and in motion.
        minHeight: compact ? 40 : 48,
        paddingHorizontal: compact ? 12 : 16,
        paddingVertical: compact ? 8 : 12,
        borderRadius: compact ? 6 : 8,
        borderWidth: 1,
        borderColor: disabled ? c.line : border,
        backgroundColor: disabled ? c.panel : background,
        opacity: pressed && !disabled ? 0.75 : 1,
        justifyContent: "center",
        alignItems: "center",
      })}
    >
      <Text
        style={{
          color: disabled ? c.muted : foreground,
          fontSize: Math.round((compact ? 13 : 15) * fm),
          fontWeight: "600",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/**
 * A horizontally scrolling filter strip.
 *
 * Wrapping four filter buttons put them on two ragged rows with a single orphan
 * on the second, which reads as an accident rather than a layout. One scrolling
 * row is the standard mobile treatment, and it degrades properly when the board
 * adds six stage chips on top of the other filters.
 */
export function ChipRow({ children }: PropsWithChildren) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      /*
        The strip bleeds to both screen edges so it reads as scrollable, but the
        inset padding belongs on the CONTENT, not as a negative margin on the
        viewport alone - that clipped the first chip's left border off at x=0.
      */
      contentContainerStyle={{
        gap: 8,
        paddingHorizontal: 20,
        alignItems: "center",
      }}
      style={{ marginHorizontal: -20, flexGrow: 0 }}
    >
      {children}
    </ScrollView>
  );
}

/**
 * A labelled input.
 *
 * `placeholder` is now part of the contract rather than something callers have to
 * remember: the search field was rendering as a completely empty bordered box
 * with its hint above it, which reads as a broken control rather than an empty
 * one. A field with no value should say what belongs in it.
 */
export function Field({
  label,
  placeholder,
  hint,
  ...props
}: TextInputProps & { label?: string; hint?: string }) {
  const c = usePalette();
  const fm = useFontMult();
  const [focused, setFocused] = useState(false);
  /*
   * The label is now optional.
   *
   * It was mandatory, which forced a visible eyebrow onto fields that already
   * describe themselves in their placeholder - the search input read "Search" above
   * a box that says "Title, notes or a tag", which is two captions and one input.
   * The accessibility label falls back to the placeholder so dropping the visual one
   * never costs a screen-reader user the control's name.
   */
  const announced = label ?? placeholder ?? "Text field";
  return (
    <View style={{ gap: 7 }}>
      {label ? <Label>{label}</Label> : null}
      <TextInput
        accessibilityLabel={announced}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...props}
        style={[
          {
            minHeight: 48,
            color: c.ink,
            borderWidth: 1,
            // Violet on focus, matching the web app's focus behaviour. A 1px
            // border-colour change alone is a weak focus affordance, and this
            // field is the single most-used control in the product.
            borderColor: focused ? c.signal : c.line,
            backgroundColor: c.paper,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 12,
            fontSize: Math.round(16 * fm),
            textAlignVertical: props.multiline ? "top" : "center",
          },
          props.style,
        ]}
      />
      {hint ? (
        <Text style={{ color: c.muted, fontSize: Math.round(12 * fm), lineHeight: Math.round(17 * fm) }}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Failure({
  message,
  retry,
}: {
  message?: string;
  retry?: () => void;
}) {
  const c = usePalette();
  const fm = useFontMult();
  return message ? (
    <View
      accessibilityLiveRegion="polite"
      style={{
        gap: 8,
        borderWidth: 1,
        borderColor: c.danger,
        borderRadius: 8,
        padding: 12,
        backgroundColor: "transparent",
      }}
    >
      <Text style={{ color: c.danger, fontSize: Math.round(14 * fm), lineHeight: Math.round(20 * fm) }}>{message}</Text>
      {retry ? <Button title="Try again" onPress={retry} /> : null}
    </View>
  ) : null;
}

export function Loading() {
  const c = usePalette();
  return (
    <View style={{ padding: 30 }}>
      <ActivityIndicator accessibilityLabel="Loading" color={c.signal} />
    </View>
  );
}

export const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  section: { gap: 12 },
});
