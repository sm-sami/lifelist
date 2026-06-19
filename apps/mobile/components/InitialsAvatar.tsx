import { useTheme } from "@/lib/useTheme";
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

interface Props {
  avatarUrl?: string | null;
  displayName?: string | null;
  size: number;
}

export function InitialsAvatar({ avatarUrl, displayName, size }: Props) {
  const { colors } = useTheme();

  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={200}
        accessibilityLabel="Your avatar"
      />
    );
  }

  const initials = getInitials(displayName ?? "");
  const fontSize = Math.round(size * 0.38);

  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.accentDim,
        },
      ]}
    >
      <Text style={[styles.text, { fontSize, color: colors.accentText }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { fontWeight: "700", includeFontPadding: false },
});
