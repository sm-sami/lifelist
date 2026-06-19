import { ItemCard } from "@/components/ItemCard";
import { estimateItemHeight } from "@/lib/itemHeight";
import { useTheme } from "@/lib/useTheme";
import { type Item, useItems } from "@/store/items";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const GAP = 12;
const H_PADDING = 16;

export default function Dashboard() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors, type, shadow, palette } = useTheme();
  const router = useRouter();

  const items = useItems((s) => s.items);
  const status = useItems((s) => s.status);
  const refetch = useItems((s) => s.refetch);

  const columnWidth = (width - H_PADDING * 2) / 2;
  const cardWidth = columnWidth - GAP;

  const header = (
    <Text style={[type.displaySmall, { color: colors.textPrimary, marginBottom: 16 }]}>
      Your Lifelist
    </Text>
  );

  function renderBody() {
    if (status === "loading" && items.length === 0) {
      return (
        <View style={styles.stateCenter}>
          <ActivityIndicator color={colors.accent} />
          <Text style={[type.paraRegular, { color: colors.textSecondary, marginTop: 12 }]}>
            Loading your Lifelist…
          </Text>
        </View>
      );
    }

    if (status === "error" && items.length === 0) {
      return (
        <View style={styles.stateCenter}>
          <Text style={[type.headingSmall, { color: colors.textPrimary }]}>
            Couldn't load your Lifelist
          </Text>
          <Text
            style={[
              type.paraRegular,
              { color: colors.textSecondary, marginTop: 6, textAlign: "center" },
            ]}
          >
            Check your connection and try again.
          </Text>
          <Pressable
            onPress={refetch}
            style={[styles.retryBtn, { borderColor: colors.accent, borderRadius: 8 }]}
          >
            <Text style={[type.cta, { color: colors.accent }]}>Retry</Text>
          </Pressable>
        </View>
      );
    }

    if (status === "ready" && items.length === 0) {
      return (
        <View style={styles.stateCenter}>
          <Text style={[type.headingRegular, { color: colors.textPrimary }]}>
            Your Lifelist is empty
          </Text>
          <Text
            style={[
              type.paraRegular,
              { color: colors.textSecondary, marginTop: 6, textAlign: "center" },
            ]}
          >
            Tap + to add the first thing you want to do before you die.
          </Text>
        </View>
      );
    }

    return (
      <FlashList
        data={items}
        numColumns={2}
        keyExtractor={(item: Item) => item.id}
        ListHeaderComponent={header}
        showsVerticalScrollIndicator={false}
        masonry
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: H_PADDING,
          paddingBottom: insets.bottom + 100,
        }}
        refreshing={status === "loading" && items.length > 0}
        onRefresh={refetch}
        renderItem={({ item }: { item: Item }) => (
          <View style={{ marginHorizontal: GAP / 2, marginBottom: GAP }}>
            <ItemCard item={item} width={cardWidth} height={estimateItemHeight(item, cardWidth)} />
          </View>
        )}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {renderBody()}
      <Pressable
        onPress={() => router.push("/(protected)/modals/add-item")}
        accessibilityRole="button"
        accessibilityLabel="Add a Lifelist item"
        style={[
          styles.fab,
          {
            right: 20,
            bottom: insets.bottom + 80,
            backgroundColor: colors.accent,
            ...shadow.level3,
          },
        ]}
      >
        <Text style={{ color: palette.white, fontSize: 32, marginTop: -2 }}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stateCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderWidth: 1,
  },
  fab: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
});
