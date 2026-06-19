import { useTheme } from "@/lib/useTheme";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function Dashboard() {
  const { colors, type, space } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.canvas,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 88,
        paddingHorizontal: space[4],
      }}
    >
      <Text
        style={[type.headingLarge, { color: colors.textPrimary, marginTop: space[6] }]}
        accessibilityRole="header"
      >
        My Lifelist
      </Text>
    </View>
  );
}
