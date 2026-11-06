/**
 * GullyScore Group Stats & Leaderboards Screen (RN port)
 *
 * Career stats, leaderboards (runs, wickets, sixes, HS, SR, econ, MVP, catches),
 * and data-derived milestone tags.
 */

import React, { useState, useMemo } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { db } from "../../storage/db";
import { replayInnings, calculateMatchMVPPoints } from "../../engine/scoringEngine";
import { GullySegmented, GullyChip } from "../common/Components";
import { Award, TrendingUp } from "lucide-react-native";
import { RunRateProgressionChart } from "./RunRateProgressionChart";
import { PlayerProfileModal } from "../players/PlayerProfileModal";
import { useTheme, FONTS } from "../../design/theme";

export const StatsScreen: React.FC = () => {
  const { colors } = useTheme();
  const [activeSubTab, setActiveSubTab] = useState<"leaderboards" | "progression">("leaderboards");
  const [filterTeamId, setFilterTeamId] = useState<string>("all");
  const [activeLeaderboard, setActiveLeaderboard] = useState<
    "runs" | "wickets" | "sixes" | "hs" | "sr" | "econ" | "mvp" | "catches"
  >("runs");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const matches = db.getMatches();
  const players = db.getPlayers();
  const teams = db.getTeams();
  const playersMap = db.getPlayersMap();

  // Aggregate career stats for all players
  const playerStats = useMemo(() => {
    const statsMap: Record<
      string,
      {
        playerId: string;
        runs: number;
        ballsFaced: number;
        wickets: number;
        legalBallsBowled: number;
        runsConceded: number;
        maidens: number;
        sixes: number;
        fours: number;
        highestScore: number;
        catches: number;
        stumpings: number;
        runOuts: number;
        mvpPoints: number;
        matches: number;
        fifties: number;
        hundreds: number;
        fiveWickets: number;
        ducks: number;
      }
    > = {};

    players.forEach((p) => {
      statsMap[p.id] = {
        playerId: p.id,
        runs: 0,
        ballsFaced: 0,
        wickets: 0,
        legalBallsBowled: 0,
        runsConceded: 0,
        maidens: 0,
        sixes: 0,
        fours: 0,
        highestScore: 0,
        catches: 0,
        stumpings: 0,
        runOuts: 0,
        mvpPoints: 0,
        matches: 0,
        fifties: 0,
        hundreds: 0,
        fiveWickets: 0,
        ducks: 0,
      };
    });

    matches.forEach((m) => {
      if (m.status !== "completed") return;
      // Guard against malformed rows (e.g. a hand-edited or truncated backup
      // imported before validation existed): a match without innings[] used
      // to throw here and crash the whole Stats tab on every launch.
      if (!Array.isArray(m.innings)) return;

      const scList = m.innings.map((inn) =>
        replayInnings(inn.ballEvents, m.rules, [], [], playersMap)
      );

      const mvp = calculateMatchMVPPoints(scList);
      Object.entries(mvp).forEach(([pId, val]) => {
        if (statsMap[pId]) {
          statsMap[pId].mvpPoints += val.total;
        }
      });

      scList.forEach((sc) => {
        // Batters
        sc.batters.forEach((b) => {
          if (statsMap[b.playerId]) {
            const st = statsMap[b.playerId];
            st.runs += b.runs;
            st.ballsFaced += b.ballsFaced;
            st.fours += b.fours;
            st.sixes += b.sixes;
            if (b.runs > st.highestScore) st.highestScore = b.runs;
            if (b.runs >= 100) st.hundreds++;
            else if (b.runs >= 50) st.fifties++;
            if (b.isOut && b.runs === 0) st.ducks++;
          }
        });

        // Bowlers
        sc.bowlers.forEach((bw) => {
          if (statsMap[bw.playerId]) {
            const st = statsMap[bw.playerId];
            st.wickets += bw.wickets;
            st.legalBallsBowled += bw.legalBalls;
            st.runsConceded += bw.runsConceded;
            st.maidens += bw.maidens;
            if (bw.wickets >= 5) st.fiveWickets++;
          }
        });

        // Fielders
        sc.batters.forEach((b) => {
          if (b.isOut && b.fielderIds) {
            b.fielderIds.forEach((fId) => {
              if (statsMap[fId]) {
                if (b.wicketType === "run_out") statsMap[fId].runOuts++;
                else if (b.wicketType === "stumped") statsMap[fId].stumpings++;
                else statsMap[fId].catches++;
              }
            });
          }
        });
      });
    });

    return statsMap;
  }, [matches, players, playersMap]);

  // Filtered by team
  const filteredList = useMemo(() => {
    let list = Object.values(playerStats);
    if (filterTeamId !== "all") {
      const team = db.getTeam(filterTeamId);
      if (team) {
        list = list.filter((item) => team.playerIds.includes(item.playerId));
      }
    }
    return list;
  }, [playerStats, filterTeamId]);

  // Sorted leaderboards
  const leaderboardData = useMemo(() => {
    const list = [...filteredList];
    switch (activeLeaderboard) {
      case "runs":
        return list.sort((a, b) => b.runs - a.runs);
      case "wickets":
        return list.sort((a, b) => b.wickets - a.wickets);
      case "sixes":
        return list.sort((a, b) => b.sixes - a.sixes);
      case "hs":
        return list.sort((a, b) => b.highestScore - a.highestScore);
      case "sr":
        return list
          .filter((p) => p.ballsFaced >= 15)
          .sort((a, b) => b.runs / b.ballsFaced - a.runs / a.ballsFaced);
      case "econ":
        return list
          .filter((p) => p.legalBallsBowled >= 12)
          .sort(
            (a, b) =>
              a.runsConceded / (a.legalBallsBowled / 6) -
              b.runsConceded / (b.legalBallsBowled / 6)
          );
      case "mvp":
        return list.sort((a, b) => b.mvpPoints - a.mvpPoints);
      case "catches":
        return list.sort((a, b) => b.catches - a.catches);
      default:
        return list;
    }
  }, [filteredList, activeLeaderboard]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header with Sub-Tab Selector (web sticky header → fixed bar above the ScrollView) */}
      <View
        style={{
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <Text
            style={{
              fontSize: 18,
              fontFamily: FONTS.serif,
              fontWeight: "700",
              color: colors.ink,
            }}
          >
            {activeSubTab === "leaderboards" ? "Group Leaderboards" : "Run-Rate Progression"}
          </Text>

          {activeSubTab === "leaderboards" && (
            // RN: web <select> team filter → horizontal chip scroller
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0, maxWidth: 180 }}
              contentContainerStyle={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              }}
            >
              <GullyChip
                label="All Teams"
                active={filterTeamId === "all"}
                onPress={() => setFilterTeamId("all")}
              />
              {teams.map((t) => (
                <GullyChip
                  key={t.id}
                  label={t.name}
                  active={filterTeamId === t.id}
                  onPress={() => setFilterTeamId(t.id)}
                />
              ))}
            </ScrollView>
          )}
        </View>

        {/* Sub-Tab Navigation Bar */}
        <View
          style={{
            flexDirection: "row",
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
            paddingHorizontal: 16,
          }}
        >
          <Pressable
            onPress={() => setActiveSubTab("leaderboards")}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 8,
              borderBottomWidth: 2,
              borderBottomColor:
                activeSubTab === "leaderboards"
                  ? colors.accent
                  : "transparent",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Award
              size={14}
              color={activeSubTab === "leaderboards" ? colors.accent : colors.ink2}
            />
            <Text
              style={{
                fontSize: 12,
                fontWeight: activeSubTab === "leaderboards" ? "700" : "500",
                color: activeSubTab === "leaderboards" ? colors.accent : colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              Leaderboards
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveSubTab("progression")}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 8,
              borderBottomWidth: 2,
              borderBottomColor:
                activeSubTab === "progression" ? colors.accent : "transparent",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <TrendingUp
              size={14}
              color={activeSubTab === "progression" ? colors.accent : colors.ink2}
            />
            <Text
              style={{
                fontSize: 12,
                fontWeight: activeSubTab === "progression" ? "700" : "500",
                color: activeSubTab === "progression" ? colors.accent : colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              Run-Rate Progression (Recharts)
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{
          width: "100%",
          maxWidth: 560,
          alignSelf: "center",
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 32,
          flexDirection: "column",
          gap: 16,
          flexGrow: 1,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {activeSubTab === "progression" ? (
          <RunRateProgressionChart matches={matches} />
        ) : (
          <>
            {/* Metric Selector Chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerStyle={{
                flexDirection: "row",
                gap: 8,
                alignItems: "center",
                paddingBottom: 4,
              }}
            >
              {[
                { id: "runs", label: "Most Runs" },
                { id: "wickets", label: "Most Wickets" },
                { id: "sixes", label: "Most Sixes" },
                { id: "hs", label: "Highest Score" },
                { id: "sr", label: "Strike Rate" },
                { id: "econ", label: "Best Econ" },
                { id: "mvp", label: "MVP Leader" },
                { id: "catches", label: "Catches" },
              ].map((item) => {
                const isActive = activeLeaderboard === item.id;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() =>
                      setActiveLeaderboard(item.id as typeof activeLeaderboard)
                    }
                    style={({ pressed }) => ({
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 8,
                      borderWidth: 1,
                      opacity: pressed ? 0.9 : 1,
                      borderColor: isActive
                        ? colors.accent
                        : colors.hairlineStrong,
                      backgroundColor: isActive
                        ? colors.accentSubtle
                        : "transparent",
                    })}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: FONTS.sans,
                        color: isActive ? colors.accent : colors.ink,
                        fontWeight: isActive ? "600" : "400",
                      }}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Leaderboard Table */}
            <View
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  backgroundColor: colors.surfaceCard,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.hairline,
                  flexDirection: "row",
                  justifyContent: "space-between",
                }}
              >
                <Text
                  style={{
                    fontFamily: FONTS.serif,
                    fontWeight: "600",
                    fontSize: 14,
                    color: colors.ink,
                  }}
                >
                  Player
                </Text>
                <Text
                  style={{
                    fontFamily: FONTS.serif,
                    fontWeight: "600",
                    fontSize: 14,
                    color: colors.ink,
                    textTransform: "capitalize",
                  }}
                >
                  {activeLeaderboard}
                </Text>
              </View>

              <View style={{ flexDirection: "column" }}>
                {leaderboardData.slice(0, 10).map((st, idx, arr) => {
                  const player = playersMap[st.playerId];
                  let metricValue: string | number = "";

                  switch (activeLeaderboard) {
                    case "runs":
                      metricValue = `${st.runs} runs (${st.ballsFaced}b)`;
                      break;
                    case "wickets":
                      metricValue = `${st.wickets} wkts (${(st.legalBallsBowled / 6).toFixed(1)} ov)`;
                      break;
                    case "sixes":
                      metricValue = `${st.sixes} sixes`;
                      break;
                    case "hs":
                      metricValue = `${st.highestScore}`;
                      break;
                    case "sr":
                      metricValue = `${((st.runs / st.ballsFaced) * 100).toFixed(1)} SR`;
                      break;
                    case "econ":
                      metricValue = `${(st.runsConceded / (st.legalBallsBowled / 6)).toFixed(2)} econ`;
                      break;
                    case "mvp":
                      metricValue = `${st.mvpPoints} pts`;
                      break;
                    case "catches":
                      metricValue = `${st.catches} catches`;
                      break;
                  }

                  return (
                    <Pressable
                      key={st.playerId}
                      onPress={() => setSelectedPlayerId(st.playerId)}
                      style={({ pressed }) => ({
                        paddingHorizontal: 16,
                        paddingVertical: 12,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderBottomWidth: idx < arr.length - 1 ? 1 : 0,
                        borderBottomColor: colors.hairline,
                        backgroundColor: pressed
                          ? colors.surfaceCard
                          : "transparent",
                        opacity: pressed ? 0.9 : 1,
                      })}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          flex: 1,
                          paddingRight: 8,
                        }}
                      >
                        <Text
                          style={{
                            width: 20,
                            fontFamily: FONTS.serif,
                            fontWeight: "700",
                            fontSize: 14,
                            color: idx === 0 ? colors.accent : colors.ink2,
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {idx + 1}.
                        </Text>
                        <View style={{ minWidth: 0 }}>
                          <Text
                            numberOfLines={1}
                            style={{
                              fontWeight: "600",
                              fontSize: 14,
                              color: colors.ink,
                              fontFamily: FONTS.sans,
                            }}
                          >
                            {player?.name || "Player"}
                          </Text>
                          <Text
                            style={{
                              fontSize: 11,
                              color: colors.ink2,
                              fontFamily: FONTS.sans,
                            }}
                          >
                            {player?.role.replace("_", " ")}
                          </Text>
                        </View>
                      </View>

                      <Text
                        style={{
                          fontFamily: FONTS.serif,
                          fontWeight: "700",
                          fontSize: 14,
                          color: colors.ink,
                          fontVariant: ["tabular-nums"],
                          textAlign: "right",
                        }}
                      >
                        {metricValue}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* --- PLAYER PROFILE MODAL --- */}
      <PlayerProfileModal
        playerId={selectedPlayerId}
        onClose={() => setSelectedPlayerId(null)}
      />
    </SafeAreaView>
  );
};
