# Frontend 004 — Item Detail: Parallax Scroll + Bottom Sheet

> Phase 4 of the Lifelist app. Builds the dynamic item detail screen
> (`app/(protected)/item/[id].tsx`): a `ParallaxScrollView` that maps scroll offset to hero-image
> scale/translate via Reanimated, and a `@gorhom/bottom-sheet` that surfaces live
> Headout experiences (from `backend/005`) in styled cards.

---

## 🎯 Objective

1. Build a high-performance `ParallaxScrollView` where the hero image **scales up** on
   overscroll-pull and **parallax-translates** on scroll, all on the UI thread via
   Reanimated worklets.
2. Lay out the detail content: title, category chip, notes, the Unsplash image
   **attribution** (required by Unsplash terms), the completion CTA (links to
   frontend/005), and the experiences section.
3. Integrate `@gorhom/bottom-sheet` with snap points, anchored to the bottom of the
   screen, rendering Headout experience cards fetched from `GET /api/experiences`.
4. Resolve the item robustly for **deep links / cold starts**: read it from the store if
   present, otherwise fetch it via `GET /api/items/:id` (loading spinner). Distinguish a
   **network/fetch failure** (error + retry state) from a real **`404`** (not-found
   state) — only a true 404 shows "not found"; a failed fetch is retryable. Never an
   infinite spinner.

---

## 💻 Code & Configuration Blueprints

### 1. Dependencies

```bash
pnpm expo install @gorhom/bottom-sheet react-native-reanimated react-native-gesture-handler
# @gorhom/bottom-sheet v5 requires reanimated 3 + gesture-handler 2 (already in 001)
```

### 2. `ParallaxScrollView` — `components/ParallaxScrollView.tsx`

```tsx
// components/ParallaxScrollView.tsx
import { type ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
  useReducedMotion,
  Extrapolation,
} from "react-native-reanimated";
import { Image } from "expo-image";
import { useTheme } from "@/lib/useTheme";

const HEADER_HEIGHT_RATIO = 0.55; // hero takes 55% of screen height

interface Props {
  imageUrl?: string | null;
  gradient: readonly [string, string];
  children: ReactNode;
  headerOverlay?: ReactNode; // back button, etc.
}

/**
 * Scroll-driven parallax. useScrollViewOffset reads the live scroll position on the UI
 * thread (no JS bridge per frame). We map that offset to the hero image's transform:
 *  - Pull down (negative offset): scale UP (1 → 2) → the classic stretchy hero.
 *  - Scroll up (positive offset): translate the hero UPWARD at HALF the scroll speed
 *    (parallax) so it drifts slower than the content sheet and the content covers it.
 *    A positive scroll offset must produce a NEGATIVE translateY (moves up) — translating
 *    DOWNWARD on scroll-up is the reversed/wrong direction.
 */
export function ParallaxScrollView({ imageUrl, gradient, children, headerOverlay }: Props) {
  const { height } = useWindowDimensions();
  const { colors, radius } = useTheme();
  const HEADER_HEIGHT = height * HEADER_HEIGHT_RATIO;

  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const offset = useScrollViewOffset(scrollRef);
  const reduceMotion = useReducedMotion();

  const heroStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { transform: [{ translateY: 0 }, { scale: 1 }] };
    const scale = interpolate(
      offset.value,
      [-HEADER_HEIGHT, 0, HEADER_HEIGHT],
      [2, 1, 1],
      Extrapolation.CLAMP,
    );
    // Positive scroll offset → NEGATIVE translateY (hero moves UP) at half the scroll
    // speed; pull-down (negative offset) keeps translateY at 0 and lets scale do the
    // stretch. Mapping HEADER_HEIGHT → -HEADER_HEIGHT * 0.5 is the half-speed drift.
    const translateY = interpolate(
      offset.value,
      [-HEADER_HEIGHT, 0, HEADER_HEIGHT],
      [0, 0, -HEADER_HEIGHT * 0.5],
      Extrapolation.CLAMP,
    );
    return { transform: [{ translateY }, { scale }] };
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <Animated.View style={[styles.hero, { height: HEADER_HEIGHT }, heroStyle]}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={reduceMotion ? 0 : 300}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: gradient[0] }]} />
        )}
      </Animated.View>

      {headerOverlay}

      <Animated.ScrollView
        ref={scrollRef}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: HEADER_HEIGHT - 40 }}
      >
        <View
          style={[
            styles.sheetTop,
            {
              backgroundColor: colors.canvas,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
            },
          ]}
        >
          {children}
        </View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { position: "absolute", top: 0, left: 0, right: 0 },
  sheetTop: {
    minHeight: 600,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
});
```

### 3. Experiences hook — `hooks/useExperiences.ts`

```ts
// hooks/useExperiences.ts
import { useEffect, useState } from "react";
import { z } from "zod";
import { ExperienceSchema, type Experience } from "@lifelist/shared";
import { apiFetch } from "@/lib/api/client"; // integration/001

const ExperiencesResponseSchema = z.object({ experiences: z.array(ExperienceSchema) });

interface State {
  experiences: Experience[];
  loading: boolean;
  error: boolean;
}

/** Fetches sanitized Headout experiences for a query (the item title). */
export function useExperiences(query: string): State {
  const [state, setState] = useState<State>({ experiences: [], loading: true, error: false });

  useEffect(() => {
    if (!query.trim()) {
      setState({ experiences: [], loading: false, error: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: false }));
    apiFetch(`/experiences?q=${encodeURIComponent(query)}&limit=6`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Experiences request failed: ${r.status}`);
        return ExperiencesResponseSchema.parse(await r.json());
      })
      .then((body) => {
        if (!controller.signal.aborted) {
          setState({ experiences: body.experiences, loading: false, error: false });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ experiences: [], loading: false, error: true });
        }
      });
    return () => controller.abort();
  }, [query]);

  return state;
}
```

### 4. Experience card — `components/ExperienceCard.tsx`

```tsx
// components/ExperienceCard.tsx
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/useTheme";
import type { Experience } from "@/hooks/useExperiences";

export function ExperienceCard({ exp }: { exp: Experience }) {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      style={[styles.card, { borderRadius: radius.md, borderColor: colors.borderGlass }]}
      onPress={() => Linking.openURL(exp.bookingUrl)}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>{exp.title}</Text>
        {exp.description ? <Text style={[styles.desc, { color: colors.textSecondary }]} numberOfLines={2}>{exp.description}</Text> : null}
        <View style={styles.metaRow}>
          <Text style={[styles.price, { color: colors.accent }]}>{exp.priceToken}</Text>
          {exp.rating != null ? (
            <View style={styles.rating}>
              <Ionicons name="star" size={12} color="#FBBF24" />
              <Text style={[styles.ratingText, { color: colors.textPrimary }]}>{exp.rating.toFixed(1)}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "rgba(255,255,255,0.05)", padding: 14,
    borderWidth: 1, marginBottom: 10,
  },
  title: { fontWeight: "700", fontSize: 15 },
  desc: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  price: { fontWeight: "800" },
  rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText: { fontSize: 12, fontWeight: "600" },
});
```

### 5. The detail screen — `app/(protected)/item/[id].tsx`

```tsx
// app/(protected)/item/[id].tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import BottomSheet, { BottomSheetView, BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { ParallaxScrollView } from "@/components/ParallaxScrollView";
import { ExperienceCard } from "@/components/ExperienceCard";
import { HoldToStampButton } from "@/components/HoldToStampButton"; // frontend/005
import { useExperiences } from "@/hooks/useExperiences";
// Store selectors/actions (integration/001). `useItem` reads the in-memory store only;
// `fetchItemById` hits GET /api/items/:id, upserts, and returns a discriminated result
// (ok | not_found | error).
import { useItem, useItemsStore } from "@/store/items";
import { useTheme } from "@/lib/useTheme";

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

  // Deep-link / cold-start resolution. `useItem` only reads the in-memory store, so a
  // deep link straight into /item/<id> finds nothing on a cold launch. Fetch on demand
  // and track loading vs not-found vs (retryable) error so the screen never spins forever
  // AND never shows "not found" for a mere network blip.
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
  }, [id, item, load]);

  const { experiences, loading, error } = useExperiences(item?.title ?? "");

  // Completion is DERIVED from the live store item, not snapshotted into local state, so
  // a Realtime update or a completion elsewhere keeps this screen in sync.
  const isCompleted = item?.status === "completed";

  const gradient = useMemo<readonly [string, string]>(
    () => [item?.category?.gradientStart ?? colors.accentDim, item?.category?.gradientEnd ?? colors.canvas],
    [item, colors],
  );

  // Still resolving the item (store miss → in-flight fetch): show a spinner, not content.
  if (!item && resolve === "loading") {
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // Network / transport failure (NOT a 404): an error state with a working Retry — the
  // item might exist; we just couldn't reach the server.
  if (!item && resolve === "error") {
    return (
      <View style={[styles.center, styles.notFound, { backgroundColor: colors.canvas }]}>
        <Ionicons name="cloud-offline" size={40} color={colors.textSecondary} />
        <Text style={[styles.notFoundTitle, { color: colors.textPrimary }]}>Couldn't load this item</Text>
        <Text style={[styles.notFoundSub, { color: colors.textSecondary }]}>
          Check your connection and try again.
        </Text>
        <View style={styles.errActions}>
          <Pressable
            onPress={load}
            style={[styles.notFoundBtn, { borderColor: colors.accent, borderRadius: radius.md }]}
          >
            <Text style={[styles.notFoundBtnText, { color: colors.accent }]}>Retry</Text>
          </Pressable>
          <Pressable
            onPress={() => router.back()}
            style={[styles.notFoundBtn, { borderColor: colors.borderGlass, borderRadius: radius.md }]}
          >
            <Text style={[styles.notFoundBtnText, { color: colors.textSecondary }]}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Hard 404 ONLY (the item genuinely doesn't exist): a real not-found state with a way
  // back — never an endless spinner, and never shown for a transient network error.
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
          <Pressable onPress={() => router.back()} style={[styles.back, { top: insets.top + 8 }]}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
        }
      >
        {item.category?.name ? <Text style={[styles.chip, { color: colors.accent }]}>{item.category.name.toUpperCase()}</Text> : null}
        <Text style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
        {item.notes ? <Text style={[styles.notes, { color: colors.textSecondary }]}>{item.notes}</Text> : null}

        {/* Unsplash attribution — REQUIRED by the Unsplash API guidelines whenever we
            show a photo. `imageAttribution` is the photographer's name; tapping it opens
            `imageAttributionUrl` (their Unsplash profile / photo page). Only rendered for
            hero images that carry attribution. */}
        {item.imageUrl && item.imageAttribution ? (
          <Text style={[styles.attribution, { color: colors.textSecondary }]}>
            Photo by{" "}
            {item.imageAttributionUrl ? (
              <Text
                style={[styles.attributionLink, { color: colors.accentText }]}
                onPress={() => Linking.openURL(item.imageAttributionUrl!)}
              >
                {item.imageAttribution}
              </Text>
            ) : (
              <Text style={styles.attributionName}>{item.imageAttribution}</Text>
            )}{" "}
            on Unsplash
          </Text>
        ) : null}

        {/* Completion derives from the live store item (status), so it stays in sync if
            the item is completed elsewhere or via a Realtime push. */}
        <HoldToStampButton itemId={item.id} completed={isCompleted} />

        <Text style={[styles.section, { color: colors.textPrimary }]}>Make it happen</Text>
        <Text style={[styles.sectionSub, { color: colors.textSecondary }]}>Live experiences from Headout</Text>
        <View style={{ height: 380 }} /> {/* reserve space; sheet overlays the rest */}
      </ParallaxScrollView>

      {/* Bottom sheet with Headout experiences */}
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={[styles.sheetBg, { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }]}
        handleIndicatorStyle={{ backgroundColor: colors.borderGlass }}
      >
        <BottomSheetView style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: colors.textPrimary }]}>Experiences</Text>
        </BottomSheetView>
        {loading ? (
          <View style={[styles.center, { backgroundColor: colors.canvas }]}><ActivityIndicator color={colors.accent} /></View>
        ) : error || experiences.length === 0 ? (
          <View style={[styles.center, { backgroundColor: colors.canvas }]}>
            <Text style={[styles.empty, { color: colors.textSecondary }]}>No live experiences right now.</Text>
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
  back: { position: "absolute", left: 16, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
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
```

> **GestureHandlerRootView** must wrap the app (done in `frontend/001`'s root layout) —
> `@gorhom/bottom-sheet` depends on it. Without it the sheet won't drag.

### 6. Store contract

Use the canonical `useItem` and discriminated `fetchItemById` implementation from
integration/001. Do not introduce a second store shape in this phase.

---

## 🚶 Step-by-Step Execution Guide

1. **Install** `@gorhom/bottom-sheet` (v5). Confirm `react-native-reanimated` (worklets)
   and `react-native-gesture-handler` are present and that `GestureHandlerRootView`
   wraps the root (frontend/001 §8).

2. **Build `ParallaxScrollView`** (§2): `useAnimatedRef` + `useScrollViewOffset` feed an
   `useAnimatedStyle` that interpolates offset → `scale`/`translateY`. Pull-down scales
   up (stretchy hero); scroll-up drifts the hero **upward** at half speed (positive
   offset → negative `translateY`). All on the UI thread.

3. **Add `useExperiences`** (§3) — fetches `/api/experiences?q=<title>` via the
   JWT-injecting `apiFetch`, with cancellation and graceful error state.

4. **Build `ExperienceCard`** (§4): title, display price token, optional description/
   rating, and taps that open the `bookingUrl` via `Linking.openURL`.

5. **Assemble `app/(protected)/item/[id].tsx`** (§5): parallax hero + content (title,
   category chip, notes, **Unsplash attribution**) + the `HoldToStampButton`
   (frontend/005, fed `completed` derived from the live store `status`) + a `BottomSheet`
   with two snap points rendering experiences in a `BottomSheetFlatList`. Handle
   loading/error/empty.

6. **Resolve the item for deep links** (§5 + §6 store excerpt): `useItem(id)` reads the
   store only, so on a cold deep link it's `undefined`. In a `useEffect`, call
   `fetchItemById(id)` (GET `/api/items/:id`, upserts on success) which returns a
   discriminated `ok | not_found | error`; drive a `loading | ready | notfound | error`
   status so the screen shows a spinner while fetching, a **not-found** state on a true
   404, and a retryable **error** state on a network/transport failure — never an
   infinite spinner, and never "not found" for a mere connectivity blip.

7. **Render the Unsplash attribution** (§5): when the hero has `imageAttribution`, show
   "Photo by <name> on Unsplash" with `<name>` linking to `imageAttributionUrl` via
   `Linking.openURL`. This is required by the Unsplash API terms whenever a photo is
   displayed.

## 🧪 Verification & Test Protocols

### A. Parallax mapping (interpolation unit)

```ts
// _parallax.test.ts — verify the interpolation math the worklet uses
import { interpolate, Extrapolation } from "react-native-reanimated";
const H = 400;
test("pull-down scales up to 2x; scroll-up moves hero UP at half speed", () => {
  // scale: pull-down (negative offset) → 2x, rest → 1x
  expect(interpolate(-H, [-H, 0, H], [2, 1, 1], Extrapolation.CLAMP)).toBeCloseTo(2);
  expect(interpolate(0, [-H, 0, H], [2, 1, 1], Extrapolation.CLAMP)).toBeCloseTo(1);
  // translateY: a POSITIVE scroll offset must yield a NEGATIVE translateY (hero drifts
  // upward) at half the scroll distance; pull-down and rest stay at 0.
  expect(interpolate(0, [-H, 0, H], [0, 0, -H * 0.5], Extrapolation.CLAMP)).toBeCloseTo(0);
  expect(interpolate(-H, [-H, 0, H], [0, 0, -H * 0.5], Extrapolation.CLAMP)).toBeCloseTo(0);
  const tY = interpolate(H, [-H, 0, H], [0, 0, -H * 0.5], Extrapolation.CLAMP);
  expect(tY).toBeCloseTo(-H * 0.5); // upward
  expect(tY).toBeLessThan(0);       // positive offset → negative translateY
});
```

### B. Parallax feel (manual, device)

- Pull the hero down past the top → it **scales up** smoothly and snaps back (60fps, no
  jank — confirms UI-thread worklet, not JS).
- Scroll up → the hero drifts **upward** at half the scroll speed (it moves up slower
  than the content sheet, never downward), then the content sheet covers it.

### C. Bottom sheet behavior

- The sheet starts at the small snap (~18%) showing the "Experiences" handle.
- Drag up → expands to 85%, list becomes scrollable; the inner
  `BottomSheetFlatList` scrolls independently without fighting the sheet gesture.
- Drag down → collapses. Confirms gesture-handler root wiring.

### D. Headout data render

For an item titled "Visit Machu Picchu", the sheet lists real sanitized experiences:
each card shows the title and `priceToken` ("See price" for the current search-only
contract). Description and rating render only when non-empty/non-null. Tapping a card
opens the allowlisted Headout `bookingUrl` in the browser.

### E. Loading / empty / error states

- While fetching → spinner in the sheet.
- For a nonsense title or upstream failure (`backend/005` returns empty) → "No live
  experiences right now." (no crash).

### F. Missing image fallback

Open an item with `imageUrl == null` → the hero shows the category gradient instead of
an image; parallax still works on the gradient block.

### G. Cold deep-link resolution: not-found vs network error

- **Warm:** tap an item already in the store → it renders immediately (no spinner flash;
  `useItem(id)` hit).
- **Cold deep link:** force-quit, then open `lifelist://item/<realId>` (or a notification
  link) → a spinner shows briefly while `fetchItemById` runs, then the detail renders
  (proves the store-miss fetch path, not an infinite spinner).
- **Unknown id (true 404):** open `lifelist://item/does-not-exist` → after the fetch
  returns `404`, the **"Item not found"** state appears with a working **Go back** button.
- **Network failure (NOT 404):** go offline (or stub `fetchItemById` to return
  `{ kind: "error" }`) and open a cold deep link → the **"Couldn't load this item"**
  error state appears with a working **Retry** (re-runs `load()`), distinct from the
  not-found state. A flaky network must never be mislabeled "not found". The screen must
  **never** spin forever.

### H. Unsplash attribution renders

For an item with an Unsplash hero, the detail shows "Photo by <photographer> on Unsplash"
beneath the title/notes; tapping the photographer name opens `imageAttributionUrl` in the
browser. (Required by Unsplash API terms.) Items without `imageAttribution` show no credit
line.

### I. Completion stays in sync

Open an item, then complete it elsewhere (or push a Realtime `status: "completed"` update
into the store). The detail's `HoldToStampButton` reflects the completed state without a
remount, because `completed` is derived from the live store `item.status` (not snapshotted
once on mount).

✅ **Phase complete when:** the interpolation test passes (positive offset → negative
`translateY`, upward at half speed), the hero scales on pull and drifts upward on scroll
at 60fps, the bottom sheet snaps/expands and scrolls its list independently, Headout
cards render and deep-link out, loading/empty/error/no-image states are handled, a cold
deep link resolves via `fetchItemById` (true-404 → not-found, network failure → retryable
error, never an endless spinner), the Unsplash attribution renders and links out, and the
completion state derives from the live store. Back/retry/attribution controls have
accessibility labels, and reduced-motion users get a static hero.

---

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
