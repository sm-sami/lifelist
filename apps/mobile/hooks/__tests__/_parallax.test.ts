import { describe, expect, test } from "@jest/globals";

// Pure interpolation math used by ParallaxScrollView worklet.
// Mirrors react-native-reanimated's interpolate with CLAMP extrapolation.
function lerp(
  inputRange: [number, number, number],
  outputRange: [number, number, number],
  value: number,
): number {
  const [i0, i1, i2] = inputRange;
  const [o0, o1, o2] = outputRange;
  const clamped = Math.max(i0, Math.min(i2, value));
  if (clamped <= i1) {
    return o0 + ((clamped - i0) / (i1 - i0)) * (o1 - o0);
  }
  return o1 + ((clamped - i1) / (i2 - i1)) * (o2 - o1);
}

const H = 400;

describe("parallax interpolation", () => {
  test("pull-down scales up to 2x; scroll-up moves hero UP at half speed", () => {
    const scaleAt = (v: number) => lerp([-H, 0, H], [2, 1, 1], v);
    const translateAt = (v: number) => lerp([-H, 0, H], [0, 0, -H * 0.5], v);

    // scale: pull-down → 2x, rest → 1x
    expect(scaleAt(-H)).toBeCloseTo(2);
    expect(scaleAt(0)).toBeCloseTo(1);
    expect(scaleAt(H)).toBeCloseTo(1);

    // translateY: positive offset → negative (hero drifts upward) at half speed
    expect(translateAt(0)).toBeCloseTo(0);
    expect(translateAt(-H)).toBeCloseTo(0);

    const tY = translateAt(H);
    expect(tY).toBeCloseTo(-H * 0.5);
    expect(tY).toBeLessThan(0);
  });
});
