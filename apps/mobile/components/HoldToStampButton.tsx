import { useTheme } from "@/lib/useTheme";
import { Pressable, StyleSheet, Text } from "react-native";

interface Props {
  itemId: string;
  completed: boolean;
}

// Stub — frontend/005 will replace this with the animated hold-to-stamp control.
export function HoldToStampButton({ completed }: Props) {
  const { colors, radius } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={completed ? "Completed" : "Mark as complete"}
      style={[
        styles.btn,
        {
          borderRadius: radius.md,
          borderColor: completed ? colors.success : colors.borderGlass,
          backgroundColor: completed ? colors.successTint : "transparent",
        },
      ]}
    >
      <Text style={[styles.label, { color: completed ? colors.success : colors.textSecondary }]}>
        {completed ? "Completed ✓" : "Hold to complete"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    marginTop: 20,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  label: { fontSize: 15, fontWeight: "700" },
});
