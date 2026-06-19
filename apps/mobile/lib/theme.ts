import { brand, fonts, palette, radius, shadow, space, spacing, type } from "./tokens";

export interface ThemeColors {
  canvas: string;
  surface: string;
  surfaceGlass: string;
  surfaceTint: string;
  borderGlass: string;
  divider: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  accentText: string;
  accentDim: string;
  candy: string;
  candyText: string;
  success: string;
  successTint: string;
  danger: string;
  tabBarBg: string;
  scrim: string;
}

const darkColors: ThemeColors = {
  canvas: "#0C0A14",
  surface: "#15111F",
  surfaceGlass: "rgba(255,255,255,0.06)",
  surfaceTint: "rgba(128,0,255,0.10)",
  borderGlass: "rgba(255,255,255,0.12)",
  divider: "rgba(255,255,255,0.10)",
  textPrimary: "#F4F2FA",
  textSecondary: "rgba(244,242,250,0.62)",
  accent: brand.purps,
  accentText: palette.purps[300],
  accentDim: palette.purps[700],
  candy: brand.candy,
  candyText: palette.candy[300],
  success: palette.green[500],
  successTint: "rgba(52,211,153,0.18)",
  danger: "#FF5A5F",
  tabBarBg: "rgba(12,10,20,0.85)",
  scrim: "rgba(0,0,0,0.6)",
};

const lightColors: ThemeColors = {
  canvas: palette.white,
  surface: palette.grey[50],
  surfaceGlass: "rgba(255,255,255,0.7)",
  surfaceTint: palette.purps[20],
  borderGlass: "rgba(17,17,17,0.10)",
  divider: palette.grey[200],
  textPrimary: palette.grey[900],
  textSecondary: palette.grey[700],
  accent: brand.purps,
  accentText: palette.purps[700],
  accentDim: palette.purps[300],
  candy: brand.candy,
  candyText: palette.candy[600],
  success: palette.green[700],
  successTint: palette.green[100],
  danger: palette.red[600],
  tabBarBg: "rgba(255,255,255,0.85)",
  scrim: "rgba(0,0,0,0.3)",
};

export interface AppTheme {
  mode: "light" | "dark";
  colors: ThemeColors;
  radius: typeof radius;
  spacing: typeof spacing;
  space: typeof space;
  shadow: typeof shadow;
  type: typeof type;
  fonts: typeof fonts;
  palette: typeof palette;
}

export const themes: { dark: AppTheme; light: AppTheme } = {
  dark: {
    mode: "dark",
    colors: darkColors,
    radius,
    spacing,
    space,
    shadow,
    type,
    fonts,
    palette,
  },
  light: {
    mode: "light",
    colors: lightColors,
    radius,
    spacing,
    space,
    shadow,
    type,
    fonts,
    palette,
  },
};
