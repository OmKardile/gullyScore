/**
 * GullyScore Detailed Player Profile Modal
 *
 * Aggregates historical performance stats across all matches stored in the local database.
 * Provides deep batting, bowling, fielding, game logs, and statistical trajectory.
 */

import React, { useState, useMemo } from "react";
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TextStyle,
  View,
} from "react-native";
import { Player, Team } from "../../types/cricket";
import { db } from "../../storage/db";
import {
  calculatePlayerDetailedStats,
  DetailedPlayerProfileStats,
} from "../../engine/playerStatsEngine";
import {
  GullyButton,
  GullySegmented,
  GullySheet,
  GullyChip,
} from "../common/Components";
import { useTheme, FONTS } from "../../design/theme";
import {
  Award,
  TrendingUp,
  Shield,
  Activity,
  Calendar,
  Sparkles,
  Archive,
  Pen, // RN: lucide-react-native 1.68 renamed Edit2 → Pen (same glyph)
  Check,
  ChevronRight,
  Target,
  Flame,
  Zap,
} from "lucide-react-native";

interface PlayerProfileModalProps {
  playerId: string | null;
  onClose: () => void;
  onPlayerUpdated?: () => void;
  onOpenMatchDetail?: (matchId: string) => void;
}

// RN: local cell for the repeated grid stat boxes (web grid-cols-N → flex row of cells).
// Covers the web variants: surface/surfaceCard bg, 10/12/14/16px serif values,
// uppercase-semibold vs plain labels.
const StatCell: React.FC<{
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  valueSize?: number;
  pad?: number;
  radius?: number;
  surface?: boolean;
  upperLabel?: boolean;
}> = ({
  label,
  value,
  valueColor,
  valueSize = 16,
  pad = 6,
  radius = 8,
  surface = false,
  upperLabel = true,
}) => {
  const { colors } = useTheme();
  const isTextValue = typeof value === "string" || typeof value === "number";
  return (
    <View
      style={{
        flex: 1,
        padding: pad,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: surface ? colors.surface : colors.surfaceCard,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          fontSize: 10,
          fontFamily: FONTS.sans,
          color: colors.ink2,
          fontWeight: upperLabel ? "600" : "400",
          textTransform: upperLabel ? "uppercase" : "none",
        }}
      >
        {label}
      </Text>
      {isTextValue ? (
        <Text
          style={{
            fontSize: valueSize,
            fontFamily: FONTS.serif,
            fontWeight: "700",
            color: valueColor || colors.ink,
            fontVariant: ["tabular-nums"],
          }}
        >
          {value}
        </Text>
      ) : (
        value
      )}
    </View>
  );
};

// RN: lucide icons cannot nest inside GullyButton's <Text>, so icon-bearing
// buttons are drawn as Pressables with identical GullyButton metrics.
const ProfileIconButton: React.FC<{
  label: string;
  icon: React.ReactNode;
  variant?: "primary" | "quiet";
  size?: "sm" | "md";
  fullWidth?: boolean;
  onPress?: () => void;
}> = ({ label, icon, variant = "quiet", size = "md", fullWidth, onPress }) => {
  const { colors } = useTheme();
  const sizeStyles =
    size === "sm"
      ? { height: 36, paddingHorizontal: 12, borderRadius: 10, gap: 4 }
      : { height: 48, paddingHorizontal: 20, borderRadius: 10, gap: 6 };
  const variantStyles =
    variant === "primary"
      ? { backgroundColor: colors.ink }
      : {
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.hairlineStrong,
        };
  const contentColor = variant === "primary" ? colors.bg : colors.ink;
  const fontSize = size === "sm" ? 12 : 14;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.9 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        sizeStyles,
        variantStyles,
        fullWidth ? { alignSelf: "stretch" } : null,
      ]}
    >
      {icon}
      <Text
        style={{
          color: contentColor,
          fontSize,
          fontFamily: FONTS.sans,
          fontWeight: "500",
          letterSpacing: -0.2,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

export const PlayerProfileModal: React.FC<PlayerProfileModalProps> = ({
  playerId,
  onClose,
  onPlayerUpdated,
  onOpenMatchDetail,
}) => {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<
    "overview" | "batting" | "bowling" | "matches" | "milestones"
  >("overview");
  const [isEditing, setIsEditing] = useState<boolean>(false);

  // Edit form state
  const [editName, setEditName] = useState<string>("");
  const [editNickname, setEditNickname] = useState<string>("");
  const [editRole, setEditRole] = useState<any>("all_rounder");
  const [editBatHand, setEditBatHand] = useState<any>("right");
  const [editBowlStyle, setEditBowlStyle] = useState<any>("rm");
  const [editTeamId, setEditTeamId] = useState<string>("");

  const allMatches = db.getMatches();
  const allTeams = db.getTeams();
  const playersMap = db.getPlayersMap();

  const stats: DetailedPlayerProfileStats | null = useMemo(() => {
    if (!playerId) return null;
    return calculatePlayerDetailedStats(playerId, allMatches, playersMap);
  }, [playerId, allMatches, playersMap]);

  if (!playerId || !stats) {
    return null;
  }

  const { player, teams } = stats;

  const startEditing = () => {
    setEditName(player.name);
    setEditNickname(player.nickname || "");
    setEditRole(player.role);
    setEditBatHand(player.battingHand);
    setEditBowlStyle(player.bowlingStyle);
    setEditTeamId(teams[0]?.id || "");
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (!editName.trim()) return;
    const updated: Player = {
      ...player,
      name: editName.trim(),
      nickname: editNickname.trim() || undefined,
      role: editRole,
      battingHand: editBatHand,
      bowlingStyle: editBowlStyle,
    };
    db.savePlayer(updated);

    // Update team roster association if changed
    if (editTeamId) {
      allTeams.forEach((t) => {
        const has = t.playerIds.includes(player.id);
        if (t.id === editTeamId && !has) {
          t.playerIds.push(player.id);
          db.saveTeam(t);
        } else if (t.id !== editTeamId && has) {
          t.playerIds = t.playerIds.filter((id) => id !== player.id);
          db.saveTeam(t);
        }
      });
    }

    setIsEditing(false);
    onPlayerUpdated?.();
  };

  const roleLabelMap: Record<string, string> = {
    pure_batter: "Batter",
    all_rounder: "All-Rounder",
    strike_bowler: "Bowler",
    wicket_keeper: "Wicketkeeper",
  };

  const bowlStyleLabelMap: Record<string, string> = {
    rf: "Right-arm Fast",
    rm: "Right-arm Medium",
    rs: "Right-arm Spin",
    lf: "Left-arm Fast",
    lm: "Left-arm Medium",
    ls: "Left-arm Spin",
  };

  // Shared text styles (web cascaded font-sans / ink from the sheet container; RN sets per-Text)
  const labelUpper10: TextStyle = {
    fontSize: 10,
    fontFamily: FONTS.sans,
    color: colors.ink2,
    fontWeight: "600",
    textTransform: "uppercase",
  };
  const labelUpper12: TextStyle = {
    fontSize: 12,
    fontFamily: FONTS.sans,
    color: colors.ink2,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  };
  const tnumSans: TextStyle = {
    fontSize: 12,
    fontFamily: FONTS.sans,
    color: colors.ink,
    fontVariant: ["tabular-nums"],
  };

  return (
    // RN: web passed maxHeight="max-h-[94vh]"; ported GullySheet has a fixed 85% cap.
    <GullySheet isOpen={!!playerId} onClose={onClose} title={player.name}>
      <View style={{ flexDirection: "column", gap: 16 }}>
        {/* --- HERO PROFILE HEADER --- */}
        <View
          style={{
            padding: 16,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: 12,
            flexDirection: "column",
            gap: 12,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                flex: 1,
                paddingRight: 8,
              }}
            >
              {/* Monogram Avatar with Team Color Ring */}
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 28,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: teams[0]?.color || colors.accent,
                  borderWidth: 2,
                  borderColor: colors.hairline,
                  shadowColor: "#000",
                  shadowOpacity: 0.1,
                  shadowRadius: 2,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: FONTS.serif,
                    fontWeight: "700",
                    color: "#FFFFFF",
                    fontSize: 20,
                  }}
                >
                  {player.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2)}
                </Text>
              </View>

              <View style={{ flex: 1 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    flexWrap: "wrap",
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
                    {player.name}
                  </Text>
                  {player.nickname && (
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: FONTS.serif,
                        fontStyle: "italic",
                        color: colors.ink2,
                      }}
                    >
                      {`"${player.nickname}"`}
                    </Text>
                  )}
                  {player.isArchived && (
                    <Text
                      style={{
                        fontSize: 10,
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 4,
                        backgroundColor: colors.surfaceCard,
                        color: colors.ink2,
                        borderWidth: 1,
                        borderColor: colors.hairline,
                        overflow: "hidden",
                      }}
                    >
                      Archived
                    </Text>
                  )}
                </View>

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 2,
                    flexWrap: "wrap",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: FONTS.sans,
                      fontWeight: "600",
                      color: colors.accent,
                    }}
                  >
                    {roleLabelMap[player.role] || "All-Rounder"}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: FONTS.sans,
                      color: colors.ink2,
                    }}
                  >
                    •
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: FONTS.sans,
                      color: colors.ink2,
                    }}
                  >
                    {player.battingHand === "left" ? "Left-hand" : "Right-hand"}{" "}
                    bat
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: FONTS.sans,
                      color: colors.ink2,
                    }}
                  >
                    •
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: FONTS.sans,
                      color: colors.ink2,
                    }}
                  >
                    {bowlStyleLabelMap[player.bowlingStyle] ||
                      player.bowlingStyle}
                  </Text>
                </View>

                {teams.length > 0 && (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      marginTop: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        fontFamily: FONTS.sans,
                        color: colors.ink2,
                      }}
                    >
                      Team:
                    </Text>
                    {teams.map((t) => (
                      <View
                        key={t.id}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 4,
                          borderWidth: 1,
                          backgroundColor: `${t.color}15`,
                          borderColor: `${t.color}40`,
                        }}
                      >
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: t.color,
                          }}
                        />
                        <Text
                          style={{
                            fontSize: 11,
                            fontFamily: FONTS.sans,
                            fontWeight: "500",
                            color: t.color,
                          }}
                        >
                          {t.name}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <Pressable
              onPress={startEditing}
              accessibilityLabel="Edit Player Info"
              style={({ pressed }) => [
                {
                  padding: 6,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: pressed ? colors.ink : colors.hairline,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Pen size={14} color={colors.ink2} />
            </Pressable>
          </View>

          {/* Quick Career Impact Ribbon */}
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: colors.hairline,
            }}
          >
            <StatCell label="Matches" value={stats.matchesCount} />
            <StatCell label="Runs" value={stats.runs} />
            <StatCell label="Wickets" value={stats.wickets} />
            <StatCell
              label="POTM"
              value={
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                  }}
                >
                  <Award size={14} color={colors.accent} />
                  <Text
                    style={{
                      fontSize: 16,
                      fontFamily: FONTS.serif,
                      fontWeight: "700",
                      color: colors.accent,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {stats.potmCount}
                  </Text>
                </View>
              }
            />
          </View>
        </View>

        {/* --- EDIT PLAYER DRAWER SHEET (INLINE) --- */}
        {isEditing && (
          <View
            style={{
              padding: 16,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.accent,
              borderRadius: 10,
              flexDirection: "column",
              gap: 12,
            }}
          >
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
                  fontFamily: FONTS.sans,
                  fontWeight: "600",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  color: colors.accent,
                }}
              >
                Edit Player Details
              </Text>
              <Pressable onPress={() => setIsEditing(false)}>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                  }}
                >
                  Cancel
                </Text>
              </Pressable>
            </View>

            {/* RN: web used grid-cols-2 inputs + grid-cols-3 selects;
                chip pickers stacked for phone width */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: FONTS.sans,
                    fontWeight: "500",
                    color: colors.ink2,
                    marginBottom: 4,
                  }}
                >
                  Player Name
                </Text>
                <TextInput
                  value={editName}
                  onChangeText={setEditName}
                  style={{
                    width: "100%",
                    backgroundColor: colors.surfaceCard,
                    borderWidth: 1,
                    borderColor: colors.hairlineStrong,
                    borderRadius: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                    color: colors.ink,
                  }}
                />
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: FONTS.sans,
                    fontWeight: "500",
                    color: colors.ink2,
                    marginBottom: 4,
                  }}
                >
                  Nickname
                </Text>
                <TextInput
                  value={editNickname}
                  onChangeText={setEditNickname}
                  placeholder="Optional"
                  placeholderTextColor={colors.ink2}
                  style={{
                    width: "100%",
                    backgroundColor: colors.surfaceCard,
                    borderWidth: 1,
                    borderColor: colors.hairlineStrong,
                    borderRadius: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                    color: colors.ink,
                  }}
                />
              </View>
            </View>

            <View>
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: FONTS.sans,
                  fontWeight: "500",
                  color: colors.ink2,
                  marginBottom: 4,
                }}
              >
                Role
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 4,
                }}
              >
                <GullyChip
                  label="All-Rounder"
                  active={editRole === "all_rounder"}
                  onPress={() => setEditRole("all_rounder")}
                />
                <GullyChip
                  label="Batter"
                  active={editRole === "pure_batter"}
                  onPress={() => setEditRole("pure_batter")}
                />
                <GullyChip
                  label="Bowler"
                  active={editRole === "strike_bowler"}
                  onPress={() => setEditRole("strike_bowler")}
                />
                <GullyChip
                  label="Keeper"
                  active={editRole === "wicket_keeper"}
                  onPress={() => setEditRole("wicket_keeper")}
                />
              </View>
            </View>

            <View>
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: FONTS.sans,
                  fontWeight: "500",
                  color: colors.ink2,
                  marginBottom: 4,
                }}
              >
                Bat Hand
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 4,
                }}
              >
                <GullyChip
                  label="Right Hand"
                  active={editBatHand === "right"}
                  onPress={() => setEditBatHand("right")}
                />
                <GullyChip
                  label="Left Hand"
                  active={editBatHand === "left"}
                  onPress={() => setEditBatHand("left")}
                />
              </View>
            </View>

            <View>
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: FONTS.sans,
                  fontWeight: "500",
                  color: colors.ink2,
                  marginBottom: 4,
                }}
              >
                Bowling Style
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 4,
                }}
              >
                <GullyChip
                  label="Right Fast"
                  active={editBowlStyle === "rf"}
                  onPress={() => setEditBowlStyle("rf")}
                />
                <GullyChip
                  label="Right Med"
                  active={editBowlStyle === "rm"}
                  onPress={() => setEditBowlStyle("rm")}
                />
                <GullyChip
                  label="Right Spin"
                  active={editBowlStyle === "rs"}
                  onPress={() => setEditBowlStyle("rs")}
                />
                <GullyChip
                  label="Left Fast"
                  active={editBowlStyle === "lf"}
                  onPress={() => setEditBowlStyle("lf")}
                />
                <GullyChip
                  label="Left Med"
                  active={editBowlStyle === "lm"}
                  onPress={() => setEditBowlStyle("lm")}
                />
                <GullyChip
                  label="Left Spin"
                  active={editBowlStyle === "ls"}
                  onPress={() => setEditBowlStyle("ls")}
                />
              </View>
            </View>

            <View>
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: FONTS.sans,
                  fontWeight: "500",
                  color: colors.ink2,
                  marginBottom: 4,
                }}
              >
                Assign to Team
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 4,
                }}
              >
                <GullyChip
                  label="No primary team"
                  active={editTeamId === ""}
                  onPress={() => setEditTeamId("")}
                />
                {allTeams.map((t) => (
                  <GullyChip
                    key={t.id}
                    label={`${t.name} (${t.shortName})`}
                    active={editTeamId === t.id}
                    onPress={() => setEditTeamId(t.id)}
                  />
                ))}
              </View>
            </View>

            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                gap: 8,
                paddingTop: 4,
              }}
            >
              <GullyButton
                size="sm"
                variant="quiet"
                onPress={() => setIsEditing(false)}
              >
                Cancel
              </GullyButton>
              <ProfileIconButton
                label="Save Changes"
                icon={<Check size={14} color={colors.bg} />}
                variant="primary"
                size="sm"
                onPress={handleSaveEdit}
              />
            </View>
          </View>
        )}

        {/* --- SUB-NAVIGATION TABS --- */}
        {/* RN: horizontal scroll — 5 tabs overflow phone width */}
        <View
          style={{
            alignItems: "center",
            borderBottomWidth: 1,
            borderBottomColor: colors.hairline,
            paddingBottom: 8,
          }}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <GullySegmented
              options={[
                { label: "Overview", value: "overview" },
                { label: "Batting", value: "batting" },
                { label: "Bowling", value: "bowling" },
                { label: "Matches", value: "matches" },
                { label: "Milestones", value: "milestones" },
              ]}
              value={activeTab}
              onChange={(v) => setActiveTab(v as any)}
            />
          </ScrollView>
        </View>

        {/* --- TAB 1: OVERVIEW --- */}
        {activeTab === "overview" && (
          <View style={{ flexDirection: "column", gap: 12 }}>
            {/* MVP Standing & Win Rate */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View
                style={{
                  flex: 1,
                  padding: 12,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 10,
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Zap size={12} color={colors.accent} />
                  <Text style={labelUpper10}>Gully MVP Points</Text>
                </View>
                <View
                  style={{
                    marginTop: 8,
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: 6,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 24,
                      fontFamily: FONTS.serif,
                      fontWeight: "700",
                      fontVariant: ["tabular-nums"],
                      color: colors.ink,
                    }}
                  >
                    {stats.totalMvpPoints}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink2,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    pts
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    marginTop: 4,
                    borderTopWidth: 1,
                    borderTopColor: colors.hairline,
                    paddingTop: 4,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      color: colors.ink2,
                      fontVariant: ["tabular-nums"],
                      fontFamily: FONTS.sans,
                    }}
                  >
                    Bat: {stats.battingMvpPoints}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      color: colors.ink2,
                      fontVariant: ["tabular-nums"],
                      fontFamily: FONTS.sans,
                    }}
                  >
                    Bowl: {stats.bowlingMvpPoints}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      color: colors.ink2,
                      fontVariant: ["tabular-nums"],
                      fontFamily: FONTS.sans,
                    }}
                  >
                    Field: {stats.fieldingMvpPoints}
                  </Text>
                </View>
              </View>

              <View
                style={{
                  flex: 1,
                  padding: 12,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 10,
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Target size={12} color={colors.accent} />
                  <Text style={labelUpper10}>Team Win Impact</Text>
                </View>
                <View
                  style={{
                    marginTop: 8,
                    flexDirection: "row",
                    alignItems: "baseline",
                    gap: 6,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 24,
                      fontFamily: FONTS.serif,
                      fontWeight: "700",
                      fontVariant: ["tabular-nums"],
                      color: colors.ink,
                    }}
                  >
                    {stats.winPercentage}%
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink2,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    wins
                  </Text>
                </View>
                <Text
                  style={{
                    fontSize: 11,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                    marginTop: 4,
                    borderTopWidth: 1,
                    borderTopColor: colors.hairline,
                    paddingTop: 4,
                  }}
                >
                  {stats.matchesWon} won out of {stats.matchesCount} matches
                  played
                </Text>
              </View>
            </View>

            {/* Career Highlights Card */}
            <View
              style={{
                padding: 14,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                flexDirection: "column",
                gap: 10,
              }}
            >
              <Text style={labelUpper12}>Career Records at a Glance</Text>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <StatCell
                  label="Highest Score"
                  value={`${stats.highestScore}${
                    stats.highestScoreNotOut ? "*" : ""
                  }`}
                  pad={8}
                  radius={8}
                  upperLabel={false}
                />
                <StatCell
                  label="Best Bowling"
                  value={
                    stats.bestBowling.wickets > 0
                      ? `${stats.bestBowling.wickets}/${stats.bestBowling.runs}`
                      : "—"
                  }
                  pad={8}
                  radius={8}
                  upperLabel={false}
                />
                <StatCell
                  label="Strike Rate"
                  value={stats.battingStrikeRate}
                  pad={8}
                  radius={8}
                  upperLabel={false}
                />
              </View>

              {/* Milestone badges */}
              <View
                style={{
                  flexDirection: "row",
                  gap: 6,
                  flexWrap: "wrap",
                  paddingTop: 4,
                }}
              >
                {stats.hundreds > 0 && (
                  <GullyChip label={`${stats.hundreds}x 100s`} active />
                )}
                {stats.fifties > 0 && (
                  <GullyChip label={`${stats.fifties}x 50s`} active />
                )}
                {stats.thirties > 0 && (
                  <GullyChip label={`${stats.thirties}x 30s`} />
                )}
                {stats.fiveWickets > 0 && (
                  <GullyChip label={`${stats.fiveWickets}x 5-Wkt Hauls`} active />
                )}
                {stats.threeWickets > 0 && (
                  <GullyChip label={`${stats.threeWickets}x 3-Wkt Hauls`} />
                )}
                {stats.ducks > 0 && <GullyChip label={`${stats.ducks} Ducks`} />}
              </View>
            </View>

            {/* Recent Match Snippet */}
            {stats.matchLogs.length > 0 && (
              <View
                style={{
                  padding: 14,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 10,
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={labelUpper12}>Latest Match Performance</Text>
                  <Pressable
                    onPress={() => setActiveTab("matches")}
                    style={({ pressed }) => [
                      {
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 2,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        color: colors.accent,
                        fontWeight: "500",
                        fontFamily: FONTS.sans,
                      }}
                    >
                      View All {stats.matchLogs.length}
                    </Text>
                    <ChevronRight size={12} color={colors.accent} />
                  </Pressable>
                </View>

                {(() => {
                  const m = stats.matchLogs[0];
                  return (
                    <Pressable
                      onPress={() => onOpenMatchDetail?.(m.matchId)}
                      style={({ pressed }) => [
                        {
                          padding: 10,
                          backgroundColor: colors.surfaceCard,
                          borderWidth: 1,
                          borderColor: pressed
                            ? colors.hairlineStrong
                            : colors.hairline,
                          borderRadius: 8,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          opacity: pressed ? 0.85 : 1,
                        },
                      ]}
                    >
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontFamily: FONTS.serif,
                              fontWeight: "700",
                              color: colors.ink,
                            }}
                          >
                            vs {m.opponentName}
                          </Text>
                          <View
                            style={{
                              backgroundColor:
                                m.result === "win"
                                  ? colors.success
                                  : m.result === "loss"
                                  ? colors.ink2
                                  : colors.surface,
                              paddingHorizontal: 6,
                              paddingVertical: 1,
                              borderRadius: 4,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 10,
                                fontWeight: "600",
                                textTransform: "uppercase",
                                color:
                                  m.result === "win" || m.result === "loss"
                                    ? "#FFFFFF"
                                    : colors.ink,
                                fontFamily: FONTS.sans,
                              }}
                            >
                              {m.result.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <Text
                          style={{
                            fontSize: 11,
                            color: colors.ink2,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {m.matchDate} · {m.venue}
                        </Text>
                      </View>

                      <View style={{ alignItems: "flex-end" }}>
                        {m.batting && (
                          <Text
                            style={{
                              fontWeight: "700",
                              color: colors.ink,
                              fontSize: 12,
                              fontVariant: ["tabular-nums"],
                              fontFamily: FONTS.sans,
                            }}
                          >
                            {m.batting.runs} runs ({m.batting.balls}b)
                          </Text>
                        )}
                        {m.bowling && (
                          <Text
                            style={{
                              fontSize: 11,
                              color: colors.ink2,
                              fontVariant: ["tabular-nums"],
                              fontFamily: FONTS.sans,
                            }}
                          >
                            {m.bowling.wickets}/{m.bowling.runs} (
                            {m.bowling.oversFormatted} ov)
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  );
                })()}
              </View>
            )}
          </View>
        )}

        {/* --- TAB 2: BATTING DEEP DIVE --- */}
        {activeTab === "batting" && (
          <View style={{ flexDirection: "column", gap: 12 }}>
            {/* Primary Batting Numbers */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <StatCell
                label="Innings"
                value={stats.battingInnings}
                surface
                pad={10}
              />
              <StatCell label="Runs" value={stats.runs} surface pad={10} />
              <StatCell
                label="Average"
                value={stats.battingAverage}
                surface
                pad={10}
              />
              <StatCell
                label="Strike Rate"
                value={stats.battingStrikeRate}
                valueColor={colors.accent}
                surface
                pad={10}
              />
            </View>

            {/* Boundary Breakdown */}
            <View
              style={{
                padding: 14,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                flexDirection: "column",
                gap: 10,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <Text style={labelUpper12}>Boundary & Power Metrics</Text>
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.serif,
                    fontWeight: "700",
                    color: colors.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {stats.boundaryRunsPct}% in Boundaries
                </Text>
              </View>

              {/* Boundary Progress Bar */}
              <View
                style={{
                  width: "100%",
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colors.surfaceCard,
                  overflow: "hidden",
                  flexDirection: "row",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    backgroundColor: colors.accent,
                    width: `${Math.min(100, stats.boundaryRunsPct)}%`,
                  }}
                />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  gap: 8,
                  paddingTop: 4,
                }}
              >
                <StatCell
                  label="Fours (4s)"
                  value={stats.fours}
                  pad={6}
                  radius={6}
                  valueSize={12}
                  upperLabel={false}
                />
                <StatCell
                  label="Sixes (6s)"
                  value={stats.sixes}
                  valueColor={colors.accent}
                  pad={6}
                  radius={6}
                  valueSize={12}
                  upperLabel={false}
                />
                <StatCell
                  label="Balls/Bdry"
                  value={
                    stats.ballsPerBoundary > 0 ? stats.ballsPerBoundary : "—"
                  }
                  pad={6}
                  radius={6}
                  valueSize={12}
                  upperLabel={false}
                />
                <StatCell
                  label="Not Outs"
                  value={stats.notOuts}
                  pad={6}
                  radius={6}
                  valueSize={12}
                  upperLabel={false}
                />
              </View>
            </View>

            {/* Recent Batting Form Log */}
            <View
              style={{
                padding: 14,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                flexDirection: "column",
                gap: 8,
              }}
            >
              <Text style={labelUpper12}>Recent Batting Innings</Text>

              {stats.recentInnings.length === 0 ? (
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                  }}
                >
                  No batting innings recorded yet.
                </Text>
              ) : (
                <View style={{ flexDirection: "column" }}>
                  {stats.recentInnings.slice(0, 5).map((inn, i) => (
                    <View
                      key={i}
                      style={{
                        paddingVertical: 8,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        ...(i > 0
                          ? {
                              borderTopWidth: 1,
                              borderTopColor: colors.hairline,
                            }
                          : null),
                      }}
                    >
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text
                          style={{
                            fontFamily: FONTS.serif,
                            fontWeight: "700",
                            fontSize: 14,
                            color: colors.ink,
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {inn.runs}
                          {!inn.isOut ? "*" : ""}{" "}
                          <Text
                            style={{
                              fontSize: 11,
                              fontFamily: FONTS.sans,
                              fontWeight: "400",
                              color: colors.ink2,
                            }}
                          >
                            ({inn.ballsFaced} balls, {inn.fours}x4,{" "}
                            {inn.sixes}x6)
                          </Text>
                        </Text>
                        <Text
                          style={{
                            fontSize: 10,
                            color: colors.ink2,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          vs {inn.opponentName} · {inn.matchDate}
                        </Text>
                      </View>

                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={tnumSans}>SR {inn.strikeRate}</Text>
                        {inn.dismissalText && (
                          <Text
                            numberOfLines={1}
                            style={{
                              fontSize: 10,
                              color: colors.ink2,
                              maxWidth: 140,
                              fontFamily: FONTS.sans,
                            }}
                          >
                            {inn.dismissalText}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {/* --- TAB 3: BOWLING DEEP DIVE --- */}
        {activeTab === "bowling" && (
          <View style={{ flexDirection: "column", gap: 12 }}>
            {/* Primary Bowling Numbers */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <StatCell
                label="Overs"
                value={stats.oversBowledFormatted}
                surface
                pad={10}
              />
              <StatCell
                label="Wickets"
                value={stats.wickets}
                valueColor={colors.accent}
                surface
                pad={10}
              />
              <StatCell
                label="Economy"
                value={stats.bowlingEconomy}
                surface
                pad={10}
              />
              <StatCell
                label="Average"
                value={stats.bowlingAverage > 0 ? stats.bowlingAverage : "—"}
                surface
                pad={10}
              />
            </View>

            {/* Bowling Spell Discipline */}
            <View
              style={{
                padding: 14,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                flexDirection: "column",
                gap: 10,
              }}
            >
              <Text style={labelUpper12}>Control & Discipline</Text>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <StatCell
                  label="Maidens"
                  value={stats.maidens}
                  pad={8}
                  radius={6}
                  valueSize={12}
                  upperLabel={false}
                />
                <StatCell
                  label="Dot Balls"
                  value={`${stats.dotBalls} (${stats.dotBallPct}%)`}
                  pad={8}
                  radius={6}
                  valueSize={12}
                  upperLabel={false}
                />
                <StatCell
                  label="Wides"
                  value={stats.widesConceded}
                  pad={8}
                  radius={6}
                  valueSize={12}
                  upperLabel={false}
                />
                <StatCell
                  label="No Balls"
                  value={stats.noBallsConceded}
                  pad={8}
                  radius={6}
                  valueSize={12}
                  upperLabel={false}
                />
              </View>
            </View>

            {/* Recent Bowling Spells */}
            <View
              style={{
                padding: 14,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                flexDirection: "column",
                gap: 8,
              }}
            >
              <Text style={labelUpper12}>Recent Bowling Spells</Text>

              {stats.recentSpells.length === 0 ? (
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontFamily: FONTS.sans,
                  }}
                >
                  No bowling spells recorded yet.
                </Text>
              ) : (
                <View style={{ flexDirection: "column" }}>
                  {stats.recentSpells.slice(0, 5).map((sp, i) => (
                    <View
                      key={i}
                      style={{
                        paddingVertical: 8,
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        ...(i > 0
                          ? {
                              borderTopWidth: 1,
                              borderTopColor: colors.hairline,
                            }
                          : null),
                      }}
                    >
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text
                          style={{
                            fontFamily: FONTS.serif,
                            fontWeight: "700",
                            fontSize: 14,
                            color: colors.ink,
                            fontVariant: ["tabular-nums"],
                          }}
                        >
                          {sp.wickets}/{sp.runsConceded}{" "}
                          <Text
                            style={{
                              fontSize: 11,
                              fontFamily: FONTS.sans,
                              fontWeight: "400",
                              color: colors.ink2,
                            }}
                          >
                            ({sp.oversFormatted} overs, {sp.maidens}m)
                          </Text>
                        </Text>
                        <Text
                          style={{
                            fontSize: 10,
                            color: colors.ink2,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          vs {sp.opponentName} · {sp.matchDate}
                        </Text>
                      </View>

                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={tnumSans}>Econ {sp.economy}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {/* --- TAB 4: CHRONOLOGICAL MATCH LOGS --- */}
        {activeTab === "matches" && (
          <View style={{ flexDirection: "column", gap: 10 }}>
            <Text style={[labelUpper12, { paddingHorizontal: 4 }]}>
              Complete Match History ({stats.matchLogs.length})
            </Text>

            {stats.matchLogs.length === 0 ? (
              <View
                style={{
                  padding: 24,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 10,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    textAlign: "center",
                    fontFamily: FONTS.sans,
                  }}
                >
                  No match appearances recorded yet.
                </Text>
              </View>
            ) : (
              <View style={{ flexDirection: "column", gap: 8 }}>
                {stats.matchLogs.map((m) => (
                  <Pressable
                    key={m.matchId}
                    onPress={() => onOpenMatchDetail?.(m.matchId)}
                    style={({ pressed }) => [
                      {
                        padding: 12,
                        backgroundColor: colors.surface,
                        borderWidth: 1,
                        borderColor: pressed
                          ? colors.hairlineStrong
                          : colors.hairline,
                        borderRadius: 10,
                        flexDirection: "column",
                        gap: 8,
                        opacity: pressed ? 0.9 : 1,
                      },
                    ]}
                  >
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
                          gap: 8,
                          flex: 1,
                          paddingRight: 8,
                        }}
                      >
                        <View
                          style={{
                            backgroundColor:
                              m.result === "win"
                                ? colors.success
                                : m.result === "loss"
                                ? colors.ink2
                                : colors.surfaceCard,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: 4,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 10,
                              fontWeight: "700",
                              textTransform: "uppercase",
                              color:
                                m.result === "win" || m.result === "loss"
                                  ? "#FFFFFF"
                                  : colors.ink,
                              fontFamily: FONTS.sans,
                            }}
                          >
                            {m.result}
                          </Text>
                        </View>
                        <Text
                          style={{
                            fontFamily: FONTS.serif,
                            fontWeight: "700",
                            fontSize: 14,
                            color: colors.ink,
                          }}
                        >
                          vs {m.opponentName}
                        </Text>
                      </View>

                      {m.isPlayerOfTheMatch && (
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                            backgroundColor: colors.accentSubtle,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: 4,
                          }}
                        >
                          <Award size={14} color={colors.accent} />
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: "700",
                              color: colors.accent,
                              fontFamily: FONTS.sans,
                            }}
                          >
                            POTM
                          </Text>
                        </View>
                      )}
                    </View>

                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        borderTopWidth: 1,
                        borderTopColor: colors.hairline,
                        paddingTop: 8,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          color: colors.ink2,
                          fontFamily: FONTS.sans,
                        }}
                      >
                        {m.matchDate} · {m.venue}
                      </Text>
                      <Text
                        style={{
                          fontVariant: ["tabular-nums"],
                          fontWeight: "500",
                          color: colors.ink,
                          fontSize: 12,
                          fontFamily: FONTS.sans,
                        }}
                      >
                        MVP: +{m.mvpPoints.total} pts
                      </Text>
                    </View>

                    {/* Performance details */}
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 8,
                        backgroundColor: colors.surfaceCard,
                        padding: 8,
                        borderRadius: 6,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontSize: 10,
                            color: colors.ink2,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          Batting
                        </Text>
                        <Text
                          style={{
                            fontWeight: "600",
                            color: colors.ink,
                            fontSize: 12,
                            fontVariant: ["tabular-nums"],
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {m.batting
                            ? `${m.batting.runs} (${m.batting.balls}b, ${m.batting.fours}x4, ${m.batting.sixes}x6)`
                            : "DNB"}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontSize: 10,
                            color: colors.ink2,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          Bowling
                        </Text>
                        <Text
                          style={{
                            fontWeight: "600",
                            color: colors.ink,
                            fontSize: 12,
                            fontVariant: ["tabular-nums"],
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {m.bowling
                            ? `${m.bowling.wickets}/${m.bowling.runs} (${m.bowling.oversFormatted} ov)`
                            : "DNB"}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {/* --- TAB 5: MILESTONES & PROJECTIONS --- */}
        {activeTab === "milestones" && (
          <View style={{ flexDirection: "column", gap: 12 }}>
            {/* Batting Milestones */}
            <View
              style={{
                padding: 14,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                flexDirection: "column",
                gap: 10,
              }}
            >
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
                  <Flame size={14} color={colors.accent} />
                  <Text style={labelUpper12}>Next Batting Milestone</Text>
                </View>
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.serif,
                    fontWeight: "700",
                    color: colors.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {stats.nextBattingMilestone.target} Career Runs
                </Text>
              </View>

              {/* Progress bar */}
              <View
                style={{
                  width: "100%",
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colors.surfaceCard,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    backgroundColor: colors.accent,
                    width: `${Math.min(
                      100,
                      (stats.runs / stats.nextBattingMilestone.target) * 100
                    )}%`,
                  }}
                />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  Current: {stats.runs} runs
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: colors.ink,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  Needs {stats.nextBattingMilestone.runsNeeded} more
                </Text>
              </View>

              <Text
                style={{
                  fontSize: 11,
                  color: colors.ink2,
                  lineHeight: 18,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                  paddingTop: 8,
                  fontFamily: FONTS.sans,
                }}
              >
                At career average of {stats.battingAverage} runs/innings,
                projected to achieve milestone in approximately{" "}
                <Text style={{ fontWeight: "700", color: colors.ink }}>
                  ~{stats.nextBattingMilestone.projectedMatches} match(es)
                </Text>
                .
              </Text>
            </View>

            {/* Bowling Milestones */}
            <View
              style={{
                padding: 14,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                flexDirection: "column",
                gap: 10,
              }}
            >
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
                  <Target size={14} color={colors.accent} />
                  <Text style={labelUpper12}>Next Bowling Milestone</Text>
                </View>
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.serif,
                    fontWeight: "700",
                    color: colors.ink,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {stats.nextBowlingMilestone.target} Career Wickets
                </Text>
              </View>

              {/* Progress bar */}
              <View
                style={{
                  width: "100%",
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colors.surfaceCard,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    backgroundColor: colors.accent,
                    width: `${Math.min(
                      100,
                      (stats.wickets / stats.nextBowlingMilestone.target) * 100
                    )}%`,
                  }}
                />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  Current: {stats.wickets} wickets
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: colors.ink,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  Needs {stats.nextBowlingMilestone.wicketsNeeded} more
                </Text>
              </View>

              <Text
                style={{
                  fontSize: 11,
                  color: colors.ink2,
                  lineHeight: 18,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                  paddingTop: 8,
                  fontFamily: FONTS.sans,
                }}
              >
                Projected to reach target in{" "}
                <Text style={{ fontWeight: "700", color: colors.ink }}>
                  ~{stats.nextBowlingMilestone.projectedMatches} match(es)
                </Text>{" "}
                based on current strike rate.
              </Text>
            </View>

            {/* Fielding Career Breakdown */}
            <View
              style={{
                padding: 14,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                flexDirection: "column",
                gap: 8,
              }}
            >
              <Text style={labelUpper12}>Fielding Discipline</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <StatCell
                  label="Catches"
                  value={stats.catches}
                  pad={8}
                  radius={6}
                  valueSize={14}
                  upperLabel={false}
                />
                <StatCell
                  label="Stumpings"
                  value={stats.stumpings}
                  pad={8}
                  radius={6}
                  valueSize={14}
                  upperLabel={false}
                />
                <StatCell
                  label="Run Outs"
                  value={stats.runOuts}
                  pad={8}
                  radius={6}
                  valueSize={14}
                  upperLabel={false}
                />
              </View>
            </View>

            {/* Archival Action */}
            <View style={{ paddingTop: 8 }}>
              <ProfileIconButton
                label={
                  player.isArchived ? "Restore Player" : "Archive Player"
                }
                icon={<Archive size={16} color={colors.ink} />}
                variant="quiet"
                fullWidth
                onPress={() => {
                  db.deleteOrArchivePlayer(player.id);
                  onPlayerUpdated?.();
                  onClose();
                }}
              />
            </View>
          </View>
        )}

        {/* Modal Footer Attribution */}
        <View style={{ paddingTop: 8, alignItems: "center" }}>
          <Text
            style={{
              fontSize: 11,
              color: colors.ink2,
              textAlign: "center",
              fontFamily: FONTS.sans,
            }}
          >
            Designed & developed by{" "}
            <Text
              onPress={() => Linking.openURL("https://omkardile.is-a.dev/")}
              style={{ fontWeight: "500", color: colors.ink }}
            >
              Omkar Kardile
            </Text>
          </Text>
        </View>
      </View>
    </GullySheet>
  );
};
