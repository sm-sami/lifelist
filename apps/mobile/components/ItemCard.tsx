import { useTheme } from "@/lib/useTheme";
import type { Item } from "@/store/items";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { DustyOverlay } from "./DustyOverlay";
import { GlassContainer } from "./GlassContainer";

export function ItemCard({ item, width, height }: { item: Item; width: number; height: number }) {
  const router = useRouter();
  const { colors, radius, type, palette } = useTheme();
  const isPending = item.status === "pending_enrichment";

  const g: [string, string] =
    item.category?.gradientStart && item.category?.gradientEnd
      ? [item.category.gradientStart, item.category.gradientEnd]
      : [colors.accentDim, colors.canvas];

  if (isPending) {
    return (
      <View style={{ width, height }}>
        <GlassContainer staticFallback style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: colors.surfaceTint, borderRadius: radius.md }} />
        </GlassContainer>
      </View>
    );
  }

  return (
    <Pressable
      style={{ width, height }}
      onPress={() => router.push(`/item/${item.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${item.status === "completed" ? ", completed" : ""}`}
    >
      <View style={{ flex: 1, overflow: "hidden", borderRadius: radius.lg }}>
        <LinearGradient colors={g} style={StyleSheet.absoluteFill} />
        {item.imageUrl ? (
          <Image
            source={{ uri: item.imageUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={300}
          />
        ) : null}
        <DustyOverlay radius={radius.lg} />
        <LinearGradient colors={["transparent", colors.scrim]} style={styles.scrim} />
        <View style={styles.meta}>
          {item.category?.name ? (
            <Text style={[type.tag, { color: colors.candyText, marginBottom: 4 }]}>
              {item.category.name.toUpperCase()}
            </Text>
          ) : null}
          <Text style={[type.headingSmall, { color: palette.white }]} numberOfLines={3}>
            {item.title}
          </Text>
        </View>
        {item.status === "completed" ? (
          <View style={[styles.stamp, { borderColor: colors.success }]}>
            <Text style={[type.tag, { color: colors.success }]}>DONE</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "55%" },
  meta: { position: "absolute", left: 12, right: 12, bottom: 12 },
  stamp: {
    position: "absolute",
    top: 10,
    right: 10,
    transform: [{ rotate: "-12deg" }],
    borderWidth: 2,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});
