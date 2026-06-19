import { useTheme } from "@/lib/useTheme";
import { useThemeMode } from "@/lib/useTheme";
import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";

interface GlassContainerProps {
  children: ReactNode;
  style?: ViewStyle;
  intensity?: number;
  radius?: number;
  /** Disable live blur (e.g. inside long lists) → cheaper translucent fill. */
  staticFallback?: boolean;
}

export function GlassContainer({
  children,
  style,
  intensity = 30,
  radius,
  staticFallback = false,
}: GlassContainerProps) {
  const { colors, radius: r, shadow, spacing } = useTheme();
  const { resolved } = useThemeMode();
  const br = radius ?? r.lg;
  const useLiveBlur = Platform.OS === "ios" && !staticFallback;

  return (
    <View style={[shadow.level2, { borderRadius: br, backgroundColor: "transparent" }, style]}>
      <View
        style={{
          flex: 1,
          overflow: "hidden",
          borderRadius: br,
          backgroundColor: colors.surfaceGlass,
        }}
      >
        {useLiveBlur ? (
          <BlurView
            tint={resolved === "dark" ? "dark" : "light"}
            intensity={intensity}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceGlass }]} />
        )}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: br, borderWidth: 1, borderColor: colors.borderGlass },
          ]}
        />
        <View style={{ flex: 1, padding: spacing(4) }}>{children}</View>
      </View>
    </View>
  );
}
