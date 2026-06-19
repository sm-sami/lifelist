import type { DuplicateMatch } from "@/lib/api/items";
import { useTheme } from "@/lib/useTheme";
import { AlertCircle } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";

interface Props {
  match: DuplicateMatch;
  onViewExisting: (id: string) => void;
  onAddAnyway: () => void;
}

export function DuplicateAlertBanner({ match, onViewExisting, onAddAnyway }: Props) {
  const { colors, radius } = useTheme();
  return (
    <Animated.View
      entering={FadeInUp.springify()}
      exiting={FadeOutUp}
      style={[styles.banner, { borderRadius: radius.md }]}
    >
      <View style={styles.row}>
        <AlertCircle size={20} color={colors.danger} />
        <Text style={[styles.text, { color: colors.textPrimary }]}>
          Looks like <Text style={styles.bold}>"{match.title}"</Text> is already on your list{"  "}
          <Text style={[styles.sim, { color: colors.danger }]}>
            {Math.round(match.similarity * 100)}% match
          </Text>
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.btn, styles.ghost, { borderColor: colors.borderGlass }]}
          onPress={() => onViewExisting(match.id)}
        >
          <Text style={[styles.ghostText, { color: colors.textSecondary }]}>View existing</Text>
        </Pressable>
        <Pressable style={[styles.btn, { backgroundColor: colors.danger }]} onPress={onAddAnyway}>
          <Text style={styles.solidText}>Add anyway</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "rgba(248,113,113,0.12)",
    borderColor: "rgba(248,113,113,0.4)",
    borderWidth: 1,
    padding: 14,
    marginTop: 12,
    gap: 12,
  },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  text: { flex: 1, lineHeight: 20 },
  bold: { fontWeight: "700" },
  sim: { fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  ghost: { borderWidth: 1 },
  ghostText: { fontWeight: "600" },
  solidText: { color: "#fff", fontWeight: "700" },
});
