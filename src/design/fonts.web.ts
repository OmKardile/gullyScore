/**
 * WEB-ONLY font loading (Metro picks this file over fonts.ts for web builds
 * via the platform-extension rule). 
 *
 * The .ttf files are self-hosted at public/fonts/ (copied from
 * @expo-google-fonts/nunito and @expo-google-fonts/baloo-2), so the app
 * loads its typography from the same origin — no Google Fonts CDN request
 * at runtime, no third-party dependency, boot can never stall on fonts.
 *
 * Families are the SAME names the design tokens reference
 * (Nunito_400Regular, Baloo2_600SemiBold, ...) — see src/design/tokens.ts.
 */
import { useFonts } from "expo-font";

const WEB_FONT_MAP = {
  Nunito_400Regular: "/fonts/Nunito-400Regular.ttf",
  Nunito_500Medium: "/fonts/Nunito-500Medium.ttf",
  Nunito_600SemiBold: "/fonts/Nunito-600SemiBold.ttf",
  Nunito_700Bold: "/fonts/Nunito-700Bold.ttf",
  Baloo2_400Regular: "/fonts/Baloo2-400Regular.ttf",
  Baloo2_500Medium: "/fonts/Baloo2-500Medium.ttf",
  Baloo2_600SemiBold: "/fonts/Baloo2-600SemiBold.ttf",
  Baloo2_700Bold: "/fonts/Baloo2-700Bold.ttf",
};

export function useAppFonts() {
  return useFonts(WEB_FONT_MAP);
}
