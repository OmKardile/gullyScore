/**
 * GullyScore Home / Matches Screen
 *
 * Resume match banner, recent matches, upcoming fixtures,
 * and an anchored in-layout "New match" bar (no FAB).
 *
 * RN port notes:
 * - Web sticky header → fixed header above the ScrollView (SafeAreaView top).
 * - Web `fixed bottom-32` toast + `fixed bottom-16` action bar → anchored at
 *   the bottom of this screen's flex layout (above App's bottom nav); the
 *   toast overlays via absolute positioning.
 * - The action bar's `bg-gradient-to-t` fade is dropped (no gradient dep) —
 *   solid bg with padding instead.
 * - GullyButton children are text-only, so the web Play icon inside
 *   "Resume Live Scoring" is dropped.
 * - `animate-pulse` dot → trivial Animated opacity loop.
 */

import React, { useState, useEffect, useRef } from "react";
import { Animated, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Match, Fixture } from "../../types/cricket";
import { db } from "../../storage/db";
import {
  BackendStatus,
  getBackendStatus,
  getSyncState,
  subscribeBackendStatus,
} from "../../storage/sync";
import { GullyButton } from "../common/Components";
import { AccessBanner } from "../access/AccessBanner";
import { UmpireKeySheet, UmpireSheetMode } from "../access/UmpireKeySheet";
import { getAccessState, subscribeAccess } from "../../storage/access";
import {
  Plus,
  Settings as SettingsIcon,
  TrendingUp,
  Inbox,
  CheckCircle2,
  CircleHelp,
} from "lucide-react-native";
import { replayInnings } from "../../engine/scoringEngine";
import { calculateLiveWinProbability } from "../../engine/predictionEngine";
import { SwipeableMatchItem } from "./SwipeableMatchItem";
import { useTheme, FONTS } from "../../design/theme";

interface HomeScreenProps {
  onStartNewMatch: () => void;
  onResumeMatch: (matchId: string) => void;
  onOpenMatchDetail: (matchId: string) => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  onStartNewMatch,
  onResumeMatch,
  onOpenMatchDetail,
  onOpenSettings,
  onOpenHelp,
}) => {
  const { colors } = useTheme();
  const [matches, setMatches] = useState<Match[]>(() => db.getMatches());
  const [activeMatch, setActiveMatch] = useState<Match | null>(() => db.getActiveMatch());
  const [fixtures, setFixtures] = useState<Fixture[]>(() => db.getFixtures());
  const [matchFilter, setMatchFilter] = useState<"active" | "archived" | "all">("active");
  const [toastMessage, setToastMessage] = useState<{ text: string; matchId?: string } | null>(null);

  // Live cloud-sync badge (same channel the Settings indicator uses).
  const [backend, setBackend] = useState<BackendStatus>(getBackendStatus());
  const [spaceCode, setSpaceCode] = useState<string | null>(getSyncState().code);
  useEffect(() => {
    const reread = () => {
      setBackend(getBackendStatus());
      setSpaceCode(getSyncState().code);
    };
    return subscribeBackendStatus(reread);
  }, []);

  // Umpire access (1.4.7): persistent mode indicator + key sheet entry.
  const [access, setAccess] = useState(getAccessState());
  const [keySheet, setKeySheet] = useState<{ open: boolean; mode: UmpireSheetMode }>({
    open: false,
    mode: "enter",
  });
  useEffect(() => {
    const reread = () => setAccess(getAccessState());
    reread();
    return subscribeAccess(reread);
  }, []);
  const canEdit = access.mode === "solo" || access.mode === "umpire";

  // RN: web `animate-pulse` on the live dot → trivial Animated loop.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!activeMatch) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [activeMatch, pulse]);

  useEffect(() => {
    const unsub = db.subscribe(() => {
      setMatches(db.getMatches());
      setActiveMatch(db.getActiveMatch());
      setFixtures(db.getFixtures());
    });
    return unsub;
  }, []);

  const handleToggleArchive = (matchId: string) => {
    let isNowArchived: boolean;
    try {
      isNowArchived = db.toggleArchiveMatch(matchId);
    } catch {
      return; // audience (1.4.7) — the gate blocked the archive toggle
    }
    setToastMessage({
      text: isNowArchived ? "Match moved to archive" : "Match restored from archive",
      matchId,
    });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.matchId === matchId ? null : prev));
    }, 4000);
  };

  const handleUndoArchive = () => {
    if (toastMessage?.matchId) {
      try {
        db.toggleArchiveMatch(toastMessage.matchId);
      } catch {
        /* audience — gate already blocked it */ 
      }
      setToastMessage(null);
    }
  };

  const displayedMatches = matches.filter((m) => {
    if (matchFilter === "active") return !m.isArchived;
    if (matchFilter === "archived") return !!m.isArchived;
    return true;
  });

  const archivedCount = matches.filter((m) => !!m.isArchived).length;
  const upcomingFixtures = fixtures.filter((f) => f.status === "pending").slice(0, 3);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Top App Bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              fontFamily: FONTS.serif,
              fontWeight: "700",
              fontSize: 20,
              color: colors.ink,
              letterSpacing: -0.5,
            }}
          >
            GullyScore
          </Text>
          <Text
            testID="home-sync-badge"
            style={{
              fontSize: 10,
              color:
                backend === "offline"
                  ? colors.warning
                  : backend === "online" && spaceCode
                    ? colors.success
                    : colors.ink2,
              fontFamily: "monospace",
              textTransform: "uppercase",
              letterSpacing: 1,
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderWidth: 1,
              borderColor: colors.hairlineStrong,
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            {backend === "checking"
              ? "Sync…"
              : backend === "offline"
                ? "Offline"
                : spaceCode
                  ? `Synced · ${spaceCode}`
                  : "Cloud Ready"}
          </Text>
        </View>

        <Pressable
          onPress={onOpenHelp}
          accessibilityRole="button"
          accessibilityLabel="Help and FAQ"
          hitSlop={8}
          style={({ pressed }) => ({
            padding: 6,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <CircleHelp size={20} strokeWidth={1.5} color={colors.ink2} />
        </Pressable>
        <Pressable
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={8}
          style={({ pressed }) => ({
            padding: 6,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <SettingsIcon size={20} strokeWidth={1.5} color={colors.ink2} />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            width: "100%",
            maxWidth: 560,
            alignSelf: "center",
            paddingHorizontal: 16,
            paddingTop: 16,
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* AUDIENCE / UMPIRE MODE BANNER (1.4.7) */}
          {access.mode !== "solo" ? (
            <AccessBanner
              onEnterKey={() =>
                setKeySheet({ open: true, mode: access.spaceHasKey ? "enter" : "set" })
              }
              onExitUmpire={() => {
                try {
                  db.exitUmpireMode();
                } catch {
                  /* session already gone — banner re-renders on its own */
                }
              }}
            />
          ) : null}

          {/* RESUME MATCH HERO BANNER (If a match is live) */}
          {activeMatch && (
            <View
              style={{
                padding: 16,
                backgroundColor: colors.surface,
                borderWidth: 2,
                borderColor: colors.accent,
                borderRadius: 12,
                flexDirection: "column",
                gap: 8,
                shadowColor: "#000",
                shadowOpacity: 0.05,
                shadowRadius: 2,
                shadowOffset: { width: 0, height: 1 },
                elevation: 2,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Animated.View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: colors.accent,
                      opacity: pulse,
                    }}
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      color: colors.accent,
                      fontWeight: "700",
                      fontFamily: FONTS.sans,
                    }}
                  >
                    Match in Progress
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 11,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                  }}
                >
                  {activeMatch.venue || "Local Ground"}
                </Text>
              </View>

              {/* Umpire chip (1.4.7): who is scoring this shared match. */}
              {access.spaceConfigured ? (
                <View
                  accessibilityLabel={
                    db.getActiveUmpire()
                      ? `Umpire: ${db.getActiveUmpire()!.name}`
                      : "No umpire scoring right now"
                  }
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 2,
                    borderWidth: 1,
                    borderColor: colors.hairlineStrong,
                    backgroundColor: colors.surfaceCard,
                  }}
                >
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: db.getActiveUmpire() ? colors.success : colors.ink2,
                    }}
                  />
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: FONTS.sansSemiBold,
                      color: colors.ink,
                    }}
                  >
                    {db.getActiveUmpire()
                      ? `Umpire: ${db.getActiveUmpire()!.name}`
                      : "No umpire yet"}
                  </Text>
                </View>
              ) : null}

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  marginVertical: 4,
                }}
              >
                <View>
                  <Text
                    style={{
                      fontSize: 16,
                      fontFamily: FONTS.serif,
                      fontWeight: "700",
                      color: colors.ink,
                    }}
                  >
                    {db.getTeam(activeMatch.teamAId)?.name} vs{" "}
                    {db.getTeam(activeMatch.teamBId)?.name}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink2,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    Innings {activeMatch.currentInningsIndex + 1} ·{" "}
                    {activeMatch.rules.overs} Overs
                  </Text>
                </View>

                {(() => {
                  const curInn = activeMatch.innings[activeMatch.currentInningsIndex];
                  const sc = curInn
                    ? replayInnings(curInn.ballEvents, activeMatch.rules, [], [], db.getPlayersMap())
                    : null;
                  return (
                    <View style={{ alignItems: "flex-end" }}>
                      <Text
                        style={{
                          fontSize: 24,
                          fontFamily: FONTS.serif,
                          fontWeight: "700",
                          color: colors.ink,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {sc ? `${sc.totalRuns}/${sc.totalWickets}` : "0/0"}
                      </Text>
                      <Text
                        style={{
                          fontSize: 12,
                          color: colors.ink2,
                          fontFamily: FONTS.sans,
                        }}
                      >
                        ({sc?.oversFormatted || "0.0"} ov)
                      </Text>
                    </View>
                  );
                })()}
              </View>

              {/* Live Win Probability Snippet */}
              {(() => {
                const curInn = activeMatch.innings[activeMatch.currentInningsIndex];
                const sc = curInn
                  ? replayInnings(
                      curInn.ballEvents,
                      activeMatch.rules,
                      [],
                      [],
                      db.getPlayersMap(),
                      curInn.targetRuns,
                      curInn.isSuperOver
                    )
                  : null;
                if (!sc) return null;
                // The chase target used to be omitted here, so the model fell
                // back to "target 1" and any 2nd-innings chase instantly read
                // as "Target reached" (100% / 0%). Pass the stored target and
                // the 1st-innings total (incl. extras), like ScoringScreen does.
                const firstInningsTotal = activeMatch.innings[0]
                  ? activeMatch.innings[0].ballEvents.reduce(
                      (acc, b) =>
                        acc +
                        b.runsBat +
                        (b.extraType === "wide" || b.extraType === "no_ball"
                          ? b.extraRuns || 1
                          : b.extraType !== "none"
                          ? b.extraRuns
                          : 0),
                      0
                    )
                  : undefined;
                const prob = calculateLiveWinProbability(activeMatch, sc, firstInningsTotal);
                const tA = db.getTeam(activeMatch.teamAId);
                const tB = db.getTeam(activeMatch.teamBId);
                return (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      backgroundColor: colors.surfaceCard,
                      borderWidth: 1,
                      borderColor: colors.hairline,
                      borderRadius: 6,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <TrendingUp size={14} color={colors.accent} />
                      <Text
                        style={{
                          fontSize: 11,
                          color: colors.ink2,
                          fontFamily: FONTS.sans,
                        }}
                      >
                        Win Predictor:
                      </Text>
                    </View>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "600",
                        color: colors.ink,
                        fontFamily: FONTS.sans,
                        fontVariant: ["tabular-nums"],
                      }}
                    >
                      {tA?.shortName} {prob.teamAWinProb}% · {tB?.shortName}{" "}
                      {prob.teamBWinProb}%
                    </Text>
                  </View>
                );
              })()}

              {/* RN: web Play icon inside the button dropped (GullyButton
                  children are text-only). */}
              <GullyButton
                variant="accent"
                fullWidth
                onPress={() => onResumeMatch(activeMatch.id)}
                style={{ marginTop: 4 }}
              >
                Resume Live Scoring
              </GullyButton>
            </View>
          )}

          {/* MATCHES LIST WITH SWIPE-TO-ACTION */}
          <View style={{ flexDirection: "column", gap: 12 }}>
            <View style={{ flexDirection: "column", gap: 6 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    color: colors.ink2,
                    fontWeight: "600",
                    fontFamily: FONTS.sans,
                  }}
                >
                  Match Records
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {displayedMatches.length} shown
                </Text>
              </View>

              {/* Match Filter Tabs */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  padding: 4,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 8,
                }}
              >
                <Pressable
                  onPress={() => setMatchFilter("active")}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      paddingVertical: 4,
                      paddingHorizontal: 8,
                      borderRadius: 6,
                      opacity: pressed ? 0.9 : 1,
                    },
                    matchFilter === "active"
                      ? {
                          backgroundColor: colors.ink,
                          elevation: 1,
                        }
                      : {},
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: matchFilter === "active" ? "700" : "500",
                      color: matchFilter === "active" ? colors.bg : colors.ink2,
                      textAlign: "center",
                      fontFamily: FONTS.sans,
                    }}
                  >
                    Active ({matches.filter((m) => !m.isArchived).length})
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setMatchFilter("archived")}
                  style={({ pressed }) => [
                    {
                      flex: 1,
                      paddingVertical: 4,
                      paddingHorizontal: 8,
                      borderRadius: 6,
                      opacity: pressed ? 0.9 : 1,
                    },
                    matchFilter === "archived"
                      ? {
                          backgroundColor: colors.ink,
                          elevation: 1,
                        }
                      : {},
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: matchFilter === "archived" ? "700" : "500",
                      color: matchFilter === "archived" ? colors.bg : colors.ink2,
                      textAlign: "center",
                      fontFamily: FONTS.sans,
                    }}
                  >
                    Archived ({archivedCount})
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setMatchFilter("all")}
                  style={({ pressed }) => [
                    {
                      paddingVertical: 4,
                      paddingHorizontal: 10,
                      borderRadius: 6,
                      opacity: pressed ? 0.9 : 1,
                    },
                    matchFilter === "all"
                      ? {
                          backgroundColor: colors.ink,
                          elevation: 1,
                        }
                      : {},
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: matchFilter === "all" ? "700" : "500",
                      color: matchFilter === "all" ? colors.bg : colors.ink2,
                      textAlign: "center",
                      fontFamily: FONTS.sans,
                    }}
                  >
                    All
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Actions hint — RN port has explicit Resume / Archive buttons on
                every match card (the web swipe gestures were replaced), so the
                old "swipe right/left" hint described an interaction that does
                not exist here. Stacked vertically: the two side-by-side texts
                collided in the middle on narrow phones. */}
            <View
              style={{
                flexDirection: "column",
                gap: 2,
                paddingHorizontal: 12,
                paddingVertical: 8,
                backgroundColor: colors.surfaceCard,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 6,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text
                  style={{
                    fontSize: 11,
                    color: colors.accent,
                    fontWeight: "700",
                    fontFamily: FONTS.sans,
                  }}
                >
                  →
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                  }}
                >
                  Tap a match to open its full scorecard
                </Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text
                  style={{
                    fontSize: 11,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                  }}
                >
                  Use its buttons to resume scoring or archive it
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    color: "#D97706",
                    fontWeight: "700",
                    fontFamily: FONTS.sans,
                  }}
                >
                  ←
                </Text>
              </View>
            </View>

            {displayedMatches.length === 0 ? (
              <View
                style={{
                  padding: 32,
                  alignItems: "center",
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 10,
                }}
              >
                <Inbox size={32} color={colors.ink2} opacity={0.4} />
                <Text
                  style={{
                    fontSize: 14,
                    fontFamily: FONTS.serif,
                    fontWeight: "700",
                    color: colors.ink,
                    textAlign: "center",
                    marginTop: 8,
                  }}
                >
                  {matchFilter === "archived" ? "No Archived Matches" : "No Matches Recorded Yet"}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                    textAlign: "center",
                    marginTop: 4,
                  }}
                >
                  {matchFilter === "archived"
                    ? "Archived matches can be restored with the Restore button."
                    : "Tap 'New Match' below to score your first gully cricket match."}
                </Text>
              </View>
            ) : (
              <View style={{ flexDirection: "column", gap: 10 }}>
                {displayedMatches.map((m) => (
                  <SwipeableMatchItem
                    key={m.id}
                    match={m}
                    onOpenMatchDetail={onOpenMatchDetail}
                    onResumeMatch={onResumeMatch}
                    onToggleArchive={handleToggleArchive}
                  />
                ))}
              </View>
            )}
          </View>

          {/* UPCOMING FIXTURES */}
          {upcomingFixtures.length > 0 && (
            <View style={{ flexDirection: "column", gap: 8 }}>
              <Text
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: colors.ink2,
                  fontWeight: "600",
                  fontFamily: FONTS.sans,
                }}
              >
                Upcoming League Fixtures
              </Text>
              <View style={{ flexDirection: "column", gap: 8 }}>
                {upcomingFixtures.map((f) => {
                  const tA = db.getTeam(f.teamAId);
                  const tB = db.getTeam(f.teamBId);
                  return (
                    <View
                      key={f.id}
                      style={{
                        padding: 12,
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: colors.hairline,
                        borderRadius: 8,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <View>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "500",
                            color: colors.ink,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {tA?.name || "Team removed"} vs {tB?.name || "Team removed"}
                        </Text>
                        <Text
                          style={{
                            fontSize: 11,
                            color: colors.ink2,
                            fontFamily: FONTS.sans,
                            marginTop: 2,
                          }}
                        >
                          {[f.roundName, f.scheduledDate].filter(Boolean).join(" · ")}
                        </Text>
                      </View>
                      <Text
                        style={{
                          fontSize: 12,
                          color: colors.ink2,
                          fontFamily: "monospace",
                        }}
                      >
                        Pending
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Action Feedback Toast — web `fixed bottom-32` → absolute overlay
          anchored above the in-layout action bar. */}
      {toastMessage && (
        <View
          style={{
            position: "absolute",
            bottom: 88,
            left: 16,
            right: 16,
          }}
          pointerEvents="box-none"
        >
          <View
            style={{
              maxWidth: 384,
              alignSelf: "center",
              padding: 12,
              backgroundColor: colors.ink,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.hairlineStrong,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              shadowColor: "#000",
              shadowOpacity: 0.15,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <CheckCircle2 size={16} color="#34D399" />
              <Text
                style={{
                  fontSize: 12,
                  color: colors.bg,
                  fontFamily: FONTS.sans,
                  flexShrink: 1,
                }}
              >
                {toastMessage.text}
              </Text>
            </View>
            {toastMessage.matchId && (
              <Pressable
                onPress={handleUndoArchive}
                style={({ pressed }) => ({
                  marginLeft: 12,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  backgroundColor: colors.surfaceCard,
                  borderRadius: 4,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text
                  style={{
                    color: colors.ink,
                    fontWeight: "700",
                    fontSize: 11,
                    fontFamily: FONTS.sans,
                  }}
                >
                  Undo
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* ANCHORED IN-LAYOUT PRIMARY ACTION BAR (STRICT NO-FAB REQUIREMENT) */}
      {/* RN: web gradient fade dropped — solid bg pad instead. */}
      <View style={{ padding: 12, backgroundColor: colors.bg, gap: 6 }}>
        <View style={{ width: "100%", maxWidth: 560, alignSelf: "center" }}>
          <Pressable
            onPress={canEdit ? onStartNewMatch : () => setKeySheet({ open: true, mode: access.spaceHasKey ? "enter" : "set" })}
            disabled={!canEdit && access.mode === "audience" && access.spaceHasKey}
            accessibilityLabel={canEdit ? "New match" : "New match (needs the umpire key)"}
            style={({ pressed }) => ({
              height: 56,
              backgroundColor: colors.ink,
              borderRadius: 10,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              opacity:
                !canEdit && access.spaceHasKey ? 0.4 : pressed ? 0.95 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
              shadowColor: "#000",
              shadowOpacity: 0.1,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 3 },
              elevation: 4,
            })}
          >
            <Plus size={20} strokeWidth={2} color={colors.bg} />
            <Text
              style={{
                fontSize: 16,
                fontFamily: FONTS.serif,
                fontWeight: "600",
                color: colors.bg,
              }}
            >
              {canEdit || !access.spaceHasKey ? "New Match" : "New Match · Umpire key needed"}
            </Text>
          </Pressable>
          {!canEdit && access.spaceHasKey ? (
            <Text
              style={{
                fontSize: 11,
                fontFamily: FONTS.sans,
                color: colors.ink2,
                textAlign: "center",
              }}
            >
              Creating a match edits shared data — enter the umpire key to unlock it.
            </Text>
          ) : null}
        </View>
      </View>

      {/* Umpire key sheet (audience → umpire entry point, 1.4.7) */}
      <UmpireKeySheet
        isOpen={keySheet.open}
        mode={keySheet.mode}
        onClose={() => setKeySheet((s) => ({ ...s, open: false }))}
      />
    </SafeAreaView>
  );
};
