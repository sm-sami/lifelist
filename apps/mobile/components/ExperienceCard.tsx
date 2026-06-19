import { useTheme } from "@/lib/useTheme";
import type { Experience } from "@lifelist/shared";
import { ArrowUpRight, Star, Ticket } from "lucide-react-native";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

export function ExperienceCard({ exp }: { exp: Experience }) {
  const { colors, radius, shadow, type } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`View experience: ${exp.title}`}
      style={({ pressed }) => [
        styles.card,
        shadow.level1,
        {
          backgroundColor: colors.surfaceGlass,
          borderColor: colors.borderGlass,
          borderRadius: radius.lg,
          opacity: pressed ? 0.78 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}
      onPress={() => Linking.openURL(exp.bookingUrl)}
    >
      <View
        style={[
          styles.icon,
          {
            borderRadius: radius.md,
            backgroundColor: colors.surfaceTint,
            borderColor: colors.borderGlass,
          },
        ]}
      >
        <Ticket size={19} color={colors.accent} strokeWidth={2.2} />
      </View>

      <View style={styles.content}>
        <Text
          style={[type.headingSmall, styles.title, { color: colors.textPrimary }]}
          numberOfLines={2}
        >
          {exp.title}
        </Text>
        {exp.description ? (
          <Text
            style={[type.label, styles.desc, { color: colors.textSecondary }]}
            numberOfLines={2}
          >
            {exp.description}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={[type.tag, styles.price, { color: colors.accentText }]}>
            {exp.priceToken}
          </Text>
          {exp.rating != null ? (
            <View style={styles.rating}>
              <Star size={12} color="#FBBF24" fill="#FBBF24" />
              <Text style={[styles.ratingText, { color: colors.textPrimary }]}>
                {exp.rating.toFixed(1)}
              </Text>
            </View>
          ) : null}
          <View style={styles.provider}>
            <ArrowUpRight size={14} color={colors.textSecondary} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: { flex: 1, minWidth: 0 },
  title: { lineHeight: 21 },
  desc: { marginTop: 4 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
  },
  price: { fontWeight: "700" },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText: { fontSize: 12, fontWeight: "600" },
  provider: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
});
