import { Canvas, Circle, Group } from "@shopify/react-native-skia";
import { useEffect, useMemo } from "react";
import { Modal, StyleSheet, useWindowDimensions } from "react-native";
import Animated, {
  type SharedValue,
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

const PARTICLE_COUNT = 80;
const COLORS = ["#8000ff", "#ff007a", "#b266ff", "#15d676", "#ffbc00", "#ffffff"];

interface Particle {
  angle: number;
  speed: number;
  radius: number;
  color: string;
}

// Rendered inside a transparent Modal so particles overlay the parallax hero,
// bottom sheet, and tab bar rather than being clipped in the button's layout.
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
  }, [t, onDone]);

  return (
    <Modal transparent statusBarTranslucent animationType="none" visible onRequestClose={onDone}>
      <Canvas style={[StyleSheet.absoluteFill, styles.canvas]} pointerEvents="none">
        <Group>
          {particles.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable particle array, index is safe
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
  // gravity term: 600 * t² sags particles downward over time
  const y = useDerivedValue(
    () => cy + Math.sin(p.angle) * p.speed * t.value + 600 * t.value * t.value,
  );
  const opacity = useDerivedValue(() => 1 - t.value);
  const r = useDerivedValue(() => p.radius * (1 - 0.4 * t.value));

  return <Circle cx={x} cy={y} r={r} color={p.color} opacity={opacity} />;
}

const styles = StyleSheet.create({
  canvas: { zIndex: 1000 },
});
