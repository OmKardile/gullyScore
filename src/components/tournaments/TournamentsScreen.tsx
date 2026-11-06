/**
 * GullyScore Tournaments Screen (RN port)
 *
 * Create tournament, auto fixture generation (circle method), and points table with correct ICC NRR.
 * Tapping a fixture opens match setup pre-filled.
 */

import React, { useState, useMemo, useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Fixture, MatchRules, Tournament } from "../../types/cricket";
import { db, DEFAULT_RULES } from "../../storage/db";
import {
  calculateTournamentPointsTable,
  generateRoundRobinFixtures,
  replayInnings,
} from "../../engine/scoringEngine";
import {
  simulateTournamentOutcomes,
  calculateNrrScenario,
} from "../../engine/predictionEngine";
import {
  NrrScenarioWidget,
  TournamentSimulationTable,
} from "../prediction/PredictionComponents";
import {
  GullyButton,
  GullySegmented,
  GullyTextField,
  GullySheet,
} from "../common/Components";
// RN: unused web lucide imports (ChevronRight, Calendar) dropped; Plus, Trophy,
// ArrowRight, Calculator, Sparkles kept from lucide-react-native
import { Plus, Trophy, ArrowRight, Calculator, Sparkles } from "lucide-react-native";
import { TournamentPointsTableVisualization } from "./TournamentPointsTableVisualization";
import { PlayerProfileModal } from "../players/PlayerProfileModal";
import { useTheme, FONTS } from "../../design/theme";

interface TournamentsScreenProps {
  onOpenMatchSetup: (params: {
    tournamentId: string;
    fixtureId: string;
    teamAId: string;
    teamBId: string;
  }) => void;
  onOpenMatchDetail: (matchId: string) => void;
}

export const TournamentsScreen: React.FC<TournamentsScreenProps> = ({
  onOpenMatchSetup,
  onOpenMatchDetail,
}) => {
  const { colors } = useTheme();
  const [tournaments, setTournaments] = useState<Tournament[]>(() => db.getTournaments());
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(() => tournaments[0] || null);
  const [activeTab, setActiveTab] = useState<"fixtures" | "table" | "predictions" | "stats">("fixtures");
  const [scenarioTeamId, setScenarioTeamId] = useState<string>("");
  const [scenarioTargetId, setScenarioTargetId] = useState<string>("");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  // Reconcile the NRR scenario picks with the selected tournament: switching
  // tournaments used to keep team ids from the PREVIOUS tournament (the
  // widget then showed foreign teams with no chip highlighted), and picking
  // a "My Team" equal to the stored "Target Rival" produced a meaningless
  // self-vs-self NRR equation.
  useEffect(() => {
    const teamIds = selectedTournament?.teamIds || [];
    if (scenarioTeamId && !teamIds.includes(scenarioTeamId)) setScenarioTeamId("");
    if (scenarioTargetId && !teamIds.includes(scenarioTargetId)) setScenarioTargetId("");
    if (scenarioTeamId && scenarioTargetId === scenarioTeamId) setScenarioTargetId("");
  }, [selectedTournament, scenarioTeamId, scenarioTargetId]);

  // Create Tournament modal state
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newTourneyName, setNewTourneyName] = useState<string>("");
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [tourneyOvers, setTourneyOvers] = useState<number>(8);

  const teams = db.getTeams();
  const matches = db.getMatches();
  // Memoize the filtered fixture list: the raw filter returned a NEW array
  // every render, so the simulation useMemo (800-iteration Monte Carlo) below
  // re-ran on every keystroke/scroll.
  const allFixtures = db.getFixtures();
  const fixtures = useMemo(
    () =>
      selectedTournament
        ? allFixtures.filter((f) => f.tournamentId === selectedTournament.id)
        : allFixtures,
    [allFixtures, selectedTournament]
  );

  const refreshTournaments = () => {
    const list = db.getTournaments();
    setTournaments(list);
    if (selectedTournament) {
      const updated = db.getTournament(selectedTournament.id);
      if (updated) setSelectedTournament(updated);
    }
  };

  const handleCreateTournament = () => {
    if (!newTourneyName.trim() || selectedTeamIds.length < 2) return;

    const tourneyId = `tourn_${Date.now()}`;
    const rules: MatchRules = {
      ...DEFAULT_RULES,
      overs: tourneyOvers,
      playersPerSide: 8,
      maxOversPerBowler: Math.ceil(tourneyOvers / 5),
    };

    const tournament: Tournament = {
      id: tourneyId,
      name: newTourneyName.trim(),
      format: "round_robin",
      teamIds: selectedTeamIds,
      rules,
      status: "in_progress",
      winPoints: 2,
      tiePoints: 1,
      nrPoints: 1,
      createdAt: Date.now(),
    };

    db.saveTournament(tournament);

    // Auto-generate round robin fixtures
    const fixList = generateRoundRobinFixtures(selectedTeamIds, tourneyId);
    fixList.forEach((f) => {
      db.saveFixture({
        ...f,
        scheduledDate: "Upcoming Weekend",
        venue: "Local Ground",
      });
    });

    refreshTournaments();
    setSelectedTournament(tournament);
    setShowCreateModal(false);
    setNewTourneyName("");
    setSelectedTeamIds([]);
  };

  // Compute points table for selected tournament
  const pointsTable = useMemo(() => {
    if (!selectedTournament) return [];
    const tourneyMatches = matches.filter((m) => m.tournamentId === selectedTournament.id);
    return calculateTournamentPointsTable(
      tourneyMatches,
      selectedTournament.teamIds,
      selectedTournament.winPoints,
      selectedTournament.tiePoints,
      selectedTournament.nrPoints,
      db.getPlayersMap()
    );
  }, [selectedTournament, matches]);

  // Monte Carlo Tournament Simulation
  const simulationResults = useMemo(() => {
    if (!selectedTournament) return [];
    return simulateTournamentOutcomes(
      selectedTournament,
      fixtures,
      matches,
      pointsTable
    );
  }, [selectedTournament, fixtures, matches, pointsTable]);

  // Tournament Top Performers: real aggregates from THIS tournament's
  // completed matches. The old list rendered the first 5 players in the
  // entire database (insertion order, no stats) under this heading.
  const tournamentTopPerformers = useMemo(() => {
    if (!selectedTournament) return [];
    const tournMatches = matches.filter(
      (m) => m.tournamentId === selectedTournament.id && m.status === "completed"
    );
    const playersMap = db.getPlayersMap();
    const agg: Record<string, { runs: number; wickets: number }> = {};
    for (const m of tournMatches) {
      m.innings.forEach((inn) => {
        const battingSquad =
          inn.battingTeamId === m.teamAId ? m.teamAPlayerIds : m.teamBPlayerIds;
        const sc = replayInnings(inn.ballEvents, m.rules, battingSquad, [], playersMap);
        sc.batters.forEach((b) => {
          if (!agg[b.playerId]) agg[b.playerId] = { runs: 0, wickets: 0 };
          agg[b.playerId].runs += b.runs;
        });
        sc.bowlers.forEach((b) => {
          if (!agg[b.playerId]) agg[b.playerId] = { runs: 0, wickets: 0 };
          agg[b.playerId].wickets += b.wickets;
        });
      });
    }
    return Object.entries(agg)
      .map(([id, a]) => ({ player: playersMap[id], runs: a.runs, wickets: a.wickets }))
      .filter((r) => !!r.player)
      .sort((x, y) => y.runs + y.wickets * 20 - (x.runs + x.wickets * 20))
      .slice(0, 5);
  }, [matches, selectedTournament]);

  // NRR Scenario Solver
  const nrrScenario = useMemo(() => {
    if (!selectedTournament) return null;
    const team1 = scenarioTeamId || selectedTournament.teamIds[0];
    const team2 =
      scenarioTargetId ||
      (selectedTournament.teamIds[1] !== team1
        ? selectedTournament.teamIds[1]
        : selectedTournament.teamIds[0]);
    if (!team1 || !team2) return null;
    return calculateNrrScenario(
      team1,
      team2,
      team2,
      pointsTable,
      selectedTournament.rules
    );
  }, [selectedTournament, scenarioTeamId, scenarioTargetId, pointsTable]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header (web sticky header → fixed bar above the ScrollView) */}
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
        <Text
          style={{
            fontSize: 18,
            fontFamily: FONTS.serif,
            fontWeight: "700",
            color: colors.ink,
          }}
        >
          Tournaments
        </Text>

        {/* RN: web's GullyButton with an inline <Plus> icon → Pressable
            replicating the primary sm button (icon + label) */}
        <Pressable
          onPress={() => setShowCreateModal(true)}
          style={({ pressed }) => ({
            height: 36,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: colors.ink,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Plus size={14} color={colors.bg} />
          <Text
            style={{
              fontSize: 12,
              fontFamily: FONTS.sans,
              fontWeight: "500",
              color: colors.bg,
            }}
          >
            New Tournament
          </Text>
        </Pressable>
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
        {/* Tournament Switcher if multiple */}
        {tournaments.length > 1 && (
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
            {tournaments.map((t) => {
              const isActive = selectedTournament?.id === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setSelectedTournament(t)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: isActive ? colors.accent : colors.hairlineStrong,
                    backgroundColor: isActive ? colors.accentSubtle : "transparent",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: FONTS.serif,
                      color: isActive ? colors.accent : colors.ink,
                      fontWeight: isActive ? "700" : "400",
                    }}
                  >
                    {t.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {selectedTournament ? (
          <View style={{ flexDirection: "column", gap: 16 }}>
            {/* Tournament Hero Card */}
            <View
              style={{
                padding: 16,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
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
                  Round Robin League · {selectedTournament.rules.overs} Overs
                </Text>
                <Text
                  style={{
                    fontSize: 18,
                    fontFamily: FONTS.serif,
                    fontWeight: "700",
                    color: colors.ink,
                    marginTop: 2,
                  }}
                >
                  {selectedTournament.name}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                  }}
                >
                  {selectedTournament.teamIds.length} Teams · Win: 2 pts, Tie/NR: 1 pt
                </Text>
              </View>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: colors.accentSubtle,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Trophy size={20} color={colors.accent} strokeWidth={1.5} />
              </View>
            </View>

            {/* Sub-tabs: Fixtures / Table / Stats */}
            <View
              style={{
                alignItems: "center",
                borderBottomWidth: 1,
                borderBottomColor: colors.hairline,
                paddingVertical: 4,
              }}
            >
              <GullySegmented
                options={[
                  { label: "Fixtures", value: "fixtures" },
                  { label: "Points Table", value: "table" },
                  { label: "Predictor & NRR", value: "predictions" },
                  { label: "Leaderboard", value: "stats" },
                ]}
                value={activeTab}
                onChange={(tab) => setActiveTab(tab)}
              />
            </View>

            {/* Sub-tab 1: Fixtures */}
            {activeTab === "fixtures" && (
              <View style={{ flexDirection: "column", gap: 8 }}>
                {fixtures.map((fix) => {
                  const tA = db.getTeam(fix.teamAId);
                  const tB = db.getTeam(fix.teamBId);
                  const isDone = fix.status === "completed" && fix.matchId;

                  return (
                    <Pressable
                      key={fix.id}
                      onPress={() => {
                        if (isDone && fix.matchId) {
                          onOpenMatchDetail(fix.matchId);
                        } else {
                          onOpenMatchSetup({
                            tournamentId: selectedTournament.id,
                            fixtureId: fix.id,
                            teamAId: fix.teamAId,
                            teamBId: fix.teamBId,
                          });
                        }
                      }}
                      style={({ pressed }) => ({
                        padding: 14,
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: pressed
                          ? colors.hairlineStrong
                          : colors.hairline,
                        borderRadius: 10,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        opacity: pressed ? 0.9 : 1,
                      })}
                    >
                      <View style={{ flexDirection: "column", flex: 1, paddingRight: 8 }}>
                        <Text
                          style={{
                            fontSize: 11,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                            color: colors.ink2,
                            fontWeight: "600",
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {fix.roundName} · {fix.scheduledDate || "Weekend"}
                        </Text>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                            marginTop: 4,
                          }}
                        >
                          <Text
                            numberOfLines={1}
                            style={{
                              fontFamily: FONTS.serif,
                              fontWeight: "700",
                              fontSize: 14,
                              color: colors.ink,
                            }}
                          >
                            {tA?.name}
                          </Text>
                          <Text
                            style={{
                              fontSize: 12,
                              color: colors.ink2,
                              fontFamily: FONTS.sans,
                            }}
                          >
                            vs
                          </Text>
                          <Text
                            numberOfLines={1}
                            style={{
                              fontFamily: FONTS.serif,
                              fontWeight: "700",
                              fontSize: 14,
                              color: colors.ink,
                            }}
                          >
                            {tB?.name}
                          </Text>
                        </View>
                      </View>

                      <View
                        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                      >
                        {isDone ? (
                          <Text
                            style={{
                              color: colors.success,
                              fontWeight: "600",
                              fontSize: 12,
                              fontFamily: FONTS.sans,
                            }}
                          >
                            Completed
                          </Text>
                        ) : (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            <Text
                              style={{
                                color: colors.accent,
                                fontWeight: "600",
                                fontSize: 12,
                                fontFamily: FONTS.sans,
                              }}
                            >
                              Play Match
                            </Text>
                            <ArrowRight size={14} color={colors.accent} />
                          </View>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {/* Sub-tab 2: Dynamic Points Table Visualization */}
            {activeTab === "table" && (
              <TournamentPointsTableVisualization
                tournament={selectedTournament}
                onOpenMatchDetail={onOpenMatchDetail}
                onOpenMatchSetup={onOpenMatchSetup}
              />
            )}

            {/* Sub-tab: Predictions & NRR Simulator */}
            {activeTab === "predictions" && (
              <View style={{ flexDirection: "column", gap: 20 }}>
                {/* 1. Monte Carlo Simulation Section */}
                <View style={{ flexDirection: "column", gap: 8 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Sparkles size={14} color={colors.accent} />
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
                        Tournament Outcome Simulator
                      </Text>
                    </View>
                    <Text
                      style={{
                        fontSize: 11,
                        color: colors.ink2,
                        fontFamily: FONTS.sans,
                      }}
                    >
                      Monte Carlo Engine
                    </Text>
                  </View>

                  <TournamentSimulationTable
                    results={simulationResults}
                    teamsMap={db.getTeamsMap()}
                  />
                </View>

                {/* 2. Interactive NRR "What Do We Need?" Calculator */}
                <View style={{ flexDirection: "column", gap: 8 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Calculator size={14} color={colors.accent} />
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
                        NRR Scenario Modeler
                      </Text>
                    </View>
                    <Text
                      style={{
                        fontSize: 11,
                        color: colors.ink2,
                        fontFamily: FONTS.sans,
                      }}
                    >
                      Exact Equation Solver
                    </Text>
                  </View>

                  {/* Pick Team & Rival Selector */}
                  <View
                    style={{
                      padding: 12,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.hairline,
                      borderRadius: 8,
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: colors.ink2,
                        fontFamily: FONTS.sans,
                      }}
                    >
                      Pick your team and the rival you need to overtake on Net
                      Run Rate:
                    </Text>
                    {/* RN: web grid-cols-2 → two equal columns */}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontSize: 10,
                            textTransform: "uppercase",
                            fontWeight: "600",
                            color: colors.ink2,
                            marginBottom: 4,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          My Team
                        </Text>
                        {/* RN: web <select> → wrapped chip picker */}
                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: 6,
                          }}
                        >
                          {selectedTournament.teamIds.map((tId) => {
                            const activeTId =
                              scenarioTeamId || selectedTournament.teamIds[0];
                            return (
                              <Pressable
                                key={tId}
                                onPress={() => setScenarioTeamId(tId)}
                                style={{
                                  paddingHorizontal: 10,
                                  paddingVertical: 5,
                                  borderRadius: 6,
                                  borderWidth: 1,
                                  borderColor:
                                    activeTId === tId
                                      ? colors.accent
                                      : colors.hairlineStrong,
                                  backgroundColor:
                                    activeTId === tId
                                      ? colors.accentSubtle
                                      : colors.surfaceCard,
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 12,
                                    color:
                                      activeTId === tId
                                        ? colors.accent
                                        : colors.ink,
                                    fontWeight:
                                      activeTId === tId ? "600" : "400",
                                    fontFamily: FONTS.sans,
                                  }}
                                >
                                  {db.getTeam(tId)?.name}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontSize: 10,
                            textTransform: "uppercase",
                            fontWeight: "600",
                            color: colors.ink2,
                            marginBottom: 4,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          Target Rival on Table
                        </Text>
                        {/* RN: web <select> → wrapped chip picker */}
                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            gap: 6,
                          }}
                        >
                          {selectedTournament.teamIds
                            .filter(
                              (tId) =>
                                tId !==
                                (scenarioTeamId || selectedTournament.teamIds[0])
                            )
                            .map((tId) => {
                              const defaultTarget =
                                scenarioTargetId ||
                                (selectedTournament.teamIds[1] !==
                                (scenarioTeamId || selectedTournament.teamIds[0])
                                  ? selectedTournament.teamIds[1]
                                  : selectedTournament.teamIds[0]);
                              return (
                                <Pressable
                                  key={tId}
                                  onPress={() => setScenarioTargetId(tId)}
                                  style={{
                                    paddingHorizontal: 10,
                                    paddingVertical: 5,
                                    borderRadius: 6,
                                    borderWidth: 1,
                                    borderColor:
                                      defaultTarget === tId
                                        ? colors.accent
                                        : colors.hairlineStrong,
                                    backgroundColor:
                                      defaultTarget === tId
                                        ? colors.accentSubtle
                                        : colors.surfaceCard,
                                  }}
                                >
                                  <Text
                                    style={{
                                      fontSize: 12,
                                      color:
                                        defaultTarget === tId
                                          ? colors.accent
                                          : colors.ink,
                                      fontWeight:
                                        defaultTarget === tId ? "600" : "400",
                                      fontFamily: FONTS.sans,
                                    }}
                                  >
                                    {db.getTeam(tId)?.name}
                                  </Text>
                                </Pressable>
                              );
                            })}
                        </View>
                      </View>
                    </View>
                  </View>

                  {nrrScenario && (
                    <NrrScenarioWidget
                      scenario={nrrScenario}
                      teamName={db.getTeam(nrrScenario.teamId)?.name || "My Team"}
                      targetOpponentName={
                        db.getTeam(nrrScenario.targetOpponentId)?.name || "Rival"
                      }
                    />
                  )}
                </View>
              </View>
            )}

            {/* Sub-tab 3: Stats */}
            {activeTab === "stats" && (
              <View
                style={{
                  padding: 16,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 10,
                  flexDirection: "column",
                  gap: 12,
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
                  Tournament Top Performers
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                  }}
                >
                  Tournament statistics update live with every match result
                  completed.
                </Text>
                <View style={{ flexDirection: "column" }}>
                  {tournamentTopPerformers.length === 0 ? (
                    <Text
                      style={{
                        fontSize: 12,
                        color: colors.ink2,
                        fontFamily: FONTS.sans,
                        paddingVertical: 8,
                      }}
                    >
                      No completed matches in this tournament yet — top
                      performers appear as results come in.
                    </Text>
                  ) : (
                    tournamentTopPerformers.map((r, i, arr) => (
                      <Pressable
                        key={r.player.id}
                        onPress={() => setSelectedPlayerId(r.player.id)}
                        style={({ pressed }) => ({
                          paddingVertical: 8,
                          paddingHorizontal: 8,
                          borderRadius: 6,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                          borderBottomColor: colors.hairline,
                          opacity: pressed ? 0.9 : 1,
                        })}
                      >
                        <Text
                          style={{
                            fontWeight: "500",
                            fontSize: 12,
                            color: colors.ink,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {i + 1}. {r.player.name}
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: colors.ink2,
                            fontVariant: ["tabular-nums"],
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {r.runs} runs · {r.wickets} wkts
                        </Text>
                      </Pressable>
                    ))
                  )}
                </View>
              </View>
            )}
          </View>
        ) : (
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
            <Text
              style={{
                fontSize: 12,
                color: colors.ink2,
                marginBottom: 12,
                textAlign: "center",
                fontFamily: FONTS.sans,
              }}
            >
              No tournaments created yet.
            </Text>
            <GullyButton onPress={() => setShowCreateModal(true)}>
              Create Tournament
            </GullyButton>
          </View>
        )}
      </ScrollView>

      {/* --- CREATE TOURNAMENT SHEET --- */}
      <GullySheet
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Tournament"
      >
        <View style={{ flexDirection: "column", gap: 16 }}>
          <GullyTextField
            label="Tournament Name"
            placeholder="e.g. Shivaji Park Premier League"
            value={newTourneyName}
            onChangeText={(t) => setNewTourneyName(t)}
          />

          {/* RN: web type="number" → number-pad keyboard */}
          <GullyTextField
            label="Overs Per Match"
            value={String(tourneyOvers)}
            onChangeText={(t) => setTourneyOvers(parseInt(t, 10) || 6)}
            tabular
            keyboardType="number-pad"
          />

          <View>
            <Text
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: colors.ink2,
                fontWeight: "600",
                marginBottom: 8,
                fontFamily: FONTS.sans,
              }}
            >
              Select Participating Teams (min 2)
            </Text>
            {/* RN: web max-h-52 overflow-y-auto → capped ScrollView */}
            <View style={{ maxHeight: 208 }}>
              <ScrollView style={{ width: "100%" }}>
                <View style={{ flexDirection: "column", gap: 6 }}>
                  {teams.map((t) => {
                    const isSelected = selectedTeamIds.includes(t.id);
                    return (
                      <Pressable
                        key={t.id}
                        onPress={() => {
                          setSelectedTeamIds((prev) =>
                            prev.includes(t.id)
                              ? prev.filter((id) => id !== t.id)
                              : [...prev, t.id]
                          );
                        }}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: 10,
                          borderWidth: 1,
                          borderRadius: 8,
                          opacity: pressed ? 0.9 : 1,
                          borderColor: isSelected
                            ? colors.accent
                            : colors.hairline,
                          backgroundColor: isSelected
                            ? colors.accentSubtle
                            : "transparent",
                        })}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            color: isSelected ? colors.accent : colors.ink,
                            fontWeight: isSelected ? "600" : "400",
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {t.name}
                        </Text>
                        {isSelected && (
                          <Text
                            style={{
                              fontSize: 12,
                              color: colors.accent,
                              fontWeight: "600",
                              fontFamily: FONTS.sans,
                            }}
                          >
                            Selected
                          </Text>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          </View>

          <GullyButton
            variant="primary"
            fullWidth
            onPress={handleCreateTournament}
            disabled={!newTourneyName.trim() || selectedTeamIds.length < 2}
            style={{ marginTop: 8 }}
          >
            Generate Fixtures & Create League
          </GullyButton>
        </View>
      </GullySheet>

      {/* --- PLAYER PROFILE MODAL --- */}
      <PlayerProfileModal
        playerId={selectedPlayerId}
        onClose={() => setSelectedPlayerId(null)}
        onOpenMatchDetail={onOpenMatchDetail}
      />
    </SafeAreaView>
  );
};
