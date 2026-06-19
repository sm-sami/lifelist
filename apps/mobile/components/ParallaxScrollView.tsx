import { useTheme } from "@/lib/useTheme";
import { Image } from "expo-image";
import type { ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedRef,
  useAnimatedStyle,
  useReducedMotion,
  useScrollViewOffset,
} from "react-native-reanimated";

const HEADER_HEIGHT_RATIO = 0.55;

interface Props {
  imageUrl?: string | null;
  gradient: readonly [string, string];
  children: ReactNode;
  headerOverlay?: ReactNode;
}

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
    // Positive scroll offset → negative translateY: hero drifts upward at half scroll speed.
    // Pull-down (negative offset) keeps translateY at 0 and lets scale stretch.
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
