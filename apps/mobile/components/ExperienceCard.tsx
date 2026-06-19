import { useTheme } from "@/lib/useTheme";
import { Ionicons } from "@expo/vector-icons";
import type { Experience } from "@lifelist/shared";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

export function ExperienceCard({ exp }: { exp: Experience }) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`View experience: ${exp.title}`}
      style={[styles.card, { borderRadius: radius.md, borderColor: colors.borderGlass }]}
      onPress={() => Linking.openURL(exp.bookingUrl)}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
          {exp.title}
        </Text>
        {exp.description ? (
          <Text style={[styles.desc, { color: colors.textSecondary }]} numberOfLines={2}>
            {exp.description}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={[styles.price, { color: colors.accent }]}>{exp.priceToken}</Text>
          {exp.rating != null ? (
            <View style={styles.rating}>
              <Ionicons name="star" size={12} color="#FBBF24" />
              <Text style={[styles.ratingText, { color: colors.textPrimary }]}>
                {exp.rating.toFixed(1)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    padding: 14,
    borderWidth: 1,
    marginBottom: 10,
  },
  title: { fontWeight: "700", fontSize: 15 },
  desc: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  price: { fontWeight: "800" },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText: { fontSize: 12, fontWeight: "600" },
});
