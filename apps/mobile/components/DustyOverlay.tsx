import { useTheme } from "@/lib/useTheme";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";

const GRAIN = require("@/assets/textures/grain.png");

export function DustyOverlay({ radius }: { radius?: number }) {
  const { radius: r, colors } = useTheme();
  const br = radius ?? r.lg;
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: br, overflow: "hidden" }]}
    >
      <Image
        source={GRAIN}
        style={[StyleSheet.absoluteFill, { opacity: 0.08 }]}
        contentFit="cover"
      />
      <LinearGradient
        colors={["transparent", colors.scrim]}
        start={{ x: 0.5, y: 0.35 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
