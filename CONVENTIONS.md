# GullyScoreRN Port Conventions (READ FIRST)

You are porting GullyScore web (React 19 + Vite + Tailwind) to React Native
(Expo SDK 58, RN 0.88.1, React 19.3). Project root: `/home/z/my-project/GullyScoreRN`.
Web source (read-only reference): `/home/z/my-project/upload/webapp/src`.

## Already ported — import, do not rewrite
- `../../types/cricket` (or `../types/cricket`) — copied verbatim. Same path structure as web.
- `../../engine/scoringEngine`, `playerStatsEngine`, `predictionEngine` — copied verbatim.
- `../storage/db` — same synchronous API + `await db.init()` on boot. Use `db.getMatches()` etc. exactly like the web code does.
- `../../design/theme` (NEW, replaces web's `design/tokens` CSS-var theming):
  `import { useTheme, FONTS } from "../../design/theme";`
  `const { colors, isDark } = useTheme();`
  `colors.bg / colors.surface / colors.surfaceCard / colors.ink / colors.ink2 / colors.hairline / colors.hairlineStrong / colors.navy / colors.accent / colors.accentSubtle / colors.success / colors.warning`
  (same values as the web TOKENS light/dark palettes).
  `FONTS.serif` = serif family for headings/numbers, `FONTS.sans` = sans body (undefined = platform default).
- `../common/Components` — ported with the SAME exported names and props:
  `GullyButton, GullyTextField, GullySegmented, GullyChip, GullySheet, GullyListRow, OverRibbon, ScoreOdometer, WagonWheel, ManhattanChart`.
  Differences from web: GullyButton uses `onPress` (not onClick); GullyTextField uses `onChangeText`; GullyChip uses `onPress`; GullyListRow uses `onPress`; OverRibbon `onBallClick` unchanged.
  Do NOT add onClick props anywhere — RN uses onPress.

## Mapping rules (web → RN)
1. **HTML → RN**: div→View, span/p/h1-h6→Text (ALL text must be inside Text), button→Pressable or GullyButton, input→TextInput or GullyTextField, img→Image, select→GullySegmented or a custom row picker, table→View rows (flexDirection row), ul/li→View/Text list.
2. **Styling**: Tailwind classes → `StyleSheet.create` or inline style objects using theme colors. Tailwind sizes are px: text-xs=12, text-sm=14, text-base=16, text-lg=18, text-xl=20, text-2xl=24, text-6xl=60. gap-1=4, gap-2=8, gap-3=12, gap-4=16, p-4=16, px-4=16, py-2=8, m-2=8. rounded-[10px]→borderRadius 10, rounded-[2px]→2, rounded-t-[16px]→top corners 16. border→borderWidth 1 + borderColor colors.hairline. shadow→elevation 2-4 (Android) or shadowColor, keep subtle.
3. **Fonts**: web `font-serif` → `fontFamily: FONTS.serif`; `font-sans` → `fontFamily: FONTS.sans`. `tnum`/tabular → `fontFeatureSettings: "'tnum'"`. font-medium→fontWeight "500", font-semibold→"600", font-bold→"700".
4. **Icons**: `import { X } from "lucide-react"` → `import { X } from "lucide-react-native"` and props `className="w-5 h-5"` → `size={20}` (+ `color={colors.ink}` when needed; stroke-[2] → `strokeWidth={2}`).
5. **Animation**: `motion/react` has no RN equivalent. DROP motion/AnimatePresence wrappers. For enter/press feedback use Pressable's function-style style (`{pressed}) => [...]`) or RN `Animated` ONLY if trivial. Sheets/modals use the ported GullySheet (Modal-based). Simple conditional rendering replaces AnimatePresence.
6. **Scrolling**: page-level → wrap in ScrollView with `contentContainerStyle={{ paddingBottom: 32 }}`. Long lists inside screens → RN FlatList only if the web code renders big arrays directly; otherwise keep .map() in a ScrollView.
7. **Layout**: `min-h-screen` → `flex: 1` on the root; `fixed` nav → parent flex column with nav at bottom. `max-w-xl mx-auto` centered column → `width: "100%", maxWidth: 560, alignSelf: "center"` on the container.
8. **Window APIs**: NO window/document/localStorage/alert. `window.confirm` → render a small inline confirm row (GullyButton pair "Confirm?" Delete/Cancel) or immediate action — keep it simple and safe. `alert()` → drop or inline Text. `matchMedia` → useTheme handles it. `new Date()` is fine. `navigator.clipboard` → RN `Clipboard` is NOT installed; drop copy buttons.
9. **recharts** (AreaChart/LineChart etc.) → hand-rolled SVG via `react-native-svg` (installed): compute points from the same data, draw `Polyline`/`Line` + axes Text, keep the same visual intent (thin lines, hairline grid, ink/accent colors). Scale x/y linearly like recharts did. Keep exported name and props identical so callers don't change.
10. **Keep**: every exported name, every prop name (except onClick→onPress, onChange→onChangeText), all logic, hooks, useMemo/useEffect, all text strings, comments. Port line-by-line where possible. Do NOT invent features. Do NOT delete features. If something is truly web-only (document.title, print, download links, clipboard), stub it out minimally and add a `// RN: dropped <thing>` comment.
11. **State and data**: identical — call db the same way. Screens re-render via `db.subscribe` in the web code; keep identical `useEffect(() => db.subscribe(...))` patterns (db is sync in RN too).
12. **Keyboard**: screens with inputs that sit above a GullySheet should keep default behavior; do not add KeyboardAvoidingView except where the web used fixed positioning (footer buttons) — RN Screens with `keyboardShouldPersistTaps="handled"` on their ScrollView.
13. **SafeArea**: full-screen overlays (scoring etc.) wrap content in `SafeAreaView` (react-native) top; the bottom nav in App.tsx handles its own padding. On screens, add `paddingTop` only if the web screen had a sticky header — prefer SafeAreaView.

## Target file placement
Mirror the web path exactly, e.g. web `src/components/stats/RunRateProgressionChart.tsx` → RN `/home/z/my-project/GullyScoreRN/src/components/stats/RunRateProgressionChart.tsx`. Keep the same default/named export style as the web file (named exports like `export const X` / `export function X` stay named).

## Quality bar
- TypeScript strict-clean: correct types, no `any` that the web file didn't already have.
- Every screen compiles against the ported foundation — no new npm deps.
- After writing your files, run: `cd /home/z/my-project/GullyScoreRN && bunx tsc --noEmit 2>&1 | grep "<your file paths>"` and fix YOUR files' errors (ignore errors from files you were not assigned; missing-import errors for components another agent is porting are expected — leave them).
- Do not touch: package.json, app.json, index.ts, App.tsx, src/design/*, src/storage/*, src/components/common/*.
