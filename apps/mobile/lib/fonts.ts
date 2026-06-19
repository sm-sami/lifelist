import {
  HankenGrotesk_300Light,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from "@expo-google-fonts/hanken-grotesk";
import { Sora_500Medium } from "@expo-google-fonts/sora";
import { useFonts } from "expo-font";

/**
 * Flip to `true` ONLY after the Halyard licence is confirmed AND the .otf files exist
 * at assets/fonts/ (and the expo-font plugin entry is added to app.config.ts). Until
 * then this stays `false` and the app ships the free Sora / Hanken Grotesk fallback.
 */
const USE_HALYARD = false;

const fallbackFonts = {
  "BrandDisplay-Medium": Sora_500Medium,
  "BrandText-Book": HankenGrotesk_300Light,
  "BrandText-Medium": HankenGrotesk_500Medium,
  "BrandText-SemiBold": HankenGrotesk_600SemiBold,
  "BrandText-Bold": HankenGrotesk_700Bold,
};

function halyardFonts(): Record<string, number> {
  return {
    "BrandDisplay-Medium": require("@/assets/fonts/HalyardDisMed.otf"),
    "BrandText-Book": require("@/assets/fonts/HalyardTextBook.otf"),
    "BrandText-Medium": require("@/assets/fonts/HalyardTextMed.otf"),
    "BrandText-SemiBold": require("@/assets/fonts/HalyardTextSemiBold.otf"),
    "BrandText-Bold": require("@/assets/fonts/HalyardText-Bold.otf"),
  };
}

export function useBrandFonts() {
  return useFonts(USE_HALYARD ? halyardFonts() : fallbackFonts);
}
