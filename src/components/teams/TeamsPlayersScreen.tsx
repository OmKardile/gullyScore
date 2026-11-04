/**
 * GullyScore Teams & Players Screen
 *
 * Local roster management, no login/account required.
 * Quick-add anywhere, player career stats, milestone tags, and archival handling.
 *
 * RN port notes:
 * - Web sticky header → fixed header above the ScrollView (SafeAreaView top).
 * - Web `<select>` pickers (role, batting hand, add-to-team) → GullyChip rows /
 *   GullySegmented per port conventions.
 * - GullyButton children are text-only, so the web Plus / Archive icons inside
 *   the "Team"/"Player" and "Archive Team" buttons are dropped.
 * - The squad list's `max-h-60 overflow-y-auto` → fixed-height nested ScrollView.
 */

import React, { useState, useMemo } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  Player,
  Team,
  PlayerRole,
  BattingHand,
  BowlingStyle,
} from "../../types/cricket";
import { db } from "../../storage/db";
import {
  GullyButton,
  GullySegmented,
  GullyTextField,
  GullySheet,
  GullyChip,
} from "../common/Components";
import { Search } from "lucide-react-native";
import { replayInnings } from "../../engine/scoringEngine";
import { PlayerProfileModal } from "../players/PlayerProfileModal";
import { useTheme, FONTS } from "../../design/theme";

// Small inline select-label (web: 11px uppercase label above a <select>).
const ControlLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { colors } = useTheme();
  return (
    <Text
      style={{
        fontSize: 11,
        fontFamily: FONTS.sans,
        textTransform: "uppercase",
        letterSpacing: 1,
        color: colors.ink2,
        fontWeight: "600",
        marginBottom: 4,
      }}
    >
      {children}
    </Text>
  );
};

export const TeamsPlayersScreen: React.FC = () => {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<"teams" | "players">("teams");
  const [teams, setTeams] = useState<Team[]>(() => db.getTeams());
  const [players, setPlayers] = useState<Player[]>(() => db.getPlayers());
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modals & Drawers
  const [showAddTeamModal, setShowAddTeamModal] = useState<boolean>(false);
  const [showAddPlayerModal, setShowAddPlayerModal] = useState<boolean>(false);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);

  // New Team Form
  const [newTeamName, setNewTeamName] = useState<string>("");
  const [newTeamShort, setNewTeamShort] = useState<string>("");
  const [newTeamColor, setNewTeamColor] = useState<string>("#0E1B2E");

  // New Player Form
  const [newPlayerName, setNewPlayerName] = useState<string>("");
  const [newPlayerNickname, setNewPlayerNickname] = useState<string>("");
  const [newPlayerRole, setNewPlayerRole] = useState<PlayerRole>("all_rounder");
  const [newPlayerBatHand, setNewPlayerBatHand] = useState<BattingHand>("right");
  const [newPlayerBowlStyle, setNewPlayerBowlStyle] = useState<BowlingStyle>("rm");
  const [newPlayerTeamId, setNewPlayerTeamId] = useState<string>("");

  const refreshData = () => {
    setTeams(db.getTeams());
    setPlayers(db.getPlayers());
  };

  const handleCreateTeam = () => {
    if (!newTeamName.trim()) return;
    const short =
      newTeamShort.trim() ||
      newTeamName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 3);

    const team: Team = {
      id: `t_${Date.now()}`,
      name: newTeamName.trim(),
      shortName: short,
      color: newTeamColor,
      monogram: short,
      playerIds: [],
      createdAt: Date.now(),
    };
    db.saveTeam(team);
    refreshData();
    setShowAddTeamModal(false);
    setNewTeamName("");
    setNewTeamShort("");
  };

  const handleCreatePlayer = () => {
    if (!newPlayerName.trim()) return;
    const player: Player = {
      id: `p_${Date.now()}`,
      name: newPlayerName.trim(),
      nickname: newPlayerNickname.trim() || undefined,
      role: newPlayerRole,
      battingHand: newPlayerBatHand,
      bowlingStyle: newPlayerBowlStyle,
      isArchived: false,
      createdAt: Date.now(),
    };
    db.savePlayer(player);
    if (newPlayerTeamId) {
      const t = db.getTeam(newPlayerTeamId);
      if (t) {
        t.playerIds.push(player.id);
        db.saveTeam(t);
      }
    }
    refreshData();
    setShowAddPlayerModal(false);
    setNewPlayerName("");
    setNewPlayerNickname("");
  };

  const filteredPlayers = useMemo(() => {
    return players
      .filter((p) => !p.isArchived)
      .filter((p) =>
        searchQuery
          ? p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.nickname?.toLowerCase().includes(searchQuery.toLowerCase())
          : true
      );
  }, [players, searchQuery]);

  // Compute career stats for selected player
  const playerCareerStats = useMemo(() => {
    if (!selectedPlayer) return null;
    const matches = db.getMatches();
    const playersMap = db.getPlayersMap();

    let matchesCount = 0;
    let inningsCount = 0;
    let runs = 0;
    let ballsFaced = 0;
    let fours = 0;
    let sixes = 0;
    let highestScore = 0;
    let notOuts = 0;
    let ducks = 0;
    let thirties = 0;
    let fifties = 0;
    let hundreds = 0;

    // Bowling
    let legalBallsBowled = 0;
    let runsConceded = 0;
    let wickets = 0;
    let maidens = 0;

    // Fielding
    let catches = 0;
    let stumpings = 0;
    let runOuts = 0;

    matches.forEach((m) => {
      const wasInTeamA = m.teamAPlayerIds.includes(selectedPlayer.id);
      const wasInTeamB = m.teamBPlayerIds.includes(selectedPlayer.id);
      if (!wasInTeamA && !wasInTeamB) return;

      matchesCount++;

      m.innings.forEach((inn) => {
        const sc = replayInnings(inn.ballEvents, m.rules, [], [], playersMap);
        const bStat = sc.batters.find((b) => b.playerId === selectedPlayer.id);
        if (bStat) {
          inningsCount++;
          runs += bStat.runs;
          ballsFaced += bStat.ballsFaced;
          fours += bStat.fours;
          sixes += bStat.sixes;
          if (bStat.runs > highestScore) highestScore = bStat.runs;
          if (!bStat.isOut) notOuts++;
          if (bStat.isOut && bStat.runs === 0) ducks++;
          if (bStat.runs >= 100) hundreds++;
          else if (bStat.runs >= 50) fifties++;
          else if (bStat.runs >= 30) thirties++;
        }

        const bwStat = sc.bowlers.find((bw) => bw.playerId === selectedPlayer.id);
        if (bwStat) {
          legalBallsBowled += bwStat.legalBalls;
          runsConceded += bwStat.runsConceded;
          wickets += bwStat.wickets;
          maidens += bwStat.maidens;
        }

        // Fielding dismissals
        sc.batters.forEach((b) => {
          if (b.isOut && b.fielderIds?.includes(selectedPlayer.id)) {
            if (b.wicketType === "run_out") runOuts++;
            else if (b.wicketType === "stumped") stumpings++;
            else catches++;
          }
        });
      });
    });

    const outs = inningsCount - notOuts;
    const battingAvg = outs > 0 ? Number((runs / outs).toFixed(1)) : runs;
    const strikeRate = ballsFaced > 0 ? Number(((runs / ballsFaced) * 100).toFixed(1)) : 0;
    const oversBowled = (legalBallsBowled / 6).toFixed(1);
    const bowlingEcon =
      legalBallsBowled > 0 ? Number((runsConceded / (legalBallsBowled / 6)).toFixed(2)) : 0;

    return {
      matchesCount,
      inningsCount,
      runs,
      ballsFaced,
      highestScore,
      battingAvg,
      strikeRate,
      fours,
      sixes,
      thirties,
      fifties,
      hundreds,
      notOuts,
      ducks,
      oversBowled,
      runsConceded,
      wickets,
      maidens,
      bowlingEcon,
      catches,
      stumpings,
      runOuts,
    };
  }, [selectedPlayer]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
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
          Roster
        </Text>

        <GullySegmented
          options={[
            { label: "Teams", value: "teams" },
            { label: "Players", value: "players" },
          ]}
          value={activeTab}
          onChange={(v) => setActiveTab(v)}
        />

        {/* RN: web Plus icon dropped (GullyButton children are text-only). */}
        <GullyButton
          size="sm"
          variant="primary"
          onPress={() =>
            activeTab === "teams" ? setShowAddTeamModal(true) : setShowAddPlayerModal(true)
          }
        >
          {activeTab === "teams" ? "Team" : "Player"}
        </GullyButton>
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
          }}
        >
          {activeTab === "teams" && (
            <View style={{ flexDirection: "column", gap: 12 }}>
              {teams
                .filter((t) => !t.isArchived)
                .map((team) => (
                  <Pressable
                    key={team.id}
                    onPress={() => setSelectedTeam(team)}
                    style={({ pressed }) => ({
                      padding: 16,
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
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 8,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: team.color,
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: FONTS.serif,
                            fontWeight: "700",
                            color: "#FFFFFF",
                            fontSize: 14,
                          }}
                        >
                          {team.monogram}
                        </Text>
                      </View>
                      <View>
                        <Text
                          style={{
                            fontSize: 16,
                            fontFamily: FONTS.serif,
                            fontWeight: "600",
                            color: colors.ink,
                          }}
                        >
                          {team.name}
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: colors.ink2,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {team.playerIds.length} players · Captain:{" "}
                          {db.getPlayer(team.captainId || "")?.name || "None"}
                        </Text>
                      </View>
                    </View>

                    <Text
                      style={{
                        fontSize: 12,
                        color: colors.ink2,
                        fontFamily: FONTS.serif,
                      }}
                    >
                      View
                    </Text>
                  </Pressable>
                ))}
            </View>
          )}

          {activeTab === "players" && (
            <View style={{ flexDirection: "column", gap: 12 }}>
              {/* Search Bar */}
              <View style={{ position: "relative", width: "100%" }}>
                <Search
                  size={16}
                  color={colors.ink2}
                  style={{ position: "absolute", left: 12, top: 12 }}
                />
                <TextInput
                  placeholder="Search players or nicknames..."
                  placeholderTextColor={colors.ink2}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  style={{
                    width: "100%",
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.hairline,
                    borderRadius: 10,
                    paddingLeft: 36,
                    paddingRight: 12,
                    paddingVertical: 8,
                    fontSize: 14,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                />
              </View>

              <View
                style={{
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {filteredPlayers.map((player, idx) => (
                  <Pressable
                    key={player.id}
                    onPress={() => setSelectedPlayer(player)}
                    style={({ pressed }) => ({
                      padding: 14,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      backgroundColor: pressed ? colors.surfaceCard : "transparent",
                      borderTopWidth: idx > 0 ? 1 : 0,
                      borderTopColor: colors.hairline,
                    })}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <View
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 16,
                          backgroundColor: colors.bg,
                          borderWidth: 1,
                          borderColor: colors.hairlineStrong,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontFamily: FONTS.serif,
                            fontWeight: "600",
                            color: colors.ink,
                          }}
                        >
                          {player.name.slice(0, 2).toUpperCase()}
                        </Text>
                      </View>
                      <View>
                        <View
                          style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                        >
                          <Text
                            style={{
                              fontSize: 14,
                              fontWeight: "500",
                              color: colors.ink,
                              fontFamily: FONTS.sans,
                            }}
                          >
                            {player.name}
                          </Text>
                          {player.nickname && (
                            <Text
                              style={{
                                fontSize: 12,
                                color: colors.ink2,
                                fontFamily: FONTS.sans,
                              }}
                            >
                              "{player.nickname}"
                            </Text>
                          )}
                        </View>
                        <Text
                          style={{
                            fontSize: 11,
                            color: colors.ink2,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {player.role.replace("_", " ")} · {player.battingHand} hand bat
                        </Text>
                      </View>
                    </View>

                    <Text
                      style={{
                        fontSize: 12,
                        color: colors.ink2,
                        fontFamily: FONTS.sans,
                      }}
                    >
                      Profile
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* --- ADD TEAM SHEET --- */}
      <GullySheet
        isOpen={showAddTeamModal}
        onClose={() => setShowAddTeamModal(false)}
        title="Create Team"
      >
        <View style={{ flexDirection: "column", gap: 16 }}>
          <GullyTextField
            label="Team Name"
            placeholder="e.g. Shivaji Park Warriors"
            value={newTeamName}
            onChangeText={setNewTeamName}
          />

          <GullyTextField
            label="Short Name / Monogram"
            placeholder="e.g. SPW"
            value={newTeamShort}
            onChangeText={setNewTeamShort}
          />

          <View>
            <ControlLabel>Team Color Accent</ControlLabel>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {["#0E1B2E", "#B4232A", "#1F7A43", "#D97706", "#4F46E5", "#0891B2"].map((col) => (
                <Pressable
                  key={col}
                  onPress={() => setNewTeamColor(col)}
                  style={({ pressed }) => ({
                    width: 32,
                    height: 32,
                    borderRadius: 4,
                    borderWidth: 2,
                    backgroundColor: col,
                    borderColor:
                      newTeamColor === col ? colors.ink : "transparent",
                    transform: [{ scale: newTeamColor === col ? 1.1 : 1 }],
                    opacity: pressed ? 0.85 : 1,
                  })}
                />
              ))}
            </View>
          </View>

          <GullyButton
            variant="primary"
            fullWidth
            onPress={handleCreateTeam}
            style={{ marginTop: 8 }}
          >
            Save Team
          </GullyButton>
        </View>
      </GullySheet>

      {/* --- ADD PLAYER SHEET --- */}
      <GullySheet
        isOpen={showAddPlayerModal}
        onClose={() => setShowAddPlayerModal(false)}
        title="Add Player"
      >
        <View style={{ flexDirection: "column", gap: 16 }}>
          <GullyTextField
            label="Full Name"
            placeholder="e.g. Omkar Kardile"
            value={newPlayerName}
            onChangeText={setNewPlayerName}
          />

          <GullyTextField
            label="Nickname (Optional)"
            placeholder="e.g. Omi"
            value={newPlayerNickname}
            onChangeText={setNewPlayerNickname}
          />

          <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <ControlLabel>Role</ControlLabel>
              {/* RN: web <select> → GullyChip row */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                <GullyChip
                  label="Batsman"
                  active={newPlayerRole === "batsman"}
                  onPress={() => setNewPlayerRole("batsman")}
                />
                <GullyChip
                  label="Bowler"
                  active={newPlayerRole === "bowler"}
                  onPress={() => setNewPlayerRole("bowler")}
                />
                <GullyChip
                  label="All-Rounder"
                  active={newPlayerRole === "all_rounder"}
                  onPress={() => setNewPlayerRole("all_rounder")}
                />
                <GullyChip
                  label="Wicket-Keeper"
                  active={newPlayerRole === "wicket_keeper"}
                  onPress={() => setNewPlayerRole("wicket_keeper")}
                />
              </View>
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <ControlLabel>Batting Hand</ControlLabel>
              <GullySegmented
                options={[
                  { label: "Right-hand", value: "right" },
                  { label: "Left-hand", value: "left" },
                ]}
                value={newPlayerBatHand}
                onChange={(v) => setNewPlayerBatHand(v)}
              />
            </View>
          </View>

          <View>
            <ControlLabel>Add to Team (Optional)</ControlLabel>
            {/* RN: web <select> → GullyChip row ("" = free agent). */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <GullyChip
                label="No team yet (Free agent)"
                active={newPlayerTeamId === ""}
                onPress={() => setNewPlayerTeamId("")}
              />
              {teams.map((t) => (
                <GullyChip
                  key={t.id}
                  label={t.name}
                  active={newPlayerTeamId === t.id}
                  onPress={() => setNewPlayerTeamId(t.id)}
                />
              ))}
            </View>
          </View>

          <GullyButton
            variant="primary"
            fullWidth
            onPress={handleCreatePlayer}
            style={{ marginTop: 8 }}
          >
            Save Player
          </GullyButton>
        </View>
      </GullySheet>

      {/* --- DETAILED PLAYER PROFILE MODAL --- */}
      <PlayerProfileModal
        playerId={selectedPlayer?.id || null}
        onClose={() => setSelectedPlayer(null)}
        onPlayerUpdated={refreshData}
      />

      {/* --- TEAM PROFILE DRAWER --- */}
      <GullySheet
        isOpen={!!selectedTeam}
        onClose={() => setSelectedTeam(null)}
        title={selectedTeam?.name || "Team Squad"}
      >
        {selectedTeam && (
          <View style={{ flexDirection: "column", gap: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 8,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: selectedTeam.color,
                }}
              >
                <Text
                  style={{
                    fontFamily: FONTS.serif,
                    fontWeight: "700",
                    color: "#FFFFFF",
                    fontSize: 18,
                  }}
                >
                  {selectedTeam.monogram}
                </Text>
              </View>
              <View>
                <Text
                  style={{
                    fontSize: 18,
                    fontFamily: FONTS.serif,
                    fontWeight: "700",
                    color: colors.ink,
                  }}
                >
                  {selectedTeam.name}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                  }}
                >
                  {selectedTeam.playerIds.length} players registered
                </Text>
              </View>
            </View>

            <View>
              <Text
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: colors.ink2,
                  fontWeight: "600",
                  marginBottom: 8,
                  fontFamily: FONTS.sans,
                }}
              >
                Squad Members
              </Text>
              {/* RN: web max-h-60 overflow-y-auto → fixed-height nested ScrollView. */}
              <ScrollView
                style={{
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 8,
                  maxHeight: 240,
                }}
                nestedScrollEnabled
              >
                {selectedTeam.playerIds.map((pId, idx) => {
                  const p = db.getPlayer(pId);
                  const isCaptain = selectedTeam.captainId === pId;
                  return (
                    <Pressable
                      key={pId}
                      onPress={() => {
                        if (p) setSelectedPlayer(p);
                      }}
                      style={({ pressed }) => ({
                        padding: 10,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        backgroundColor: pressed
                          ? colors.surfaceCard
                          : "transparent",
                        borderTopWidth: idx > 0 ? 1 : 0,
                        borderTopColor: colors.hairline,
                      })}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: "500",
                            color: colors.ink,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {p?.name || "Player"}
                        </Text>
                        {isCaptain && (
                          <Text
                            style={{
                              fontSize: 10,
                              color: colors.accent,
                              fontWeight: "700",
                              fontFamily: FONTS.sans,
                            }}
                          >
                            (C)
                          </Text>
                        )}
                      </View>
                      <Text
                        style={{
                          color: colors.ink2,
                          fontSize: 11,
                          fontFamily: FONTS.sans,
                        }}
                      >
                        {p?.role.replace("_", " ")}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* RN: web Archive icon dropped (GullyButton children are text-only). */}
            <GullyButton
              variant="quiet"
              fullWidth
              onPress={() => {
                db.deleteOrArchiveTeam(selectedTeam.id);
                refreshData();
                setSelectedTeam(null);
              }}
            >
              Archive Team
            </GullyButton>
          </View>
        )}
      </GullySheet>
    </SafeAreaView>
  );
};
