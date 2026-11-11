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
  // Multi-team assignment (test-6): a gully player often turns out for more
  // than one team (Sunday club + office league). The old single-select
  // newPlayerTeamId silently kept only the LAST team tapped — every earlier
  // pick vanished, which read from the outside as "add to team doesn't work".
  const [newPlayerTeamIds, setNewPlayerTeamIds] = useState<string[]>([]);

  // Team management sheet (test-6): squad membership, captain and identity
  // editing live in the team's own sheet — opened from every team card
  // ("Manage") and automatically right after creating a team (wizard step 2).
  const [isEditingTeam, setIsEditingTeam] = useState<boolean>(false);
  const [editTeamName, setEditTeamName] = useState<string>("");
  const [editTeamShort, setEditTeamShort] = useState<string>("");
  const [editTeamColor, setEditTeamColor] = useState<string>("#0E1B2E");
  const [teamSheetError, setTeamSheetError] = useState<string | null>(null);
  const [justCreatedTeamId, setJustCreatedTeamId] = useState<string | null>(
    null
  );
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
    // Wizard step 2 (test-6): a bare team with no squad, no captain and no
    // way to customize it just dead-ends after this sheet closes — the user
    // is dumped back on the list with nothing to do next. Open the manage
    // sheet for the fresh team immediately so squad-building is one tap away.
    setJustCreatedTeamId(team.id);
    setSelectedTeam(team);
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
      // Multi-team: every tapped team gets the player (deduped; archived
      // teams are skipped defensively — the chip row only offers active
      // teams, but a cloud-sync pull could have archived one mid-form).
      newPlayerTeamIds.forEach((tid) => {
        const t = db.getTeam(tid);
        if (t && !t.playerIds.includes(player.id)) {
          db.saveTeam({ ...t, playerIds: [...t.playerIds, player.id] });
        }
      });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
      return;
    }
    setFormError(null);
    refreshData();
    setShowAddPlayerModal(false);
    setNewPlayerName("");
    setNewPlayerNickname("");
    setNewPlayerTeamIds([]);
  };

  // --- Team management handlers (test-6) -------------------------------
  // Every mutation is guarded: an expired umpire session throws inside
  // db.saveTeam, and an uncaught throw here would crash the app (same
  // convention as handleCreateTeam above). Errors surface inline in the
  // team sheet instead.
  //
  // All handlers take a teamId and re-read the LIVE record from db instead
  // of trusting the `team` render snapshot: two quick taps on different
  // chips used to run on the same pre-tap squad, and the second save
  // silently clobbered the first member addition.
  const syncSelectedTeam = (teamId: string) => {
    setSelectedTeam(db.getTeam(teamId) ?? null);
    refreshData();
  };

  const handleToggleSquadMember = (teamId: string, playerId: string) => {
    if (!canEdit) return;
    const fresh = db.getTeam(teamId);
    if (!fresh) return;
    try {
      const inSquad = fresh.playerIds.includes(playerId);
      const playerIds = inSquad
        ? fresh.playerIds.filter((id) => id !== playerId)
        : [...fresh.playerIds, playerId];
      // Removing the captain from the squad would leave captainId pointing
      // at a non-member — clear it so the card never shows a ghost captain.
      const captainId =
        inSquad && fresh.captainId === playerId ? undefined : fresh.captainId;
      db.saveTeam({ ...fresh, playerIds, captainId });
      setTeamSheetError(null);
    } catch (e) {
      setTeamSheetError(e instanceof Error ? e.message : String(e));
    }
    syncSelectedTeam(teamId);
  };

  const handleSetCaptain = (teamId: string, playerId: string) => {
    if (!canEdit) return;
    const fresh = db.getTeam(teamId);
    if (!fresh) return;
    try {
      db.saveTeam({ ...fresh, captainId: playerId });
      setTeamSheetError(null);
    } catch (e) {
      setTeamSheetError(e instanceof Error ? e.message : String(e));
    }
    syncSelectedTeam(teamId);
  };

  const startEditTeam = (team: Team) => {
    setEditTeamName(team.name);
    setEditTeamShort(team.shortName);
    setEditTeamColor(team.color);
    setTeamSheetError(null);
    setIsEditingTeam(true);
  };

  const handleSaveTeamDetails = (teamId: string) => {
    if (!canEdit) return;
    if (!editTeamName.trim()) return;
    const fresh = db.getTeam(teamId);
    if (!fresh) return;
    const short =
      editTeamShort.trim() ||
      editTeamName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 3);
    try {
      db.saveTeam({
        ...fresh,
        name: editTeamName.trim(),
        shortName: short,
        monogram: short,
        color: editTeamColor,
      });
      setTeamSheetError(null);
      setIsEditingTeam(false);
    } catch (e) {
      setTeamSheetError(e instanceof Error ? e.message : String(e));
    }
    syncSelectedTeam(teamId);
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

        {/* Naming (test-6): "Team"/"Player" read as labels for the tab
            itself, not as actions. The buttons now say what they do. */}
        <GullyButton
          size="sm"
          variant="primary"
          disabled={!canEdit}
          onPress={() =>
            activeTab === "teams" ? setShowAddTeamModal(true) : setShowAddPlayerModal(true)
          }
        >
          {canEdit
            ? activeTab === "teams"
              ? "New Team"
              : "New Player"
            : "Umpire key needed"}
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
                    {/* Responsive: the name block flexes and truncates so a
                        long team name + captain line can never push the View
                        label off the row (320dp phones). */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
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
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          numberOfLines={1}
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
                          numberOfLines={1}
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
                        flexShrink: 0,
                      }}
                    >
                      Manage
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
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
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
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View
                          style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                        >
                          <Text
                            numberOfLines={1}
                            style={{
                              fontSize: 14,
                              fontWeight: "500",
                              color: colors.ink,
                              fontFamily: FONTS.sans,
                              flexShrink: 1,
                            }}
                          >
                            {player.name}
                          </Text>
                          {player.nickname && (
                            <Text
                              numberOfLines={1}
                              style={{
                                fontSize: 12,
                                color: colors.ink2,
                                fontFamily: FONTS.sans,
                                flexShrink: 0,
                              }}
                            >
                              "{player.nickname}"
                            </Text>
                          )}
                        </View>
                        <Text
                          numberOfLines={1}
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
                        flexShrink: 0,
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
            <ControlLabel>Add to Teams (Optional)</ControlLabel>
            {/* Multi-select (test-6): each team toggles independently — a
                player can join several teams at once. "Free agent" clears
                the selection. Archived teams are never offered. */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              <GullyChip
                label="No team yet (Free agent)"
                active={newPlayerTeamIds.length === 0}
                onPress={() => setNewPlayerTeamIds([])}
              />
              {teams
                .filter((t) => !t.isArchived)
                .map((t) => (
                  <GullyChip
                    key={t.id}
                    label={t.name}
                    colorDot={t.color}
                    active={newPlayerTeamIds.includes(t.id)}
                    onPress={() =>
                      setNewPlayerTeamIds((prev) =>
                        prev.includes(t.id)
                          ? prev.filter((id) => id !== t.id)
                          : [...prev, t.id]
                      )
                    }
                  />
                ))}
            </View>
            {newPlayerTeamIds.length > 1 ? (
              <Text
                style={{
                  fontSize: 11,
                  color: colors.ink2,
                  fontFamily: FONTS.sans,
                  marginTop: 6,
                }}
              >
                Joining {newPlayerTeamIds.length} teams at once.
              </Text>
            ) : null}
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

      {/* --- TEAM MANAGE SHEET (test-6) ------------------------------------
          Squad membership, captain and team identity are edited here —
          reachable from every team card's "Manage" action and opened
          automatically right after creation (wizard step 2). Previously the
          drawer was read-only: no way to add/remove members, pick a captain
          or customize the team after it was created. */}
      <GullySheet
        isOpen={!!selectedTeam}
        onClose={() => {
          setSelectedTeam(null);
          setJustCreatedTeamId(null);
          setIsEditingTeam(false);
          setTeamSheetError(null);
        }}
        title={selectedTeam?.name || "Team Squad"}
      >
        {selectedTeam && (() => {
          const team = selectedTeam;
          const justCreated = justCreatedTeamId === team.id;
          const squad = team.playerIds
            .map((id) => db.getPlayer(id))
            .filter((p): p is Player => !!p && !p.isArchived);
          const availablePlayers = players.filter(
            (p) => !p.isArchived && !team.playerIds.includes(p.id)
          );
          const captainName =
            db.getPlayer(team.captainId || "")?.name || "None";
          return (
            <View style={{ flexDirection: "column", gap: 16 }}>
              {justCreated && (
                <View
                  style={{
                    padding: 12,
                    borderWidth: 1,
                    borderColor: colors.hairlineStrong,
                    borderRadius: 10,
                    backgroundColor: colors.surfaceCard,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: FONTS.sans,
                      color: colors.ink,
                      lineHeight: 18,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 13,
                        fontFamily: FONTS.sans,
                        fontWeight: "700",
                        color: colors.ink,
                      }}
                    >
                      Team created!{" "}
                    </Text>
                    Add players to the squad and pick a captain below.
                  </Text>
                </View>
              )}

              {/* Identity header */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 48,
                    height: 48,
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
                      fontSize: 18,
                    }}
                  >
                    {team.monogram}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 18,
                      fontFamily: FONTS.serif,
                      fontWeight: "700",
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
                    {team.playerIds.length} player
                    {team.playerIds.length === 1 ? "" : "s"} registered ·
                    Captain: {captainName}
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
                  {squad.length === 0 && (
                    <Text
                      style={{
                        padding: 12,
                        fontSize: 12,
                        color: colors.ink2,
                        fontFamily: FONTS.sans,
                        lineHeight: 17,
                      }}
                    >
                      No players yet — add your first players below.
                    </Text>
                  )}
                  {squad.map((p, idx) => {
                    const isCaptain = team.captainId === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => setSelectedPlayer(p)}
                        style={({ pressed }) => ({
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          backgroundColor: pressed
                            ? colors.surfaceCard
                            : "transparent",
                          borderTopWidth: idx > 0 ? 1 : 0,
                          borderTopColor: colors.hairline,
                        })}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <Text
                            numberOfLines={1}
                            style={{
                              fontSize: 12,
                              fontWeight: "500",
                              color: colors.ink,
                              fontFamily: FONTS.sans,
                              flexShrink: 1,
                            }}
                          >
                            {p.name}
                          </Text>
                          {isCaptain && (
                            <Text
                              style={{
                                fontSize: 10,
                                color: colors.accent,
                                fontWeight: "700",
                                fontFamily: FONTS.sans,
                                flexShrink: 0,
                              }}
                            >
                              (C)
                            </Text>
                          )}
                          <Text
                            numberOfLines={1}
                            style={{
                              color: colors.ink2,
                              fontSize: 11,
                              fontFamily: FONTS.sans,
                              flexShrink: 0,
                            }}
                          >
                            {p.role.replace("_", " ")}
                          </Text>
                        </View>
                        {canEdit && (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              flexShrink: 0,
                            }}
                          >
                            {!isCaptain && (
                              <GullyButton
                                size="sm"
                                variant="quiet"
                                onPress={() => handleSetCaptain(team.id, p.id)}
                              >
                                Make Captain
                              </GullyButton>
                            )}
                            <GullyButton
                              size="sm"
                              variant="quiet"
                              onPress={() =>
                                handleToggleSquadMember(team.id, p.id)
                              }
                            >
                              Remove
                            </GullyButton>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Add players to the squad: chips toggle membership directly.
                  Players already on OTHER teams stay available — a gully
                  player can turn out for several teams at once. */}
              {canEdit && (
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
                    Add Players to Squad
                  </Text>
                  {availablePlayers.length === 0 ? (
                    <Text
                      style={{
                        fontSize: 12,
                        color: colors.ink2,
                        fontFamily: FONTS.sans,
                        lineHeight: 17,
                      }}
                    >
                      Every active player is already on this squad — create
                      more from the Players tab.
                    </Text>
                  ) : (
                    <View
                      style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
                    >
                      {availablePlayers.map((p) => (
                        <GullyChip
                          key={p.id}
                          label={p.name}
                          onPress={() =>
                            handleToggleSquadMember(team.id, p.id)
                          }
                        />
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* Team identity editing */}
              {canEdit &&
                (isEditingTeam ? (
                  <View style={{ flexDirection: "column", gap: 16 }}>
                    <GullyTextField
                      label="Team Name"
                      placeholder="e.g. Shivaji Park Warriors"
                      value={editTeamName}
                      onChangeText={setEditTeamName}
                    />
                    <GullyTextField
                      label="Short Name / Monogram"
                      placeholder="e.g. SPW"
                      value={editTeamShort}
                      onChangeText={setEditTeamShort}
                    />
                    <View>
                      <ControlLabel>Team Color Accent</ControlLabel>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        {[
                          "#0E1B2E",
                          "#B4232A",
                          "#1F7A43",
                          "#D97706",
                          "#4F46E5",
                          "#0891B2",
                        ].map((col) => (
                          <Pressable
                            key={col}
                            onPress={() => setEditTeamColor(col)}
                            style={({ pressed }) => ({
                              width: 32,
                              height: 32,
                              borderRadius: 4,
                              borderWidth: 2,
                              backgroundColor: col,
                              borderColor:
                                editTeamColor === col
                                  ? colors.ink
                                  : "transparent",
                              transform: [
                                { scale: editTeamColor === col ? 1.1 : 1 },
                              ],
                              opacity: pressed ? 0.85 : 1,
                            })}
                          />
                        ))}
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <GullyButton
                        variant="primary"
                        fullWidth
                        onPress={() => handleSaveTeamDetails(team.id)}
                      >
                        Save Team Changes
                      </GullyButton>
                      <GullyButton
                        variant="quiet"
                        onPress={() => setIsEditingTeam(false)}
                      >
                        Cancel
                      </GullyButton>
                    </View>
                  </View>
                ) : (
                  <GullyButton
                    variant="quiet"
                    fullWidth
                    onPress={() => startEditTeam(team)}
                  >
                    Edit Team Details
                  </GullyButton>
                ))}

              {teamSheetError ? (
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.warning,
                    fontFamily: FONTS.sans,
                    lineHeight: 17,
                  }}
                >
                  {teamSheetError}
                </Text>
              ) : null}

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
          );
        })()}
      </GullySheet>
    </SafeAreaView>
  );
};
