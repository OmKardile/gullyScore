/**
 * GullyScore Match Setup Screen
 *
 * Pick 2 teams, overs, players per side, ball type, venue, date, toss, squads, and configurable local rules.
 *
 * RN port notes:
 * - Web sticky header → fixed header above the ScrollView (SafeAreaView top).
 * - Web `<select>` pickers → GullyChip rows (teams, ball type) and
 *   GullySegmented (quick-add target team) per port conventions.
 * - Web `type="date"` input → plain text field for the ISO date string
 *   (no date-picker dependency available).
 * - Web checkbox inputs → Pressable checkbox squares (Check icon).
 */

import React, { useState, useMemo } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { Match, MatchRules, Player, Team } from "../../types/cricket";
import { db, DEFAULT_RULES } from "../../storage/db";
import {
  GullyButton,
  GullyTextField,
  GullySegmented,
  GullyChip,
} from "../common/Components";
import { calculatePreMatchPrediction } from "../../engine/predictionEngine";
import { PreMatchPredictionCard } from "../prediction/PredictionComponents";
import { ChevronLeft, Check } from "lucide-react-native";
import { useTheme, FONTS } from "../../design/theme";

interface MatchSetupScreenProps {
  onBack: () => void;
  onMatchCreated: (matchId: string) => void;
  initialFixtureId?: string;
  initialTeamAId?: string;
  initialTeamBId?: string;
  initialTournamentId?: string;
}

// Repeated section card (web: rounded bordered surface card with a numbered label).
const SectionCard: React.FC<{
  label: string;
  gap?: number;
  children: React.ReactNode;
}> = ({ label, gap = 12, children }) => {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.hairline,
        borderRadius: 10,
        padding: 16,
        flexDirection: "column",
        gap,
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
        {label}
      </Text>
      {children}
    </View>
  );
};

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

// Choice button (web: bordered grid-col-2 toss/choice buttons).
const ChoiceButton: React.FC<{ active: boolean; onPress: () => void; children: React.ReactNode }> = ({
  active,
  onPress,
  children,
}) => {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          padding: 10,
          borderRadius: 8,
          borderWidth: 1,
          opacity: pressed ? 0.9 : 1,
        },
        active
          ? {
              borderColor: colors.accent,
              backgroundColor: colors.accentSubtle,
            }
          : { borderColor: colors.hairlineStrong },
      ]}
    >
      <Text
        style={{
          fontSize: 12,
          fontFamily: FONTS.sans,
          fontWeight: active ? "700" : "400",
          color: active ? colors.accent : colors.ink,
          textAlign: "center",
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
};

// Tiny number stepper button (web: 28px bordered square).
const StepperButton: React.FC<{ active: boolean; onPress: () => void; children: React.ReactNode }> = ({
  active,
  onPress,
  children,
}) => {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        {
          width: 28,
          height: 28,
          borderRadius: 4,
          borderWidth: 1,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.8 : 1,
        },
        active
          ? {
              borderColor: colors.accent,
              backgroundColor: colors.accentSubtle,
            }
          : { borderColor: colors.hairline },
      ]}
    >
      <Text
        style={{
          fontSize: 12,
          fontFamily: FONTS.sans,
          fontWeight: active ? "700" : "400",
          color: active ? colors.accent : colors.ink,
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
};

// Checkbox (web: <input type="checkbox">) → Pressable square with a Check icon.
const CheckBox: React.FC<{ checked: boolean; onToggle: () => void }> = ({ checked, onToggle }) => {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={8}
      style={({ pressed }) => ({
        width: 16,
        height: 16,
        borderRadius: 2,
        borderWidth: 1,
        borderColor: checked ? colors.accent : colors.hairlineStrong,
        backgroundColor: checked ? colors.accent : "transparent",
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {checked ? <Check size={12} strokeWidth={3} color="#FFFFFF" /> : null}
    </Pressable>
  );
};

export const MatchSetupScreen: React.FC<MatchSetupScreenProps> = ({
  onBack,
  onMatchCreated,
  initialFixtureId,
  initialTeamAId,
  initialTeamBId,
  initialTournamentId,
}) => {
  const { colors } = useTheme();
  const teams = db.getTeams();
  const players = db.getPlayers();
  const settings = db.getSettings();

  const [teamAId, setTeamAId] = useState<string>(initialTeamAId || teams[0]?.id || "");
  const [teamBId, setTeamBId] = useState<string>(
    initialTeamBId || (teams[1]?.id !== teamAId ? teams[1]?.id : teams[2]?.id) || ""
  );

  const [overs, setOvers] = useState<number>(settings.defaultRules.overs || 10);
  const [playersPerSide, setPlayersPerSide] = useState<number>(
    settings.defaultRules.playersPerSide || 8
  );
  const [ballType, setBallType] = useState<"tennis" | "leather" | "box">(
    settings.defaultRules.ballType || "tennis"
  );
  const [venue, setVenue] = useState<string>("Local Ground");
  const [date, setDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );

  // Toss
  const [tossWinner, setTossWinner] = useState<string>(teamAId);
  const [tossDecision, setTossDecision] = useState<"bat" | "bowl">("bat");

  // Squad selection
  const [teamAPlayers, setTeamAPlayers] = useState<string[]>(() => {
    const t = db.getTeam(teamAId);
    return t ? t.playerIds.slice(0, playersPerSide) : [];
  });
  const [teamBPlayers, setTeamBPlayers] = useState<string[]>(() => {
    const t = db.getTeam(teamBId);
    return t ? t.playerIds.slice(0, playersPerSide) : [];
  });

  // Local rules
  const [wideRuns, setWideRuns] = useState<number>(settings.defaultRules.wideRunValue);
  const [noBallRuns, setNoBallRuns] = useState<number>(settings.defaultRules.noBallRunValue);
  const [freeHit, setFreeHit] = useState<boolean>(settings.defaultRules.freeHitOnNoBall);
  const [lastManBatting, setLastManBatting] = useState<boolean>(
    settings.defaultRules.lastManBatting
  );
  const [noConsecutive, setNoConsecutive] = useState<boolean>(
    settings.defaultRules.noConsecutiveOvers
  );
  const [trackWagon, setTrackWagon] = useState<boolean>(
    settings.defaultRules.trackShotDirection
  );

  const preMatchPred = useMemo(() => {
    const tA = db.getTeam(teamAId);
    const tB = db.getTeam(teamBId);
    if (!tA || !tB) return null;
    return calculatePreMatchPrediction(
      tA,
      tB,
      db.getMatches(),
      { ...settings.defaultRules, overs, ballType },
      venue
    );
  }, [teamAId, teamBId, overs, ballType, venue, settings.defaultRules]);

  // Quick add player inline
  const [quickPlayerName, setQuickPlayerName] = useState<string>("");
  const [quickAddTargetTeam, setQuickAddTargetTeam] = useState<"A" | "B">("A");

  const handleQuickAddPlayer = () => {
    if (!quickPlayerName.trim()) return;
    const targetTeamId = quickAddTargetTeam === "A" ? teamAId : teamBId;
    const newP = db.quickAddPlayer(quickPlayerName.trim(), targetTeamId);
    if (quickAddTargetTeam === "A") {
      setTeamAPlayers((prev) => [...prev, newP.id]);
    } else {
      setTeamBPlayers((prev) => [...prev, newP.id]);
    }
    setQuickPlayerName("");
  };

  const handleStartMatch = () => {
    const rules: MatchRules = {
      overs,
      playersPerSide,
      ballType,
      wideRunValue: wideRuns,
      noBallRunValue: noBallRuns,
      freeHitOnNoBall: freeHit,
      lastManBatting,
      maxOversPerBowler: Math.ceil(overs / 5),
      noConsecutiveOvers: noConsecutive,
      superOverOnTie: false,
      trackShotDirection: trackWagon,
    };

    // Determine who bats first based on toss
    const firstBatTeamId =
      tossDecision === "bat"
        ? tossWinner
        : tossWinner === teamAId
        ? teamBId
        : teamAId;
    const firstBowlTeamId = firstBatTeamId === teamAId ? teamBId : teamAId;

    const matchId = `match_${Date.now()}`;
    const newMatch: Match = {
      id: matchId,
      teamAId,
      teamBId,
      teamAPlayerIds: teamAPlayers,
      teamBPlayerIds: teamBPlayers,
      date,
      venue,
      rules,
      toss: {
        winnerTeamId: tossWinner,
        decision: tossDecision,
      },
      status: "live",
      currentInningsIndex: 0,
      innings: [
        {
          battingTeamId: firstBatTeamId,
          bowlingTeamId: firstBowlTeamId,
          ballEvents: [],
        },
      ],
      tournamentId: initialTournamentId,
      fixtureId: initialFixtureId,
      updatedAt: Date.now(),
    };

    db.saveMatch(newMatch);

    if (initialFixtureId) {
      const fix = db.getFixtures().find((f) => f.id === initialFixtureId);
      if (fix) {
        db.saveFixture({ ...fix, matchId });
      }
    }

    onMatchCreated(matchId);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Top Bar */}
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
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <ChevronLeft size={20} strokeWidth={1.5} color={colors.ink} />
          <Text
            style={{
              fontSize: 14,
              fontWeight: "500",
              color: colors.ink,
              fontFamily: FONTS.sans,
            }}
          >
            Cancel
          </Text>
        </Pressable>
        <Text
          style={{
            fontSize: 14,
            fontFamily: FONTS.serif,
            fontWeight: "600",
            color: colors.ink,
          }}
        >
          New Match Setup
        </Text>
        <View style={{ width: 48 }} />
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
            gap: 24,
          }}
        >
          {/* Teams Selection */}
          <SectionCard label="01. Teams">
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <ControlLabel>Team 1</ControlLabel>
                {/* RN: web <select> → GullyChip row */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {teams.map((t) => (
                    <GullyChip
                      key={t.id}
                      label={t.name}
                      active={t.id === teamAId}
                      onPress={() => {
                        setTeamAId(t.id);
                        const tm = db.getTeam(t.id);
                        if (tm) setTeamAPlayers(tm.playerIds.slice(0, playersPerSide));
                      }}
                    />
                  ))}
                </View>
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <ControlLabel>Team 2</ControlLabel>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {teams.map((t) => (
                    <GullyChip
                      key={t.id}
                      label={t.name}
                      active={t.id === teamBId}
                      onPress={() => {
                        setTeamBId(t.id);
                        const tm = db.getTeam(t.id);
                        if (tm) setTeamBPlayers(tm.playerIds.slice(0, playersPerSide));
                      }}
                    />
                  ))}
                </View>
              </View>
            </View>
          </SectionCard>

          {/* Pre-Match Win Predictor Card */}
          {preMatchPred && teamAId && teamBId && teamAId !== teamBId && (
            <PreMatchPredictionCard
              pred={preMatchPred}
              teamA={db.getTeam(teamAId)}
              teamB={db.getTeam(teamBId)}
            />
          )}

          {/* Match Configuration */}
          <SectionCard label="02. Match Format">
            <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <GullyTextField
                  label="Overs"
                  value={String(overs)}
                  onChangeText={(t) => setOvers(parseInt(t, 10) || 1)}
                  tabular
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <GullyTextField
                  label="Players / Side"
                  value={String(playersPerSide)}
                  onChangeText={(t) => setPlayersPerSide(parseInt(t, 10) || 1)}
                  tabular
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ flex: 1.2, minWidth: 0 }}>
                <ControlLabel>Ball</ControlLabel>
                {/* RN: web <select> → GullyChip row */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  <GullyChip
                    label="Tennis"
                    active={ballType === "tennis"}
                    onPress={() => setBallType("tennis")}
                  />
                  <GullyChip
                    label="Leather"
                    active={ballType === "leather"}
                    onPress={() => setBallType("leather")}
                  />
                  <GullyChip
                    label="Box"
                    active={ballType === "box"}
                    onPress={() => setBallType("box")}
                  />
                </View>
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
              <View style={{ flex: 1 }}>
                <GullyTextField
                  label="Venue"
                  value={venue}
                  onChangeText={setVenue}
                />
              </View>
              <View style={{ flex: 1 }}>
                {/* RN: web type="date" input → plain text field (no
                    date-picker dep); value stays the ISO yyyy-mm-dd string. */}
                <GullyTextField
                  label="Date"
                  value={date}
                  onChangeText={setDate}
                />
              </View>
            </View>
          </SectionCard>

          {/* Toss */}
          <SectionCard label="03. Toss">
            <View style={{ flexDirection: "column", gap: 8 }}>
              <Text
                style={{
                  fontSize: 12,
                  color: colors.ink2,
                  fontFamily: FONTS.sans,
                }}
              >
                Toss Winner
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <ChoiceButton
                    active={tossWinner === teamAId}
                    onPress={() => setTossWinner(teamAId)}
                  >
                    {db.getTeam(teamAId)?.name}
                  </ChoiceButton>
                </View>
                <View style={{ flex: 1 }}>
                  <ChoiceButton
                    active={tossWinner === teamBId}
                    onPress={() => setTossWinner(teamBId)}
                  >
                    {db.getTeam(teamBId)?.name}
                  </ChoiceButton>
                </View>
              </View>

              <Text
                style={{
                  fontSize: 12,
                  color: colors.ink2,
                  marginTop: 8,
                  fontFamily: FONTS.sans,
                }}
              >
                Chose To
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <ChoiceButton
                    active={tossDecision === "bat"}
                    onPress={() => setTossDecision("bat")}
                  >
                    Bat First
                  </ChoiceButton>
                </View>
                <View style={{ flex: 1 }}>
                  <ChoiceButton
                    active={tossDecision === "bowl"}
                    onPress={() => setTossDecision("bowl")}
                  >
                    Bowl First
                  </ChoiceButton>
                </View>
              </View>
            </View>
          </SectionCard>

          {/* Local Rules Config */}
          <SectionCard label="04. Local Rules">
            <View
              style={{
                flexDirection: "column",
                gap: 10,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingTop: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                    color: colors.ink,
                    flexShrink: 1,
                    paddingRight: 8,
                  }}
                >
                  Wide run penalty
                </Text>
                <View style={{ flexDirection: "row", gap: 4 }}>
                  {[0, 1, 2].map((r) => (
                    <StepperButton
                      key={r}
                      active={wideRuns === r}
                      onPress={() => setWideRuns(r)}
                    >
                      {r}
                    </StepperButton>
                  ))}
                </View>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingTop: 8,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                    color: colors.ink,
                    flexShrink: 1,
                    paddingRight: 8,
                  }}
                >
                  No-ball run penalty
                </Text>
                <View style={{ flexDirection: "row", gap: 4 }}>
                  {[1, 2].map((r) => (
                    <StepperButton
                      key={r}
                      active={noBallRuns === r}
                      onPress={() => setNoBallRuns(r)}
                    >
                      {r}
                    </StepperButton>
                  ))}
                </View>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingTop: 8,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                    color: colors.ink,
                    flexShrink: 1,
                    paddingRight: 8,
                  }}
                >
                  Free hit on no-ball
                </Text>
                <CheckBox checked={freeHit} onToggle={() => setFreeHit(!freeHit)} />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingTop: 8,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                    color: colors.ink,
                    flexShrink: 1,
                    paddingRight: 8,
                  }}
                >
                  Last man batting (solo last batter)
                </Text>
                <CheckBox
                  checked={lastManBatting}
                  onToggle={() => setLastManBatting(!lastManBatting)}
                />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingTop: 8,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                    color: colors.ink,
                    flexShrink: 1,
                    paddingRight: 8,
                  }}
                >
                  No consecutive overs by same bowler
                </Text>
                <CheckBox
                  checked={noConsecutive}
                  onToggle={() => setNoConsecutive(!noConsecutive)}
                />
              </View>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingTop: 8,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                    color: colors.ink,
                    flexShrink: 1,
                    paddingRight: 8,
                  }}
                >
                  Track shot direction (Wagon Wheel)
                </Text>
                <CheckBox
                  checked={trackWagon}
                  onToggle={() => setTrackWagon(!trackWagon)}
                />
              </View>
            </View>
          </SectionCard>

          {/* Quick Add Player Anywhere */}
          <SectionCard label="Quick Add Player (by name only)" gap={8}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <TextInput
                placeholder="Player name..."
                placeholderTextColor={colors.ink2}
                value={quickPlayerName}
                onChangeText={setQuickPlayerName}
                style={{
                  flex: 1,
                  minWidth: 140,
                  backgroundColor: colors.surfaceCard,
                  borderWidth: 1,
                  borderColor: colors.hairlineStrong,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  fontSize: 14,
                  color: colors.ink,
                  fontFamily: FONTS.sans,
                }}
              />
              <GullySegmented
                options={[
                  { label: "Team 1", value: "A" },
                  { label: "Team 2", value: "B" },
                ]}
                value={quickAddTargetTeam}
                onChange={(v) => setQuickAddTargetTeam(v)}
              />
              <GullyButton size="sm" variant="quiet" onPress={handleQuickAddPlayer}>
                Add
              </GullyButton>
            </View>
          </SectionCard>

          {/* Start Match CTA */}
          <View style={{ paddingTop: 8 }}>
            <GullyButton
              variant="primary"
              size="lg"
              fullWidth
              onPress={handleStartMatch}
              disabled={!teamAId || !teamBId || teamAId === teamBId}
            >
              Start Match & Open Live Scorer
            </GullyButton>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
