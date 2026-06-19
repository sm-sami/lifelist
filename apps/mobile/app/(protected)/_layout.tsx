import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/useTheme";
import { Redirect, Stack } from "expo-router";

export default function ProtectedLayout() {
  const { session, loading } = useAuth();
  const { colors } = useTheme();

  if (!loading && !session) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="item/[id]" options={{ presentation: "card" }} />
      <Stack.Screen
        name="modals/add-item"
        options={{
          presentation: "transparentModal",
          animation: "none",
          contentStyle: { backgroundColor: "transparent" },
        }}
      />
    </Stack>
  );
}
