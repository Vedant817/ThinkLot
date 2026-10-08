import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../components/ui";
export default function TabLayout() {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        lazy: true,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: c.paper,
          borderTopColor: c.line,
          height: 60 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.muted,
      }}
    >
      {(
        ["index", "ideas", "board", "review", "archive", "account"] as const
      ).map((name, i) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: ["Home", "Lot", "Board", "Review", "Archive", "Account"][i],
            tabBarIcon: ({ color }) => (
              <Text style={{ color, fontSize: 20 }}>
                {["◉", "≡", "▥", "✓", "▤", "○"][i]}
              </Text>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
