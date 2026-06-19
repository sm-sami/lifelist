import * as Haptics from "expo-haptics";

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
    if (p >= 1) return;
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
