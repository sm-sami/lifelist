import "react-native-gesture-handler";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useBrandFonts } from "@/lib/fonts";
import { ThemeModeProvider, useTheme, useThemeMode } from "@/lib/useTheme";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SystemBars } from "react-native-edge-to-edge";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

function Shell() {
  const theme = useTheme();
  const { resolved } = useThemeMode();
  const { session, loading: authLoading } = useAuth();
  const [fontsLoaded, fontError] = useBrandFonts();
  const isAuthed = !!session;

  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.canvas }} />;
  }

  if (authLoading) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.canvas }} />;
  }

  const navTheme = resolved === "dark" ? DarkTheme : DefaultTheme;
  const nav = {
    ...navTheme,
    colors: {
      ...navTheme.colors,
      background: theme.colors.canvas,
      card: theme.colors.canvas,
    },
  };

  return (
    <ThemeProvider value={nav}>
      <StatusBar style={resolved === "dark" ? "light" : "dark"} />
      <SystemBars style={resolved === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.canvas },
        }}
      >
        <Stack.Protected guard={isAuthed}>
          <Stack.Screen name="(protected)" />
        </Stack.Protected>
        <Stack.Protected guard={!isAuthed}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Screen name="index" />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeModeProvider>
          <AuthProvider>
            <Shell />
          </AuthProvider>
        </ThemeModeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
