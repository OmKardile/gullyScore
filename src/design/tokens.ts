/**
 * GullyScore Design Tokens
 * 
 * Strict single source of truth for all visual values.
 * Zero hardcoded values in UI components.
 */

export const APP_NAME = "GullyScore";

export const TOKENS = {
  colors: {
    light: {
      bg: "#F6F3EC",        // warm paper
      surface: "#FBF9F4",   // subtle warm surface
      surfaceCard: "#FFFFFF",
      ink: "#14161A",       // deep near-black
      ink2: "#5B5F66",      // secondary muted ink
      hairline: "rgba(20, 22, 26, 0.10)",
      hairlineStrong: "rgba(20, 22, 26, 0.20)",
      navy: "#0E1B2E",
      accent: "#B4232A",     // cricket-ball crimson (used <= 5% of screen)
      accentSubtle: "rgba(180, 35, 42, 0.08)",
      success: "#1F7A43",
      warning: "#965E00",
    },
    dark: {
      bg: "#121214",        // warm charcoal, never pure black
      surface: "#18191C",
      surfaceCard: "#1F2024",
      ink: "#F2EFE8",
      ink2: "#9B9E96",
      hairline: "rgba(242, 239, 232, 0.12)",
      hairlineStrong: "rgba(242, 239, 232, 0.24)",
      navy: "#0E1B2E",
      accent: "#E0454C",     // lifted for dark contrast
      accentSubtle: "rgba(224, 69, 76, 0.12)",
      success: "#34D399",
      warning: "#FBBF24",
    },
  },
  typography: {
    fonts: {
      serif: 'var(--font-serif), "Fraunces", Georgia, serif',
      sans: 'var(--font-sans), "Instrument Sans", system-ui, sans-serif',
    },
    sizes: {
      scoreHero: "text-6xl sm:text-7xl font-serif font-bold tracking-tight",
      scoreOvers: "text-xl sm:text-2xl font-serif",
      sectionTitle: "text-2xl font-serif font-medium",
      cardTitle: "text-lg font-serif font-medium",
      body: "text-[15px] leading-relaxed font-sans",
      bodyMedium: "text-[15px] font-medium font-sans",
      meta: "text-xs uppercase tracking-wider font-sans font-medium text-[var(--color-ink-2)]",
      tabular: "font-variant-numeric: tabular-nums",
    },
  },
  spacing: {
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    6: "24px",
    8: "32px",
    12: "48px",
    18: "72px",
  },
  radius: {
    ruleChip: "2px",     // chips, rules, indicators
    control: "10px",     // buttons, inputs, segmented controls
    sheet: "16px",       // bottom sheets, modal cards
  },
  elevation: {
    none: "none",
    sheet: "0 -4px 24px rgba(0, 0, 0, 0.12)",
  },
  borders: {
    hairline: "1px solid var(--color-hairline)",
    hairlineStrong: "1px solid var(--color-hairline-strong)",
  },
} as const;

export type ThemeMode = "light" | "dark" | "system";
