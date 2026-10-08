import { Feather } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePalette } from "../../components/ui";

/**
 * Tab navigation.
 *
 * Two fixes here, both visible in a screenshot.
 *
 * ACTIVE TAB WAS AMBER
 *
 * `tabBarActiveTintColor` was the palette's `accent`, which in the old palette
 * was the same rust orange now used for LOT plates. Amber is reserved for "a
 * number you need to read" - plates and priority scores. Spending it on the
 * active tab meant the strongest colour in the app pointed at navigation rather
 * than at data. Violet is the navigation/action colour, so the active tab is
 * violet, and the plate is the only amber thing on the screen.
 *
 * THE ICONS WERE UNICODE GLYPHS
 *
 * "◉ ≡ ▥ ✓ ▤ ○" rendered at wildly inconsistent optical weights - the ✓ is far
 * heavier than the ○ next to it - and ◉/○ for Home and Account are not
 * metaphors, they are just circles. Feather is a single thin-stroke geometric
 * set, so every icon carries the same visual weight, and each one is a thing:
 * home, a list, a board of columns, a revisit, an archive, a person.
 */
const TABS = [
  { name: "index", title: "Home", icon: "home" },
  { name: "ideas", title: "Lot", icon: "list" },
  { name: "board", title: "Board", icon: "grid" },
  { name: "review", title: "Review", icon: "refresh-cw" },
  { name: "archive", title: "Archive", icon: "archive" },
  { name: "account", title: "Account", icon: "user" },
] as const;

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
          borderTopWidth: 1,
          height: 58 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 8,
        },
        tabBarActiveTintColor: c.signal,
        tabBarInactiveTintColor: c.muted,
        tabBarLabelStyle: { fontSize: 11, letterSpacing: 0.2 },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarAccessibilityLabel: tab.title,
            tabBarIcon: ({ color, focused }) => (
              <Feather name={tab.icon} size={20} color={color} strokeWidth={focused ? 2.4 : 1.8} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
