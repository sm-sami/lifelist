import type { DuplicateMatch } from "@/lib/api/items";
import { useTheme } from "@/lib/useTheme";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";

interface Props {
  match: DuplicateMatch;
  onViewExisting: (id: string) => void;
  onAddAnyway: () => void;
}

export function DuplicateAlertBanner({ match, onViewExisting, onAddAnyway }: Props) {
  const { colors, palette, radius, type } = useTheme();
  const similarity = Math.round(match.similarity * 100);

  return (
    <Animated.View
      entering={FadeInUp.springify()}
      exiting={FadeOutUp}
      style={[
        styles.banner,
        {
          backgroundColor: colors.surfaceGlass,
          borderColor: colors.borderGlass,
          borderRadius: radius.lg,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.copy}>
          <View style={styles.titleRow}>
            <Text style={[type.headingSmall, { color: colors.textPrimary }]}>
              Already on your list
            </Text>
            <View
              style={[
                styles.matchPill,
                {
                  backgroundColor: colors.surfaceTint,
                  borderColor: colors.borderGlass,
                  borderRadius: radius.pill,
                },
              ]}
            >
              <Text style={[type.tag, { color: colors.accentText }]}>{similarity}% match</Text>
            </View>
          </View>
          <Text style={[type.label, styles.text, { color: colors.textSecondary }]}>
            “{match.title}” looks very similar to this one.
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[
            styles.btn,
            styles.primary,
            {
              backgroundColor: colors.accent,
              borderRadius: radius.md,
            },
          ]}
          onPress={() => onViewExisting(match.id)}
        >
          <Text style={[type.cta, { color: palette.white }]}>View existing</Text>
        </Pressable>
        <Pressable
          style={[
            styles.btn,
            styles.secondary,
            {
              borderColor: colors.borderGlass,
              borderRadius: radius.md,
            },
          ]}
          onPress={onAddAnyway}
        >
          <Text style={[type.cta, { color: colors.textSecondary }]}>Add anyway</Text>
        </Pressable>
      </View>
      <Text style={[type.tag, styles.footnote, { color: colors.textSecondary }]}>
        You can still add it if this is meaningfully different.
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    padding: 14,
    marginTop: 14,
    gap: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  copy: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  matchPill: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  text: {
    marginTop: 5,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: {
    flex: 1.1,
  },
  secondary: {
    flex: 0.9,
    borderWidth: 1,
  },
  footnote: {
    lineHeight: 15,
  },
});
