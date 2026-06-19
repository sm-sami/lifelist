import { useTheme } from "@/lib/useTheme";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function AddItemModal() {
  const { colors, type, space, radius } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "flex-end" }}>
      <View
        style={{
          backgroundColor: colors.surface,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          paddingTop: space[4],
          paddingBottom: insets.bottom + space[4],
          paddingHorizontal: space[4],
          minHeight: 200,
        }}
      >
        <Text
          style={[type.headingRegular, { color: colors.textPrimary, marginBottom: space[4] }]}
          accessibilityRole="header"
        >
          Add to your Lifelist
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Text style={[type.cta, { color: colors.accentText }]}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}
