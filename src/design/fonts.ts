/**
 * GullyScoreRN font registry — friendly & rounded Google Fonts.
 *
 * - Nunito  (body):      soft, rounded, highly legible UI text
 * - Baloo 2 (headings): warm, rounded display font for scores/titles
 *
 * Loaded via useFonts() in App.tsx (works on native + web; the font files
 * ship inside the JS bundle, so no native config or prebuild change needed).
 */

export { useFonts } from "expo-font";
export {
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
} from "@expo-google-fonts/nunito";
export {
  Baloo2_400Regular,
  Baloo2_500Medium,
  Baloo2_600SemiBold,
  Baloo2_700Bold,
} from "@expo-google-fonts/baloo-2";
