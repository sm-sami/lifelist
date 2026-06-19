import { ItemCard } from "@/components/ItemCard";
import { useMeData } from "@/hooks/useMeData";
import { useAuth } from "@/lib/auth";
import { estimateItemHeight } from "@/lib/itemHeight";
import { useTheme } from "@/lib/useTheme";
import { type Item, useItems } from "@/store/items";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const GAP = 12;
const H_PADDING = 16;

type StatusFilter = "all" | "active" | "completed";

function dicebearUrl(userId: string) {
  return `https://api.dicebear.com/9.x/thumbs/png?seed=${encodeURIComponent(userId)}&backgroundType=gradientLinear`;
}

export default function Dashboard() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors, type, shadow, palette } = useTheme();
  const router = useRouter();

  const items = useItems((s) => s.items);
  const status = useItems((s) => s.status);
  const refetch = useItems((s) => s.refetch);
  const { session } = useAuth();
  const meData = useMeData();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const columnWidth = (width - H_PADDING * 2) / 2;
  const cardWidth = columnWidth - GAP;

  const firstName = meData?.displayName ?? session?.user?.email?.split("@")[0] ?? "";
  const userId = session?.user?.id ?? "";
  const avatarSrc = meData?.avatarUrl ?? dicebearUrl(userId);

  const greeting = firstName ? `Welcome, ${firstName}` : "Welcome";
  const categories = useMemo(() => {
    const byId = new Map<string, NonNullable<Item["category"]>>();
    for (const item of items) {
      if (item.category) byId.set(item.category.id, item.category);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const statusMatches =
          statusFilter === "all" ||
          (statusFilter === "active"
            ? item.status === "active" || item.status === "pending_enrichment"
            : item.status === "completed");
        const categoryMatches = categoryFilter === "all" || item.categoryId === categoryFilter;
        return statusMatches && categoryMatches;
      }),
    [items, statusFilter, categoryFilter],
  );

  const header = (
    <View>
      <View style={styles.headerRow}>
        <View style={styles.dashHeader}>
          <Text style={[type.label, { color: colors.textSecondary }]}>YOUR LIFELIST</Text>
          <Text style={[type.displaySmall, { color: colors.textPrimary, marginTop: 4 }]}>
            {greeting}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push("/(protected)/(tabs)/profile")}
          accessibilityRole="button"
          accessibilityLabel="Open profile and settings"
          hitSlop={8}
          style={[
            styles.profileButton,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderGlass,
            },
          ]}
        >
          <Image
            source={{ uri: avatarSrc }}
            style={styles.profileAvatar}
            contentFit="cover"
            transition={150}
            accessibilityLabel="Your avatar"
          />
        </Pressable>
      </View>
      <View style={styles.filterBlock}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.filterRow}>
            {(
              [
                ["all", "All"],
                ["active", "Active"],
                ["completed", "Done"],
              ] as const
            ).map(([value, label]) => {
              const selected = statusFilter === value;
              return (
                <Pressable
                  key={value}
                  onPress={() => setStatusFilter(value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: selected ? colors.accent : colors.surfaceGlass,
                      borderColor: selected ? colors.accent : colors.borderGlass,
                    },
                  ]}
                >
                  <Text
                    style={[type.tag, { color: selected ? palette.white : colors.textPrimary }]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        {categories.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.filterRow}>
              <Pressable
                onPress={() => setCategoryFilter("all")}
                accessibilityRole="button"
                accessibilityState={{ selected: categoryFilter === "all" }}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor:
                      categoryFilter === "all" ? colors.surfaceTint : colors.surfaceGlass,
                    borderColor: categoryFilter === "all" ? colors.accentText : colors.borderGlass,
                  },
                ]}
              >
                <Text style={[type.tag, { color: colors.textPrimary }]}>All categories</Text>
              </Pressable>
              {categories.map((category) => {
                const selected = categoryFilter === category.id;
                return (
                  <Pressable
                    key={category.id}
                    onPress={() => setCategoryFilter(category.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: selected ? colors.surfaceTint : colors.surfaceGlass,
                        borderColor: selected ? colors.accentText : colors.borderGlass,
                      },
                    ]}
                  >
                    <Text style={[type.tag, { color: colors.textPrimary }]}>{category.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : null}
      </View>
    </View>
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
              {
                color: colors.textSecondary,
                marginTop: 6,
                textAlign: "center",
              },
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
              {
                color: colors.textSecondary,
                marginTop: 6,
                textAlign: "center",
              },
            ]}
          >
            Tap + to add to your lifelist
          </Text>
        </View>
      );
    }

    return (
      <FlashList
        data={filteredItems}
        numColumns={2}
        keyExtractor={(item: Item) => item.id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <View style={styles.filteredEmpty}>
            <Text style={[type.headingSmall, { color: colors.textPrimary }]}>Nothing here yet</Text>
            <Text style={[type.label, { color: colors.textSecondary, marginTop: 6 }]}>
              Try changing the filters.
            </Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
        masonry
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: H_PADDING,
          paddingBottom: insets.bottom + 88,
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
            bottom: insets.bottom + 20,
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
  dashHeader: {
    flex: 1,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  profileAvatar: { width: "100%", height: "100%" },
  filterBlock: {
    gap: 8,
    marginBottom: 16,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filteredEmpty: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
});
