import { CelebrationCanvas } from "@/components/CelebrationCanvas";
import { completeItem } from "@/lib/api/items";
import { startHapticEscalation } from "@/lib/haptics";
import { useTheme } from "@/lib/useTheme";
import { useItemsStore } from "@/store/items";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const HOLD_MS = 2000;

export function HoldToStampButton({ itemId, completed }: { itemId: string; completed: boolean }) {
  const { colors, radius } = useTheme();
  const reduceMotion = useReducedMotion();
  const upsert = useItemsStore((s) => s.upsert);
  const progress = useSharedValue(completed ? 1 : 0);
  const scale = useSharedValue(1);
  const [isDone, setIsDone] = useState(completed);
  const [celebrate, setCelebrate] = useState(false);
  const [error, setError] = useState(false);
  const hapticsRef = useRef<ReturnType<typeof startHapticEscalation> | null>(null);
  // Guards against double-fire: a full hold and a manual Retry can both invoke onComplete.
  const inFlight = useRef(false);

  useEffect(() => {
    setIsDone(completed);
    progress.value = withTiming(completed ? 1 : 0, { duration: reduceMotion ? 0 : 200 });
  }, [completed, progress, reduceMotion]);

  const onComplete = useCallback(async () => {
    if (inFlight.current) return;
    if (isDone && !error) return;
    inFlight.current = true;
    setError(false);
    hapticsRef.current?.success();
    // Optimistic flip — celebration starts before the PATCH resolves.
    setIsDone(true);
    setCelebrate(!reduceMotion);
    try {
      const updated = await completeItem(itemId);
      upsert(updated);
      AccessibilityInfo.announceForAccessibility("Item marked complete");
    } catch {
      // Roll back: the write failed, so undo the optimistic state entirely.
      setIsDone(false);
      setCelebrate(false);
      cancelAnimation(progress);
      progress.value = withTiming(0, { duration: 250 });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(true);
    } finally {
      inFlight.current = false;
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

  const ringStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  const containerStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <>
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessible
          accessibilityRole="button"
          accessibilityLabel={isDone ? "Item completed" : "Mark item complete"}
          accessibilityHint={
            isDone
              ? undefined
              : "Hold for two seconds, or use the Mark complete accessibility action"
          }
          accessibilityActions={isDone ? [] : [{ name: "activate", label: "Mark complete" }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === "activate") void onComplete();
          }}
          style={[
            styles.button,
            {
              borderRadius: radius.lg,
              borderColor: error ? colors.danger : isDone ? colors.success : colors.accent,
              backgroundColor: isDone ? colors.successTint : colors.accentDim,
            },
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

      {error ? (
        <View style={styles.errorRow}>
          <Text style={[styles.errorText, { color: colors.danger }]}>
            Couldn't save — tap to retry.
          </Text>
          <Pressable
            onPress={retry}
            accessibilityRole="button"
            accessibilityLabel="Retry completing this item"
            style={[styles.retryBtn, { borderColor: colors.danger, borderRadius: radius.md }]}
          >
            <Text style={[styles.retryText, { color: colors.danger }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {celebrate ? <CelebrationCanvas onDone={() => setCelebrate(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: 20,
    height: 60,
    overflow: "hidden",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fill: { position: "absolute", left: 0, top: 0, bottom: 0, opacity: 0.45 },
  label: { fontWeight: "800", fontSize: 16 },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 10,
  },
  errorText: { flex: 1, fontSize: 13, fontWeight: "600" },
  retryBtn: { paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1 },
  retryText: { fontSize: 13, fontWeight: "700" },
});
