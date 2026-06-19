import { InitialsAvatar } from "@/components/InitialsAvatar";
import { ItemCard } from "@/components/ItemCard";
import { FilterEmptyIllustration } from "@/components/SheetIllustration";
import { useMeData } from "@/hooks/useMeData";
import { useAuth } from "@/lib/auth";
import { estimateItemHeight } from "@/lib/itemHeight";
import { useTheme } from "@/lib/useTheme";
import { type Item, useItems } from "@/store/items";
import { FlashList } from "@shopify/flash-list";
import { useRouter } from "expo-router";
import { Search, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const GAP = 12;
const H_PADDING = 16;

type StatusFilter = "all" | "active" | "completed";

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
  const [searchQuery, setSearchQuery] = useState("");

  const columnWidth = (width - H_PADDING * 2) / 2;
  const cardWidth = columnWidth - GAP;

  const firstName = meData?.displayName ?? session?.user?.email?.split("@")[0] ?? "";

  const greeting = firstName ? `Welcome, ${firstName}` : "Welcome";
  const categories = useMemo(() => {
    const byId = new Map<string, NonNullable<Item["category"]>>();
    for (const item of items) {
      if (item.category) byId.set(item.category.id, item.category);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);
  const filteredItems = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const statusMatches =
        statusFilter === "all" ||
        (statusFilter === "active"
          ? item.status === "active" || item.status === "pending_enrichment"
          : item.status === "completed");
      const categoryMatches = categoryFilter === "all" || item.categoryId === categoryFilter;
      const searchMatches =
        !needle ||
        item.title.toLowerCase().includes(needle) ||
        item.category?.name.toLowerCase().includes(needle) ||
        item.notes?.toLowerCase().includes(needle);
      return statusMatches && categoryMatches && searchMatches;
    });
  }, [items, statusFilter, categoryFilter, searchQuery]);

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
        >
          <InitialsAvatar avatarUrl={meData?.avatarUrl} displayName={firstName} size={44} />
        </Pressable>
      </View>
      <View style={styles.filterBlock}>
        <View
          style={[
            styles.statusSegment,
            {
              backgroundColor: colors.surfaceGlass,
              borderColor: colors.borderGlass,
            },
          ]}
        >
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
                onPress={() => {
                  if (statusFilter !== value) setStatusFilter(value);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[
                  styles.statusSegmentItem,
                  { backgroundColor: selected ? colors.accent : "transparent" },
                ]}
              >
                <Text style={[type.cta, { color: selected ? palette.white : colors.textPrimary }]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View
          style={[
            styles.searchBox,
            {
              backgroundColor: colors.surfaceGlass,
              borderColor: colors.borderGlass,
            },
          ]}
        >
          <Search size={17} color={colors.textSecondary} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search your lifelist"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            autoCorrect={false}
            style={[type.paraRegular, styles.searchInput, { color: colors.textPrimary }]}
          />
          {searchQuery ? (
            <Pressable
              onPress={() => setSearchQuery("")}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={8}
            >
              <X size={17} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        {categories.length > 0 ? (
          <View style={styles.categoryBlock}>
            <Text style={[type.tag, styles.categoryLabel, { color: colors.textSecondary }]}>
              CATEGORIES
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.categoryRow}>
                <Pressable
                  onPress={() => {
                    if (categoryFilter !== "all") setCategoryFilter("all");
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: categoryFilter === "all" }}
                  style={[
                    styles.categoryChip,
                    {
                      backgroundColor:
                        categoryFilter === "all" ? colors.surfaceTint : "transparent",
                      borderColor:
                        categoryFilter === "all" ? colors.accentText : colors.borderGlass,
                    },
                  ]}
                >
                  <Text
                    style={[
                      type.tag,
                      {
                        color: categoryFilter === "all" ? colors.accentText : colors.textSecondary,
                      },
                    ]}
                  >
                    All
                  </Text>
                </Pressable>
                {categories.map((category) => {
                  const selected = categoryFilter === category.id;
                  return (
                    <Pressable
                      key={category.id}
                      onPress={() => {
                        if (categoryFilter !== category.id) setCategoryFilter(category.id);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[
                        styles.categoryChip,
                        {
                          backgroundColor: selected ? colors.surfaceTint : "transparent",
                          borderColor: selected ? colors.accentText : colors.borderGlass,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          type.tag,
                          { color: selected ? colors.accentText : colors.textSecondary },
                        ]}
                      >
                        {category.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>
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
      <View style={styles.listShell}>
        <View
          style={[
            styles.fixedHeader,
            {
              paddingTop: insets.top + 12,
              paddingHorizontal: H_PADDING,
            },
          ]}
        >
          {header}
        </View>
        <FlashList
          key={`${statusFilter}:${categoryFilter}`}
          data={filteredItems}
          numColumns={2}
          keyExtractor={(item: Item) => item.id}
          ListEmptyComponent={
            <View style={styles.filteredEmpty}>
              <FilterEmptyIllustration />
              <Text style={[type.headingSmall, { color: colors.textPrimary, marginTop: 16 }]}>
                Nothing here yet
              </Text>
              <Text style={[type.label, { color: colors.textSecondary, marginTop: 6 }]}>
                Try changing the search or filters.
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
          masonry
          contentContainerStyle={{
            paddingHorizontal: H_PADDING,
            paddingBottom: insets.bottom + 88,
          }}
          refreshing={status === "loading" && items.length > 0}
          onRefresh={refetch}
          renderItem={({ item }: { item: Item }) => (
            <View style={{ marginHorizontal: GAP / 2, marginBottom: GAP }}>
              <ItemCard
                item={item}
                width={cardWidth}
                height={estimateItemHeight(item, cardWidth)}
              />
            </View>
          )}
        />
      </View>
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
  listShell: {
    flex: 1,
  },
  fixedHeader: {
    flexShrink: 0,
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
  filterBlock: {
    gap: 10,
    marginBottom: 16,
  },
  statusSegment: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 999,
    padding: 4,
  },
  statusSegmentItem: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBox: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 0,
  },
  categoryBlock: {
    gap: 7,
  },
  categoryLabel: {
    letterSpacing: 1.2,
    paddingLeft: 2,
  },
  categoryRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 8,
  },
  categoryChip: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  filteredEmpty: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
});
