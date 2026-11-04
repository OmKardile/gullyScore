/**
 * GullyScoreRN App Root & Navigation Container
 *
 * RN port of the web app's App.tsx:
 * - @react-navigation/native-stack for all overlay screens (proper back
 *   handling: Android hardware back, iOS swipe-back, web browser back)
 * - 4 bottom tabs: Matches | Teams | Tournaments | Stats (custom bar with
 *   2dp active line — web parity)
 * - Nunito (body) + Baloo 2 (headings) — friendly rounded Google Fonts
 * - ErrorBoundary + font/boot gates
 */

import React, { useEffect, useState } from "react";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import {
  View,
  Text,
  Pressable,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { Calendar, Users, Trophy, ChartColumn } from "lucide-react-native";
import { NavigationContainer, useNavigation } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  NativeStackScreenProps,
} from "@react-navigation/native-stack";
import {
  useFonts,
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Baloo2_600SemiBold,
  Baloo2_700Bold,
} from "./src/design/fonts";
import { db } from "./src/storage/db";
import { ThemeProvider, useTheme, FONTS } from "./src/design/theme";
import { ErrorBoundary } from "./src/components/common/ErrorBoundary";
import { HomeScreen } from "./src/components/home/HomeScreen";
import { ScoringScreen } from "./src/components/scoring/ScoringScreen";
import { MatchDetailScreen } from "./src/components/match/MatchDetailScreen";
import { MatchSetupScreen } from "./src/components/match/MatchSetupScreen";
import { TeamsPlayersScreen } from "./src/components/teams/TeamsPlayersScreen";
import { TournamentsScreen } from "./src/components/tournaments/TournamentsScreen";
import { StatsScreen } from "./src/components/stats/StatsScreen";
import { SettingsScreen } from "./src/components/settings/SettingsScreen";
import { HelpScreen } from "./src/components/help/HelpScreen";
import { ComponentGalleryScreen } from "./src/components/gallery/ComponentGalleryScreen";

type MainTab = "matches" | "teams" | "tournaments" | "stats";

export type RootStackParamList = {
  Tabs: undefined;
  Scoring: { matchId: string };
  MatchSetup:
    | { tournamentId?: string; fixtureId?: string; teamAId?: string; teamBId?: string }
    | undefined;
  MatchDetail: { matchId: string };
  Settings: undefined;
  Help: undefined;
  Gallery: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/* ------------------------------------------------------------------ */
/* Route wrappers: translate navigation (params + goBack) into the     */
/* existing screen props, so screens keep their original APIs.         */
/* ------------------------------------------------------------------ */

type Nav = NativeStackScreenProps<RootStackParamList>["navigation"];

function ScoringRoute({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "Scoring">) {
  return (
    <ScoringScreen
      matchId={route.params.matchId}
      onExit={() => navigation.goBack()}
      onViewScorecard={(mId) =>
        navigation.navigate("MatchDetail", { matchId: mId })
      }
    />
  );
}

function MatchSetupRoute({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "MatchSetup">) {
  const p = route.params;
  return (
    <MatchSetupScreen
      initialTournamentId={p?.tournamentId}
      initialFixtureId={p?.fixtureId}
      initialTeamAId={p?.teamAId}
      initialTeamBId={p?.teamBId}
      onBack={() => navigation.goBack()}
      onMatchCreated={(mId) => {
        // replace setup with the live scorer so Back exits to where you came from
        navigation.replace("Scoring", { matchId: mId });
      }}
    />
  );
}

function MatchDetailRoute({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, "MatchDetail">) {
  return (
    <MatchDetailScreen
      matchId={route.params.matchId}
      onBack={() => navigation.goBack()}
      onResumeScoring={(mId) => navigation.navigate("Scoring", { matchId: mId })}
    />
  );
}

function SettingsRoute({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Settings">) {
  return (
    <SettingsScreen
      onBack={() => navigation.goBack()}
      onOpenHelp={() => navigation.navigate("Help")}
      onOpenGallery={() => navigation.navigate("Gallery")}
      onThemeChanged={() => {}}
    />
  );
}

function HelpRoute({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Help">) {
  return <HelpScreen onBack={() => navigation.goBack()} />;
}

function GalleryRoute({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Gallery">) {
  return <ComponentGalleryScreen onBack={() => navigation.goBack()} />;
}

/* ------------------------------------------------------------------ */
/* Main tabs with the strict custom bottom navigation (web parity)      */
/* ------------------------------------------------------------------ */

function MainTabs() {
  const { colors } = useTheme();
  const navigation = useNavigation<Nav>();
  const [activeTab, setActiveTab] = useState<MainTab>("matches");

  const handleOpenMatchSetup = (params?: {
    tournamentId?: string;
    fixtureId?: string;
    teamAId?: string;
    teamBId?: string;
  }) => {
    navigation.navigate("MatchSetup", params);
  };

  // Main Tab Destinations
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="default" />
      <View style={{ flex: 1 }}>
        {activeTab === "matches" && (
          <HomeScreen
            onStartNewMatch={() => handleOpenMatchSetup()}
            onResumeMatch={(mId) => navigation.navigate("Scoring", { matchId: mId })}
            onOpenMatchDetail={(mId) => navigation.navigate("MatchDetail", { matchId: mId })}
            onOpenSettings={() => navigation.navigate("Settings")}
          />
        )}

        {activeTab === "teams" && <TeamsPlayersScreen />}

        {activeTab === "tournaments" && (
          <TournamentsScreen
            onOpenMatchSetup={(params) => handleOpenMatchSetup(params)}
            onOpenMatchDetail={(mId) => navigation.navigate("MatchDetail", { matchId: mId })}
          />
        )}

        {activeTab === "stats" && <StatsScreen />}
      </View>

      {/* STRICT CUSTOM BOTTOM NAVIGATION (NO M3 PILL INDICATORS) */}
      <SafeAreaView
        edges={["bottom"]}
        style={{
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.hairline,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            height: 64,
            maxWidth: 560,
            width: "100%",
            alignSelf: "center",
          }}
        >
          {[
            { id: "matches", label: "Matches", icon: Calendar },
            { id: "teams", label: "Teams", icon: Users },
            { id: "tournaments", label: "Tournaments", icon: Trophy },
            { id: "stats", label: "Stats", icon: ChartColumn },
          ].map((dest) => {
            const Icon = dest.icon;
            const isActive = activeTab === (dest.id as MainTab);

            return (
              <Pressable
                key={dest.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={dest.label}
                onPress={() => setActiveTab(dest.id as MainTab)}
                style={({ pressed }) => [
                  {
                    flex: 1,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                {/* 2dp Active Accent Indicator Line at Top of Tab */}
                {isActive ? (
                  <View
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 16,
                      right: 16,
                      height: 2,
                      backgroundColor: colors.accent,
                    }}
                  />
                ) : null}

                <Icon
                  size={20}
                  color={isActive ? colors.ink : colors.ink2}
                  strokeWidth={isActive ? 2.2 : 1.6}
                />
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: FONTS.sans,
                    marginTop: 4,
                    letterSpacing: -0.2,
                    fontWeight: isActive ? "600" : "400",
                    color: isActive ? colors.ink : colors.ink2,
                  }}
                >
                  {dest.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Boot gate: fonts + local DB before first paint                      */
/* ------------------------------------------------------------------ */

function Root() {
  const { colors } = useTheme();
  const [booted, setBooted] = useState(false);
  const [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Baloo2_600SemiBold,
    Baloo2_700Bold,
  });

  useEffect(() => {
    db.init().then(() => setBooted(true));
  }, []);

  if (!booted || !fontsLoaded) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, animation: "slide_from_right" }}
    >
      <Stack.Screen name="Tabs" component={MainTabs} />
      <Stack.Screen name="Scoring" component={ScoringRoute} />
      <Stack.Screen name="MatchSetup" component={MatchSetupRoute} />
      <Stack.Screen name="MatchDetail" component={MatchDetailRoute} />
      <Stack.Screen name="Settings" component={SettingsRoute} />
      <Stack.Screen name="Help" component={HelpRoute} />
      <Stack.Screen name="Gallery" component={GalleryRoute} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <NavigationContainer>
            <Root />
          </NavigationContainer>
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
