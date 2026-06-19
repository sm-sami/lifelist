/** Headout core palette (subset we use), from @headout/dot coreColors. */
export const palette = {
  purps: {
    10: "#f8f6ff",
    20: "#f3e9ff",
    30: "#ecd9ff",
    50: "#d9b3ff",
    100: "#cc99ff",
    300: "#b266ff",
    400: "#9933ff",
    500: "#8000ff",
    600: "#7300e5",
    700: "#6600cc",
    800: "#330066",
    900: "#150029",
  },
  candy: {
    100: "#fff2f8",
    200: "#ffe5f2",
    300: "#ff66af",
    400: "#fe3394",
    500: "#ff007a",
    600: "#e5006e",
    700: "#cc0062",
    800: "#660031",
  },
  grey: {
    50: "#fafafa",
    100: "#f8f8f8",
    200: "#f0f0f0",
    300: "#e2e2e2",
    400: "#c4c4c4",
    500: "#9f9f9f",
    600: "#888888",
    700: "#666666",
    800: "#444444",
    900: "#222222",
  },
  green: { 100: "#f1fff2", 500: "#15d676", 700: "#078842" },
  red: { 100: "#ffe5e5", 500: "#ef0404", 600: "#d60404" },
  white: "#ffffff",
  black: "#111111",
} as const;

export const brand = {
  purps: palette.purps[500],
  candy: palette.candy[500],
} as const;

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

export const spacing = (n: number) => n * 4;
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const shadow = {
  level1: {
    shadowColor: palette.black,
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  level2: {
    shadowColor: palette.black,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  level3: {
    shadowColor: palette.black,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

/**
 * Brand-neutral font family aliases. lib/fonts.ts registers whichever real font
 * files are present (free Sora/Hanken Grotesk fallback by default, Halyard when
 * the licence is cleared) under exactly these names. No component changes when
 * the family is swapped.
 */
export const fonts = {
  displayMedium: "BrandDisplay-Medium",
  textBook: "BrandText-Book",
  textMedium: "BrandText-Medium",
  textSemiBold: "BrandText-SemiBold",
  textBold: "BrandText-Bold",
} as const;

export const type = {
  displayLarge: { fontFamily: fonts.displayMedium, fontSize: 36, lineHeight: 44 },
  displaySmall: { fontFamily: fonts.displayMedium, fontSize: 30, lineHeight: 38 },
  headingLarge: { fontFamily: fonts.textSemiBold, fontSize: 24, lineHeight: 28 },
  headingRegular: { fontFamily: fonts.textSemiBold, fontSize: 18, lineHeight: 24 },
  headingSmall: { fontFamily: fonts.textSemiBold, fontSize: 15, lineHeight: 20 },
  cta: { fontFamily: fonts.textMedium, fontSize: 16, lineHeight: 20 },
  paraLarge: { fontFamily: fonts.textBook, fontSize: 17, lineHeight: 28 },
  paraRegular: { fontFamily: fonts.textBook, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.textBook, fontSize: 13, lineHeight: 18 },
  tag: { fontFamily: fonts.textMedium, fontSize: 11, lineHeight: 14, letterSpacing: 0.4 },
} as const;
