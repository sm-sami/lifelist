import { ExperienceCard } from "@/components/ExperienceCard";
import { HoldToStampButton } from "@/components/HoldToStampButton";
import { ParallaxScrollView } from "@/components/ParallaxScrollView";
import { EmptyIllustration, ErrorIllustration } from "@/components/SheetIllustration";
import { useExperiences } from "@/hooks/useExperiences";
import { useTheme } from "@/lib/useTheme";
import { useItem, useItemsStore } from "@/store/items";
import BottomSheet, {
  BottomSheetFlatList,
  BottomSheetView,
  useBottomSheetSpringConfigs,
} from "@gorhom/bottom-sheet";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, CloudOff, Search } from "lucide-react-native";
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
  const sheetAnimation = useBottomSheetSpringConfigs({
    damping: 30,
    stiffness: 150,
    mass: 1,
    overshootClamping: true,
  });

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
    refetch: refetchExp,
  } = useExperiences(item?.experienceSearchQuery ?? item?.title ?? "", item?.experienceLocation);

  const isCompleted = item?.status === "completed";

  const gradient = useMemo<readonly [string, string]>(
    () => [
      item?.category?.gradientStart ?? colors.accentDim,
      item?.category?.gradientEnd ?? colors.canvas,
    ],
    [item, colors],
  );

  const experienceHeader = (
    <View style={styles.sheetHeader}>
      <View style={styles.sheetHeadingRow}>
        <View style={styles.sheetHeadingCopy}>
          <Text style={[styles.sheetEyebrow, { color: colors.accentText }]}>MAKE IT HAPPEN</Text>
          <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>Experiences</Text>
        </View>
        {!expLoading && !expError && experiences.length > 0 ? (
          <View
            style={[
              styles.resultCount,
              {
                backgroundColor: colors.surfaceTint,
                borderRadius: radius.pill,
              },
            ]}
          >
            <Text style={[styles.resultCountText, { color: colors.accentText }]}>
              {experiences.length}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.sheetSubtitle, { color: colors.textSecondary }]}>
        Bookable options from Headout
      </Text>
    </View>
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
        <CloudOff size={40} color={colors.textSecondary} />
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
        <Search size={40} color={colors.textSecondary} />
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
            <ChevronLeft size={24} color="#fff" />
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

        <HoldToStampButton itemId={item.id} completed={isCompleted} />

        <View style={{ height: 380 }} />
      </ParallaxScrollView>

      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        animationConfigs={sheetAnimation}
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
        {expLoading ? (
          <BottomSheetView style={styles.sheetState}>
            {experienceHeader}
            <View style={styles.sheetCenter}>
              <ActivityIndicator color={colors.accent} />
            </View>
          </BottomSheetView>
        ) : expError ? (
          <BottomSheetView style={styles.sheetState}>
            {experienceHeader}
            <View style={styles.sheetCenter}>
              <ErrorIllustration />
              <Text style={[styles.empty, { color: colors.textSecondary, marginTop: 16 }]}>
                Couldn't load experiences.
              </Text>
              <Pressable
                onPress={refetchExp}
                accessibilityRole="button"
                accessibilityLabel="Retry loading experiences"
                style={[styles.expRetry, { borderColor: colors.accent, borderRadius: radius.md }]}
              >
                <Text style={[styles.expRetryText, { color: colors.accent }]}>Retry</Text>
              </Pressable>
            </View>
          </BottomSheetView>
        ) : experiences.length === 0 ? (
          <BottomSheetView style={styles.sheetState}>
            {experienceHeader}
            <View style={styles.sheetCenter}>
              <EmptyIllustration />
              <Text style={[styles.empty, { color: colors.textSecondary, marginTop: 16 }]}>
                No live experiences right now.
              </Text>
            </View>
          </BottomSheetView>
        ) : (
          <BottomSheetFlatList
            data={experiences}
            keyExtractor={(e, i) => `${e.bookingUrl}-${i}`}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={experienceHeader}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingBottom: insets.bottom + 24,
            }}
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
  sheetBg: {},
  sheetHeader: { width: "100%", paddingTop: 6, paddingBottom: 12 },
  sheetHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetHeadingCopy: { flex: 1, minWidth: 0 },
  sheetEyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.3, marginBottom: 3 },
  sheetTitle: { fontSize: 20, lineHeight: 25, fontWeight: "800" },
  sheetSubtitle: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  sheetState: { flex: 1, paddingHorizontal: 20, paddingBottom: 24 },
  sheetCenter: {
    flex: 1,
    minHeight: 420,
    alignItems: "center",
    justifyContent: "center",
  },
  resultCount: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  resultCountText: { fontSize: 13, fontWeight: "800" },
  empty: { textAlign: "center", paddingHorizontal: 24 },
  expRetry: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1 },
  expRetryText: { fontSize: 14, fontWeight: "700" },
});
