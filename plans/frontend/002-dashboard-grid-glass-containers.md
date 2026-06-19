# Frontend 002 — Dashboard Grid + Glass Containers

> Phase 2 of the Lifelist app. Builds the visual heart of the Dashboard: a reusable
> `GlassContainer` (expo-blur + alpha border + drop shadow), a fluid two-column
> **masonry** layout engine, the vintage `DustyOverlay` texture layer, and the
> `ItemCard` that composes them with each category's procedural gradient.

---

## 🎯 Objective

1. Build a production `GlassContainer` using `expo-blur` with semi-transparent alpha
   borders and custom drop shadows — with a documented Android fallback (live blur in
   long scroll lists tanks Android FPS).
2. Render variable-height cards through FlashList v2's virtualized masonry implementation
   so long lifelists stay performant without row-zipping columns.
3. Build the `DustyOverlay` — a cheap, static vintage grain/vignette layer rendered
   above card imagery.
4. Compose these into `ItemCard`, themed by the category gradient from `backend/004`,
   showing a shimmer state while `status === "pending_enrichment"`.

---

## 💻 Code & Configuration Blueprints

### 1. Dependencies

```bash
pnpm expo install expo-linear-gradient expo-image
pnpm --filter mobile add @shopify/flash-list
```

### 2. `GlassContainer` — `components/GlassContainer.tsx`

> **This component is the canonical `useTheme()` migration example.** Note how it reads
> `useTheme()` in the body and builds the color-dependent styles inline, so it re-skins
> automatically in light vs dark. Radii now use the Headout scale (default `radius.lg` =
> **12**) and shadows use the **subtle** Headout tokens (opacity ~0.10), not the heavy
> `0.35` drop shadow. The blur tint follows the active theme.

```tsx
// components/GlassContainer.tsx
import { type ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { useTheme, useThemeMode } from "@/lib/useTheme";

interface GlassContainerProps {
  children: ReactNode;
  style?: ViewStyle;
  intensity?: number;
  radius?: number;
  /** Disable live blur (e.g. inside long lists) → cheaper translucent fill. */
  staticFallback?: boolean;
}

/**
 * A frosted-glass surface (our primary dark aesthetic; in light mode it reads as a
 * soft translucent panel — Headout-flat). iOS uses a real BlurView; Android (and when
 * staticFallback is true) approximates glass with a translucent fill — performant.
 * The alpha border + subtle Headout shadow sell the "pane of glass" look.
 */
export function GlassContainer({
  children,
  style,
  intensity = 30,
  radius,
  staticFallback = false,
}: GlassContainerProps) {
  const { colors, radius: r, shadow, spacing } = useTheme();
  const { resolved } = useThemeMode();
  const br = radius ?? r.lg; // 12 — Headout default
  const useLiveBlur = Platform.OS === "ios" && !staticFallback;

  return (
    <View style={[shadow.level2, { borderRadius: br, backgroundColor: "transparent" }, style]}>
      <View style={{ flex: 1, overflow: "hidden", borderRadius: br, backgroundColor: colors.surfaceGlass }}>
        {useLiveBlur ? (
          <BlurView tint={resolved === "dark" ? "dark" : "light"} intensity={intensity} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceGlass }]} />
        )}
        {/* alpha border drawn on top so it isn't clipped by the blur layer */}
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: br, borderWidth: 1, borderColor: colors.borderGlass }]}
        />
        <View style={{ flex: 1, padding: spacing(4) }}>{children}</View>
      </View>
    </View>
  );
}
```

### 3. Height estimator for items — `lib/itemHeight.ts`

```ts
// lib/itemHeight.ts
import type { Item } from "@/store/items"; // client Item type (integration/001)

/**
 * Estimates an ItemCard's rendered height for masonry packing. Cards have a portrait
 * image (3:4) plus a title block whose height grows with title length. Pending cards
 * use a fixed shimmer height.
 */
export function estimateItemHeight(item: Item, columnWidth: number): number {
  if (item.status === "pending_enrichment") return columnWidth * 1.1; // shimmer block

  const imageHeight = item.imageUrl ? columnWidth * (4 / 3) : columnWidth * 0.6;
  const titleLines = Math.max(1, Math.ceil(item.title.length / 22));
  const titleHeight = 22 + titleLines * 20;
  return Math.round(imageHeight + titleHeight + 16);
}
```

### 4. `DustyOverlay` — `components/DustyOverlay.tsx`

```tsx
// components/DustyOverlay.tsx
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/lib/useTheme";

/**
 * Vintage texture layer placed ABOVE card imagery. Two cheap, static layers:
 *  1. A faint repeating grain PNG at low opacity (blend = overlay via opacity).
 *  2. A radial-ish vignette using a LinearGradient corner darkening.
 * No animation, no blur — negligible cost even across many cards.
 */
const GRAIN = require("@/assets/textures/grain.png"); // 256x256 tileable noise

export function DustyOverlay({ radius }: { radius?: number }) {
  const { radius: r, colors } = useTheme();
  const br = radius ?? r.lg; // 12
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: br, overflow: "hidden" }]}>
      <Image
        source={GRAIN}
        style={[StyleSheet.absoluteFill, { opacity: 0.08 }]}
        contentFit="cover"
        // expo-image tiles via repeat on web; on native we just cover-stretch the noise.
      />
      <LinearGradient
        colors={["transparent", colors.scrim]}
        start={{ x: 0.5, y: 0.35 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
```

### 5. `ItemCard` — `components/ItemCard.tsx`

```tsx
// components/ItemCard.tsx
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { GlassContainer } from "./GlassContainer";
import { DustyOverlay } from "./DustyOverlay";
import { useTheme } from "@/lib/useTheme";
import type { Item } from "@/store/items";

export function ItemCard({ item, width, height }: { item: Item; width: number; height: number }) {
  const router = useRouter();
  const { colors, radius, type, palette } = useTheme();
  const isPending = item.status === "pending_enrichment";
  // Category gradients come from the backend (procedural dark-purple pairs); fall back
  // to the Headout purps→canvas wash when an item has no category yet.
  const g = item.category?.gradientStart && item.category?.gradientEnd
    ? [item.category.gradientStart, item.category.gradientEnd] as const
    : [colors.accentDim, colors.canvas] as const;

  if (isPending) {
    return (
      <View style={{ width, height }}>
        <GlassContainer staticFallback style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: colors.surfaceTint, borderRadius: radius.md }} />
        </GlassContainer>
      </View>
    );
  }

  return (
    <Pressable
      style={{ width, height }}
      onPress={() => router.push(`/item/${item.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${item.status === "completed" ? ", completed" : ""}`}
    >
      <View style={{ flex: 1, overflow: "hidden", borderRadius: radius.lg }}>
        <LinearGradient colors={g} style={StyleSheet.absoluteFill} />
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={300} />
        ) : null}
        <DustyOverlay radius={radius.lg} />
        {/* Bottom scrim for legible text over imagery (theme-aware) */}
        <LinearGradient colors={["transparent", colors.scrim]} style={styles.scrim} />
        <View style={styles.meta}>
          {item.category?.name ? (
            <Text style={[type.tag, { color: colors.candyText, marginBottom: 4 }]}>
              {item.category.name.toUpperCase()}
            </Text>
          ) : null}
          <Text style={[type.headingSmall, { color: palette.white }]} numberOfLines={3}>
            {item.title}
          </Text>
        </View>
        {item.status === "completed" ? (
          <View style={[styles.stamp, { borderColor: colors.success }]}>
            <Text style={[type.tag, { color: colors.success }]}>DONE</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

// Layout-only styles (no colors) can stay static; colors come from useTheme above.
const styles = StyleSheet.create({
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "55%" },
  meta: { position: "absolute", left: 12, right: 12, bottom: 12 },
  stamp: {
    position: "absolute", top: 10, right: 10, transform: [{ rotate: "-12deg" }],
    borderWidth: 2, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
});
```

> Card text sits on imagery, so the title is white in both themes; the category chip
> uses Headout **candy** pink and the type comes from Halyard tokens (`type.tag`,
> `type.headingSmall`). Note how only **layout** lives in `StyleSheet.create` — every
> color is applied inline from `useTheme()`, which is the pattern to repeat everywhere.

### 6. Dashboard screen — `app/(protected)/(tabs)/index.tsx`

> **Virtualized, not a `ScrollView`.** A plain `ScrollView` mounts every card at once —
> fine for 5 items, a memory/scroll-jank problem for a long lifelist. We render the
> masonry through **`FlashList` with `masonry`** so only on-screen cards are mounted and columns
> remain independent; row-zipping would leave false vertical gaps.
>
> The screen also owns the full **loading / error / empty / retry** state machine sourced
> from the store (integration/001 exposes `status` + `refetch`).

```tsx
// app/(protected)/(tabs)/index.tsx
import { ActivityIndicator, View, useWindowDimensions, Text, Pressable } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { estimateItemHeight } from "@/lib/itemHeight";
import { ItemCard } from "@/components/ItemCard";
import { useTheme } from "@/lib/useTheme";
import { useItems } from "@/store/items"; // integration/001

const GAP = 12;
const H_PADDING = 16;

export default function Dashboard() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors, type, shadow, palette } = useTheme();
  const router = useRouter();

  // Store exposes the data plus an async lifecycle (integration/001):
  //   status: "loading" | "error" | "ready", items: Item[], refetch: () => void
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

  // ── State machine: loading / error / empty / ready ──────────────────────────────
  function renderBody() {
    // LOADING (initial fetch, nothing cached yet).
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

    // ERROR (and nothing cached to show instead) → retry.
    if (status === "error" && items.length === 0) {
      return (
        <View style={styles.stateCenter}>
          <Text style={[type.headingSmall, { color: colors.textPrimary }]}>
            Couldn't load your Lifelist
          </Text>
          <Text style={[type.paraRegular, { color: colors.textSecondary, marginTop: 6, textAlign: "center" }]}>
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

    // EMPTY (loaded fine, no items yet).
    if (status === "ready" && items.length === 0) {
      return (
        <View style={styles.stateCenter}>
          <Text style={[type.headingRegular, { color: colors.textPrimary }]}>
            Your Lifelist is empty
          </Text>
          <Text style={[type.paraRegular, { color: colors.textSecondary, marginTop: 6, textAlign: "center" }]}>
            Tap + to add the first thing you want to do before you die.
          </Text>
        </View>
      );
    }

    // READY (or stale-while-error/refetching with cached items) → virtualized grid.
    return (
      <FlashList
        data={items}
        masonry
        numColumns={2}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        showsVerticalScrollIndicator={false}
        // paddingBottom clears the floating tab bar + the bottom safe-area inset (§7b).
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: H_PADDING,
          paddingBottom: insets.bottom + 100,
        }}
        // Pull-to-refresh doubles as the retry path when a refetch errored.
        refreshing={status === "loading" && items.length > 0}
        onRefresh={refetch}
        renderItem={({ item }) => (
          <View style={{ marginHorizontal: GAP / 2, marginBottom: GAP }}>
            <ItemCard
              item={item}
              width={cardWidth}
              height={estimateItemHeight(item, cardWidth)}
            />
          </View>
        )}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      {renderBody()}

      {/* Floating Smart-Add FAB — Headout purple, subtle (not glowing) shadow */}
      <Pressable
        onPress={() => router.push("/(protected)/modals/add-item")}
        accessibilityRole="button"
        accessibilityLabel="Add a Lifelist item"
        style={{
          position: "absolute", right: 20, bottom: insets.bottom + 80,
          width: 60, height: 60, borderRadius: 30, backgroundColor: colors.accent,
          alignItems: "center", justifyContent: "center",
          ...shadow.level3,
        }}
      >
        <Text style={{ color: palette.white, fontSize: 32, marginTop: -2 }}>+</Text>
      </Pressable>
    </View>
  );
}
```

> The screen-state layout styles (`stateCenter`, `retryBtn`) are color-free and live in
> a local `StyleSheet.create`; colors come from `useTheme()` inline, per convention:
>
> ```ts
> const styles = StyleSheet.create({
>   stateCenter: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
>   retryBtn: { marginTop: 16, paddingHorizontal: 22, paddingVertical: 11, borderWidth: 1 },
> });
> ```
>
> (Add `StyleSheet` to the `react-native` import above.)

---

## 🚶 Step-by-Step Execution Guide

1. **Install** `expo-linear-gradient`, `@shopify/flash-list`, and confirm `expo-image`
   from phase 1. Add a tileable `assets/textures/grain.png` (256×256 noise).

2. **Build `GlassContainer`** (§2). Note the platform split: live `BlurView` only on
   iOS / when not in a list; translucent fill otherwise. The alpha border is drawn as
   a sibling overlay so the blur doesn't clip it.

3. **Add the `estimateItemHeight` heuristic** (§3) used to choose each card's actual
   rendered height. FlashList v2 measures those rendered heights; it does not need an
   `estimatedItemSize` prop.

4. **Build `DustyOverlay`** (§4): static grain image + vignette gradient. No animation.

5. **Build `ItemCard`** (§5): gradient base → image → DustyOverlay → scrim → meta.
   Handle the `pending_enrichment` shimmer and the `completed` stamp.

6. **Assemble the Dashboard** `app/(protected)/(tabs)/index.tsx` (§6): render through a
   virtualized FlashList v2 masonry,
   and add the floating Smart-Add FAB. Wire the loading / error / empty / ready branches
   (with a working **Retry** + pull-to-refresh) off the store's `status` + `refetch`.

## 🧪 Verification & Test Protocols

### A. Glass appearance + theme switch (manual, both platforms)

- **iOS dark (primary):** `GlassContainer` shows a real frosted blur of content behind
  it, a 1px alpha border, and a **subtle** Headout shadow (`shadow.level2`, ~0.10) —
  not the old heavy glow. Radius is 12.
- **iOS light:** the same surface reads as a soft translucent light panel with a
  hairline grey border (Headout-flat).
- **Android:** translucent fill (no blur), still bordered + softly elevated. Scroll
  20+ cards — FPS stays smooth.
- Toggle the theme: the FAB stays Headout purple `#8000ff`, surfaces/borders/text all
  flip, with no remount.

### B. Card states

Render mock items covering all three statuses:
- `pending_enrichment` → tinted (purps wash) shimmer block, no image/title.
- `active` with `imageUrl` → portrait image, **candy-pink** category chip, scrim, white
  Halyard title.
- `completed` → rotated "DONE" stamp in `success` green.

### C. Gradient theming

A card whose `category.gradientStart/End` are set shows those exact dark-purple stops
(the backend's procedural pairs) behind/around the image. A card with no image shows
the `accentDim → canvas` purps fallback (proves the fallback path).

### D. Two-column responsiveness

Rotate the device / resize: `columnWidth` recomputes from `useWindowDimensions`, cards
reflow into balanced columns without overlap or clipping. The FAB stays pinned bottom-
right above the tab bar (and above the Android nav bar via `insets.bottom`).

### E. Virtualization + async states

- **Virtualization:** with 200+ mock items, the grid scrolls smoothly and only on-screen
  cards are mounted (FlashList recycles) — no all-at-once `ScrollView` mount.
- **Loading:** set the mock store `status: "loading"` with no items → centered spinner +
  "Loading your Lifelist…".
- **Error:** `status: "error"`, no items → error message + working **Retry** that calls
  `refetch`.
- **Empty:** `status: "ready"`, `items: []` → the empty-state prompt to tap +.
- **Stale-while-refetch:** with cached items, pull-to-refresh fires `refetch` and the
  grid stays visible (no flash to a blank loading screen).

✅ **Phase complete when:** glass renders correctly per-platform and re-skins cleanly
between light/dark with Headout tokens (purps/candy,
radius 12, subtle shadows), all three card states display, gradients theme correctly,
the grid reflows on resize, the list is virtualized masonry, and
the loading / error / empty / retry branches all render and recover.

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
