/**
 * GullyScoreRN font registry — friendly & rounded Google Fonts.
 *
 * - Nunito  (body):      soft, rounded, highly legible UI text
 * - Baloo 2 (headings): warm, rounded display font for scores/titles
 *
 * Native: the .ttf files ship inside the app bundle via @expo-google-fonts,
 * so the app renders correctly offline.
 *
 * Web: this file is SHADOWED by fonts.web.ts (Metro's platform-extension
 * resolution prefers .web.ts for web builds). The web build never touches
 * @expo-google-fonts — it loads the same fonts self-hosted from /fonts/*.ttf.
 * That matters: the previous web path resolved the .ttf to dev-server-only
 * /assets/node_modules/... URLs that 404 on any static host, leaving the
 * boot gate waiting on a font-timeout fallback.
 */
import { useFonts } from "expo-font";
import {
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
} from "@expo-google-fonts/nunito";
import {
  Baloo2_400Regular,
  Baloo2_500Medium,
  Baloo2_600SemiBold,
  Baloo2_700Bold,
} from "@expo-google-fonts/baloo-2";

export function useAppFonts() {
  return useFonts({
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Baloo2_400Regular,
    Baloo2_500Medium,
    Baloo2_600SemiBold,
    Baloo2_700Bold,
  });
}

// Kept for parity with the old module surface (individual font descriptors).
export {
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Baloo2_400Regular,
  Baloo2_500Medium,
  Baloo2_600SemiBold,
  Baloo2_700Bold,
};
