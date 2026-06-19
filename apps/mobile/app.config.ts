import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Lifelist",
  slug: "lifelist",
  scheme: "lifelist",
  sdkVersion: "56.0.0",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  plugins: ["expo-router", "react-native-edge-to-edge"],
  ios: { supportsTablet: true, bundleIdentifier: "com.lifelist.app" },
  android: {
    package: "com.lifelist.app",
    // @ts-expect-error: edgeToEdgeEnabled is valid in SDK 56 but not yet in the bundled types
    edgeToEdgeEnabled: true,
    navigationBar: { barStyle: "light-content", backgroundColor: "#00000000" },
  },
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  },
};

export default config;
