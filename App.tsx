/**
 * GullyScoreRN App Root & Navigation Container
 *
 * RN port of the web app's App.tsx:
 * - 4 bottom tabs: Matches | Teams | Tournaments | Stats
 * - Custom bottom navigation with 2dp active line (no stock M3 pill)
 * - Full-screen live scorer outside tabs
 * - Light/dark theme synchronization
 */

import React, { useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  Pressable,
  StatusBar,
  ActivityIndicator,
} from "react-native";
import { Calendar, Users, Trophy, ChartColumn } from "lucide-react-native";
import { db } from "./src/storage/db";
import { ThemeProvider, useTheme, FONTS } from "./src/design/theme";
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
type OverlayScreen =
  | "none"
  | "scoring"
  | "match_setup"
  | "match_detail"
  | "settings"
  | "help"
  | "gallery";

function MainTabs() {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<MainTab>("matches");
  const [overlayScreen, setOverlayScreen] = useState<OverlayScreen>("none");
  const [activeMatchId, setActiveMatchId] = useState<string>("");
  const [setupParams, setSetupParams] = useState<any>(null);

  const handleOpenMatchSetup = (params?: any) => {
    setSetupParams(params || null);
    setOverlayScreen("match_setup");
  };

  // Full-Screen Overlays Outside Tabs
  if (overlayScreen === "scoring" && activeMatchId) {
    return (
      <ScoringScreen
        matchId={activeMatchId}
        onExit={() => {
          setOverlayScreen("none");
          setActiveMatchId("");
        }}
        onViewScorecard={(mId) => {
          setActiveMatchId(mId);
          setOverlayScreen("match_detail");
        }}
      />
    );
  }

  if (overlayScreen === "match_setup") {
    return (
      <MatchSetupScreen
        initialTournamentId={setupParams?.tournamentId}
        initialFixtureId={setupParams?.fixtureId}
        initialTeamAId={setupParams?.teamAId}
        initialTeamBId={setupParams?.teamBId}
        onBack={() => setOverlayScreen("none")}
        onMatchCreated={(mId) => {
          setActiveMatchId(mId);
          setOverlayScreen("scoring");
        }}
      />
    );
  }

  if (overlayScreen === "match_detail" && activeMatchId) {
    return (
      <MatchDetailScreen
        matchId={activeMatchId}
        onBack={() => {
          setOverlayScreen("none");
          setActiveMatchId("");
        }}
        onResumeScoring={(mId) => {
          setActiveMatchId(mId);
          setOverlayScreen("scoring");
        }}
      />
    );
  }

  if (overlayScreen === "settings") {
    return (
      <SettingsScreen
        onOpenHelp={() => setOverlayScreen("help")}
        onOpenGallery={() => setOverlayScreen("gallery")}
        onThemeChanged={() => {}}
      />
    );
  }

  if (overlayScreen === "help") {
    return <HelpScreen onBack={() => setOverlayScreen("settings")} />;
  }

  if (overlayScreen === "gallery") {
    return <ComponentGalleryScreen onBack={() => setOverlayScreen("settings")} />;
  }

  // Main Tab Destinations
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar barStyle="default" />
      <View style={{ flex: 1 }}>
        {activeTab === "matches" && (
          <HomeScreen
            onStartNewMatch={() => handleOpenMatchSetup()}
            onResumeMatch={(mId) => {
              setActiveMatchId(mId);
              setOverlayScreen("scoring");
            }}
            onOpenMatchDetail={(mId) => {
              setActiveMatchId(mId);
              setOverlayScreen("match_detail");
            }}
            onOpenSettings={() => setOverlayScreen("settings")}
          />
        )}

        {activeTab === "teams" && <TeamsPlayersScreen />}

        {activeTab === "tournaments" && (
          <TournamentsScreen
            onOpenMatchSetup={(params) => handleOpenMatchSetup(params)}
            onOpenMatchDetail={(mId) => {
              setActiveMatchId(mId);
              setOverlayScreen("match_detail");
            }}
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
            const isActive = activeTab === dest.id as MainTab;

            return (
              <Pressable
                key={dest.id}
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

function Root() {
  const { colors } = useTheme();
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    db.init().then(() => setBooted(true));
  }, []);

  if (!booted) {
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

  return <MainTabs />;
}

export default function App() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}
