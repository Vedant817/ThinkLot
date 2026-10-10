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
import { useState, type PropsWithChildren } from "react";

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
export type Palette = ReturnType<typeof usePalette>;

export function usePalette() {
  const dark = useColorScheme() === "dark";
  return dark
    ? {
        /*
         * Dark — soft slate, not near-black.
         *
         * These were pure near-neutrals (#0e0e11 paper, #f4f4f1 ink), which read as
         * "contrast dialled to maximum": the surface went almost to black and the
         * text to almost white, so every screen looked like a screenshot of a
         * terminal. A device run flagged it as "too black, very contrasted".
         *
         * The fix is a single consistent cast rather than a lightened black: paper
         * is lifted to a slate that still sits unambiguously behind the content,
         * every surface is desaturated towards blue-grey (cooler in both senses -
         * lower temperature and calmer), and the ink tokens are dimmed slightly so
         * text reads against the page rather than punching through it.
         *
         * Contrast is the constraint, so it is measured rather than eyeballed:
         * `scripts/verify-theme-contrast.ts` asserts every ink token clears WCAG AA
         * on paper, panel and sunk. Softening a dark theme by hand is the easiest
         * way to quietly break that, which is why it is a gate rather than a note.
         */
        paper: "#171920",
        panel: "#1f232b",
        sunk: "#1c2027",
        line: "#343944",
        lineStrong: "#737b8b",
        ink: "#e8eaf0",
        ink2: "#a8aebc",
        muted: "#8b93a3",
        signal: "#8b7cf6",
        signalInk: "#16121f",
        signalSoft: "#232038",
        lot: "#f0b429",
        lotSoft: "#2e2413",
        ok: "#46b981",
        good: "#4ade80",
        danger: "#f87171",
      }
    : {
        paper: "#ffffff",
        panel: "#f6f6f4",
        sunk: "#eeeeeb",
        line: "#e4e4de",
        lineStrong: "#85857d",
        ink: "#141418",
        ink2: "#55554f",
        // 4.618:1 on --sunk, measured. The web token was darkened from #6f6f68
        // because it failed AA on that surface; keeping the same value here
        // keeps the two clients honest about it.
        muted: "#6b6b64",
        signal: "#5b4bdb",
        signalInk: "#ffffff",
        signalSoft: "#eeecfd",
        lot: "#8a5300",
        lotSoft: "#fdf1dc",
        ok: "#0f6b45",
        good: "#1c6b3a",
        danger: "#a81f14",
      };
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
  return (
    <View style={{ gap: 6 }}>
      <Text
        accessibilityRole="header"
        style={{ fontSize: 26, lineHeight: 30, fontWeight: "700", color: c.ink }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ color: c.ink2, fontSize: 14, lineHeight: 20 }}>{subtitle}</Text>
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
  return (
    <Text
      style={{
        color: c.muted,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: "600",
      }}
    >
      {children}
    </Text>
  );
}

export function Note({ children }: PropsWithChildren) {
  const c = usePalette();
  return (
    <Text style={{ color: c.ink2, fontSize: 15, lineHeight: 22 }}>{children}</Text>
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
  return (
    <Text
      style={{
        color: c.lot,
        backgroundColor: c.lotSoft,
        fontFamily: mono,
        fontSize: 12,
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
          fontSize: compact ? 13 : 15,
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
            fontSize: 16,
            textAlignVertical: props.multiline ? "top" : "center",
          },
          props.style,
        ]}
      />
      {hint ? (
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{hint}</Text>
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
      <Text style={{ color: c.danger, fontSize: 14, lineHeight: 20 }}>{message}</Text>
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
