import { useTheme } from "@/lib/useTheme";
import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ItemDetail() {
  const { colors, type, space } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.canvas,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingHorizontal: space[4],
      }}
    >
      <Text style={[type.headingRegular, { color: colors.textPrimary }]}>Item {id}</Text>
    </View>
  );
}
