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

import React, { useState, useMemo, useEffect } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Player,
  Team,
  PlayerRole,
  BattingHand,
  BowlingStyle,
} from "../../types/cricket";
import { db } from "../../storage/db";
import { getAccessState, subscribeAccess } from "../../storage/access";
import {
  GullyButton,
  GullySegmented,
  GullyTextField,
  GullySheet,
  GullyChip,
} from "../common/Components";
import { Search } from "lucide-react-native";

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

  // Umpire access (1.4.7): audience devices cannot add/edit/delete.
  const [canEdit, setCanEdit] = useState(getAccessState().mode !== "audience");
  useEffect(
    () => subscribeAccess(() => setCanEdit(getAccessState().mode !== "audience")),
    []
  );

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
  // Create-form failures (expired umpire session, storage error) shown
  // inline in the sheet — never swallowed, never crashing the app.
  const [formError, setFormError] = useState<string | null>(null);
  // Restore/archive failures shown inline in the teams list (same reason).
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const refreshData = () => {
    setTeams(db.getTeams());
    setPlayers(db.getPlayers());
  };

  // Stay live like the other tabs: a cloud-sync pull (or an edit made in the
  // profile modal, which saves through db) used to leave this screen's
  // rosters stale until the tab was re-entered (no db.subscribe here).
  useEffect(() => {
    const unsub = db.subscribe(refreshData);
    return unsub;
  }, []);

  const handleCreateTeam = () => {
    if (!canEdit) return;
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
    // Guarded: an expired umpire session throws inside this onPress —
    // uncaught, that crashed the app instead of showing a message.
    try {
      db.saveTeam(team);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
      return;
    }
    setFormError(null);
    refreshData();
    setShowAddTeamModal(false);
    setNewTeamName("");
    setNewTeamShort("");
  };

  const handleCreatePlayer = () => {
    if (!canEdit) return;
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
    try {
      db.savePlayer(player);
      if (newPlayerTeamId) {
        const t = db.getTeam(newPlayerTeamId);
        if (t) {
          db.saveTeam({ ...t, playerIds: [...t.playerIds, player.id] });
        }
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
      return;
    }
    setFormError(null);
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
          disabled={!canEdit}
          onPress={() =>
            activeTab === "teams" ? setShowAddTeamModal(true) : setShowAddPlayerModal(true)
          }
        >
          {canEdit ? (activeTab === "teams" ? "Team" : "Player") : "Umpire key needed"}
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

              {/* Archived teams: restore entry point (1.4.7-test-3 fix —
                  archiving a team used to be irreversible from the UI;
                  db.unarchiveTeam existed but had no caller). */}
              {teams.some((t) => t.isArchived) && (
                <View style={{ flexDirection: "column", gap: 8, marginTop: 8 }}>
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
                    Archived Teams
                  </Text>
                  {teams
                    .filter((t) => t.isArchived)
                    .map((team) => (
                      <View
                        key={team.id}
                        style={{
                          padding: 12,
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.hairline,
                          borderRadius: 10,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          opacity: 0.85,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                          <View
                            style={{
                              width: 32,
                              height: 32,
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
                                fontSize: 12,
                              }}
                            >
                              {team.monogram}
                            </Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                fontSize: 14,
                                fontFamily: FONTS.serif,
                                fontWeight: "600",
                                color: colors.ink,
                              }}
                              numberOfLines={1}
                            >
                              {team.name}
                            </Text>
                            <Text style={{ fontSize: 11, color: colors.ink2, fontFamily: FONTS.sans }}>
                              {team.playerIds.length} players · archived
                            </Text>
                          </View>
                        </View>
                        <GullyButton
                          size="sm"
                          variant="quiet"
                          disabled={!canEdit}
                          onPress={() => {
                            try {
                              db.unarchiveTeam(team.id);
                              setRestoreError(null);
                            } catch (err) {
                              setRestoreError(
                                err instanceof Error ? err.message : String(err)
                              );
                            }
                            refreshData();
                          }}
                        >
                          Restore
                        </GullyButton>
                      </View>
                    ))}
                  {restoreError ? (
                    <Text
                      style={{
                        fontSize: 12,
                        color: colors.warning,
                        fontFamily: FONTS.sans,
                        lineHeight: 17,
                      }}
                    >
                      {restoreError}
                    </Text>
                  ) : null}
                </View>
              )}
              {/* Archive/restore failures must be visible even when NO
                  archived team exists (review round 2: the message used to
                  render only inside the archived section, so a failed
                  archive vanished with the section it was gating on). */}
              {restoreError && !teams.some((t) => t.isArchived) ? (
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.warning,
                    fontFamily: FONTS.sans,
                    lineHeight: 17,
                  }}
                >
                  {restoreError}
                </Text>
              ) : null}
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
        onClose={() => {
          setShowAddTeamModal(false);
          setFormError(null);
        }}
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
          {formError ? (
            <Text style={{ fontSize: 12, color: colors.warning, fontFamily: FONTS.sans, lineHeight: 17 }}>
              {formError}
            </Text>
          ) : null}
        </View>
      </GullySheet>

      {/* --- ADD PLAYER SHEET --- */}
      <GullySheet
        isOpen={showAddPlayerModal}
        onClose={() => {
          setShowAddPlayerModal(false);
          setFormError(null);
        }}
        title="Add Player"
      >
        <View style={{ flexDirection: "column", gap: 16 }}>
          <GullyTextField
            label="Full Name"
            placeholder="e.g. Arjun Patil"
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
              {/* Archived teams are roster-managed from the Teams list —
                  don't offer them for new player assignments. */}
              {teams
                .filter((t) => !t.isArchived)
                .map((t) => (
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
          {formError ? (
            <Text style={{ fontSize: 12, color: colors.warning, fontFamily: FONTS.sans, lineHeight: 17 }}>
              {formError}
            </Text>
          ) : null}
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
              disabled={!canEdit}
              onPress={() => {
                try {
                  db.deleteOrArchiveTeam(selectedTeam.id);
                  setRestoreError(null);
                } catch (err) {
                  setRestoreError(
                    `Couldn't archive ${selectedTeam.name} — ${
                      err instanceof Error ? err.message : String(err)
                    }`
                  );
                }
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
