import { useHydrateItems } from "@/hooks/useHydrateItems";
import { useItemsRealtime } from "@/lib/realtime/useItemsRealtime";
import { useTheme } from "@/lib/useTheme";
import { Tabs } from "expo-router";

export default function TabsLayout() {
  const { colors } = useTheme();
  useHydrateItems();
  useItemsRealtime();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarStyle: { display: "none" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Lifelist" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
