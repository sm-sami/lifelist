import { ChangePhotoButton } from "@/components/ChangePhotoButton";
import { ExperienceCard } from "@/components/ExperienceCard";
import { HoldToStampButton } from "@/components/HoldToStampButton";
import { ParallaxScrollView } from "@/components/ParallaxScrollView";
import { useExperiences } from "@/hooks/useExperiences";
import { useTheme } from "@/lib/useTheme";
import { useItem, useItemsStore } from "@/store/items";
import { Ionicons } from "@expo/vector-icons";
import BottomSheet, { BottomSheetFlatList, BottomSheetView } from "@gorhom/bottom-sheet";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Resolve = "loading" | "ready" | "notfound" | "error";

export default function ItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, radius } = useTheme();
  const item = useItem(id);
  const fetchItemById = useItemsStore((s) => s.fetchItemById);
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["18%", "85%"], []);

  const [resolve, setResolve] = useState<Resolve>(item ? "ready" : "loading");
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setResolve("loading");
    const res = await fetchItemById(id);
    if (generation !== loadGeneration.current) return;
    if (res.kind === "ok") setResolve("ready");
    else if (res.kind === "not_found") setResolve("notfound");
    else setResolve("error");
  }, [id, fetchItemById]);

  useEffect(() => {
    if (item) {
      setResolve("ready");
      return;
    }
    void load();
    return () => {
      loadGeneration.current++;
    };
  }, [item, load]);

  const {
    experiences,
    loading: expLoading,
    error: expError,
  } = useExperiences(item?.experienceSearchQuery ?? item?.title ?? "", item?.experienceLocation);

  const isCompleted = item?.status === "completed";

  const gradient = useMemo<readonly [string, string]>(
    () => [
      item?.category?.gradientStart ?? colors.accentDim,
      item?.category?.gradientEnd ?? colors.canvas,
    ],
    [item, colors],
  );

  if (!item && resolve === "loading") {
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!item && resolve === "error") {
    return (
      <View style={[styles.center, styles.notFound, { backgroundColor: colors.canvas }]}>
        <Ionicons name="cloud-offline" size={40} color={colors.textSecondary} />
        <Text style={[styles.notFoundTitle, { color: colors.textPrimary }]}>
          Couldn't load this item
        </Text>
        <Text style={[styles.notFoundSub, { color: colors.textSecondary }]}>
          Check your connection and try again.
        </Text>
        <View style={styles.errActions}>
          <Pressable
            onPress={load}
            accessibilityRole="button"
            accessibilityLabel="Retry loading item"
            style={[styles.notFoundBtn, { borderColor: colors.accent, borderRadius: radius.md }]}
          >
            <Text style={[styles.notFoundBtnText, { color: colors.accent }]}>Retry</Text>
          </Pressable>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={[
              styles.notFoundBtn,
              { borderColor: colors.borderGlass, borderRadius: radius.md },
            ]}
          >
            <Text style={[styles.notFoundBtnText, { color: colors.textSecondary }]}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!item) {
    return (
      <View style={[styles.center, styles.notFound, { backgroundColor: colors.canvas }]}>
        <Ionicons name="search" size={40} color={colors.textSecondary} />
        <Text style={[styles.notFoundTitle, { color: colors.textPrimary }]}>Item not found</Text>
        <Text style={[styles.notFoundSub, { color: colors.textSecondary }]}>
          This Lifelist item may have been removed.
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={[styles.notFoundBtn, { borderColor: colors.accent, borderRadius: radius.md }]}
        >
          <Text style={[styles.notFoundBtnText, { color: colors.accent }]}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ParallaxScrollView
        imageUrl={item.imageUrl}
        gradient={gradient}
        headerOverlay={
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={[styles.back, { top: insets.top + 8 }]}
          >
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
        }
      >
        {item.category?.name ? (
          <Text style={[styles.chip, { color: colors.accent }]}>
            {item.category.name.toUpperCase()}
          </Text>
        ) : null}
        <Text style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
        {item.notes ? (
          <Text style={[styles.notes, { color: colors.textSecondary }]}>{item.notes}</Text>
        ) : null}

        {item.imageUrl && item.imageAttribution ? (
          <Text style={[styles.attribution, { color: colors.textSecondary }]}>
            {"Photo by "}
            {item.imageAttributionUrl ? (
              <Text
                style={[styles.attributionLink, { color: colors.accentText }]}
                onPress={() => Linking.openURL(item.imageAttributionUrl!)}
                accessibilityRole="link"
                accessibilityLabel={`Photo by ${item.imageAttribution} on Unsplash`}
              >
                {item.imageAttribution}
              </Text>
            ) : (
              <Text style={styles.attributionName}>{item.imageAttribution}</Text>
            )}
            {" on Unsplash"}
          </Text>
        ) : null}

        <ChangePhotoButton itemId={item.id} />

        <HoldToStampButton itemId={item.id} completed={isCompleted} />

        <Text style={[styles.section, { color: colors.textPrimary }]}>Make it happen</Text>
        <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>
          Live experiences from Headout
        </Text>
        <View style={{ height: 380 }} />
      </ParallaxScrollView>

      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={[
          styles.sheetBg,
          {
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
          },
        ]}
        handleIndicatorStyle={{ backgroundColor: colors.borderGlass }}
      >
        <BottomSheetView style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>Experiences</Text>
        </BottomSheetView>
        {expLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : expError || experiences.length === 0 ? (
          <View style={styles.center}>
            <Text style={[styles.empty, { color: colors.textSecondary }]}>
              No live experiences right now.
            </Text>
          </View>
        ) : (
          <BottomSheetFlatList
            data={experiences}
            keyExtractor={(e, i) => `${e.bookingUrl}-${i}`}
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
            renderItem={({ item: exp }) => <ExperienceCard exp={exp} />}
          />
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  notFound: { paddingHorizontal: 32, gap: 10 },
  notFoundTitle: { fontSize: 20, fontWeight: "800", marginTop: 8 },
  notFoundSub: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  notFoundBtn: { marginTop: 12, paddingHorizontal: 22, paddingVertical: 12, borderWidth: 1 },
  notFoundBtnText: { fontSize: 15, fontWeight: "700" },
  errActions: { flexDirection: "row", gap: 12, marginTop: 12 },
  back: {
    position: "absolute",
    left: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  chip: { fontWeight: "800", fontSize: 11, letterSpacing: 1.4, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: "800", lineHeight: 34 },
  notes: { fontSize: 15, lineHeight: 22, marginTop: 12 },
  attribution: { fontSize: 12, lineHeight: 16, marginTop: 12 },
  attributionName: { fontWeight: "600" },
  attributionLink: { fontWeight: "600", textDecorationLine: "underline" },
  section: { fontSize: 18, fontWeight: "800", marginTop: 28 },
  sectionSub: { fontSize: 13, marginTop: 4 },
  sheetBg: {},
  sheetHeader: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  sheetTitle: { fontSize: 16, fontWeight: "800" },
  empty: {},
});
