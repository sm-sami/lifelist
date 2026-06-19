# Frontend 001 — Expo Router Scaffolding

> Phase 1 of the Lifelist app. Establishes the Expo (React Native) project with
> `expo-router` file-based routing, light + dark theming (dark-primary, canvas
> `#0C0A14`) built on Headout's real design tokens, and the
> Supabase JS client configured for native auth-token persistence so sessions survive
> app restarts.

---

## 🎯 Objective

1. Lay out the complete `expo-router` directory tree: a root layout, an auth gate, a
   `(tabs)` group (Dashboard), a modal group for Smart-Add, and the dynamic
   item-detail route — all protected routes gated behind a route-group guard.
2. Ship both light and dark themes (dark is primary; canvas `#0C0A14`) using Headout's
   brand tokens, switchable at runtime and persisted.
3. Initialize the Supabase JS client with `AsyncStorage` persistence, `processLock`
   (so concurrent native auth calls don't deadlock init), and `AppState` token
   auto-refresh, and provide an `AuthProvider` + `useAuth` hook that gates the app via
   **expo-router protected route groups** and exposes the access token to the API layer
   (integration/001).

---

## 💻 Code & Configuration Blueprints

### 1. Dependencies

```bash
pnpm create expo-app apps/mobile --template tabs@sdk-56
cd apps/mobile
pnpm expo install expo-router expo-blur expo-haptics expo-image expo-font \
  react-native-reanimated react-native-worklets react-native-gesture-handler \
  react-native-safe-area-context react-native-screens react-native-edge-to-edge \
  @react-native-async-storage/async-storage \
  @supabase/supabase-js
pnpm add zustand
# Test deps (frontend test snippets import these — also declared in 000):
pnpm add -D @testing-library/react-native
```

`react-native-edge-to-edge` + `expo-font` are added here for the Android system-bar
handling (§7b) and the free-fallback / Halyard font bundling (§5b).
`react-native-worklets` is the standalone worklets runtime used by Reanimated 4.
`babel-preset-expo` configures the required plugin automatically. React Native Testing
Library includes its Jest matchers; do not install the deprecated
`@testing-library/jest-native` package.

> **Pin versions — don't float them.** This app targets **Expo SDK 56**. Pin the SDK
> explicitly in `package.json` (`"expo": "~56.0.0"`) and let `pnpm expo install` resolve
> every Expo-managed native dependency (reanimated, gesture-handler, expo-image, etc.) to
> the versions that match SDK 56 — `expo install` does this automatically, which is why we
> use it instead of `pnpm add` for native packages. Do **not** bump individual native
> packages off the SDK-pinned versions; mismatches between reanimated/gesture-handler and
> the SDK are the usual cause of cryptic worklet/native crashes. The same SDK number (56)
> is used consistently throughout this doc (`app.config.ts` `sdkVersion`, the Expo Go steps,
> and the verification notes).

### 2. Directory tree (expo-router)

```
app/
├── _layout.tsx               # Root: providers, gesture root, theme, Stack w/ Stack.Protected guard
├── index.tsx                 # Redirect → /(protected)/(tabs) or /(auth)/sign-in based on session
├── (auth)/
│   ├── _layout.tsx           # Stack for unauthenticated screens
│   └── sign-in.tsx           # Email/password (or magic link) sign-in
├── (protected)/              # Route group gated by the session guard (deep links included)
│   ├── (tabs)/
│   │   ├── _layout.tsx       # Dark-themed Tabs navigator (Dashboard)
│   │   └── index.tsx         # Dashboard (frontend/002)
│   ├── item/
│   │   └── [id].tsx          # Item detail w/ parallax + bottom sheet (frontend/004)
│   └── modals/
│       └── add-item.tsx      # Smart-Add overlay (frontend/003)

components/                   # GlassContainer, DustyOverlay, etc. (frontend/002+)
assets/
└── fonts/                    # Halyard*.otf (licence-gated, §5b) OR free fallback (Sora / Hanken Grotesk)
lib/
├── supabase.ts               # Supabase client (this phase)
├── tokens.ts                 # Headout primitives: palette, radii, spacing, shadow, type
├── theme.ts                  # light + dark semantic palettes (dark = primary)
├── useTheme.tsx              # ThemeModeProvider + useTheme()/useThemeMode()
├── fonts.ts                  # Halyard registration (expo-font)
└── auth.tsx                  # AuthProvider + useAuth
hooks/                        # useDebounce, etc. (frontend/003+)
store/                        # zustand stores (integration/001)
app.config.ts
babel.config.js
```

### 3. `app.config.ts` (expo-router + reanimated essentials)

```ts
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Lifelist",
  slug: "lifelist",
  scheme: "lifelist",
  sdkVersion: "56.0.0",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  plugins: ["expo-router", "react-native-edge-to-edge"],
  ios: { supportsTablet: true, bundleIdentifier: "com.lifelist.app" },
  android: {
    package: "com.lifelist.app",
    edgeToEdgeEnabled: true,
    navigationBar: { barStyle: "light-content", backgroundColor: "#00000000" },
  },
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  },
};

export default config;
```

> - `userInterfaceStyle: "automatic"` lets the app render both light and dark (the
>   in-app toggle still overrides via `ThemeModeProvider`; default preference is dark).
> - `edgeToEdgeEnabled` + `react-native-edge-to-edge` make Android draw under the
>   system bars (the modern Expo default) — which is exactly why every screen must use
>   safe-area insets (§7b).
> - The **publishable** key is safe to ship (gated by RLS); secret + third-party keys
>   live only on the backend.
> - **Fonts are NOT pinned in `plugins` here** because the default build ships the free
>   Sora / Hanken Grotesk fallback (loaded at runtime via `@expo-google-fonts/*`, which
>   need no `expo-font` config plugin). The `expo-font` plugin entry that bundles the
>   licensed `Halyard*.otf` files is added **only** when the licence is cleared and the
>   files are present (§5b) — listing missing `.otf` paths in `plugins` would fail the
>   build, which is the bug this avoids.

### 4. `babel.config.js`

Reanimated 4 and Worklets require no manual Babel plugin under Expo SDK 56:
`babel-preset-expo` configures it automatically.

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
```

### 5. Design tokens & theming — `lib/tokens.ts`, `lib/theme.ts`, `lib/useTheme.tsx`

> These values are pulled from Headout's real mobile design system (`@headout/dot` in
> the `fresh-aer` monorepo; brand purple **`#8000ff`** "purps", accent pink
> **`#ff007a`** "candy", grey ramp, okaygreen/warningred). We ship **two themes**:
> **dark is the primary/default** (our glassmorphism aesthetic), and a **light** theme
> that follows Headout's flat, white, color-blocked look. Both reuse the same brand
> hues, radii, spacing, and shadow scale so the app reads as Headout in either mode.

#### `lib/tokens.ts` — mode-agnostic primitives (Headout palette, radii, spacing, shadows)

```ts
// lib/tokens.ts
/** Headout core palette (subset we use), from @headout/dot coreColors. */
export const palette = {
  purps: {
    10: "#f8f6ff", 20: "#f3e9ff", 30: "#ecd9ff", 50: "#d9b3ff", 100: "#cc99ff",
    300: "#b266ff", 400: "#9933ff", 500: "#8000ff", 600: "#7300e5", 700: "#6600cc",
    800: "#330066", 900: "#150029",
  },
  candy: {
    100: "#fff2f8", 200: "#ffe5f2", 300: "#ff66af", 400: "#fe3394", 500: "#ff007a",
    600: "#e5006e", 700: "#cc0062", 800: "#660031",
  },
  grey: {
    50: "#fafafa", 100: "#f8f8f8", 200: "#f0f0f0", 300: "#e2e2e2", 400: "#c4c4c4",
    500: "#9f9f9f", 600: "#888888", 700: "#666666", 800: "#444444", 900: "#222222",
  },
  green: { 100: "#f1fff2", 500: "#15d676", 700: "#078842" },
  red: { 100: "#ffe5e5", 500: "#ef0404", 600: "#d60404" },
  white: "#ffffff",
  black: "#111111", // Headout brand black (not pure #000)
} as const;

/** Brand constants — identical in both themes. */
export const brand = {
  purps: palette.purps[500], // #8000ff — primary
  candy: palette.candy[500], // #ff007a — accent
} as const;

/** Radii (Headout: small radii; 12 = default for buttons/sheets, 8 inner, 4 chips). */
export const radius = { xs: 4, sm: 6, md: 8, lg: 12, xl: 16, pill: 999 } as const;

/** Spacing — Headout uses a 4-based scale. spacing(4) === 16 (the workhorse). */
export const spacing = (n: number) => n * 4;
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48 } as const;

/** Shadows — Headout: subtle, soft, shadowColor #111 @ ~0.10 opacity. */
export const shadow = {
  level1: { shadowColor: palette.black, shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  level2: { shadowColor: palette.black, shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  level3: { shadowColor: palette.black, shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
} as const;

/**
 * Typography family names. These are MODE-NEUTRAL aliases — they do NOT hardcode
 * "Halyard". `lib/fonts.ts` registers whichever real font files are present (the free
 * Sora / Hanken Grotesk fallback by default, or the licensed Halyard set once cleared)
 * under exactly these alias strings, so the whole type scale below is agnostic and no
 * component changes when the family is swapped. (See §5b.)
 */
export const fonts = {
  displayMedium: "BrandDisplay-Medium",
  textBook: "BrandText-Book", // weight 300 — airy default body
  textMedium: "BrandText-Medium", // 500
  textSemiBold: "BrandText-SemiBold", // 600
  textBold: "BrandText-Bold", // 700
} as const;

export const type = {
  displayLarge: { fontFamily: fonts.displayMedium, fontSize: 36, lineHeight: 44 },
  displaySmall: { fontFamily: fonts.displayMedium, fontSize: 30, lineHeight: 38 },
  headingLarge: { fontFamily: fonts.textSemiBold, fontSize: 24, lineHeight: 28 },
  headingRegular: { fontFamily: fonts.textSemiBold, fontSize: 18, lineHeight: 24 },
  headingSmall: { fontFamily: fonts.textSemiBold, fontSize: 15, lineHeight: 20 },
  cta: { fontFamily: fonts.textMedium, fontSize: 16, lineHeight: 20 },
  paraLarge: { fontFamily: fonts.textBook, fontSize: 17, lineHeight: 28 }, // body, light 300
  paraRegular: { fontFamily: fonts.textBook, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: fonts.textBook, fontSize: 13, lineHeight: 18 },
  tag: { fontFamily: fonts.textMedium, fontSize: 11, lineHeight: 14, letterSpacing: 0.4 },
} as const;
```

#### `lib/theme.ts` — light & dark semantic palettes (dark = primary)

```ts
// lib/theme.ts
import { palette, brand, radius, spacing, space, shadow, type, fonts } from "./tokens";

/**
 * Semantic color tokens. The KEY NAMES are stable across modes, so components read
 * e.g. colors.accent / colors.canvas / colors.textPrimary and automatically adapt.
 * Dark is our primary glassmorphism theme; light follows Headout's flat white look.
 *
 * IMPORTANT (TS): both palettes must be typed against a SHARED interface, not against
 * `typeof darkColors`. If light is typed `typeof darkColors`, TS infers each dark value
 * as its literal string (e.g. canvas: "#0C0A14") and then rejects the light palette's
 * different literals ("#0C0A14" is not assignable to "#ffffff"). `ThemeColors` widens
 * every token to `string`, so light and dark are mutually assignable.
 */
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
  canvas: "#0C0A14", // near-black, faint purps tint
  surface: "#15111F", // raised solid surface
  surfaceGlass: "rgba(255,255,255,0.06)", // frosted glass fill
  surfaceTint: "rgba(128,0,255,0.10)", // purps-tinted card wash
  borderGlass: "rgba(255,255,255,0.12)", // alpha glass border
  divider: "rgba(255,255,255,0.10)",
  textPrimary: "#F4F2FA",
  textSecondary: "rgba(244,242,250,0.62)",
  accent: brand.purps, // #8000ff for fills/borders
  accentText: palette.purps[300], // #b266ff — legible purps on dark
  accentDim: palette.purps[700],
  candy: brand.candy, // #ff007a
  candyText: palette.candy[300], // #ff66af on dark
  success: palette.green[500],
  successTint: "rgba(52,211,153,0.18)",
  danger: "#FF5A5F",
  tabBarBg: "rgba(12,10,20,0.85)",
  scrim: "rgba(0,0,0,0.6)",
};

const lightColors: ThemeColors = {
  canvas: palette.white, // Headout: white canvas
  surface: palette.grey[50],
  surfaceGlass: "rgba(255,255,255,0.7)",
  surfaceTint: palette.purps[20], // #f3e9ff pale-purple card (Headout surface.light.primary)
  borderGlass: "rgba(17,17,17,0.10)", // hairline grey divider
  divider: palette.grey[200],
  textPrimary: palette.grey[900], // #222
  textSecondary: palette.grey[700], // #666
  accent: brand.purps,
  accentText: palette.purps[700], // #6600cc link.primary on light
  accentDim: palette.purps[300],
  candy: brand.candy,
  candyText: palette.candy[600],
  success: palette.green[700],
  successTint: palette.green[100],
  danger: palette.red[600],
  tabBarBg: "rgba(255,255,255,0.85)",
  scrim: "rgba(0,0,0,0.3)",
};

/**
 * A single theme shape both modes satisfy. `colors` is the shared `ThemeColors`
 * interface (not the dark-literal type), so `themes.light` and `themes.dark` have the
 * SAME type and `AppTheme` is their common shape — `useTheme()` can hand back either.
 */
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
  dark: { mode: "dark", colors: darkColors, radius, spacing, space, shadow, type, fonts, palette },
  light: { mode: "light", colors: lightColors, radius, spacing, space, shadow, type, fonts, palette },
};
```

#### `lib/useTheme.tsx` — mode provider + hook (system / light / dark, dark default)

```tsx
// lib/useTheme.tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { themes, type AppTheme } from "./theme";

export type ThemeMode = "system" | "light" | "dark";
const STORAGE_KEY = "lifelist.themeMode";

interface ThemeContextValue {
  theme: AppTheme;
  mode: ThemeMode; // the user's preference
  resolved: "light" | "dark"; // what's actually shown
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Wrap the app in this (root layout). Default preference is "dark" (our primary look);
 * "system" follows the OS via useColorScheme; the choice is persisted to AsyncStorage.
 */
export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const [mode, setModeState] = useState<ThemeMode>("dark"); // PRIMARY = dark

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === "light" || v === "dark" || v === "system") setModeState(v);
    });
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    void AsyncStorage.setItem(STORAGE_KEY, m);
  };

  const resolved: "light" | "dark" =
    mode === "system" ? (system === "light" ? "light" : "dark") : mode;

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: themes[resolved], mode, resolved, setMode }),
    [resolved, mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Primary accessor used by every component instead of a static `theme` import. */
export function useTheme(): AppTheme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeModeProvider");
  return ctx.theme;
}

/** For the settings toggle (system / light / dark). */
export function useThemeMode() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeMode must be used within ThemeModeProvider");
  return ctx;
}
```

> **Theming rule (applies to every frontend doc):** there is **no** static `theme`
> export — components always call `const { colors, radius, type } = useTheme()` inside
> the component body and build styles from those. For `StyleSheet.create`, either inline the
> dynamic colors via the `style={[...]}` array or use a `useThemedStyles(factory)` helper
> (a `useMemo` over `useTheme()`). The token **names** are unchanged, so it's a
> mechanical swap from `theme.colors.X` → `colors.X`. frontend/002 shows the pattern.

### 5b. Halyard fonts — bundle + load

> ⚠️ **Halyard is a PROPRIETARY, licensed font — do NOT copy the `.otf` files into this
> repo or any build until you have confirmed redistribution rights.** Halyard is owned by
> Headout (via its type licensor); the copies in the `proteus` repo are licensed for
> Headout's own products and that licence does **not** automatically extend to bundling the
> binaries into a new app, an open-source repo, or an OTA/EAS build artifact. Bundling a
> font you don't have rights to is a licence violation. **Before** copying
> `Halyard*.otf`, confirm with whoever owns the Headout font licence that this app is
> covered.
>
> **Safe default if rights are NOT confirmed:** ship a free, license-clean fallback —
> **Sora** for display/headings and **Hanken Grotesk** for body — both available under the
> SIL Open Font License (redistributable, embeddable). Pull them via `@expo-google-fonts/sora`
> / `@expo-google-fonts/hanken-grotesk` (or download the `.ttf`s) and point the
> `fonts.*` family names in `lib/tokens.ts` at them. The whole design system reads from
> those token names, so swapping the family strings is the only change needed — no
> component edits. Treat Halyard as an upgrade to flip on **once the licence is cleared**,
> not a launch blocker.

The fallback path must work **end-to-end with no Halyard files on disk**. The default
build registers free Google fonts (Sora + Hanken Grotesk) under the brand-neutral alias
names from `lib/tokens.ts` (`BrandDisplay-Medium`, `BrandText-Book`, …). When the
Halyard licence is cleared, drop the `.otf`s into `assets/fonts/` and flip
`USE_HALYARD = true` — same alias names, so nothing else changes.

```bash
# Free, license-clean fallback fonts (default — no Halyard needed):
pnpm add @expo-google-fonts/sora @expo-google-fonts/hanken-grotesk
```

```ts
// lib/fonts.ts — register the active font set under the brand-neutral aliases.
import { useFonts } from "expo-font";
import {
  Sora_500Medium,
} from "@expo-google-fonts/sora";
import {
  HankenGrotesk_300Light,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from "@expo-google-fonts/hanken-grotesk";

/**
 * Flip to `true` ONLY after the Halyard licence is confirmed AND the .otf files exist at
 * assets/fonts/ (and the expo-font plugin entry is added to app.config.ts — see §3). Until
 * then this stays `false` and the app ships the free Sora / Hanken Grotesk fallback,
 * which requires no local font files and no config plugin.
 */
const USE_HALYARD = false;

// Free fallback: Sora for display, Hanken Grotesk for the text ramp. Mapped to the SAME
// alias family names the design tokens use, so the type scale is unchanged.
const fallbackFonts = {
  "BrandDisplay-Medium": Sora_500Medium,
  "BrandText-Book": HankenGrotesk_300Light, // airy 300 body
  "BrandText-Medium": HankenGrotesk_500Medium,
  "BrandText-SemiBold": HankenGrotesk_600SemiBold,
  "BrandText-Bold": HankenGrotesk_700Bold,
};

// Licensed Halyard set — only referenced when USE_HALYARD is true, so the require()s are
// never evaluated (and never fail) while the files are absent.
function halyardFonts(): Record<string, number> {
  return {
    "BrandDisplay-Medium": require("@/assets/fonts/HalyardDisMed.otf"),
    "BrandText-Book": require("@/assets/fonts/HalyardTextBook.otf"),
    "BrandText-Medium": require("@/assets/fonts/HalyardTextMed.otf"),
    "BrandText-SemiBold": require("@/assets/fonts/HalyardTextSemiBold.otf"),
    "BrandText-Bold": require("@/assets/fonts/HalyardText-Bold.otf"),
  };
}

/** Returns [loaded, error]. Loads whichever set is active; aliases stay identical. */
export function useBrandFonts() {
  return useFonts(USE_HALYARD ? halyardFonts() : fallbackFonts);
}
```

> Only when `USE_HALYARD` is `true` do you also add the `["expo-font", { fonts: [...] }]`
> plugin entry (the licensed `.otf` paths) to `app.config.ts` §3. The default fallback uses
> `@expo-google-fonts/*` modules, which need no config plugin.

### 6. Supabase client — `lib/supabase.ts`

```ts
// lib/supabase.ts
import "react-native-url-polyfill/auto"; // required for supabase-js fetch URL parsing
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, processLock } from "@supabase/supabase-js";
import { AppState } from "react-native";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as
  | { supabaseUrl?: string; supabasePublishableKey?: string }
  | undefined;
const supabaseUrl = extra?.supabaseUrl;
const supabasePublishableKey = extra?.supabasePublishableKey;

// Safe init failure path: a missing/typo'd env should throw a CLEAR error at startup,
// not a cryptic "Invalid URL" deep inside supabase-js (or a silently broken client).
if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "[supabase] Missing supabaseUrl / supabasePublishableKey in Expo config `extra`. " +
      "Set them (§3) before launching.",
  );
}

/**
 * Supabase client tuned for React Native:
 *  - storage: AsyncStorage so the session survives app restarts.
 *  - autoRefreshToken: refreshes the access token before expiry.
 *  - persistSession: write the session to storage.
 *  - detectSessionInUrl: false — there is no URL to parse on native.
 *  - lock: processLock — serializes concurrent auth calls (getSession +
 *    onAuthStateChange firing at once). WITHOUT it, supabase-js on native can deadlock
 *    during init and the app hangs forever on the font/auth gate. This is the
 *    RN-recommended lock from supabase-js.
 */
export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});

/**
 * Supabase only auto-refreshes while a timer is alive. On native we must tie refresh
 * to foreground/background: start refresh when active, stop when backgrounded.
 */
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
```

Install the polyfill: `pnpm expo install react-native-url-polyfill expo-constants`.

### 7. Auth provider + hook — `lib/auth.tsx`

```tsx
// lib/auth.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

interface AuthState {
  session: Session | null;
  loading: boolean;
  /** Always-fresh access token for the API layer (integration/001). */
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 1. Hydrate the persisted session on launch. ALWAYS clear `loading` (even on
    //    error) so a failed/locked init can't leave the app stuck on the gate forever.
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
    // 2. Subscribe to all subsequent auth changes (sign-in, refresh, sign-out).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    session,
    loading,
    getToken: async () => {
      // getSession returns the cached session; supabase refreshes it under the hood.
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

### 8. Root layout — `app/_layout.tsx`

```tsx
// app/_layout.tsx
import "react-native-gesture-handler"; // must be imported first
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SystemBars } from "react-native-edge-to-edge";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { View } from "react-native";
import { useAuth, AuthProvider } from "@/lib/auth";
import { ThemeModeProvider, useTheme, useThemeMode } from "@/lib/useTheme";
import { useBrandFonts } from "@/lib/fonts";

/** Inner shell: needs to be INSIDE ThemeModeProvider to read the active theme. */
function Shell() {
  const theme = useTheme();
  const { resolved } = useThemeMode();
  const { session, loading: authLoading } = useAuth();
  const [fontsLoaded, fontError] = useBrandFonts();
  const isAuthed = !!session;

  // Don't hang forever on a font failure: once fonts load OR error, proceed (system
  // font is an acceptable degraded state — far better than an infinite blank canvas).
  if (!fontsLoaded && !fontError) {
    // Block first paint until the brand font is ready, on the correct canvas color.
    return <View style={{ flex: 1, backgroundColor: theme.colors.canvas }} />;
  }

  // Do not mount either route guard until persisted auth has resolved. Otherwise a
  // returning user briefly looks signed out and can be redirected to the auth group.
  if (authLoading) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.canvas }} />;
  }

  const navTheme = resolved === "dark" ? DarkTheme : DefaultTheme;
  const nav = {
    ...navTheme,
    colors: { ...navTheme.colors, background: theme.colors.canvas, card: theme.colors.canvas },
  };

  return (
    <ThemeProvider value={nav}>
      {/* Status + Android nav bar icons flip with the theme; bars stay transparent (edge-to-edge). */}
      <StatusBar style={resolved === "dark" ? "light" : "dark"} />
      <SystemBars style={resolved === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.canvas } }}>
        {/*
          Auth gating uses expo-router protected route groups.
          `Stack.Protected guard={isAuthed}` makes ALL routes in the (protected) group —
          tabs, item/[id], modals — reachable only with a session. A deep link straight
          into a protected route with no session is redirected to the guard's anchor
          (the first matching unguarded route, here /(auth)/sign-in), instead of
          rendering. This replaces the old "only the index redirect is guarded" approach,
          which let deep links bypass the gate.

          The shell returns its loading canvas before this Stack mounts while auth is
          hydrating; once resolved, the guards reflect `isAuthed`.
        */}
        <Stack.Protected guard={isAuthed}>
          <Stack.Screen name="(protected)" />
        </Stack.Protected>
        <Stack.Protected guard={!isAuthed}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Screen name="index" />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeModeProvider>
          <AuthProvider>
            <Shell />
          </AuthProvider>
        </ThemeModeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

### 8b. Protected group layout — `app/(protected)/_layout.tsx`

The `(protected)` group owns the presentation options for its routes (tabs, item
detail, the transparent modal). The group is only mounted when `Stack.Protected`'s guard
passes (§8), so this layout never renders without a session — but it also redundantly
redirects on a falsy session as a defensive belt-and-suspenders for any future nested
deep link.

```tsx
// app/(protected)/_layout.tsx
import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/useTheme";

export default function ProtectedLayout() {
  const { session, loading } = useAuth();
  const { colors } = useTheme();

  // Defensive: the parent Stack.Protected guard already gates this, but if a session
  // expires mid-session, bounce to sign-in rather than show protected chrome.
  if (!loading && !session) return <Redirect href="/(auth)/sign-in" />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="item/[id]" options={{ presentation: "card" }} />
      <Stack.Screen
        name="modals/add-item"
        options={{ presentation: "transparentModal", animation: "fade" }}
      />
    </Stack>
  );
}
```

### 9. Auth gate — `app/index.tsx`

```tsx
// app/index.tsx
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/useTheme";

export default function Index() {
  const { colors } = useTheme();
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return <Redirect href={session ? "/(protected)/(tabs)" : "/(auth)/sign-in"} />;
}
```

### 10. Tabs layout — `app/(protected)/(tabs)/_layout.tsx`

```tsx
// app/(protected)/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { Platform, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme, useThemeMode } from "@/lib/useTheme";

export default function TabsLayout() {
  const { colors } = useTheme();
  const { resolved } = useThemeMode();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        // The bar floats; react-native-screens adds the bottom safe-area inset for it
        // automatically. Screens still pad their scroll content to clear it (§7b).
        tabBarStyle: {
          position: "absolute",
          borderTopColor: colors.borderGlass,
          backgroundColor: Platform.OS === "android" ? colors.tabBarBg : "transparent",
        },
        // Frosted tab bar on iOS; opaque on Android (blur is costly there). Tint
        // follows the active theme.
        tabBarBackground: () =>
          Platform.OS === "ios" ? (
            <BlurView tint={resolved === "dark" ? "dark" : "light"} intensity={40} style={StyleSheet.absoluteFill} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Lifelist", tabBarIcon: ({ color, size }) => <Ionicons name="sparkles" color={color} size={size} /> }}
      />
    </Tabs>
  );
}
```

### 7b. Safe-area & Android edge-to-edge convention

Because Android now renders **edge-to-edge** (content under the status + navigation
bars), the following rules are mandatory and apply to every screen:

- **`SafeAreaProvider`** wraps the app (root layout §8) — already done.
- **Each screen owns its insets:** call `const insets = useSafeAreaInsets()` at the
  screen root and apply `paddingTop: insets.top` (top bars) and
  `paddingBottom: insets.bottom` (Android nav bar / iOS home indicator). Scroll views
  add `insets.bottom + 88` of bottom padding to clear the floating tab bar.
- **Full-bleed heroes are intentional:** the item-detail parallax image extends *under*
  the status bar; its back button is offset by `insets.top` (see frontend/004).
- **`SystemBars`** (root layout) flips status/nav-bar icon color with the theme and
  keeps the bars transparent so the canvas shows through.
- **Don't** wrap everything in `<SafeAreaView edges={[...]}>` *and* add manual insets —
  pick one per screen (we use `useSafeAreaInsets`) to avoid double padding.

> Add the `@/*` path alias in `tsconfig.json` (`"paths": { "@/*": ["./*"] }`) so the
> imports above resolve.

---

## 🚶 Step-by-Step Execution Guide

1. **Create the app directly at the workspace path:**
   `pnpm create expo-app apps/mobile --template tabs@sdk-56`, then install §1's
   dependencies from `apps/mobile`.

2. **Set the `@/*` path alias** in `tsconfig.json`. Keep Babel on
   `babel-preset-expo`; do not add a manual Reanimated/Worklets plugin (§4).

3. **Configure `app.config.ts`** (§3): `scheme`, `userInterfaceStyle: "automatic"`,
   `newArchEnabled`, the `expo-router` / `react-native-edge-to-edge` / `expo-font`
   plugins, Android `edgeToEdgeEnabled`, and the `extra` block with
   `supabaseUrl`/`supabasePublishableKey`/`apiBaseUrl`.

4. **Add the design system** `lib/tokens.ts` + `lib/theme.ts` + `lib/useTheme.tsx` (§5),
   then wire up fonts (§5b): the default `USE_HALYARD = false` ships the free Sora /
   Hanken Grotesk fallback via `@expo-google-fonts/*` — no local files, no config plugin,
   works out of the box. **Only if Halyard's licence is confirmed**, drop the `.otf`s
   into `assets/fonts/`, add the `expo-font` plugin entry to `app.config.ts` §3, and flip
   `USE_HALYARD = true`. The token family names are brand-neutral aliases, so either set
   plugs in with no component edits.

5. **Initialize Supabase** `lib/supabase.ts` (§6) with AsyncStorage persistence + the
   `AppState` auto-refresh wiring. Install `react-native-url-polyfill` and
   `expo-constants`.

6. **Add the auth layer** `lib/auth.tsx` (§7): `AuthProvider` hydrates the persisted
   session, subscribes to `onAuthStateChange`, and exposes `getToken()` for the API
   layer.

7. **Build the navigation shell:** root `_layout.tsx` (§8) wrapping
   `ThemeModeProvider` → `AuthProvider` → `Shell` (font gate + `Stack.Protected` guards +
   nav theme + `SystemBars`), the `(protected)/_layout.tsx` group layout (§8b) that owns
   the modal/card presentations, `index.tsx` gate (§9), and
   `(protected)/(tabs)/_layout.tsx` (§10, single Dashboard tab). Apply the safe-area
   convention (§7b) to each screen. Add placeholders for `(auth)/sign-in`,
   `(protected)/item/[id]`, `(protected)/modals/add-item` (filled in by later phases).

8. **Build a minimal `(auth)/sign-in.tsx`** (use `useSafeAreaInsets` + `useTheme`) calling
   `supabase.auth.signInWithPassword(...)` so you can obtain a session for testing.

9. **Run:** `pnpm expo start` and open the project in current Expo Go. Reanimated,
   Skia, runtime-loaded fallback fonts, Router, Supabase, and image picking are included
   in the SDK 56 Expo Go runtime. Use a custom development build only if a future native
   dependency or config plugin is not present in Expo Go.

---

## 🧪 Verification & Test Protocols

### A. App boots into the dark canvas (primary) with the bundled brand font

Launch the app **with no Halyard files present** (the default). Default theme is
**dark**: background `#0C0A14` everywhere (no white flash between screens — confirms
`contentStyle`/`sceneStyle`). Status bar icons are light. Headings render in the free
**Sora / Hanken Grotesk** fallback (loaded via `@expo-google-fonts/*`, `USE_HALYARD =
false`). Compare against a known system-font build — the letterforms must differ; if you
see the system fallback, the `useBrandFonts()` load gate failed. Then (only if licence
cleared) flip `USE_HALYARD = true` with the `.otf`s in place and confirm Halyard renders
under the same alias names with zero component changes.

### B. Auth gate routing + protected-route deep links

- Cold start while signed out → lands on `/(auth)/sign-in`.
- Sign in → auto-redirects to `/(protected)/(tabs)` (Dashboard).
- Force-quit and relaunch → goes **straight** to the Dashboard without re-login (proves
  AsyncStorage session persistence).
- **Deep-link gating (the fix):** while signed out, open a deep link straight into a
  protected route — `lifelist://item/<id>` or `lifelist://modals/add-item`. The
  `Stack.Protected` guard must redirect to `/(auth)/sign-in`, NOT render the protected
  screen. (Previously only the index redirect was guarded, so these slipped through.)

### C. Token auto-refresh across background/foreground

```tsx
// drop into the Dashboard temporarily
import { useAuth } from "@/lib/auth";
const { getToken } = useAuth();
// Log token, background the app for >1h (or set short expiry in Supabase), foreground,
// log again — the token string should change (refreshed), not be null.
```

### D. Tab bar appearance

The Dashboard tab (Lifelist) renders. On iOS the
tab bar is frosted (BlurView); on Android it is the opaque `tabBarBg`. Active icon tints
Headout purple (`#8000ff`).

### E. Light / dark switching

```tsx
// temporary toggle to exercise both themes
import { useThemeMode } from "@/lib/useTheme";
const { mode, setMode } = useThemeMode();
// setMode("light") → canvas turns white (#fafafa), text dark grey (#222), accents stay
//   #8000ff / #ff007a, status-bar icons flip to dark.
// setMode("dark")  → back to #0C0A14. setMode("system") → follows OS appearance.
```

Confirm the choice **persists** across a relaunch (AsyncStorage), and that switching the
OS appearance while in `"system"` mode updates the app live.

### F. Safe area / Android edge-to-edge

On an Android device with **gesture nav** and again with **3-button nav** (and an
iPhone with a notch + home indicator): no content is clipped by the status bar or
hidden behind the nav bar; the floating tab bar sits above the nav bar; the
item-detail hero correctly bleeds under the status bar with its back button below it.

### G. Modal presentation

Navigate `router.push("/(protected)/modals/add-item")` — it presents as a transparent
fade modal over the current screen (the canvas behind stays visible), confirming the
`transparentModal` config (now owned by the `(protected)` group layout, §8b) for the
upcoming Smart-Add overlay.

### H. Provider guards

Render a component using `useAuth` outside `AuthProvider` (and one using `useTheme`
outside `ThemeModeProvider`) in a scratch test — each must throw its
`"... must be used within ..."` error, proving the guards.

✅ **Phase complete when:** the app boots to the dark canvas in the brand font (free
fallback by default), light/dark switching works and persists, nothing is clipped by
system bars on either platform, the session persists across restarts/refresh, the single
Dashboard tab renders with the themed bar, signed-out deep links into protected routes
redirect to sign-in (`Stack.Protected` guard), and the Smart-Add route presents as a
transparent modal.

Accessibility labels/roles for sign-in and navigation controls, readable loading labels,
and reduced-motion behavior for theme transitions are part of this phase's Definition
of Done.

---

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
