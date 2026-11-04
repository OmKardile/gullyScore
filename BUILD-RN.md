# GullyScore React Native — Build Instructions

Ported 1:1 from the GullyScore web app (React 19 + Vite + Tailwind + localStorage)
to React Native 0.88 / Expo SDK 58. Same engines, same screens, same data model.

## Stack
- Expo SDK 58, React Native 0.88.1, React 19.3, TypeScript strict-clean (0 errors)
- Navigation: @react-navigation/native-stack (Android hardware back, iOS swipe,
  web browser back all work) + custom bottom tab bar (web parity)
- Fonts: Nunito (body) + Baloo 2 (headings) via @expo-google-fonts (bundled,
  no native config needed)
- Storage: AsyncStorage (same synchronous API as the web localStorage engine,
  hydrated once at boot via `db.init()`) — offline-first, no cloud account
- Icons: lucide-react-native | Charts: react-native-svg | App icon: generated
  from the design tokens (navy #0E1B2E / cricket-ball crimson #B4232A)

## Install & run
    npm install               # or bun install
    npm run web               # web dev (http://localhost:8081)
    npm start                 # native dev (Expo Go or device/emulator)
    npm run check             # tsc --noEmit

## Build a release APK — pick ONE of these 3 routes

### Route A — EAS Build (cloud, no Android setup needed; easiest)
    npm install -g eas-cli    # or use npx
    eas login                  # free expo.dev account
    npx eas build -p android --profile production
    # .eas.json is pre-configured: buildType "apk", autoIncrement versionCode
    # When it finishes you get a download URL for the signed APK.

### Route B — Local build (Android Studio / command line)
    npx expo prebuild --platform android    # regenerates android/
    cd android && ./gradlew assembleRelease  # Windows: gradlew.bat
    # Needs JDK 17+ and Android SDK (platform 37 + build-tools 37.0.0).
    # app.json already sets compileSdkVersion 37 (required by Expo 58 AARs —
    # do NOT lower it to 36 or the build fails).

    Output: android/app/build/outputs/apk/release/app-release.apk
    (package dev.omkardile.gullyscore, versionName 1.3.0, minSdk 24, targetSdk 36)

### Route C — Ask the agent sandbox to build it
The Android toolchain (JDK 21, SDK, NDK 27.1.12297006) fits in the sandbox;
expect ~45 min end-to-end including toolchain download. The sandbox build config
is memory-tuned (Gradle Xmx1024m, workers.max=1, arm64-v8a only).

## Signing
Signing is pre-configured: android/app/gullyscore-release.keystore
(PKCS12, alias `gullyscore`, storepass `gullyscore2026`). APKs signed with it
install as updates over existing installs. For Play Store, generate your own
keystore and update android/app/build.gradle.

Note: `expo prebuild` will regenerate android/ — if it does, re-apply the
signingConfig block in android/app/build.gradle (it references the committed
keystore) or keep the committed android/ directory and build without --clean.

## Port layout
- App.tsx: NavigationContainer + native stack (Tabs / Scoring / MatchSetup /
  MatchDetail / Settings / Help / Gallery) + ErrorBoundary + font gate
- src/types, src/engine: copied verbatim from the web app (pure TypeScript)
- src/storage/db.ts: AsyncStorage port, identical API + demo seed data
- src/design/theme.tsx + fonts.ts: RN theming + Google Fonts registry
- src/components/**: all 12 web screens ported (ScoringScreen, MatchDetail,
  MatchSetup, TeamsPlayers, Tournaments + points-table viz, Stats + run-rate
  chart (recharts -> react-native-svg), PlayerProfile, Prediction, Settings,
  Help, Gallery)
- Web-only features stubbed with `// RN:` comments (canvas poster, clipboard,
  file download; replaced by in-app JSON share sheets)

## Data & sync
Offline-first: all data lives in on-device AsyncStorage. The Settings screen
shows a live storage indicator (match/team/player counts) and the cloud-sync
status ("Supabase — Not connected"). Use Settings > Export / Import to move
data between phones as JSON. To add real Supabase sync, wire your project
URL + anon key into a new sync layer (see the Kotlin app's SupabaseSync.kt
for the reference design).
