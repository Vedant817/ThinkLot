import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PropsWithChildren } from 'react';

export function usePalette() {
  return useColorScheme() === 'dark'
    ? { paper: '#171916', ink: '#F1F2E9', muted: '#A4ABA0', line: '#42483E', accent: '#FFD269', panel: '#242820', danger: '#FFAAA0' }
    : { paper: '#F5F6ED', ink: '#22281F', muted: '#5A6353', line: '#C4CBB8', accent: '#B05B00', panel: '#EBEEDF', danger: '#A72B26' };
}
export function Page({ children, scroll = true, safeTop = true }: PropsWithChildren<{ scroll?: boolean; safeTop?: boolean }>) {
  const c = usePalette(); const insets = useSafeAreaInsets();
  const content = scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: Math.max(insets.bottom, 20) + 24 }}>{children}</ScrollView> : children;
  return <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.paper, paddingTop: safeTop ? insets.top : 0 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{content}</KeyboardAvoidingView>;
}
export function Heading({ title, subtitle }: { title: string; subtitle?: string }) {
  const c = usePalette();
  return <View style={{ gap: 8, borderBottomWidth: 1, borderColor: c.line, paddingBottom: 18 }}><Text style={{ color: c.muted, fontSize: 12, letterSpacing: 2 }}>THINKLOT / FIELD LEDGER</Text><Text accessibilityRole="header" style={{ fontSize: 34, fontWeight: '700', color: c.ink }}>{title}</Text>{subtitle && <Text style={{ color: c.muted, fontSize: 15 }}>{subtitle}</Text>}</View>;
}
export function Label({ children }: PropsWithChildren) { const c = usePalette(); return <Text style={{ color: c.ink, fontSize: 17, fontWeight: '600' }}>{children}</Text>; }
export function Note({ children }: PropsWithChildren) { const c = usePalette(); return <Text style={{ color: c.muted, fontSize: 15, lineHeight: 22 }}>{children}</Text>; }
export function Button({ title, onPress, disabled, primary, danger }: { title: string; onPress: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }) {
  const c = usePalette();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: danger ? c.danger : c.line, backgroundColor: primary ? c.ink : c.panel, opacity: disabled ? .45 : pressed ? .7 : 1, justifyContent: 'center' })}><Text style={{ color: primary ? c.paper : danger ? c.danger : c.ink, fontSize: 15, fontWeight: '600' }}>{title}</Text></Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const c = usePalette();
  return <View style={{ gap: 7 }}><Text style={{ color: c.muted, fontSize: 13 }}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={c.muted} {...props} style={[{ minHeight: 48, color: c.ink, borderWidth: 1, borderColor: c.line, backgroundColor: c.panel, padding: 12, fontSize: 16, textAlignVertical: props.multiline ? 'top' : 'center' }, props.style]} /></View>;
}
export function Failure({ message, retry }: { message?: string; retry?: () => void }) { const c = usePalette(); return message ? <View accessibilityLiveRegion="polite" style={{ gap: 8, borderLeftWidth: 3, borderColor: c.danger, padding: 12 }}><Text style={{ color: c.danger }}>{message}</Text>{retry && <Button title="Try again" onPress={retry} />}</View> : null; }
export function Loading() { const c = usePalette(); return <View style={{ padding: 30 }}><ActivityIndicator accessibilityLabel="Loading" color={c.accent} /></View>; }
export const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, section: { gap: 12 } });
