/**
 * GullyScore Live Scorer Screen (The Core Experience)
 *
 * Outdoor-optimised, sunlight-ready, thumb-first 48dp+ tap targets.
 * Unlimited undo, event-sourced replay, wicket flow, ball log, and instant auto-save.
 *
 * RN port notes:
 * - Root is a SafeAreaView flex column: header bar on top, scrollable reading
 *   zone + thumb scoring pad (web's justify-between h-screen column) between.
 * - Bottom-sheet flows (wicket, next bowler, ball log, more actions, prediction)
 *   use the ported GullySheet; the web's centered fixed overlays (wagon wheel
 *   direction picker, custom runs, exit confirm) are RN Modals (CenteredModal).
 * - navigator.vibrate haptics -> react-native Vibration (same pattern API).
 * - Screen WakeLock (navigator.wakeLock) is web-only; dropped (no-op effect).
 * - Web CSS grids -> fixed rows of flex:1 children via chunked().
 */

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  Vibration,
  View,
} from "react-native";
import {
  BallEvent,
  DismissalInfo,
  ExtraType,
  Match,
  Player,
  ShotDirection,
  WicketType,
} from "../../types/cricket";
import { db } from "../../storage/db";
import {
  replayInnings,
  formatOvers,
  generateBallCommentary,
} from "../../engine/scoringEngine";
import {
  GullyButton,
  GullySheet,
  GullyTextField,
  OverRibbon,
  ScoreOdometer,
} from "../common/Components";
import {
  calculateLiveWinProbability,
  calculateProjectedScore,
  calculateBatterProjection,
} from "../../engine/predictionEngine";
import {
  LiveWinProbBar,
  ProjectedScoreStrip,
} from "../prediction/PredictionComponents";
import { useTheme, FONTS } from "../../design/theme";
import {
  RotateCcw,
  ArrowLeftRight,
  MoreVertical,
  History,
  Check,
  ChevronLeft,
  X,
  TrendingUp,
  Sparkles,
} from "lucide-react-native";

interface ScoringScreenProps {
  matchId: string;
  onExit: () => void;
  onViewScorecard: (matchId: string) => void;
}

/**
 * Web `tnum` (tabular figures). RN 0.88's generated TextStyle has no
 * `fontFeatureSettings` member; fontVariant achieves the same tabular figures
 * (pass it as an array element: style={[…, TNUM]}).
 */
const TNUM = { fontVariant: ["tabular-nums"] as const };

/** Split an array into fixed-size rows — RN replacement for CSS grid-cols-*. */
function chunked<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

/** Centered overlay dialog — RN port of the web's `fixed inset-0 z-50` modals. */
const CenteredModal: React.FC<{
  visible: boolean;
  onRequestClose?: () => void;
  children: React.ReactNode;
}> = ({ visible, onRequestClose, children }) => (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    onRequestClose={onRequestClose}
  >
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        backgroundColor: "rgba(0,0,0,0.6)", // bg-black/60
      }}
    >
      {children}
    </View>
  </Modal>
);

/** Big run key (0/1/2/3/4/6) — keeps the web's active:bg-ink / active:text-bg press state. */
const RunKey: React.FC<{
  label: string;
  isBoundary: boolean;
  disabled?: boolean;
  onPress: () => void;
}> = ({ label, isBoundary, disabled, onPress }) => {
  const { colors } = useTheme();
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{
        flex: 1,
        height: 64,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.hairlineStrong,
        backgroundColor: pressed ? colors.ink : colors.surfaceCard,
        opacity: disabled ? 0.3 : 1,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      }}
    >
      <Text
        style={{
          fontSize: 24,
          fontFamily: FONTS.serif,
          fontWeight: isBoundary ? "900" : "500",
          color: pressed ? colors.bg : colors.ink,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
};

export const ScoringScreen: React.FC<ScoringScreenProps> = ({
  matchId,
  onExit,
  onViewScorecard,
}) => {
  const { colors } = useTheme();
  const [match, setMatch] = useState<Match | undefined>(() => db.getMatch(matchId));
  const [playersMap, setPlayersMap] = useState<Record<string, Player>>(() => db.getPlayersMap());
  const [settings] = useState(() => db.getSettings());

  // Sheet states
  const [showWicketSheet, setShowWicketSheet] = useState(false);
  const [showNextBowlerSheet, setShowNextBowlerSheet] = useState(false);
  const [showBallLogSheet, setShowBallLogSheet] = useState(false);
  const [showMoreActionsSheet, setShowMoreActionsSheet] = useState(false);
  const [showWagonWheelModal, setShowWagonWheelModal] = useState(false);
  const [showConfirmExit, setShowConfirmExit] = useState(false);
  const [showCustomRunsModal, setShowCustomRunsModal] = useState(false);
  const [showPredictionSheet, setShowPredictionSheet] = useState(false);
  const [customRunsValue, setCustomRunsValue] = useState("5");

  // Temporary ball for wagon wheel direction
  const [pendingWagonBall, setPendingWagonBall] = useState<BallEvent | null>(null);

  // Wicket progressive sheet state
  const [wicketStep, setWicketStep] = useState<"type" | "fielder" | "batter" | "next_batter">("type");
  const [selectedWicketType, setSelectedWicketType] = useState<WicketType>("bowled");
  const [selectedFielderIds, setSelectedFielderIds] = useState<string[]>([]);
  const [dismissedBatterId, setDismissedBatterId] = useState<string>("");
  const [dismissedEnd, setDismissedEnd] = useState<"striker" | "non_striker">("striker");
  const [runOutCompletedRuns, setRunOutCompletedRuns] = useState<number>(0);
  const [selectedNextBatterId, setSelectedNextBatterId] = useState<string>("");

  // Bowler selection state
  const [selectedNextBowlerId, setSelectedNextBowlerId] = useState<string>("");

  // Edit ball log state
  const [editingBall, setEditingBall] = useState<BallEvent | null>(null);

  // Keep screen on via WakeLock API if enabled
  // RN: dropped — navigator.wakeLock is a web-only API (no keep-awake module installed).
  useEffect(() => {
    // no-op in RN
  }, [settings.keepScreenOn]);

  // Haptic feedback trigger
  // RN: navigator.vibrate -> react-native Vibration (same pattern API).
  const triggerHaptic = useCallback(
    (type: "light" | "double" | "firm" | "wicket" | "undo") => {
      if (!settings.haptics) return;
      if (type === "light") Vibration.vibrate(12);
      else if (type === "double") Vibration.vibrate([15, 30, 20]);
      else if (type === "firm") Vibration.vibrate(40);
      else if (type === "wicket") Vibration.vibrate([60, 40, 60]);
      else if (type === "undo") Vibration.vibrate(25);
    },
    [settings.haptics]
  );

  // Reload data from DB on changes
  useEffect(() => {
    const unsub = db.subscribe(() => {
      setMatch(db.getMatch(matchId));
      setPlayersMap(db.getPlayersMap());
    });
    return unsub;
  }, [matchId]);

  if (!match) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
        }}
      >
        <Text style={{ color: colors.ink2, fontFamily: FONTS.sans, textAlign: "center" }}>
          Match not found.
        </Text>
        <GullyButton onPress={onExit} style={{ marginTop: 16 }}>
          Back to Home
        </GullyButton>
      </SafeAreaView>
    );
  }

  const currentInningsIndex = match.currentInningsIndex;
  const currentInningsData = match.innings[currentInningsIndex];
  const ballEvents = currentInningsData ? currentInningsData.ballEvents : [];

  const battingSquadIds =
    currentInningsData.battingTeamId === match.teamAId
      ? match.teamAPlayerIds
      : match.teamBPlayerIds;
  const bowlingSquadIds =
    currentInningsData.bowlingTeamId === match.teamAId
      ? match.teamAPlayerIds
      : match.teamBPlayerIds;

  // Replay scorecards
  const scorecard = useMemo(() => {
    return replayInnings(
      ballEvents,
      match.rules,
      battingSquadIds,
      bowlingSquadIds,
      playersMap,
      currentInningsData.targetRuns,
      currentInningsData.isSuperOver
    );
  }, [ballEvents, match.rules, battingSquadIds, bowlingSquadIds, playersMap, currentInningsData]);

  // Teams info
  const battingTeam = db.getTeam(currentInningsData.battingTeamId);
  const bowlingTeam = db.getTeam(currentInningsData.bowlingTeamId);

  // Active batter & bowler determination
  const lastBall = ballEvents[ballEvents.length - 1];
  const strikerId = lastBall?.strikerId || battingSquadIds[0] || "";
  const nonStrikerId = lastBall?.nonStrikerId || battingSquadIds[1] || "";
  const bowlerId = lastBall?.bowlerId || bowlingSquadIds[0] || "";

  const strikerPlayer = playersMap[strikerId];
  const nonStrikerPlayer = playersMap[nonStrikerId];
  const bowlerPlayer = playersMap[bowlerId];

  const strikerStat = scorecard.batters.find((b) => b.playerId === strikerId);
  const nonStrikerStat = scorecard.batters.find((b) => b.playerId === nonStrikerId);
  const bowlerStat = scorecard.bowlers.find((b) => b.playerId === bowlerId);

  // Current over balls for ribbon
  const currentOverLegalBallsCount = scorecard.legalBallsCount % 6;
  const lastOverSummary = scorecard.overSummaries[scorecard.overSummaries.length - 1];
  const ballsInCurrentOver =
    currentOverLegalBallsCount === 0 && lastBall && scorecard.legalBallsCount > 0
      ? []
      : ballEvents.slice(
          scorecard.overSummaries.reduce((sum, o) => sum + o.balls.length, 0)
        );

  const ribbonBalls = ballsInCurrentOver.map((b) => ({
    runsBat: b.runsBat,
    extraType: b.extraType,
    extraRuns: b.extraRuns,
    isWicket: !!b.wicket && b.wicket.type !== "retired_hurt",
    isLegal: b.isLegal,
  }));

  // Target and RRR calculation
  const target = currentInningsData.targetRuns;
  const legalBallsRemaining = Math.max(0, match.rules.overs * 6 - scorecard.legalBallsCount);
  const runsRemaining = target ? Math.max(0, target - scorecard.totalRuns) : 0;
  const rrr =
    legalBallsRemaining > 0 && target
      ? Number(((runsRemaining / (legalBallsRemaining / 6))).toFixed(2))
      : 0;

  // Prediction Models
  const teamA = db.getTeam(match.teamAId);
  const teamB = db.getTeam(match.teamBId);
  const firstInningsTotal = match.innings[0]?.ballEvents.reduce(
    (acc, b) =>
      acc +
      b.runsBat +
      (b.extraType === "wide" || b.extraType === "no_ball"
        ? b.extraRuns || 1
        : b.extraType !== "none"
        ? b.extraRuns
        : 0),
    0
  );

  const winProbability = useMemo(() => {
    return calculateLiveWinProbability(match, scorecard, firstInningsTotal);
  }, [match, scorecard, firstInningsTotal]);

  const totalPossibleWickets = match.rules.lastManBatting
    ? match.rules.playersPerSide
    : match.rules.playersPerSide - 1;

  const projectedScore = useMemo(() => {
    return calculateProjectedScore(
      scorecard.totalRuns,
      scorecard.legalBallsCount,
      match.rules.overs,
      scorecard.totalWickets,
      totalPossibleWickets,
      match.rules.ballType
    );
  }, [scorecard, match.rules, totalPossibleWickets]);

  const strikerMilestone = useMemo(() => {
    return calculateBatterProjection(
      strikerStat?.runs || 0,
      strikerStat?.ballsFaced || 0,
      legalBallsRemaining,
      Math.max(0, totalPossibleWickets - scorecard.totalWickets)
    );
  }, [strikerStat, legalBallsRemaining, totalPossibleWickets, scorecard.totalWickets]);

  // Auto end check
  useEffect(() => {
    if (scorecard.isCompleted && match.status === "live") {
      // Check if 1st innings just completed
      if (currentInningsIndex === 0 && match.innings.length === 1) {
        // Start 2nd innings
        const nextInnings = {
          battingTeamId: match.innings[0].bowlingTeamId,
          bowlingTeamId: match.innings[0].battingTeamId,
          targetRuns: scorecard.totalRuns + 1,
          ballEvents: [],
        };
        const updatedMatch = {
          ...match,
          innings: [...match.innings, nextInnings],
          currentInningsIndex: 1,
        };
        db.saveMatch(updatedMatch);
      } else if (currentInningsIndex >= 1) {
        // Match completed! Compute result
        const inn1 = replayInnings(
          match.innings[0].ballEvents,
          match.rules,
          [],
          [],
          playersMap
        );
        const inn2 = scorecard;

        let resultText = "";
        let winnerTeamId: string | undefined = undefined;

        if (inn2.totalRuns > inn1.totalRuns) {
          const wicketsRemaining = match.rules.playersPerSide - 1 - inn2.totalWickets;
          resultText = `${bowlingTeam?.name} chased target to win by ${wicketsRemaining} wicket(s)`;
          winnerTeamId = currentInningsData.battingTeamId;
        } else if (inn2.totalRuns < inn1.totalRuns) {
          const runMargin = inn1.totalRuns - inn2.totalRuns;
          resultText = `${battingTeam?.name} won by ${runMargin} run(s)`;
          winnerTeamId = match.innings[0].battingTeamId;
        } else {
          resultText = "Match tied!";
        }

        const updatedMatch: Match = {
          ...match,
          status: "completed",
          resultText,
          winnerTeamId,
        };
        db.saveMatch(updatedMatch);
      }
    }
  }, [
    scorecard.isCompleted,
    currentInningsIndex,
    match,
    scorecard,
    battingTeam?.name,
    bowlingTeam?.name,
    currentInningsData.battingTeamId,
    playersMap,
  ]);

  // Check for end of over prompt (6 legal balls reached)
  const isOverComplete =
    scorecard.legalBallsCount > 0 &&
    scorecard.legalBallsCount % 6 === 0 &&
    ballsInCurrentOver.length === 0 &&
    !scorecard.isCompleted;

  // Handle recorded ball event
  const recordBall = useCallback(
    (
      runsBat: number,
      extraType: ExtraType = "none",
      extraRuns: number = 0,
      wicket?: DismissalInfo,
      shotDirection?: ShotDirection
    ) => {
      const isLegal = extraType !== "wide" && extraType !== "no_ball";
      const isFreeHit = lastBall ? lastBall.extraType === "no_ball" : false;
      const nextSeq = ballEvents.length + 1;
      const overNum = Math.floor(scorecard.legalBallsCount / 6);
      const ballInOver = (scorecard.legalBallsCount % 6) + 1;

      const commentary = generateBallCommentary(
        { runsBat, extraType, extraRuns, isLegal, wicket, shotDirection },
        strikerPlayer?.name || "Striker",
        bowlerPlayer?.name || "Bowler"
      );

      const newBall: BallEvent = {
        id: `ball_${Date.now()}_${nextSeq}`,
        seq: nextSeq,
        inningsIndex: currentInningsIndex,
        overNumber: overNum,
        ballInOver,
        strikerId,
        nonStrikerId,
        bowlerId,
        runsBat,
        extraType,
        extraRuns,
        isLegal,
        wicket,
        shotDirection,
        isFreeHit,
        timestamp: Date.now(),
        commentaryText: commentary,
      };

      // Determine next striker / non-striker
      let nextStriker = strikerId;
      let nextNonStriker = nonStrikerId;

      // Strike rotation logic:
      // Odd runs swap strike
      const runsCompleted = wicket ? wicket.runsCompleted : runsBat;
      const totalRunsRan = runsCompleted + (extraType === "bye" || extraType === "leg_bye" ? extraRuns : 0);
      const shouldSwapStrike = totalRunsRan % 2 !== 0;

      if (shouldSwapStrike) {
        const tmp = nextStriker;
        nextStriker = nextNonStriker;
        nextNonStriker = tmp;
      }

      // If wicket fell, assign next batter
      if (wicket && selectedNextBatterId) {
        if (wicket.dismissedEnd === "striker" || wicket.dismissedPlayerId === strikerId) {
          nextStriker = selectedNextBatterId;
        } else {
          nextNonStriker = selectedNextBatterId;
        }
      }

      // Check if over ends after this legal ball
      const newLegalBallsCount = scorecard.legalBallsCount + (isLegal ? 1 : 0);
      const isEndOfOver = isLegal && newLegalBallsCount % 6 === 0;

      if (isEndOfOver && !match.rules.lastManBatting) {
        // Switch ends at over end
        const tmp = nextStriker;
        nextStriker = nextNonStriker;
        nextNonStriker = tmp;
      }

      const updatedEvents = [...ballEvents, newBall];
      const updatedInnings = [...match.innings];
      updatedInnings[currentInningsIndex] = {
        ...currentInningsData,
        ballEvents: updatedEvents,
      };

      const updatedMatch: Match = {
        ...match,
        innings: updatedInnings,
      };

      db.saveMatch(updatedMatch);

      // Trigger Haptics
      if (wicket) triggerHaptic("wicket");
      else if (runsBat === 4) triggerHaptic("double");
      else if (runsBat === 6) triggerHaptic("firm");
      else triggerHaptic("light");

      // Optional wagon wheel prompt if boundary/scoring shot and enabled
      if (
        runsBat > 0 &&
        match.rules.trackShotDirection &&
        !shotDirection &&
        !showWagonWheelModal
      ) {
        setPendingWagonBall(newBall);
        setShowWagonWheelModal(true);
      }

      // Check if bowler needs to be chosen for next over
      if (isEndOfOver && newLegalBallsCount < match.rules.overs * 6) {
        setTimeout(() => {
          setShowNextBowlerSheet(true);
        }, 300);
      }
    },
    [
      ballEvents,
      bowlerId,
      bowlerPlayer?.name,
      currentInningsData,
      currentInningsIndex,
      lastBall,
      match,
      nonStrikerId,
      scorecard.legalBallsCount,
      selectedNextBatterId,
      showWagonWheelModal,
      strikerId,
      strikerPlayer?.name,
      triggerHaptic,
    ]
  );

  // Undo last ball
  const handleUndo = () => {
    if (ballEvents.length === 0) return;
    const updatedEvents = ballEvents.slice(0, -1);
    const updatedInnings = [...match.innings];
    updatedInnings[currentInningsIndex] = {
      ...currentInningsData,
      ballEvents: updatedEvents,
    };
    db.saveMatch({ ...match, innings: updatedInnings });
    triggerHaptic("undo");
  };

  // Swap striker manually
  const handleSwapStriker = () => {
    if (ballEvents.length === 0) return;
    const last = { ...ballEvents[ballEvents.length - 1] };
    const tmp = last.strikerId;
    last.strikerId = last.nonStrikerId;
    last.nonStrikerId = tmp;
    const updated = [...ballEvents.slice(0, -1), last];
    const updatedInnings = [...match.innings];
    updatedInnings[currentInningsIndex] = { ...currentInningsData, ballEvents: updated };
    db.saveMatch({ ...match, innings: updatedInnings });
    triggerHaptic("light");
  };

  // Bowler assignment
  const handleSelectNextBowler = (bId: string) => {
    setSelectedNextBowlerId(bId);
    setShowNextBowlerSheet(false);
  };

  // Wicket sheet confirmation
  const handleConfirmWicket = () => {
    const isRunOut = selectedWicketType === "run_out";
    const dismissedId = isRunOut
      ? dismissedBatterId || strikerId
      : strikerId; // for bowled, lbw, caught, striker is dismissed

    const wicketInfo: DismissalInfo = {
      type: selectedWicketType,
      dismissedPlayerId: dismissedId,
      dismissedEnd: dismissedEnd,
      fielderIds: selectedFielderIds,
      runsCompleted: runOutCompletedRuns,
    };

    recordBall(runOutCompletedRuns, "none", 0, wicketInfo);
    setShowWicketSheet(false);
    // Reset state
    setWicketStep("type");
    setSelectedWicketType("bowled");
    setSelectedFielderIds([]);
    setDismissedBatterId("");
    setSelectedNextBatterId("");
  };

  // Save wagon wheel shot direction
  const handleSaveShotDirection = (dir: ShotDirection) => {
    if (!pendingWagonBall) return;
    const updatedEvents = ballEvents.map((b) =>
      b.id === pendingWagonBall.id ? { ...b, shotDirection: dir } : b
    );
    const updatedInnings = [...match.innings];
    updatedInnings[currentInningsIndex] = { ...currentInningsData, ballEvents: updatedEvents };
    db.saveMatch({ ...match, innings: updatedInnings });
    setShowWagonWheelModal(false);
    setPendingWagonBall(null);
  };

  // Eligible next batters (those in squad who haven't batted yet)
  const availableNextBatters = battingSquadIds.filter((pId) => {
    const stat = scorecard.batters.find((b) => b.playerId === pId);
    return !stat || (!stat.isOut && pId !== strikerId && pId !== nonStrikerId);
  });

  // Eligible bowlers for next over
  const eligibleBowlers = bowlingSquadIds.map((pId) => {
    const stat = scorecard.bowlers.find((b) => b.playerId === pId);
    const oversBowled = stat ? stat.legalBalls / 6 : 0;
    const isConsecutive = match.rules.noConsecutiveOvers && bowlerId === pId;
    const reachedMax = oversBowled >= match.rules.maxOversPerBowler;
    let ineligibleReason = "";
    if (isConsecutive) ineligibleReason = "Bowled previous over";
    if (reachedMax) ineligibleReason = `Reached max quota (${match.rules.maxOversPerBowler} ov)`;

    return {
      playerId: pId,
      player: playersMap[pId],
      oversBowled,
      isEligible: !isConsecutive && !reachedMax,
      ineligibleReason,
    };
  });

  const isLeftHandPad = settings.padHand === "left";

  // Shared label styles (web: text-xs/[11px] uppercase tracking-wider text-ink-2 …)
  const zoneLabel = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.ink2,
    fontFamily: FONTS.sans,
  } as const;
  const sheetLabel = {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.ink2,
    fontWeight: "600",
  } as const;
  const cardLabel = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.ink2,
    fontWeight: "600",
  } as const;
  const fieldLabel = { fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans } as const;

  return (
    <SafeAreaView style={{ flex: 1, width: "100%", backgroundColor: colors.bg }}>
      {/* Top Header Bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
          backgroundColor: colors.surface,
        }}
      >
        <Pressable
          onPress={() => setShowConfirmExit(true)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <ChevronLeft size={20} strokeWidth={1.5} color={colors.ink} />
          <Text style={{ fontSize: 14, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink }}>
            Matches
          </Text>
        </Pressable>

        <View style={{ flexDirection: "column", alignItems: "center" }}>
          <Text style={{ fontSize: 12, fontFamily: FONTS.serif, fontWeight: "600", color: colors.ink }}>
            {battingTeam?.name} vs {bowlingTeam?.name}
          </Text>
          <Text style={{ fontSize: 10, color: colors.ink2, fontFamily: FONTS.sans }}>
            Innings {currentInningsIndex + 1} of {match.innings.length} · {match.rules.overs} Overs
          </Text>
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Pressable
            onPress={() => setShowPredictionSheet(true)}
            accessibilityLabel="Live Win & Score Predictor"
            style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.85 : 1 })}
          >
            <TrendingUp size={20} strokeWidth={1.5} color={colors.ink2} />
          </Pressable>
          <Pressable
            onPress={() => setShowBallLogSheet(true)}
            accessibilityLabel="Ball Log & Replay"
            style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.85 : 1 })}
          >
            <History size={20} strokeWidth={1.5} color={colors.ink2} />
          </Pressable>
          <Pressable
            onPress={() => onViewScorecard(matchId)}
            accessibilityLabel="Scorecard"
            style={({ pressed }) => ({ padding: 8, opacity: pressed ? 0.85 : 1 })}
          >
            <MoreVertical size={20} strokeWidth={1.5} color={colors.ink2} />
          </Pressable>
        </View>
      </View>

      {/* Main Scoring Area */}
      <ScrollView
        style={{ flex: 1, width: "100%" }}
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "space-between",
          width: "100%",
          maxWidth: 560,
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Upper Reading Zone */}
        <View style={{ flexDirection: "column", width: "100%", paddingHorizontal: 16, paddingTop: 8 }}>
          {/* Score as Hero */}
          <ScoreOdometer
            runs={scorecard.totalRuns}
            wickets={scorecard.totalWickets}
            overs={scorecard.oversFormatted}
            crr={scorecard.runRate}
            target={target}
            rrr={rrr}
          />

          {/* Live Prediction Bar */}
          <View style={{ marginBottom: 8 }}>
            {currentInningsIndex === 0 ? (
              <ProjectedScoreStrip
                model={projectedScore}
                onPressDetails={() => setShowPredictionSheet(true)}
              />
            ) : (
              <LiveWinProbBar
                prob={winProbability}
                teamA={teamA}
                teamB={teamB}
                onPressDetails={() => setShowPredictionSheet(true)}
              />
            )}
          </View>

          {/* Batters Strip */}
          <View
            style={{
              width: "100%",
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              padding: 12,
              marginBottom: 8,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: 6,
                borderBottomWidth: 1,
                borderBottomColor: colors.hairline,
                marginBottom: 8,
              }}
            >
              <Text style={zoneLabel}>Batter</Text>
              <View style={{ flexDirection: "row", gap: 16 }}>
                <Text style={[zoneLabel, { width: 24, textAlign: "right", fontWeight: "600" }]}>
                  R
                </Text>
                <Text style={[zoneLabel, { width: 20, textAlign: "right" }]}>B</Text>
                <Text style={[zoneLabel, { width: 16, textAlign: "right" }]}>4s</Text>
                <Text style={[zoneLabel, { width: 16, textAlign: "right" }]}>6s</Text>
                <Text style={[zoneLabel, { width: 36, textAlign: "right" }]}>SR</Text>
              </View>
            </View>

            {/* Striker */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 4,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    width: 6,
                    height: 14,
                    backgroundColor: colors.accent,
                    borderRadius: 1,
                  }}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 14,
                    fontFamily: FONTS.sans,
                    fontWeight: "600",
                    color: colors.ink,
                    maxWidth: 130,
                  }}
                >
                  {strikerPlayer?.name || "Striker"} *
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
                <Text
                  style={[
                    { width: 24, textAlign: "right", fontWeight: "700", fontSize: 14, color: colors.ink },
                    TNUM,
                  ]}
                >
                  {strikerStat?.runs ?? 0}
                </Text>
                <Text
                  style={[
                    { width: 20, textAlign: "right", fontSize: 12, color: colors.ink2 },
                    TNUM,
                  ]}
                >
                  {strikerStat?.ballsFaced ?? 0}
                </Text>
                <Text
                  style={[
                    { width: 16, textAlign: "right", fontSize: 12, color: colors.ink2 },
                    TNUM,
                  ]}
                >
                  {strikerStat?.fours ?? 0}
                </Text>
                <Text
                  style={[
                    { width: 16, textAlign: "right", fontSize: 12, color: colors.ink2 },
                    TNUM,
                  ]}
                >
                  {strikerStat?.sixes ?? 0}
                </Text>
                <Text
                  style={[
                    { width: 36, textAlign: "right", fontSize: 12, color: colors.ink2 },
                    TNUM,
                  ]}
                >
                  {strikerStat?.strikeRate?.toFixed(1) ?? "0.0"}
                </Text>
              </View>
            </View>

            {/* Non-Striker */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 4,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14 }}>
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 14, color: colors.ink2, maxWidth: 130, fontFamily: FONTS.sans }}
                >
                  {nonStrikerPlayer?.name || "Non-Striker"}
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
                <Text
                  style={[
                    { width: 24, textAlign: "right", fontWeight: "700", fontSize: 14, color: colors.ink },
                    TNUM,
                  ]}
                >
                  {nonStrikerStat?.runs ?? 0}
                </Text>
                <Text
                  style={[
                    { width: 20, textAlign: "right", fontSize: 12, color: colors.ink2 },
                    TNUM,
                  ]}
                >
                  {nonStrikerStat?.ballsFaced ?? 0}
                </Text>
                <Text
                  style={[
                    { width: 16, textAlign: "right", fontSize: 12, color: colors.ink2 },
                    TNUM,
                  ]}
                >
                  {nonStrikerStat?.fours ?? 0}
                </Text>
                <Text
                  style={[
                    { width: 16, textAlign: "right", fontSize: 12, color: colors.ink2 },
                    TNUM,
                  ]}
                >
                  {nonStrikerStat?.sixes ?? 0}
                </Text>
                <Text
                  style={[
                    { width: 36, textAlign: "right", fontSize: 12, color: colors.ink2 },
                    TNUM,
                  ]}
                >
                  {nonStrikerStat?.strikeRate?.toFixed(1) ?? "0.0"}
                </Text>
              </View>
            </View>
          </View>

          {/* Bowler Strip */}
          <View
            style={{
              width: "100%",
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              padding: 12,
              marginBottom: 8,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={zoneLabel}>Bowl</Text>
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: colors.ink,
                  fontFamily: FONTS.sans,
                  maxWidth: 140,
                }}
              >
                {bowlerPlayer?.name || "Bowler"}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Text style={[{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans }, TNUM]}>
                {formatOvers(bowlerStat?.legalBalls ?? 0)} ov
              </Text>
              <Text style={[{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans }, TNUM]}>
                {bowlerStat?.maidens ?? 0} m
              </Text>
              <Text style={[{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans }, TNUM]}>
                {bowlerStat?.runsConceded ?? 0} r
              </Text>
              <Text
                style={[
                  { fontSize: 12, fontWeight: "700", color: colors.ink, fontFamily: FONTS.sans },
                  TNUM,
                ]}
              >
                {bowlerStat?.wickets ?? 0} w
              </Text>
              <Text style={[{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans }, TNUM]}>
                econ {bowlerStat?.economy?.toFixed(1) ?? "0.0"}
              </Text>
            </View>
          </View>

          {/* Over Ribbon */}
          <View
            style={{
              width: "100%",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 6,
              marginBottom: 8,
            }}
          >
            <Text style={zoneLabel}>This Over</Text>
            <OverRibbon balls={ribbonBalls} />
          </View>
        </View>

        {/* Thumb Zone Scoring Pad (Bottom 45%) */}
        <View
          style={{
            width: "100%",
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.hairlineStrong,
            padding: 12,
            // RN: web's pb-safe bottom inset is handled by the root SafeAreaView
          }}
        >
          {/* Pad Header: Undo & Strike Swap */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <Pressable
              onPress={handleUndo}
              disabled={ballEvents.length === 0}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 12,
                paddingVertical: 6,
                opacity: ballEvents.length === 0 ? 0.3 : pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <RotateCcw size={14} strokeWidth={1.5} color={colors.ink2} />
              <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }}>
                Undo Last Ball
              </Text>
            </Pressable>

            <Pressable
              onPress={handleSwapStriker}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 12,
                paddingVertical: 6,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <ArrowLeftRight size={14} strokeWidth={1.5} color={colors.ink2} />
              <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }}>
                Swap Strike
              </Text>
            </Pressable>
          </View>

          {/* Grid of Big Runs: 0, 1, 2, 3, 4, 6 */}
          <View
            style={{
              flexDirection: isLeftHandPad ? "row-reverse" : "row",
              gap: 8,
              marginBottom: 10,
            }}
          >
            {[0, 1, 2, 3, 4, 6].map((run) => {
              const isBoundary = run === 4 || run === 6;
              return (
                <RunKey
                  key={run}
                  label={`${run}`}
                  isBoundary={isBoundary}
                  onPress={() => recordBall(run)}
                />
              );
            })}
          </View>

          {/* Extras Row: Wd, Nb, Bye, LB, +Custom */}
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
            <Pressable
              onPress={() => recordBall(0, "wide", match.rules.wideRunValue)}
              style={({ pressed }) => ({
                flex: 1,
                height: 44,
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                backgroundColor: colors.surfaceCard,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Text style={{ fontSize: 12, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink }}>
                Wd
              </Text>
              <Text style={[{ fontSize: 9, color: colors.ink2 }, TNUM]}>
                +{match.rules.wideRunValue}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => recordBall(0, "no_ball", match.rules.noBallRunValue)}
              style={({ pressed }) => ({
                flex: 1,
                height: 44,
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                backgroundColor: colors.surfaceCard,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Text style={{ fontSize: 12, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink }}>
                Nb
              </Text>
              <Text style={[{ fontSize: 9, color: colors.ink2 }, TNUM]}>
                +{match.rules.noBallRunValue}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => recordBall(0, "bye", 1)}
              style={({ pressed }) => ({
                flex: 1,
                height: 44,
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                backgroundColor: colors.surfaceCard,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Text style={{ fontSize: 12, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink }}>
                Bye
              </Text>
              <Text style={{ fontSize: 9, color: colors.ink2 }}>+1</Text>
            </Pressable>

            <Pressable
              onPress={() => recordBall(0, "leg_bye", 1)}
              style={({ pressed }) => ({
                flex: 1,
                height: 44,
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                backgroundColor: colors.surfaceCard,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Text style={{ fontSize: 12, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink }}>
                LB
              </Text>
              <Text style={{ fontSize: 9, color: colors.ink2 }}>+1</Text>
            </Pressable>

            <Pressable
              onPress={() => setShowCustomRunsModal(true)}
              style={({ pressed }) => ({
                flex: 1,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                backgroundColor: colors.surfaceCard,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <Text style={{ fontSize: 12, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink }}>
                5 / +Run
              </Text>
            </Pressable>
          </View>

          {/* Primary Action Row: WICKET (Ball Crimson) + More */}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => {
                setWicketStep("type");
                setShowWicketSheet(true);
              }}
              style={({ pressed }) => ({
                flex: 3,
                height: 56,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.accent,
                borderRadius: 10,
                opacity: pressed ? 0.9 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
                // shadow-sm
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.2,
                shadowRadius: 2,
                elevation: 2,
              })}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontFamily: FONTS.serif,
                  fontWeight: "700",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: "#FFFFFF",
                }}
              >
                WICKET
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setShowMoreActionsSheet(true)}
              style={({ pressed }) => ({
                flex: 1,
                height: 56,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                backgroundColor: colors.surfaceCard,
                opacity: pressed ? 0.85 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}
            >
              <View style={{ flexDirection: "column", alignItems: "center" }}>
                <Text
                  style={{ fontSize: 12, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink }}
                >
                  More
                </Text>
                <Text style={{ fontSize: 9, color: colors.ink2 }}>Actions</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* --- PROGRESSIVE WICKET SHEET --- */}
      <GullySheet
        isOpen={showWicketSheet}
        onClose={() => setShowWicketSheet(false)}
        title="Record Dismissal"
      >
        {wicketStep === "type" && (
          <View style={{ flexDirection: "column", gap: 12 }}>
            <Text style={sheetLabel}>Select Dismissal Type</Text>
            <View style={{ flexDirection: "column", gap: 8 }}>
              {chunked(
                [
                  { type: "bowled", label: "Bowled" },
                  { type: "caught", label: "Caught" },
                  { type: "caught_behind", label: "Caught Behind †" },
                  { type: "caught_bowled", label: "Caught & Bowled" },
                  { type: "lbw", label: "LBW" },
                  { type: "run_out", label: "Run Out" },
                  { type: "stumped", label: "Stumped †" },
                  { type: "hit_wicket", label: "Hit Wicket" },
                  { type: "retired_out", label: "Retired Out" },
                  { type: "retired_hurt", label: "Retired Hurt (Not Out)" },
                ],
                2
              ).map((row, rowIndex) => (
                <View key={rowIndex} style={{ flexDirection: "row", gap: 8 }}>
                  {row.map((opt) => (
                    <Pressable
                      key={opt.type}
                      onPress={() => {
                        setSelectedWicketType(opt.type as WicketType);
                        if (
                          opt.type === "caught" ||
                          opt.type === "caught_behind" ||
                          opt.type === "run_out" ||
                          opt.type === "stumped"
                        ) {
                          setWicketStep("fielder");
                        } else if (opt.type === "retired_hurt") {
                          // Retired hurt doesn't count as a wicket
                          recordBall(0, "none", 0, {
                            type: "retired_hurt",
                            dismissedPlayerId: strikerId,
                            dismissedEnd: "striker",
                            fielderIds: [],
                            runsCompleted: 0,
                          });
                          setShowWicketSheet(false);
                        } else {
                          setWicketStep("next_batter");
                        }
                      }}
                      style={({ pressed }) => ({
                        flex: 1,
                        padding: 12,
                        borderWidth: 1,
                        borderRadius: 10,
                        alignItems: "flex-start",
                        opacity: pressed ? 0.85 : 1,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                        ...(selectedWicketType === opt.type
                          ? {
                              borderColor: colors.accent,
                              backgroundColor: colors.accentSubtle,
                            }
                          : { borderColor: colors.hairlineStrong }),
                      })}
                    >
                      <Text
                        style={{
                          fontFamily: FONTS.sans,
                          fontSize: 14,
                          textAlign: "left",
                          color: colors.ink,
                          fontWeight: selectedWicketType === opt.type ? "600" : "400",
                        }}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          </View>
        )}

        {wicketStep === "fielder" && (
          <View style={{ flexDirection: "column", gap: 12 }}>
            <Text style={sheetLabel}>Select Fielder(s)</Text>
            <ScrollView
              style={{ maxHeight: 224 }}
              contentContainerStyle={{ flexDirection: "column", gap: 6 }}
              nestedScrollEnabled
            >
              {bowlingSquadIds.map((pId) => {
                const p = playersMap[pId];
                const isSelected = selectedFielderIds.includes(pId);
                return (
                  <Pressable
                    key={pId}
                    onPress={() => {
                      if (selectedWicketType === "run_out") {
                        // Allow multiple for run out
                        setSelectedFielderIds((prev) =>
                          prev.includes(pId) ? prev.filter((id) => id !== pId) : [...prev, pId]
                        );
                      } else {
                        setSelectedFielderIds([pId]);
                      }
                    }}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: 10,
                      borderWidth: 1,
                      borderRadius: 10,
                      opacity: pressed ? 0.85 : 1,
                      ...(isSelected
                        ? {
                            borderColor: colors.accent,
                            backgroundColor: colors.accentSubtle,
                          }
                        : { borderColor: colors.hairline }),
                    })}
                  >
                    <Text
                      style={{
                        fontFamily: FONTS.sans,
                        fontSize: 14,
                        color: colors.ink,
                        fontWeight: isSelected ? "500" : "400",
                      }}
                    >
                      {p?.name || "Player"}
                    </Text>
                    {isSelected && <Check size={16} color={colors.accent} />}
                  </Pressable>
                );
              })}
            </ScrollView>

            {selectedWicketType === "run_out" ? (
              <GullyButton
                variant="primary"
                fullWidth
                onPress={() => setWicketStep("batter")}
                style={{ marginTop: 8 }}
              >
                Next: Who was run out?
              </GullyButton>
            ) : (
              <GullyButton
                variant="primary"
                fullWidth
                onPress={() => setWicketStep("next_batter")}
                style={{ marginTop: 8 }}
              >
                Next: Select New Batter
              </GullyButton>
            )}
          </View>
        )}

        {wicketStep === "batter" && selectedWicketType === "run_out" && (
          <View style={{ flexDirection: "column", gap: 16 }}>
            <Text style={sheetLabel}>Run Out Details</Text>

            <View>
              <Text style={fieldLabel}>Which batter was dismissed?</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                <Pressable
                  onPress={() => {
                    setDismissedBatterId(strikerId);
                    setDismissedEnd("striker");
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    padding: 12,
                    borderWidth: 1,
                    borderRadius: 10,
                    opacity: pressed ? 0.85 : 1,
                    ...(dismissedBatterId === strikerId
                      ? {
                          borderColor: colors.accent,
                          backgroundColor: colors.accentSubtle,
                        }
                      : { borderColor: colors.hairlineStrong }),
                  })}
                >
                  <Text style={{ fontSize: 14, textAlign: "left", color: colors.ink }}>
                    Striker: {strikerPlayer?.name}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setDismissedBatterId(nonStrikerId);
                    setDismissedEnd("non_striker");
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    padding: 12,
                    borderWidth: 1,
                    borderRadius: 10,
                    opacity: pressed ? 0.85 : 1,
                    ...(dismissedBatterId === nonStrikerId
                      ? {
                          borderColor: colors.accent,
                          backgroundColor: colors.accentSubtle,
                        }
                      : { borderColor: colors.hairlineStrong }),
                  })}
                >
                  <Text style={{ fontSize: 14, textAlign: "left", color: colors.ink }}>
                    Non-Striker: {nonStrikerPlayer?.name}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View>
              <Text style={fieldLabel}>Runs completed before run out:</Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                {[0, 1, 2, 3].map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => setRunOutCompletedRuns(r)}
                    style={({ pressed }) => ({
                      flex: 1,
                      paddingVertical: 8,
                      borderWidth: 1,
                      borderRadius: 8,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: pressed ? 0.85 : 1,
                      ...(runOutCompletedRuns === r
                        ? {
                            borderColor: colors.accent,
                            backgroundColor: colors.accentSubtle,
                          }
                        : { borderColor: colors.hairline }),
                    })}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontFamily: FONTS.serif,
                        color: colors.ink,
                        fontWeight: runOutCompletedRuns === r ? "700" : "400",
                      }}
                    >
                      {r}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <GullyButton
              variant="primary"
              fullWidth
              onPress={() => setWicketStep("next_batter")}
            >
              Next: Select New Batter
            </GullyButton>
          </View>
        )}

        {wicketStep === "next_batter" && (
          <View style={{ flexDirection: "column", gap: 12 }}>
            <Text style={sheetLabel}>Select Incoming Batter</Text>
            <ScrollView
              style={{ maxHeight: 224 }}
              contentContainerStyle={{ flexDirection: "column", gap: 6 }}
              nestedScrollEnabled
            >
              {availableNextBatters.length === 0 ? (
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    paddingVertical: 8,
                    fontStyle: "italic",
                  }}
                >
                  No more batters available (Innings completed or all out).
                </Text>
              ) : (
                availableNextBatters.map((pId) => {
                  const p = playersMap[pId];
                  const isSelected = selectedNextBatterId === pId;
                  return (
                    <Pressable
                      key={pId}
                      onPress={() => setSelectedNextBatterId(pId)}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: 10,
                        borderWidth: 1,
                        borderRadius: 10,
                        opacity: pressed ? 0.85 : 1,
                        ...(isSelected
                          ? {
                              borderColor: colors.accent,
                              backgroundColor: colors.accentSubtle,
                            }
                          : { borderColor: colors.hairline }),
                      })}
                    >
                      <Text
                        style={{
                          fontFamily: FONTS.sans,
                          fontSize: 14,
                          color: colors.ink,
                          fontWeight: isSelected ? "500" : "400",
                        }}
                      >
                        {p?.name || "Player"}
                      </Text>
                      {isSelected && <Check size={16} color={colors.accent} />}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <GullyButton
              variant="accent"
              fullWidth
              disabled={availableNextBatters.length > 0 && !selectedNextBatterId}
              onPress={handleConfirmWicket}
              style={{ marginTop: 8 }}
            >
              Confirm Wicket
            </GullyButton>
          </View>
        )}
      </GullySheet>

      {/* --- NEXT BOWLER SHEET (END OF OVER) --- */}
      <GullySheet
        isOpen={showNextBowlerSheet || isOverComplete}
        onClose={() => setShowNextBowlerSheet(false)}
        title="Select Bowler for Next Over"
      >
        <View style={{ flexDirection: "column", gap: 8 }}>
          <Text style={sheetLabel}>Bowling Team: {bowlingTeam?.name}</Text>
          <ScrollView
            style={{ maxHeight: 256 }}
            contentContainerStyle={{ flexDirection: "column", gap: 6 }}
            nestedScrollEnabled
          >
            {eligibleBowlers.map((item) => (
              <Pressable
                key={item.playerId}
                disabled={!item.isEligible}
                onPress={() => handleSelectNextBowler(item.playerId)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: 12,
                  borderWidth: 1,
                  borderRadius: 10,
                  opacity: item.isEligible ? (pressed ? 0.85 : 1) : 0.4,
                  ...(item.isEligible
                    ? { borderColor: colors.hairlineStrong }
                    : { borderColor: colors.hairline, backgroundColor: colors.bg }),
                })}
              >
                <View style={{ flexDirection: "column", alignItems: "flex-start" }}>
                  <Text
                    style={{
                      fontFamily: FONTS.sans,
                      fontSize: 14,
                      fontWeight: "500",
                      color: colors.ink,
                    }}
                  >
                    {item.player?.name}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.ink2 }}>
                    {item.oversBowled.toFixed(1)} ov bowled
                    {!item.isEligible && ` · ${item.ineligibleReason}`}
                  </Text>
                </View>
                {item.isEligible && (
                  <Text style={{ fontSize: 12, color: colors.accent, fontWeight: "600" }}>
                    Select
                  </Text>
                )}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </GullySheet>

      {/* --- BALL LOG & REPLAY SHEET --- */}
      {/* RN: dropped web's maxHeight="max-h-[90vh]" sheet prop (GullySheet clamps itself). */}
      <GullySheet
        isOpen={showBallLogSheet}
        onClose={() => setShowBallLogSheet(false)}
        title="Ball-by-Ball Log & Replay"
      >
        <View style={{ flexDirection: "column", gap: 8 }}>
          <Text style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans }}>
            Inspect, edit, or delete any past ball. GullyScore will automatically recompute the
            entire innings by pure deterministic replay.
          </Text>

          <ScrollView
            style={{ maxHeight: 384, marginTop: 8 }}
            contentContainerStyle={{ flexDirection: "column", gap: 8 }}
            nestedScrollEnabled
          >
            {ballEvents.slice().reverse().map((ball) => {
              const str = playersMap[ball.strikerId]?.name || "Striker";
              const bwl = playersMap[ball.bowlerId]?.name || "Bowler";
              return (
                <View
                  key={ball.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: 10,
                    borderWidth: 1,
                    borderColor: colors.hairline,
                    borderRadius: 8,
                    backgroundColor: colors.surface,
                  }}
                >
                  <View style={{ flexDirection: "column", flex: 1, paddingRight: 8 }}>
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: "600",
                        color: colors.ink,
                        fontFamily: FONTS.sans,
                      }}
                    >
                      Over {ball.overNumber}.{ball.ballInOver} — {ball.commentaryText}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.ink2 }}>
                      {str} facing {bwl} · {ball.runsBat} run(s)
                      {ball.extraType !== "none" && ` (${ball.extraType})`}
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Pressable
                      onPress={() => {
                        // Delete this specific ball and recompute
                        const updated = ballEvents.filter((b) => b.id !== ball.id);
                        const updatedInnings = [...match.innings];
                        updatedInnings[currentInningsIndex] = {
                          ...currentInningsData,
                          ballEvents: updated,
                        };
                        db.saveMatch({ ...match, innings: updatedInnings });
                      }}
                      style={({ pressed }) => ({
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text style={{ fontSize: 12, color: colors.accent }}>Delete</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </GullySheet>

      {/* --- WAGON WHEEL SHOT DIRECTION PICKER MODAL --- */}
      {showWagonWheelModal && (
        <CenteredModal
          visible
          onRequestClose={() => {
            setShowWagonWheelModal(false);
            setPendingWagonBall(null);
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 384,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairlineStrong,
              borderRadius: 16,
              padding: 20,
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <Text
              style={[
                {
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  fontWeight: "600",
                  color: colors.ink2,
                  marginBottom: 4,
                },
              ]}
            >
              Track Shot Direction
            </Text>
            <Text
              style={{
                fontSize: 14,
                fontFamily: FONTS.serif,
                fontWeight: "500",
                color: colors.ink,
                marginBottom: 12,
              }}
            >
              Where was that boundary hit?
            </Text>

            {/* Circular Shot Direction Selector */}
            <View style={{ flexDirection: "column", gap: 8, width: "100%", marginBottom: 16 }}>
              {chunked(
                [
                  { dir: "third_man", label: "Third Man" },
                  { dir: "straight", label: "Straight" },
                  { dir: "fine_leg", label: "Fine Leg" },
                  { dir: "point", label: "Point" },
                  { dir: "pitch", label: "Defended" },
                  { dir: "square_leg", label: "Square Leg" },
                  { dir: "cover", label: "Cover" },
                  { dir: "long_off", label: "Long Off" },
                  { dir: "mid_wicket", label: "Mid Wicket" },
                ],
                3
              ).map((row, rowIndex) => (
                <View key={rowIndex} style={{ flexDirection: "row", gap: 8 }}>
                  {row.map((item) => (
                    <Pressable
                      key={item.dir}
                      onPress={() => handleSaveShotDirection(item.dir as ShotDirection)}
                      style={({ pressed }) => ({
                        flex: 1,
                        height: 44,
                        padding: 4,
                        borderWidth: 1,
                        borderColor: pressed ? colors.accent : colors.hairlineStrong,
                        borderRadius: 8,
                        backgroundColor: colors.surfaceCard,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: pressed ? 0.85 : 1,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      })}
                    >
                      <Text
                        style={{ fontSize: 11, fontFamily: FONTS.sans, color: colors.ink, textAlign: "center" }}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>

            <GullyButton
              variant="text"
              size="sm"
              onPress={() => {
                setShowWagonWheelModal(false);
                setPendingWagonBall(null);
              }}
            >
              Skip (One Tap)
            </GullyButton>
          </View>
        </CenteredModal>
      )}

      {/* --- CUSTOM RUNS MODAL --- */}
      {showCustomRunsModal && (
        <CenteredModal visible onRequestClose={() => setShowCustomRunsModal(false)}>
          <View
            style={{
              width: "100%",
              maxWidth: 320,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairlineStrong,
              borderRadius: 16,
              padding: 20,
              flexDirection: "column",
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontFamily: FONTS.serif,
                fontWeight: "500",
                color: colors.ink,
                marginBottom: 12,
              }}
            >
              Enter Custom Runs
            </Text>
            <GullyTextField
              label="Runs Scored"
              value={customRunsValue}
              onChangeText={setCustomRunsValue}
              keyboardType="number-pad"
              tabular
            />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
              <GullyButton
                variant="quiet"
                fullWidth
                onPress={() => setShowCustomRunsModal(false)}
              >
                Cancel
              </GullyButton>
              <GullyButton
                variant="primary"
                fullWidth
                onPress={() => {
                  const runs = parseInt(customRunsValue, 10) || 0;
                  recordBall(runs);
                  setShowCustomRunsModal(false);
                }}
              >
                Confirm
              </GullyButton>
            </View>
          </View>
        </CenteredModal>
      )}

      {/* --- MORE ACTIONS SHEET --- */}
      <GullySheet
        isOpen={showMoreActionsSheet}
        onClose={() => setShowMoreActionsSheet(false)}
        title="Match Adjustments"
      >
        <View style={{ flexDirection: "column", gap: 8 }}>
          <Pressable
            onPress={() => {
              recordBall(0, "penalty", 5);
              setShowMoreActionsSheet(false);
            }}
            style={({ pressed }) => ({
              padding: 12,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              alignItems: "flex-start",
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <Text style={{ fontSize: 14, fontFamily: FONTS.sans, color: colors.ink, textAlign: "left" }}>
              Award 5 Penalty Runs
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setShowNextBowlerSheet(true);
              setShowMoreActionsSheet(false);
            }}
            style={({ pressed }) => ({
              padding: 12,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              alignItems: "flex-start",
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <Text style={{ fontSize: 14, fontFamily: FONTS.sans, color: colors.ink, textAlign: "left" }}>
              Change Bowler Mid-Over (Injured/Tactical)
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              onViewScorecard(matchId);
              setShowMoreActionsSheet(false);
            }}
            style={({ pressed }) => ({
              padding: 12,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              alignItems: "flex-start",
              opacity: pressed ? 0.85 : 1,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            })}
          >
            <Text style={{ fontSize: 14, fontFamily: FONTS.sans, color: colors.ink, textAlign: "left" }}>
              View Full Scorecard & Commentary
            </Text>
          </Pressable>
        </View>
      </GullySheet>

      {/* --- PREDICTION & PROJECTED SCORE SHEET --- */}
      <GullySheet
        isOpen={showPredictionSheet}
        onClose={() => setShowPredictionSheet(false)}
        title="Live Prediction & Projections"
      >
        <View style={{ flexDirection: "column", gap: 16 }}>
          {/* Win Probability Section */}
          <View
            style={{
              padding: 14,
              backgroundColor: colors.surfaceCard,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Text style={cardLabel}>Live Win Probability Model</Text>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: FONTS.serif,
                  fontWeight: "700",
                  color: colors.ink,
                }}
              >
                {teamA?.shortName}: {winProbability.teamAWinProb}%
              </Text>
              <Text style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans }}>vs</Text>
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: FONTS.serif,
                  fontWeight: "700",
                  color: colors.ink,
                }}
              >
                {winProbability.teamBWinProb}% :{teamB?.shortName}
              </Text>
            </View>
            <View
              style={{
                width: "100%",
                height: 8,
                backgroundColor: colors.hairline,
                borderRadius: 2,
                overflow: "hidden",
                flexDirection: "row",
              }}
            >
              <View
                style={{
                  width: `${winProbability.teamAWinProb}%`,
                  backgroundColor: teamA?.color || "#0E1B2E",
                  height: "100%",
                }}
              />
              <View
                style={{
                  width: `${winProbability.teamBWinProb}%`,
                  backgroundColor: teamB?.color || "#B4232A",
                  height: "100%",
                }}
              />
            </View>
            <Text style={{ fontSize: 11, color: colors.ink2, marginTop: 4, fontFamily: FONTS.sans }}>
              <Text style={{ fontWeight: "700" }}>Key Factor:</Text> {winProbability.keyFactor}
            </Text>
          </View>

          {/* Projected Score Details */}
          <View
            style={{
              padding: 14,
              backgroundColor: colors.surfaceCard,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              flexDirection: "column",
              gap: 10,
            }}
          >
            <Text style={cardLabel}>Innings Total Projections (1st Innings)</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View
                style={{
                  flex: 1,
                  padding: 8,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 6,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 10, color: colors.ink2 }}>Conservative</Text>
                <Text
                  style={[
                    { fontSize: 16, fontWeight: "700", fontFamily: FONTS.serif, color: colors.ink },
                    TNUM,
                  ]}
                >
                  {projectedScore.projectedMin}
                </Text>
              </View>
              <View
                style={{
                  flex: 1,
                  padding: 8,
                  borderWidth: 1,
                  borderColor: colors.accent,
                  backgroundColor: colors.accentSubtle,
                  borderRadius: 6,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 10, color: colors.accent, fontWeight: "600" }}>
                  Median Projected
                </Text>
                <Text
                  style={[
                    {
                      fontSize: 16,
                      fontWeight: "700",
                      fontFamily: FONTS.serif,
                      color: colors.accent,
                    },
                    TNUM,
                  ]}
                >
                  {projectedScore.projectedMedian}
                </Text>
              </View>
              <View
                style={{
                  flex: 1,
                  padding: 8,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 6,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 10, color: colors.ink2 }}>Accelerated Max</Text>
                <Text
                  style={[
                    { fontSize: 16, fontWeight: "700", fontFamily: FONTS.serif, color: colors.ink },
                    TNUM,
                  ]}
                >
                  {projectedScore.projectedMax}
                </Text>
              </View>
            </View>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingTop: 4,
                borderTopWidth: 1,
                borderTopColor: colors.hairline,
              }}
            >
              <Text style={{ fontSize: 11, color: colors.ink2, fontFamily: FONTS.sans }}>
                Par Score: {projectedScore.parScore} runs
              </Text>
              <Text style={{ fontSize: 11, color: colors.ink2, fontFamily: FONTS.sans }}>
                Death-Overs Index: {(projectedScore.accelerationFactor * 100).toFixed(0)}%
              </Text>
            </View>
          </View>

          {/* Batter Milestone Projections */}
          <View
            style={{
              padding: 14,
              backgroundColor: colors.surfaceCard,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Text style={cardLabel}>Batters Projected Output</Text>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingVertical: 4,
                borderBottomWidth: 1,
                borderBottomColor: colors.hairline,
              }}
            >
              <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink }}>
                {strikerPlayer?.name} (Striker)
              </Text>
              <Text style={[{ fontSize: 12, fontWeight: "600", color: colors.ink }, TNUM]}>
                Projected ~{strikerMilestone.projectedRuns} runs
              </Text>
            </View>
            {strikerMilestone.nextMilestone && (
              <Text style={{ fontSize: 11, color: colors.ink2, fontFamily: FONTS.sans }}>
                On track for {strikerMilestone.nextMilestone} milestone in ~{strikerMilestone.estimatedBallsToMilestone || "-"} balls ({strikerMilestone.probabilityOfMilestone}% probability based on strike rate).
              </Text>
            )}
          </View>
        </View>
      </GullySheet>

      {/* --- CONFIRM EXIT DIALOG --- */}
      {showConfirmExit && (
        <CenteredModal visible onRequestClose={() => setShowConfirmExit(false)}>
          <View
            style={{
              width: "100%",
              maxWidth: 384,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairlineStrong,
              borderRadius: 16,
              padding: 20,
              flexDirection: "column",
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontFamily: FONTS.serif,
                fontWeight: "600",
                color: colors.ink,
                marginBottom: 8,
              }}
            >
              Leave Live Scoring?
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: colors.ink2,
                fontFamily: FONTS.sans,
                marginBottom: 16,
              }}
            >
              Your match is automatically saved. You can resume scoring at any time from the Home
              screen.
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <GullyButton
                variant="quiet"
                fullWidth
                onPress={() => setShowConfirmExit(false)}
              >
                Stay
              </GullyButton>
              <GullyButton
                variant="primary"
                fullWidth
                onPress={() => {
                  setShowConfirmExit(false);
                  onExit();
                }}
              >
                Leave
              </GullyButton>
            </View>
          </View>
        </CenteredModal>
      )}
    </SafeAreaView>
  );
};
