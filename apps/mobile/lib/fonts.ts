import { useFonts } from "expo-font";

// Medium = HalyardMed.otf, Regular = HalyardReg.otf.
// Weights without a dedicated cut (SemiBold, Bold) alias to Medium; Book aliases to Regular.
const brandFonts = {
  "BrandDisplay-Medium": require("@/assets/fonts/HalyardMed.otf"),
  "BrandText-Book": require("@/assets/fonts/HalyardReg.otf"),
  "BrandText-Medium": require("@/assets/fonts/HalyardMed.otf"),
  "BrandText-SemiBold": require("@/assets/fonts/HalyardMed.otf"),
  "BrandText-Bold": require("@/assets/fonts/HalyardMed.otf"),
};

export function useBrandFonts() {
  return useFonts(brandFonts);
}
