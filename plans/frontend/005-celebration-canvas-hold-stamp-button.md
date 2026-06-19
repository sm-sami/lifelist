# Frontend 005 — Celebration Canvas + Hold-to-Stamp Button

> Phase 5 of the Lifelist app. Builds the `HoldToStampButton` — a long-press gesture
> (via `react-native-gesture-handler`) that tracks press duration, escalates haptic
> ticks over a 2-second hold, and on completion fires the item-complete API and
> triggers a full-screen Skia particle-explosion celebration.

---

## 🎯 Objective

1. Implement `HoldToStampButton`: a `LongPressGesture` that fills a progress ring over
   **2 seconds** and only "stamps" when the full hold completes (release early =
   cancel).
2. Drive an **escalating haptic loop** — ticks that start sparse and get denser/heavier
   across the 2s, ending with a success thud.
3. On completion, optimistically flip the button + mount a full-screen
   `@shopify/react-native-skia` particle-explosion canvas **at the root window level**
   (via a `Modal` portal so it overlays the parallax/bottom-sheet, not nested inside the
   scroll content), then **await** `PATCH /api/items/:id/complete`. The completion
   mutation is guarded by an **in-flight / idempotency** ref so a held-then-retapped or
   double-fired gesture can never send the PATCH twice. On failure, roll the UI back
   (un-complete, rewind the ring, cancel the celebration), fire an error haptic, and
   surface a visible, retryable error — completion never silently lies about an unsaved
   write.

---

## 💻 Code & Configuration Blueprints

### 1. Dependencies

```bash
pnpm expo install expo-haptics @shopify/react-native-skia
# react-native-gesture-handler + reanimated already installed (frontend/001)
```

### 2. Escalating haptics controller — `lib/haptics.ts`

```ts
// lib/haptics.ts
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * Drives an escalating haptic sequence over `durationMs`. The tick interval shrinks
 * (sparse → dense) and the impact style intensifies (Light → Medium → Heavy) as the
 * hold progresses, building anticipation. Returns a stop() to cancel on early release.
 *
 * NOTE: Android haptics are coarser/less granular than iOS. We still escalate, but the
 * subtlety of Light→Medium→Heavy is far more pronounced on iOS. Do not assume parity.
 */
export function startHapticEscalation(durationMs = 2000) {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function styleForProgress(p: number): Haptics.ImpactFeedbackStyle {
    if (p < 0.4) return Haptics.ImpactFeedbackStyle.Light;
    if (p < 0.75) return Haptics.ImpactFeedbackStyle.Medium;
    return Haptics.ImpactFeedbackStyle.Heavy;
  }

  // Interval shrinks from ~220ms (sparse) to ~60ms (rapid) as progress → 1.
  function nextDelay(p: number): number {
    return Math.max(60, 220 - p * 160);
  }

  function tick() {
    if (stopped) return;
    const elapsed = Date.now() - start;
    const p = Math.min(elapsed / durationMs, 1);
    Haptics.impactAsync(styleForProgress(p)).catch(() => {});
    if (p >= 1) return; // escalation done; success notification fired by caller
    timer = setTimeout(tick, nextDelay(p));
  }

  tick();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    success() {
      stopped = true;
      if (timer) clearTimeout(timer);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    },
  };
}
```

### 2b. Completion API contract — `lib/api/items.ts`

```ts
import { z } from "zod";
import { ItemDtoSchema, type ItemDto } from "@lifelist/shared";
import { apiJson } from "@/lib/api/client";

const CompleteResponseSchema = z.object({ item: ItemDtoSchema });

export async function completeItem(itemId: string): Promise<ItemDto> {
  const body = await apiJson<unknown>(`/items/${itemId}/complete`, { method: "PATCH" });
  return CompleteResponseSchema.parse(body).item;
}
```

### 3. `HoldToStampButton` — `components/HoldToStampButton.tsx`

```tsx
// components/HoldToStampButton.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
  Easing,
  cancelAnimation,
  useReducedMotion,
} from "react-native-reanimated";
import { useTheme } from "@/lib/useTheme";
import { startHapticEscalation } from "@/lib/haptics";
import { completeItem } from "@/lib/api/items"; // PATCH /api/items/:id/complete
import { useItemsStore } from "@/store/items";
import { CelebrationCanvas } from "./CelebrationCanvas";

const HOLD_MS = 2000;

export function HoldToStampButton({ itemId, completed }: { itemId: string; completed: boolean }) {
  const { colors, radius } = useTheme();
  const reduceMotion = useReducedMotion();
  const upsert = useItemsStore((s) => s.upsert);
  const progress = useSharedValue(completed ? 1 : 0);
  const scale = useSharedValue(1);
  const [isDone, setIsDone] = useState(completed);
  const [celebrate, setCelebrate] = useState(false);
  const [error, setError] = useState(false); // surfaced inline with a retry affordance
  const hapticsRef = useRef<ReturnType<typeof startHapticEscalation> | null>(null);
  // In-flight / idempotency guard: the long-press onStart and a manual Retry can both
  // call onComplete; this ref ensures only ONE PATCH is ever in flight at a time, so the
  // completion mutation can never double-fire.
  const inFlight = useRef(false);

  useEffect(() => {
    setIsDone(completed);
    progress.value = withTiming(completed ? 1 : 0, { duration: reduceMotion ? 0 : 200 });
  }, [completed, progress, reduceMotion]);

  /**
   * Completion must NOT silently lie. We optimistically flip to done + start the
   * celebration, then AWAIT the PATCH. On failure we roll everything back (button,
   * progress ring, celebration), fire an error haptic, and surface a visible, retryable
   * error — no empty `.catch(() => {})` that swallows a failed write.
   */
  const onComplete = useCallback(async () => {
    // Idempotency: drop the call if a completion is already in flight, or if it already
    // succeeded (isDone with no error). Prevents a double PATCH from a re-fire/retry.
    if (inFlight.current) return;
    if (isDone && !error) return;
    inFlight.current = true;
    setError(false);
    hapticsRef.current?.success();
    // Optimistic: flip the button + play the explosion immediately.
    setIsDone(true);
    setCelebrate(!reduceMotion);
    try {
      const updated = await completeItem(itemId);
      upsert(updated);
      AccessibilityInfo.announceForAccessibility("Item marked complete");
    } catch {
      // Roll back the optimistic UI so the button doesn't claim a completion that failed.
      setIsDone(false);
      setCelebrate(false); // cancel/return the celebration overlay
      cancelAnimation(progress);
      progress.value = withTiming(0, { duration: 250 }); // ring rewinds to empty
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(true); // show the inline error + retry
    } finally {
      inFlight.current = false; // release the guard so a Retry can run after a failure
    }
  }, [itemId, progress, isDone, error, reduceMotion, upsert]);

  const retry = useCallback(() => {
    void onComplete();
  }, [onComplete]);

  const beginHaptics = useCallback(() => {
    hapticsRef.current = startHapticEscalation(HOLD_MS);
  }, []);

  const cancelHaptics = useCallback(() => {
    hapticsRef.current?.stop();
  }, []);

  /**
   * LongPress gesture. We drive `progress` with withTiming over HOLD_MS on begin, and
   * cancel it on early release. The gesture's own minDuration fires onStart=complete
   * only if held the full HOLD_MS.
   */
  const gesture = Gesture.LongPress()
    .minDuration(HOLD_MS)
    .maxDistance(40)
    .onBegin(() => {
      "worklet";
      if (isDone) return;
      scale.value = withSpring(0.96);
      progress.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear });
      runOnJS(beginHaptics)();
    })
    .onStart(() => {
      "worklet";
      // Fired only when the full HOLD_MS elapsed without cancel → success.
      runOnJS(onComplete)();
    })
    .onFinalize((_e, success) => {
      "worklet";
      scale.value = withSpring(1);
      if (!success && !isDone) {
        cancelAnimation(progress);
        progress.value = withTiming(0, { duration: 250 });
        runOnJS(cancelHaptics)();
      }
    });

  const ringStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
  }));
  const containerStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <>
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessible
          accessibilityRole="button"
          accessibilityLabel={isDone ? "Item completed" : "Mark item complete"}
          accessibilityHint={isDone ? undefined : "Hold for two seconds, or use the Mark complete accessibility action"}
          accessibilityActions={isDone ? [] : [{ name: "activate", label: "Mark complete" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "activate") void onComplete();
          }}
          style={[
            styles.button,
            {
              borderRadius: radius.lg,
              borderColor: isDone ? colors.success : colors.accent,
              backgroundColor: isDone ? colors.successTint : colors.accentDim,
            },
            error && { borderColor: colors.danger },
            containerStyle,
          ]}
        >
          <Animated.View
            style={[styles.fill, { backgroundColor: colors.accent }, ringStyle]}
            pointerEvents="none"
          />
          <Text style={[styles.label, { color: colors.textPrimary }]}>
            {isDone ? "✓  Completed" : "Hold to mark complete"}
          </Text>
        </Animated.View>
      </GestureDetector>

      {/* Visible failure state + retry — the write failed, so say so. */}
      {error ? (
        <View style={styles.errorRow}>
          <Text style={[styles.errorText, { color: colors.danger }]}>
            Couldn't save — tap to retry.
          </Text>
          <Pressable
            onPress={retry}
            style={[styles.retryBtn, { borderColor: colors.danger, borderRadius: radius.md }]}
          >
            <Text style={[styles.retryText, { color: colors.danger }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Rendered at ROOT window level via a portal Modal (see CelebrationCanvas §4), so
          the explosion overlays the parallax hero + bottom sheet instead of being clipped
          inside this button's normal layout flow. */}
      {celebrate ? (
        <CelebrationCanvas onDone={() => setCelebrate(false)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: 20, height: 60, overflow: "hidden",
    borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.45 },
  label: { fontWeight: "800", fontSize: 16 },
  errorRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 10 },
  errorText: { flex: 1, fontSize: 13, fontWeight: "600" },
  retryBtn: { paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1 },
  retryText: { fontSize: 13, fontWeight: "700" },
});
```

### 4. Particle explosion canvas — `components/CelebrationCanvas.tsx`

```tsx
// components/CelebrationCanvas.tsx
import { useEffect, useMemo } from "react";
import { Modal, StyleSheet, useWindowDimensions } from "react-native";
import { Canvas, Circle, Group } from "@shopify/react-native-skia";
import Animated, {
  type SharedValue,
  useSharedValue,
  withTiming,
  useDerivedValue,
  runOnJS,
  Easing,
} from "react-native-reanimated";

const PARTICLE_COUNT = 80;
// Headout-brand confetti: purps + candy lead, with festive supporting hues.
const COLORS = ["#8000ff", "#ff007a", "#b266ff", "#15d676", "#ffbc00", "#ffffff"];

interface Particle {
  angle: number;
  speed: number;
  radius: number;
  color: string;
}

/**
 * Full-screen Skia particle explosion. A single shared `t` (0→1) drives every
 * particle's position outward from center along its angle, with gravity sag and fade.
 * Skia draws on its own thread; the animation runs ~1.2s then calls onDone.
 *
 * Rendered inside a transparent `Modal` so it portals to the ROOT window — the explosion
 * sits above the parallax hero, bottom sheet, tab bar, everything — rather than being
 * clipped/positioned inside the HoldToStampButton's normal layout. `pointerEvents="none"`
 * + a transparent Modal mean it never blocks touches, and it unmounts after ~1.2s.
 *
 * This is the skeleton — particle motion is parameterized so designers can retune
 * COUNT/COLORS/physics without touching the render loop.
 */
export function CelebrationCanvas({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const cx = width / 2;
  const cy = height * 0.42;
  const t = useSharedValue(0);

  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: PARTICLE_COUNT }, () => ({
        angle: Math.random() * Math.PI * 2,
        speed: 180 + Math.random() * 320,
        radius: 3 + Math.random() * 6,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      })),
    [],
  );

  useEffect(() => {
    t.value = withTiming(1, { duration: 1200, easing: Easing.out(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
  }, []);

  return (
    <Modal transparent statusBarTranslucent animationType="none" visible onRequestClose={onDone}>
      <Canvas style={[StyleSheet.absoluteFill, styles.canvas]} pointerEvents="none">
        <Group>
          {particles.map((p, i) => (
            <ParticleNode key={i} p={p} t={t} cx={cx} cy={cy} />
          ))}
        </Group>
      </Canvas>
    </Modal>
  );
}

function ParticleNode({
  p,
  t,
  cx,
  cy,
}: {
  p: Particle;
  t: SharedValue<number>;
  cx: number;
  cy: number;
}) {
  const x = useDerivedValue(() => cx + Math.cos(p.angle) * p.speed * t.value);
  const y = useDerivedValue(
    () => cy + Math.sin(p.angle) * p.speed * t.value + 600 * t.value * t.value, // gravity
  );
  const opacity = useDerivedValue(() => 1 - t.value);
  const r = useDerivedValue(() => p.radius * (1 - 0.4 * t.value));

  return <Circle cx={x} cy={y} r={r} color={p.color} opacity={opacity} />;
}

const styles = StyleSheet.create({
  canvas: { zIndex: 1000 },
});
```

---

## 🚶 Step-by-Step Execution Guide

1. **Install** `expo-haptics` and `@shopify/react-native-skia`. Both are included in
   Expo Go for SDK 56.

2. **Build the haptics controller** `lib/haptics.ts` (§2): a self-rescheduling tick loop
   whose interval shrinks and impact style intensifies with progress, plus `stop()`
   (early release) and `success()` (completion thud). Wrap all `Haptics.*` in
   `.catch(() => {})` since some Android devices reject rapid calls.

3. **Build `HoldToStampButton`** (§3): a `Gesture.LongPress().minDuration(2000)`. On
   `onBegin` start the progress `withTiming` + haptics; `onStart` (fires only after the
   full 2s) → `onComplete`; `onFinalize` with `success=false` rewinds the ring and stops
   haptics. Use `runOnJS` to bridge worklet → JS callbacks. `onComplete` **awaits**
   `completeItem`, immediately upserts the returned canonical ItemDto, and on failure
   rolls back (`setIsDone(false)`, rewind `progress` to 0,
   cancel the celebration), fires an `Error` notification haptic, and sets a visible
   `error` state with a **Retry** affordance — no swallowed errors.

4. **Build `CelebrationCanvas`** (§4): a Skia `Canvas` with N particles, each driven by a
   single shared `t` via `useDerivedValue` (position outward + gravity + fade), wrapped in
   a transparent `Modal` so it renders at the **root window level** (overlays the parallax
   hero + bottom sheet, not nested in the button). Calls `onDone` when the 1.2s timing
   finishes, which unmounts the Modal.

5. **Wire completion**: `completeItem(itemId)` → `PATCH /api/items/:id/complete`
   (backend/004). Optimistically flip the button to "Completed" and start the
   celebration, then **await** the PATCH; on success upsert the returned DTO immediately
   while Realtime handles other devices, on failure roll back + show the retryable error.

6. Mount the button in the item detail screen (already referenced in frontend/004 §5).

---

## 🧪 Verification & Test Protocols

### A. Full-hold completes, early release cancels (manual)

- Press and hold the button for the full 2s → the fill ring sweeps to 100%, haptics
  escalate, a success thud fires, the label flips to "✓ Completed", and the particle
  explosion plays.
- Press and release at ~1s → the ring rewinds to 0, haptics stop, **no** completion
  (proves `minDuration` + `onFinalize(success=false)` cancel path).

### B. Haptic escalation cadence (manual, iOS device)

Hold and feel: ticks start sparse + light, become rapid + heavy near the end, capped by
a distinct success notification. On Android, confirm it at least vibrates throughout and
ends with the success buzz (granularity will be coarser — expected).

### C. Completion is idempotent / already-done

Open an already-`completed` item → the button renders in the green "✓ Completed" state
and the gesture is inert (`if (isDone) return` in `onBegin`). A repeated `onComplete`
call short-circuits on the `isDone && !error` guard.

### D. API call fires once (in-flight guard)

Add a `console.log`/network watch on `completeItem`. A successful full hold triggers
**exactly one** `PATCH /api/items/:id/complete`. Then force rapid re-fires (e.g. trigger
`onComplete` twice in the same tick, or hold + immediately retap): the `inFlight` ref
ensures still **only one** PATCH is sent while one is pending — the mutation can't
double-fire. Verify in SQL the row now has `status='completed'` and a non-null
`completed_at` (satisfies the `items_completed_consistency_ck` constraint from
backend/001).

### D2. Completion failure rolls back (manual + forced error)

Force `completeItem` to reject (go offline, or stub it to throw). Do a full 2s hold:
- The button flips to "✓ Completed" and the explosion starts (optimistic), **then** the
  awaited PATCH fails → the button reverts to "Hold to mark complete", the fill ring
  rewinds to 0, and the celebration is cancelled (no lingering overlay).
- An **error** haptic fires (`Haptics.NotificationFeedbackType.Error`).
- A visible inline message ("Couldn't save — tap to retry.") with a **Retry** button
  appears; tapping **Retry** re-runs `onComplete` and, once the network is back, succeeds.
- Confirm there is **no** empty `.catch(() => {})` swallowing the failure — the UI never
  claims a completion that didn't persist.

### E. Canvas performance, root-level overlay & teardown

The explosion runs at 60fps (Skia thread). It renders at the **root window level** (the
transparent `Modal`): trigger a completion while the bottom sheet is expanded — the
particles must paint **over** the sheet, hero, and tab bar, not be clipped inside the
button's container. It **unmounts** itself after ~1.2s (`onDone` → `setCelebrate(false)`,
which closes the Modal), leaving no lingering full-screen overlay that would block touches
(`pointerEvents="none"` plus unmount).

### F. Particle tunables

Temporarily set `PARTICLE_COUNT = 200` and confirm it still animates smoothly on a
mid-range device; reset to 80. Confirms the single-shared-value design scales.

✅ **Phase complete when:** a full 2s hold completes the item (escalating haptics +
**exactly one** PATCH guarded by the in-flight ref + DB row updated), early release
cancels cleanly, the Skia explosion plays at the **root window level** (over the sheet/
hero) and self-tears-down, already-completed items render inert, and a **failed**
completion rolls back the button/ring/celebration, fires an error haptic, and surfaces a
visible retry (no swallowed errors, no double-fire). The accessibility action completes
without a sustained hold, announces success, and reduced-motion mode skips the burst.

---

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
