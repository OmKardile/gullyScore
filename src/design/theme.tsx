/**
 * GullyScoreRN Theme System
 *
 * RN port of the web app's CSS-variable theming. The web app toggles a
 * `.dark` class on <html>; here a ThemeContext resolves the TOKENS palette
 * (light/dark) and exposes it through `useTheme()`.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Appearance } from "react-native";
import { TOKENS, ThemeMode } from "../design/tokens";
import { db } from "../storage/db";

export interface ThemePalette {
  bg: string;
  surface: string;
  surfaceCard: string;
  ink: string;
  ink2: string;
  hairline: string;
  hairlineStrong: string;
  navy: string;
  accent: string;
  accentSubtle: string;
  success: string;
  warning: string;
}

export function paletteFor(isDark: boolean): ThemePalette {
  return isDark ? TOKENS.colors.dark : TOKENS.colors.light;
}

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemePalette;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  isDark: false,
  colors: TOKENS.colors.light,
  setMode: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [systemDark, setSystemDark] = useState(
    Appearance.getColorScheme() === "dark"
  );

  // Load persisted theme once db is ready
  useEffect(() => {
    db.init().then(() => {
      setModeState(db.getSettings().theme);
    });
  }, []);

  // Track system preference for "system" mode
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemDark(colorScheme === "dark");
    });
    return () => sub.remove();
  }, []);

  const isDark = mode === "dark" || (mode === "system" && systemDark);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      isDark,
      colors: paletteFor(isDark),
      setMode: (m: ThemeMode) => {
        setModeState(m);
        db.saveSettings({ theme: m });
      },
    }),
    [mode, isDark]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
};

export function useTheme() {
  return useContext(ThemeContext);
}

/** Shared font families: friendly & rounded — Nunito body, Baloo 2 display.
 *  Static Google Font families loaded via useFonts() in App.tsx. */
export const FONTS = {
  serif: "Baloo2_600SemiBold",
  serifBold: "Baloo2_700Bold",
  sans: "Nunito_400Regular",
  sansMedium: "Nunito_500Medium",
  sansSemiBold: "Nunito_600SemiBold",
  sansBold: "Nunito_700Bold",
};
