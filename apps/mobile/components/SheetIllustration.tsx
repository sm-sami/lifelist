import { useTheme } from "@/lib/useTheme";
import { Circle, G, Line, Path, Svg } from "react-native-svg";

export function EmptyIllustration() {
  const { colors } = useTheme();
  const dim = colors.textSecondary;
  const accent = colors.accent;

  return (
    <Svg width={96} height={96} viewBox="0 0 96 96">
      {/* Compass circle */}
      <Circle
        cx={48}
        cy={48}
        r={38}
        stroke={dim}
        strokeWidth={1.5}
        fill="none"
        strokeOpacity={0.4}
      />
      <Circle cx={48} cy={48} r={30} stroke={dim} strokeWidth={1} fill="none" strokeOpacity={0.2} />
      {/* N/S needle */}
      <Path d="M48 18 L53 48 L48 44 L43 48 Z" fill={accent} opacity={0.9} />
      <Path d="M48 78 L53 48 L48 52 L43 48 Z" fill={dim} opacity={0.5} />
      {/* E/W ticks */}
      <Line x1={16} y1={48} x2={22} y2={48} stroke={dim} strokeWidth={1.5} strokeOpacity={0.4} />
      <Line x1={74} y1={48} x2={80} y2={48} stroke={dim} strokeWidth={1.5} strokeOpacity={0.4} />
      {/* Center dot */}
      <Circle cx={48} cy={48} r={3} fill={accent} opacity={0.9} />
      {/* Cardinal labels */}
      <Line x1={48} y1={10} x2={48} y2={16} stroke={dim} strokeWidth={1.5} strokeOpacity={0.4} />
      <Line x1={48} y1={80} x2={48} y2={86} stroke={dim} strokeWidth={1.5} strokeOpacity={0.4} />
    </Svg>
  );
}

export function FilterEmptyIllustration() {
  const { colors } = useTheme();
  const dim = colors.textSecondary;
  const accent = colors.accent;

  return (
    <Svg width={112} height={112} viewBox="0 0 112 112">
      <G opacity={0.9}>
        {/* Funnel / filter shape */}
        <Path
          d="M18 26 L46 58 L46 84 L66 74 L66 58 L94 26 Z"
          stroke={dim}
          strokeWidth={2}
          fill="none"
          strokeOpacity={0.35}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Horizontal lines inside funnel (filter slots) */}
        <Line
          x1={28}
          y1={38}
          x2={84}
          y2={38}
          stroke={dim}
          strokeWidth={1.5}
          strokeOpacity={0.25}
          strokeLinecap="round"
        />
        <Line
          x1={36}
          y1={48}
          x2={76}
          y2={48}
          stroke={dim}
          strokeWidth={1.5}
          strokeOpacity={0.2}
          strokeLinecap="round"
        />
        {/* Accent dot — the "nothing matched" indicator */}
        <Circle cx={56} cy={70} r={7} fill={accent} opacity={0.15} />
        <Circle cx={56} cy={70} r={4} fill={accent} opacity={0.6} />
        {/* Small cross over the dot */}
        <Line
          x1={53}
          y1={67}
          x2={59}
          y2={73}
          stroke={accent}
          strokeWidth={1.8}
          strokeLinecap="round"
          opacity={0.9}
        />
        <Line
          x1={59}
          y1={67}
          x2={53}
          y2={73}
          stroke={accent}
          strokeWidth={1.8}
          strokeLinecap="round"
          opacity={0.9}
        />
      </G>
    </Svg>
  );
}

export function ErrorIllustration() {
  const { colors } = useTheme();
  const dim = colors.textSecondary;
  const danger = colors.danger;

  return (
    <Svg width={96} height={96} viewBox="0 0 96 96">
      <G opacity={0.85}>
        {/* Cloud body */}
        <Path
          d="M30 62 Q18 62 18 50 Q18 40 28 38 Q28 26 40 26 Q48 26 52 32 Q56 28 62 28 Q74 28 74 40 Q82 42 82 52 Q82 62 70 62"
          stroke={dim}
          strokeWidth={1.8}
          fill="none"
          strokeOpacity={0.45}
          strokeLinecap="round"
        />
        {/* Crack / break line through cloud */}
        <Path
          d="M44 40 L50 50 L44 54 L52 66"
          stroke={danger}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.8}
        />
        {/* Rain drops */}
        <Line
          x1={34}
          y1={70}
          x2={32}
          y2={78}
          stroke={dim}
          strokeWidth={1.5}
          strokeOpacity={0.35}
          strokeLinecap="round"
        />
        <Line
          x1={48}
          y1={72}
          x2={46}
          y2={80}
          stroke={dim}
          strokeWidth={1.5}
          strokeOpacity={0.35}
          strokeLinecap="round"
        />
        <Line
          x1={62}
          y1={70}
          x2={60}
          y2={78}
          stroke={dim}
          strokeWidth={1.5}
          strokeOpacity={0.35}
          strokeLinecap="round"
        />
      </G>
    </Svg>
  );
}
