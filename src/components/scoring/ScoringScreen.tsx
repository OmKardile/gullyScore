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

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
  AudienceModeError,
  MatchLockedError,
  canEdit,
  getAccessState,
  subscribeAccess,
} from "../../storage/access";
import { AccessBanner } from "../access/AccessBanner";
import { UmpireKeySheet, UmpireSheetMode } from "../access/UmpireKeySheet";
import {
  replayInnings,
  formatOvers,
  generateBallCommentary,
  deriveLiveCrease,
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

/** Human one-liner for a scored/recorded ball — used by the activity log. */
function ballSentence(b: BallEvent): string {
  const over = `${b.overNumber + 1}.${b.ballInOver}`;
  if (b.wicket) {
    return `took a wicket (${b.wicket.type.replace(/_/g, " ")}) — over ${over}`;
  }
  if (b.extraType === "wide") {
    return `recorded a wide${b.runsBat ? ` +${b.runsBat} run(s)` : ""} — over ${over}`;
  }
  if (b.extraType === "no_ball") {
    return `recorded a no-ball${b.runsBat ? ` +${b.runsBat} run(s)` : ""} — over ${over}`;
  }
  if (b.extraType === "bye" || b.extraType === "leg_bye") {
    return `recorded ${b.extraRuns} ${b.extraType === "leg_bye" ? "leg-bye" : "bye"}${b.extraRuns === 1 ? "" : "s"} — over ${over}`;
  }
  if (b.runsBat === 4) return `scored FOUR — over ${over}`;
  if (b.runsBat === 6) return `scored SIX — over ${over}`;
  return `scored ${b.runsBat} run${b.runsBat === 1 ? "" : "s"} — over ${over}`;
}

/** Split an array into fixed-size rows — RN replacement for CSS grid-cols-*. */
function chunked<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

/** Centered overlay dialog — RN port of the web's `fixed inset-0 z-50` modals.
 * The backdrop is a DISMISSABLE sibling Pressable: tapping outside the dialog
 * calls onRequestClose (web users previously tapped the dark area, nothing
 * happened, and the screen read as "stuck"). */
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
      }}
    >
      <Pressable
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "rgba(0,0,0,0.6)" }, // bg-black/60
        ]}
        onPress={() => onRequestClose?.()}
      />
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

/** Human explanation for a db write failure — shown in the inline error
 * banner so a failed save is never silent (and never crashes the app). */
function explainDbError(e: unknown): string {
  if (e instanceof AudienceModeError) {
    return "your umpire session ended. Re-enter the umpire key to keep scoring.";
  }
  if (e instanceof MatchLockedError) {
    return "this match is completed and locked. Reopen it from the scorecard to edit.";
  }
  return e instanceof Error ? e.message : "something went wrong while saving.";
}

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

  // ── Save-error banner (1.4.7-test-3): every failed db write is shown here,
  //  explained in plain words — no silent failures, no crashes.
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    if (!saveError) return;
    const t = setTimeout(() => setSaveError(null), 7000);
    return () => clearTimeout(t);
  }, [saveError]);

  /** True once the user has scored/edited anything THIS screen session —
   *  guards the auto-end effect so a REOPENED match (whose innings is
   *  already complete at mount) is never silently re-completed before the
   *  user has actually corrected something. */
  const sessionEditedRef = useRef(false);

  // Start-of-innings openers + opening bowler sheet (1.4.7-test-3)
  const [showOpenersSheet, setShowOpenersSheet] = useState(false);
  const [openersStrikerId, setOpenersStrikerId] = useState("");
  const [openersNonStrikerId, setOpenersNonStrikerId] = useState("");
  const [openersBowlerId, setOpenersBowlerId] = useState("");
  const openersArmedForRef = useRef<number | null>(null);

  // Legacy-data rescue: a pre-1.4.7-test-3 log that ends on a wicket has no record
  // of who came in — ask once, then persist the crease.
  const [replacementOnly, setReplacementOnly] = useState(false);
  const incomingArmedRef = useRef(false);

  // Custom runs modal validation
  const [customRunsError, setCustomRunsError] = useState<string | null>(null);

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
      const m = db.getMatch(matchId);
      // Keep the last snapshot if the row vanished (deleted / cloud tombstone
      // mid-scoring): switching to undefined takes the early-return path and
      // skips the hooks after it — React "fewer hooks" crash + ErrorBoundary.
      if (m) setMatch(m);
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

  // Active batter & bowler determination (1.4.7-test-3):
  //  1. the persisted crease state on the innings (authoritative — written
  //     by every scoring action),
  //  2. a deterministic derivation from the event log (pre-1.4.7-test-3 matches),
  //  3. squad-order defaults.
  // Before this, striker/bowler came from the LAST BALL only, so strike
  // rotation, incoming batters and bowler changes were never reflected.
  const lastBall = ballEvents[ballEvents.length - 1];
  const derivedCrease = useMemo(
    () => deriveLiveCrease(ballEvents, match.rules, battingSquadIds, bowlingSquadIds),
    [ballEvents, match.rules, battingSquadIds, bowlingSquadIds]
  );
  const strikerId =
    currentInningsData.strikerId || derivedCrease?.strikerId || battingSquadIds[0] || "";
  const nonStrikerId =
    currentInningsData.nonStrikerId || derivedCrease?.nonStrikerId || battingSquadIds[1] || "";
  const bowlerId =
    currentInningsData.bowlerId || derivedCrease?.bowlerId || bowlingSquadIds[0] || "";

  const strikerPlayer = playersMap[strikerId];
  const nonStrikerPlayer = playersMap[nonStrikerId];
  const bowlerPlayer = playersMap[bowlerId];

  const strikerStat = scorecard.batters.find((b) => b.playerId === strikerId);
  const nonStrikerStat = scorecard.batters.find((b) => b.playerId === nonStrikerId);
  const bowlerStat = scorecard.bowlers.find((b) => b.playerId === bowlerId);

  // Eligible bowlers for the next over (computed before recordBall so the
  // recorder can consume the user's pick / auto-pick a legal bowler).
  // `ballEvents.length > 0` guard: at the start of an innings there is no
  // "previous over", so squad member #1 must not be flagged as consecutive.
  // Consecutive-ness is judged against the bowler of the LAST RECORDED BALL
  // (an over-end pick in the sheet already wrote the NEXT bowler into the
  // crease state — that must not make the new bowler look consecutive).
  const lastOverBowlerId = lastBall?.bowlerId || "";
  const eligibleBowlers = bowlingSquadIds.map((pId) => {
    const stat = scorecard.bowlers.find((b) => b.playerId === pId);
    const oversBowled = stat ? stat.legalBalls / 6 : 0;
    const isConsecutive =
      match.rules.noConsecutiveOvers && ballEvents.length > 0 && lastOverBowlerId === pId;
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

  // Auto end check. The actual innings/match completion save is extracted so
  // the "End now" button on a reopened match can trigger the same path.
  const applyInningsCompletion = useCallback(() => {
    if (currentInningsIndex === 0 && match.innings.length === 1) {
      // Start 2nd innings. The crease state starts empty — the openers sheet
      // fires for the new innings (openersArmedForRef re-arms on index change).
      const nextInnings = {
        battingTeamId: match.innings[0].bowlingTeamId,
        bowlingTeamId: match.innings[0].battingTeamId,
        targetRuns: scorecard.totalRuns + 1,
        ballEvents: [] as BallEvent[],
      };
      const updatedMatch = {
        ...match,
        innings: [...match.innings, nextInnings],
        currentInningsIndex: 1,
      };
      try {
        db.saveMatch(updatedMatch);
      } catch (e) {
        setSaveError(`Couldn't start the 2nd innings — ${explainDbError(e)}`);
      }
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
        resultText = `${bowlingTeam?.name || "The chasing team"} chased target to win by ${wicketsRemaining} wicket(s)`;
        winnerTeamId = currentInningsData.battingTeamId;
      } else if (inn2.totalRuns < inn1.totalRuns) {
        const runMargin = inn1.totalRuns - inn2.totalRuns;
        resultText = `${battingTeam?.name || "The defending team"} won by ${runMargin} run(s)`;
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
      try {
        db.saveMatch(updatedMatch);
        db.logActivity("match_completed", {
          matchId: match.id,
          detail: `completed the match — ${resultText}`,
          after: resultText,
        });
      } catch (e) {
        setSaveError(`Couldn't record the result — ${explainDbError(e)}`);
      }
    }
  }, [
    currentInningsIndex,
    match,
    scorecard,
    battingTeam?.name,
    bowlingTeam?.name,
    currentInningsData.battingTeamId,
    playersMap,
  ]);

  useEffect(() => {
    // Audience devices never drive innings transitions: a pulled "live +
    // completed scorecard" match (e.g. the umpire's phone died right after
    // the completing ball) must NOT make a viewer's write — the transition
    // arrives with the umpire device's next sync. Guarding here also keeps
    // the gated saveMatch below from throwing inside this effect.
    if (!canEdit()) return;
    if (scorecard.isCompleted && match.status === "live") {
      // Reopen guard (1.4.7-test-3): a reopened match MOUNTS with an already-complete
      // innings. Completing it again before the user has corrected anything
      // would instantly re-lock the match (the reported "reopen does nothing"
      // bug). Wait for an actual edit this session; the reading zone shows an
      // "End now" button for a deliberate finish.
      if (!sessionEditedRef.current) return;
      applyInningsCompletion();
    }
  }, [
    scorecard.isCompleted,
    applyInningsCompletion,
    match,
  ]);

  /** True when the innings stands complete but the auto-end is holding off
   *  (reopened match, no edits yet) — drives the notice + "End now" button. */
  const showReopenNotice =
    scorecard.isCompleted && match.status === "live" && !sessionEditedRef.current;

  // Check for end of over prompt (6 legal balls reached)
  const isOverComplete =
    scorecard.legalBallsCount > 0 &&
    scorecard.legalBallsCount % 6 === 0 &&
    ballsInCurrentOver.length === 0 &&
    !scorecard.isCompleted;

  // Auto-open the next-bowler sheet ONCE per completed-over boundary (also
  // on mount when a restored / synced match already sits at X.0 overs).
  // CRITICAL: `isOpen` of the sheet is driven purely by showNextBowlerSheet.
  // The previous `isOpen={showNextBowlerSheet || isOverComplete}` deadlocked
  // the screen: isOverComplete only clears after the NEXT ball is recorded,
  // but the blocking modal itself prevented recording that ball — so tapping
  // a bowler (or Close / backdrop) never dismissed the sheet ("stuck screen").
  const lastOverBoundaryRef = useRef(-1);
  useEffect(() => {
    if (!isOverComplete) {
      // Left the boundary (next ball recorded / undo) — re-arm the prompt.
      if (lastOverBoundaryRef.current !== -1) lastOverBoundaryRef.current = -1;
      return;
    }
    if (
      !showNextBowlerSheet &&
      lastOverBoundaryRef.current !== scorecard.legalBallsCount
    ) {
      lastOverBoundaryRef.current = scorecard.legalBallsCount;
      // Defense in depth: the mandatory bowler sheet takes priority over the
      // optional shot-direction prompt — never stack two blocking overlays
      // (the wagon modal's full-screen backdrop hides this sheet behind a
      // dark layer, which is exactly the "stuck screen" users reported).
      if (showWagonWheelModal) {
        setShowWagonWheelModal(false);
        setPendingWagonBall(null);
      }
      setShowNextBowlerSheet(true);
    }
  }, [isOverComplete, scorecard.legalBallsCount, showNextBowlerSheet, showWagonWheelModal]);

  // Handle recorded ball event.
  // LIVE-STATE RULE: every input is re-read from the db at call time. React
  // state (`match`, `ballEvents`, `scorecard`) updates are async, so a fast
  // tapper could otherwise fire recordBall twice against the SAME stale
  // snapshot — both balls got the same id/seq and overwrote each other, which
  // made the pad silently swallow taps (the "screen hangs" report).
  //
  // CREASE RULE (1.4.7-test-3): who is on strike / who is bowling comes from the
  // persisted innings state first (written by every previous action), then
  // the event-log derivation (pre-1.4.7-test-3 matches), then squad defaults. After
  // the ball, the ROTATED state (odd-run swap, over-end swap, incoming
  // batter, chosen bowler) is written BACK to the innings — this is the fix
  // for "batsman and bowler never change": the rotation used to be computed
  // and thrown away.
  const recordBall = useCallback(
    (
      runsBat: number,
      extraType: ExtraType = "none",
      extraRuns: number = 0,
      wicket?: DismissalInfo,
      shotDirection?: ShotDirection
    ) => {
      if (!canEdit()) return; // audience devices never write (1.4.7)
      const liveMatch = db.getMatch(matchId);
      if (!liveMatch) return;
      // Never mutate a finished/abandoned match (e.g. opened from a stale
      // "Resume" link): scoring a completed match appends balls while the
      // recorded result text/winner stay frozen — corrupted match record.
      if (liveMatch.status !== "live") return;
      const liveInnIdx = liveMatch.currentInningsIndex;
      const liveInn = liveMatch.innings[liveInnIdx];
      if (!liveInn) return;

      const liveEvents = liveInn.ballEvents;
      const liveBattingSquadIds =
        liveInn.battingTeamId === liveMatch.teamAId
          ? liveMatch.teamAPlayerIds
          : liveMatch.teamBPlayerIds;
      const liveBowlingSquadIds =
        liveInn.bowlingTeamId === liveMatch.teamAId
          ? liveMatch.teamAPlayerIds
          : liveMatch.teamBPlayerIds;
      const liveSc = replayInnings(
        liveEvents,
        liveMatch.rules,
        liveBattingSquadIds,
        liveBowlingSquadIds,
        playersMap,
        liveInn.targetRuns,
        liveInn.isSuperOver
      );
      const liveLastBall = liveEvents[liveEvents.length - 1];
      const liveCrease = deriveLiveCrease(
        liveEvents,
        liveMatch.rules,
        liveBattingSquadIds,
        liveBowlingSquadIds
      );
      const liveStrikerId =
        liveInn.strikerId || liveCrease?.strikerId || liveBattingSquadIds[0] || "";
      const liveNonStrikerId =
        liveInn.nonStrikerId || liveCrease?.nonStrikerId || liveBattingSquadIds[1] || "";
      const liveBowlerId =
        liveInn.bowlerId || liveCrease?.bowlerId || liveBowlingSquadIds[0] || "";
      // The bowler of the last RECORDED ball — the consecutive-over rule
      // judges against this, not the crease state (which may already hold
      // the user's pick for the coming over).
      const prevOverBowlerId = liveLastBall?.bowlerId || "";

      const isLegal = extraType !== "wide" && extraType !== "no_ball";
      const isFreeHit =
        !!liveMatch.rules.freeHitOnNoBall && liveLastBall ? liveLastBall.extraType === "no_ball" : false;
      const nextSeq = liveEvents.length + 1;
      const overNum = Math.floor(liveSc.legalBallsCount / 6);
      const ballInOver = (liveSc.legalBallsCount % 6) + 1;

      // Bowler for this ball:
      // - An explicit pick from the bowler sheet (over-end choice, or a
      //   mid-over tactical change) always wins — it is ALSO persisted on
      //   the innings state by handleSelectNextBowler, so it survives
      //   screen remounts; the state fallback below covers that case too.
      // - Otherwise, on the first ball of a new over, auto-pick the first
      //   eligible squad bowler so a quota-locked / just-finished bowler is
      //   never silently re-credited with the next over.
      // - Mid-over continuity falls back to the crease state's bowler.
      // Eligibility is recomputed from the LIVE scorecard, not the stale one.
      const isNewOverStart = liveSc.legalBallsCount % 6 === 0;
      let effectiveBowlerId = selectedNextBowlerId || liveBowlerId;
      if (!selectedNextBowlerId && isNewOverStart) {
        const autoPick = liveBowlingSquadIds
          .map((pId) => {
            const stat = liveSc.bowlers.find((b) => b.playerId === pId);
            const oversBowled = stat ? stat.legalBalls / 6 : 0;
            const isConsecutive =
              liveMatch.rules.noConsecutiveOvers && liveEvents.length > 0 && prevOverBowlerId === pId;
            const reachedMax = oversBowled >= liveMatch.rules.maxOversPerBowler;
            return { playerId: pId, isEligible: !isConsecutive && !reachedMax };
          })
          .find((b) => b.isEligible);
        if (autoPick) effectiveBowlerId = autoPick.playerId;
      }

      const commentary = generateBallCommentary(
        { runsBat, extraType, extraRuns, isLegal, wicket, shotDirection },
        playersMap[liveStrikerId]?.name || "Striker",
        playersMap[effectiveBowlerId]?.name || "Bowler"
      );

      const newBall: BallEvent = {
        id: `ball_${Date.now()}_${nextSeq}_${Math.random().toString(36).slice(2, 8)}`,
        seq: nextSeq,
        inningsIndex: liveInnIdx,
        overNumber: overNum,
        ballInOver,
        strikerId: liveStrikerId,
        nonStrikerId: liveNonStrikerId,
        bowlerId: effectiveBowlerId,
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

      // Determine next striker / non-striker (the crease AFTER this ball)
      let nextStriker = liveStrikerId;
      let nextNonStriker = liveNonStrikerId;

      // Strike rotation logic: odd runs completed swap strike.
      const runsCompleted = wicket ? wicket.runsCompleted : runsBat;
      const totalRunsRan = runsCompleted + (extraType === "bye" || extraType === "leg_bye" ? extraRuns : 0);
      const shouldSwapStrike = totalRunsRan % 2 !== 0;

      if (shouldSwapStrike && nextStriker && nextNonStriker) {
        const tmp = nextStriker;
        nextStriker = nextNonStriker;
        nextNonStriker = tmp;
      }

      // If a wicket fell, the incoming batter replaces the DISMISSED player
      // wherever they sit AFTER the run swap (batters cross on odd runs, so
      // a run-out non-striker can end up at the striker's end).
      if (wicket && selectedNextBatterId) {
        const dismissedId = wicket.dismissedPlayerId;
        if (dismissedId === nextStriker) {
          nextStriker = selectedNextBatterId;
        } else if (dismissedId === nextNonStriker) {
          nextNonStriker = selectedNextBatterId;
        } else if (wicket.dismissedEnd === "striker") {
          nextStriker = selectedNextBatterId;
        } else {
          nextNonStriker = selectedNextBatterId;
        }
      }

      // Check if over ends after this legal ball — ends swap too (not with
      // last-man-batting: there is no partner to swap with).
      const newLegalBallsCount = liveSc.legalBallsCount + (isLegal ? 1 : 0);
      const isEndOfOver = isLegal && newLegalBallsCount % 6 === 0;

      if (isEndOfOver && !liveMatch.rules.lastManBatting && nextStriker && nextNonStriker) {
        const tmp = nextStriker;
        nextStriker = nextNonStriker;
        nextNonStriker = tmp;
      }

      const updatedEvents = [...liveEvents, newBall];
      const updatedInnings = [...liveMatch.innings];
      updatedInnings[liveInnIdx] = {
        ...liveInn,
        ballEvents: updatedEvents,
        // Persist the rotated crease + this ball's bowler — the actual fix
        // for the striker/bowler never changing.
        strikerId: nextStriker,
        nonStrikerId: nextNonStriker,
        bowlerId: effectiveBowlerId,
      };

      const updatedMatch: Match = {
        ...liveMatch,
        innings: updatedInnings,
      };

      try {
        db.saveMatch(updatedMatch);
      } catch (e) {
        // Never crash the pad on a gated save (session expired mid-match,
        // match completed elsewhere): show exactly what happened instead.
        setSaveError(`Couldn't record the ball — ${explainDbError(e)}`);
        return;
      }
      sessionEditedRef.current = true;

      // Activity log (1.4.7): every scoring action, attributed + readable.
      db.logActivity("ball_scored", {
        matchId,
        detail: ballSentence(newBall),
        after: `${newBall.runsBat}${newBall.extraType !== "none" ? ` ${newBall.extraType}` : ""} run(s)`,
      });

      // The explicit bowler choice has been consumed by this ball.
      if (selectedNextBowlerId) setSelectedNextBowlerId("");

      // Trigger Haptics
      if (wicket) triggerHaptic("wicket");
      else if (runsBat === 4) triggerHaptic("double");
      else if (runsBat === 6) triggerHaptic("firm");
      else triggerHaptic("light");

      // Optional wagon wheel prompt if boundary/scoring shot and enabled.
      // SUPPRESSED on the over's last ball: the mandatory next-bowler sheet
      // opens at that moment and the wagon modal's full-screen backdrop used
      // to stack on top of it — the dark overlay hid the bowler sheet and the
      // screen looked frozen until the user found "Skip (One Tap)". The
      // direction can still be set later from the Ball Log.
      if (
        runsBat > 0 &&
        liveMatch.rules.trackShotDirection &&
        !shotDirection &&
        !showWagonWheelModal &&
        !isEndOfOver
      ) {
        setPendingWagonBall(newBall);
        setShowWagonWheelModal(true);
      }

      // Check if bowler needs to be chosen for next over — handled by the
      // isOverComplete auto-open effect above (once per over boundary,
      // always dismissable). No timer-driven forced open here.
    },
    [
      matchId,
      playersMap,
      showWagonWheelModal,
      selectedNextBowlerId,
      selectedNextBatterId,
      triggerHaptic,
    ]
  );

  // Undo last ball — live db read so rapid undos remove exactly one ball
  // per tap (React state is async and would otherwise replay the same slice).
  // The crease BEFORE the removed ball is exactly who faced/bowled that
  // ball — restore it into the innings state so the next ball keeps the
  // right striker/non-striker/bowler.
  const handleUndo = () => {
    if (!canEdit()) return; // audience — the pad is disabled, belt & braces
    const liveMatch = db.getMatch(matchId);
    if (!liveMatch || liveMatch.status !== "live") return;
    const liveInn = liveMatch.innings[liveMatch.currentInningsIndex];
    if (!liveInn || liveInn.ballEvents.length === 0) return;
    const removed = liveInn.ballEvents[liveInn.ballEvents.length - 1];
    const updatedEvents = liveInn.ballEvents.slice(0, -1);
    const updatedInnings = [...liveMatch.innings];
    updatedInnings[liveMatch.currentInningsIndex] = {
      ...liveInn,
      ballEvents: updatedEvents,
      strikerId: removed.strikerId,
      nonStrikerId: removed.nonStrikerId,
      bowlerId: removed.bowlerId,
    };
    try {
      db.saveMatch({ ...liveMatch, innings: updatedInnings });
    } catch (e) {
      setSaveError(`Couldn't undo — ${explainDbError(e)}`);
      return;
    }
    sessionEditedRef.current = true;
    db.logActivity("ball_removed", {
      matchId,
      detail: `undid the last ball — ${ballSentence(removed)}`,
      before: ballSentence(removed),
      correction: true,
    });
    triggerHaptic("undo");
  };

  // Swap striker manually. 1.4.7-test-3: this now flips the PERSISTED crease state
  // only — the old implementation rewrote the last ball's strikerId, which
  // corrupted the scorecard replay (the last ball was re-attributed to the
  // other batter).
  const handleSwapStriker = () => {
    if (!canEdit()) return;
    const liveMatch = db.getMatch(matchId);
    if (!liveMatch || liveMatch.status !== "live") return;
    const liveInn = liveMatch.innings[liveMatch.currentInningsIndex];
    if (!liveInn) return;
    const liveEvents = liveInn.ballEvents;
    const batSquad =
      liveInn.battingTeamId === liveMatch.teamAId
        ? liveMatch.teamAPlayerIds
        : liveMatch.teamBPlayerIds;
    const bowlSquad =
      liveInn.bowlingTeamId === liveMatch.teamAId
        ? liveMatch.teamAPlayerIds
        : liveMatch.teamBPlayerIds;
    const crease = deriveLiveCrease(liveEvents, liveMatch.rules, batSquad, bowlSquad);
    const sId = liveInn.strikerId || crease?.strikerId || batSquad[0] || "";
    const nsId = liveInn.nonStrikerId || crease?.nonStrikerId || batSquad[1] || "";
    if (!sId || !nsId) return; // last-man batting — nothing to swap
    const updatedInnings = [...liveMatch.innings];
    updatedInnings[liveMatch.currentInningsIndex] = {
      ...liveInn,
      strikerId: nsId,
      nonStrikerId: sId,
    };
    try {
      db.saveMatch({ ...liveMatch, innings: updatedInnings });
    } catch (e) {
      setSaveError(`Couldn't swap strike — ${explainDbError(e)}`);
      return;
    }
    sessionEditedRef.current = true;
    db.logActivity("striker_swapped", {
      matchId,
      detail: "swapped striker and non-striker",
      correction: true,
    });
    triggerHaptic("light");
  };

  // Bowler assignment. 1.4.7-test-3: the pick is persisted onto the innings state
  // IMMEDIATELY — the bowler strip updates at once (the "bowler never
  // changed" bug) and the choice survives a screen remount. The next ball
  // records it onto its event.
  const handleSelectNextBowler = (bId: string) => {
    setSelectedNextBowlerId(bId);
    setShowNextBowlerSheet(false);
    if (!canEdit()) return;
    const liveMatch = db.getMatch(matchId);
    if (!liveMatch || liveMatch.status !== "live") return;
    const liveInn = liveMatch.innings[liveMatch.currentInningsIndex];
    if (!liveInn) return;
    const updatedInnings = [...liveMatch.innings];
    updatedInnings[liveMatch.currentInningsIndex] = { ...liveInn, bowlerId: bId };
    try {
      db.saveMatch({ ...liveMatch, innings: updatedInnings });
      db.logActivity("bowler_changed", {
        matchId,
        detail: `set ${playersMap[bId]?.name || "the bowler"} to bowl the next over`,
      });
    } catch (e) {
      setSaveError(`Couldn't set the bowler — ${explainDbError(e)}`);
    }
  };

  // Wicket sheet confirmation. `replacementOnly` mode (legacy pre-1.4.7-test-3
  // matches whose log ends on a wicket) only sets the crease — no new ball.
  const handleConfirmWicket = () => {
    if (replacementOnly) {
      if (!selectedNextBatterId) return;
      if (!canEdit()) {
        resetWicketSheet();
        return;
      }
      const liveMatch = db.getMatch(matchId);
      if (!liveMatch || liveMatch.status !== "live") {
        resetWicketSheet();
        return;
      }
      const liveInn = liveMatch.innings[liveMatch.currentInningsIndex];
      const last = liveInn?.ballEvents[liveInn.ballEvents.length - 1];
      if (!liveInn || !last?.wicket) {
        resetWicketSheet();
        return;
      }
      let striker = liveInn.strikerId || last.strikerId;
      let nonStriker = liveInn.nonStrikerId || last.nonStrikerId;
      const dismissedId = last.wicket.dismissedPlayerId;
      if (dismissedId === striker) striker = selectedNextBatterId;
      else nonStriker = selectedNextBatterId;
      const updatedInnings = [...liveMatch.innings];
      updatedInnings[liveMatch.currentInningsIndex] = {
        ...liveInn,
        strikerId: striker,
        nonStrikerId: nonStriker,
      };
      try {
        db.saveMatch({ ...liveMatch, innings: updatedInnings });
      } catch (e) {
        setSaveError(`Couldn't set the incoming batter — ${explainDbError(e)}`);
        return;
      }
      sessionEditedRef.current = true;
      db.logActivity("crease_set", {
        matchId,
        detail: `set ${playersMap[selectedNextBatterId]?.name || "the incoming batter"} at the crease (recorded before crease tracking)`,
        correction: true,
      });
      resetWicketSheet();
      return;
    }

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
    resetWicketSheet();
  };

  const resetWicketSheet = () => {
    setShowWicketSheet(false);
    // Reset state
    setWicketStep("type");
    setSelectedWicketType("bowled");
    setSelectedFielderIds([]);
    setDismissedBatterId("");
    setDismissedEnd("striker");
    setRunOutCompletedRuns(0);
    setSelectedNextBatterId("");
    setReplacementOnly(false);
  };

  // Save wagon wheel shot direction (live db read — the pending ball is
  // matched against the newest persisted events, never a stale snapshot)
  const handleSaveShotDirection = (dir: ShotDirection) => {
    if (!canEdit()) return; // audience (1.4.7)
    const liveMatch = db.getMatch(matchId);
    if (!liveMatch || liveMatch.status !== "live" || !pendingWagonBall) return;
    const liveInn = liveMatch.innings[liveMatch.currentInningsIndex];
    if (!liveInn) return;
    const updatedEvents = liveInn.ballEvents.map((b) =>
      b.id === pendingWagonBall.id ? { ...b, shotDirection: dir } : b
    );
    const updatedInnings = [...liveMatch.innings];
    updatedInnings[liveMatch.currentInningsIndex] = { ...liveInn, ballEvents: updatedEvents };
    try {
      db.saveMatch({ ...liveMatch, innings: updatedInnings });
    } catch (e) {
      setSaveError(`Couldn't save the shot direction — ${explainDbError(e)}`);
      return;
    }
    sessionEditedRef.current = true;
    setShowWagonWheelModal(false);
    setPendingWagonBall(null);
  };

  // Delete a specific ball from the log (live db read so the edit always
  // applies to the newest state). When the LAST ball is deleted, the crease
  // rolls back to whoever faced/bowled that ball (same rule as Undo).
  const handleDeleteBall = (ball: BallEvent) => {
    if (!canEdit()) return; // audience (1.4.7)
    const liveMatch = db.getMatch(matchId);
    if (!liveMatch || liveMatch.status !== "live") return;
    const liveInn = liveMatch.innings[liveMatch.currentInningsIndex];
    if (!liveInn) return;
    const isLast = liveInn.ballEvents[liveInn.ballEvents.length - 1]?.id === ball.id;
    const updated = liveInn.ballEvents.filter((b) => b.id !== ball.id);
    if (updated.length === liveInn.ballEvents.length) return; // already gone
    const updatedInnings = [...liveMatch.innings];
    updatedInnings[liveMatch.currentInningsIndex] = {
      ...liveInn,
      ballEvents: updated,
      ...(isLast
        ? {
            strikerId: ball.strikerId,
            nonStrikerId: ball.nonStrikerId,
            bowlerId: ball.bowlerId,
          }
        : {}),
    };
    try {
      db.saveMatch({ ...liveMatch, innings: updatedInnings });
    } catch (e) {
      setSaveError(`Couldn't delete the ball — ${explainDbError(e)}`);
      return;
    }
    sessionEditedRef.current = true;
    db.logActivity("ball_removed", {
      matchId,
      detail: `deleted a ball from the log — ${ballSentence(ball)}`,
      before: ballSentence(ball),
      correction: true,
    });
  };

  // Confirm the start-of-innings crease (openers + opening bowler).
  const handleConfirmOpeners = () => {
    if (!canEdit()) {
      setShowOpenersSheet(false);
      return;
    }
    const liveMatch = db.getMatch(matchId);
    if (!liveMatch || liveMatch.status !== "live") {
      setShowOpenersSheet(false);
      return;
    }
    const liveInn = liveMatch.innings[liveMatch.currentInningsIndex];
    if (!liveInn) {
      setShowOpenersSheet(false);
      return;
    }
    const batSquad =
      liveInn.battingTeamId === liveMatch.teamAId
        ? liveMatch.teamAPlayerIds
        : liveMatch.teamBPlayerIds;
    const bowlSquad =
      liveInn.bowlingTeamId === liveMatch.teamAId
        ? liveMatch.teamAPlayerIds
        : liveMatch.teamBPlayerIds;
    let striker = openersStrikerId || batSquad[0] || "";
    let nonStriker = openersNonStrikerId || batSquad[1] || "";
    // Never allow the same player at both ends — fall back to squad order.
    if (nonStriker === striker) {
      nonStriker = batSquad.find((id) => id !== striker) || "";
    }
    const bowler = openersBowlerId || bowlSquad[0] || "";
    const updatedInnings = [...liveMatch.innings];
    updatedInnings[liveMatch.currentInningsIndex] = {
      ...liveInn,
      strikerId: striker,
      nonStrikerId: nonStriker,
      bowlerId: bowler,
    };
    try {
      db.saveMatch({ ...liveMatch, innings: updatedInnings });
    } catch (e) {
      setSaveError(`Couldn't set the openers — ${explainDbError(e)}`);
      return; // keep the sheet open so the user can retry
    }
    db.logActivity("innings_setup", {
      matchId,
      detail: `set ${playersMap[striker]?.name || "the striker"} and ${
        playersMap[nonStriker]?.name || "the non-striker"
      } to open, ${playersMap[bowler]?.name || "the first bowler"} with the ball`,
    });
    setShowOpenersSheet(false);
  };

  // Eligible next batters (those in squad who haven't batted yet)
  const availableNextBatters = battingSquadIds.filter((pId) => {
    const stat = scorecard.batters.find((b) => b.playerId === pId);
    return !stat || (!stat.isOut && pId !== strikerId && pId !== nonStrikerId);
  });

  // Pad is only interactive while the match is live (guards above make every
  // write path no-op on finished matches; this keeps the UI honest too) AND
  // this device may edit (umpire/solo). Audience devices view only (1.4.7).
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
  const canScore = access.mode === "solo" || access.mode === "umpire";

  const isMatchLive = match.status === "live";
  const padEnabled = isMatchLive && canScore;

  const isLeftHandPad = settings.padHand === "left";

  // ── Start-of-innings prompt (1.4.7-test-3) ─────────────────────────────────────
  // A brand-new innings has no crease state: ask once for the opening pair
  // + opening bowler instead of silently defaulting to squad order (which
  // credited the wrong batters/bowler until the user noticed).
  useEffect(() => {
    if (!padEnabled) return;
    const inningsEmpty = ballEvents.length === 0;
    const hasState = !!(currentInningsData.strikerId || currentInningsData.nonStrikerId);
    if (inningsEmpty && !hasState) {
      if (openersArmedForRef.current === currentInningsIndex) return; // already asked
      openersArmedForRef.current = currentInningsIndex;
      setOpenersStrikerId(battingSquadIds[0] || "");
      setOpenersNonStrikerId(battingSquadIds[1] || "");
      setOpenersBowlerId(bowlingSquadIds[0] || "");
      setShowOpenersSheet(true);
    } else if (!inningsEmpty) {
      openersArmedForRef.current = null; // re-arm for the next innings
    }
  }, [
    padEnabled,
    ballEvents.length,
    currentInningsIndex,
    currentInningsData.strikerId,
    currentInningsData.nonStrikerId,
    battingSquadIds,
    bowlingSquadIds,
  ]);

  // ── Legacy-data rescue (1.4.7-test-3) ──────────────────────────────────────────
  // A pre-1.4.7-test-3 event log that ends on a wicket never recorded who came in.
  // Ask once, then persist the crease (no new ball is recorded).
  useEffect(() => {
    const legacyPendingBatter =
      ballEvents.length > 0 &&
      !currentInningsData.strikerId &&
      !!lastBall?.wicket &&
      lastBall.wicket.type !== "retired_hurt" &&
      !scorecard.isCompleted;
    if (
      legacyPendingBatter &&
      !incomingArmedRef.current &&
      !showWicketSheet &&
      !showOpenersSheet
    ) {
      incomingArmedRef.current = true;
      setWicketStep("next_batter");
      setReplacementOnly(true);
      setSelectedNextBatterId("");
      setShowWicketSheet(true);
    }
    if (!legacyPendingBatter) {
      incomingArmedRef.current = false;
    }
  }, [
    ballEvents.length,
    currentInningsData.strikerId,
    lastBall,
    scorecard.isCompleted,
    showWicketSheet,
    showOpenersSheet,
  ]);

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

      {/* Save-error banner (1.4.7-test-3): failed writes are explained, never
          silent, never a crash. Fixed under the header so it stays visible
          while the pad scrolls. */}
      {saveError ? (
        <View
          style={{
            marginHorizontal: 16,
            marginTop: 8,
            padding: 12,
            borderWidth: 1,
            borderRadius: 10,
            borderColor: colors.warning,
            backgroundColor: colors.surface,
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 12,
                fontFamily: FONTS.sansSemiBold,
                color: colors.warning,
              }}
            >
              Couldn't save
            </Text>
            <Text
              style={{
                fontSize: 12,
                fontFamily: FONTS.sans,
                color: colors.ink,
                marginTop: 2,
              }}
            >
              {saveError}
            </Text>
          </View>
          <Pressable
            onPress={() => setSaveError(null)}
            hitSlop={8}
            accessibilityLabel="Dismiss error"
          >
            <X size={16} color={colors.ink2} />
          </Pressable>
        </View>
      ) : null}

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
          {/* Reopen notice (1.4.7-test-3): the innings is complete but the match is
              live again — the auto-end holds off until the user actually
              edits something, so a correction session is never instantly
              re-locked. */}
          {showReopenNotice ? (
            <View
              style={{
                width: "100%",
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.warning,
                borderRadius: 10,
                padding: 12,
                marginBottom: 8,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.sansSemiBold,
                    color: colors.warning,
                  }}
                >
                  Innings complete — match reopened
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: FONTS.sans,
                    color: colors.ink2,
                    marginTop: 2,
                  }}
                >
                  Correct it from the Ball Log, or finish the match for good.
                </Text>
              </View>
              <GullyButton
                variant="primary"
                size="sm"
                onPress={() => {
                  sessionEditedRef.current = true;
                  applyInningsCompletion();
                }}
              >
                End now
              </GullyButton>
            </View>
          ) : null}
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

        {/* Audience-mode banner (1.4.7) — the pad below is inert until the
            umpire key is entered. */}
        {access.spaceConfigured && !canScore ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <AccessBanner
              onEnterKey={() =>
                setKeySheet({ open: true, mode: access.spaceHasKey ? "enter" : "set" })
              }
              onExitUmpire={() => {
                try {
                  db.exitUmpireMode();
                } catch {
                  /* nothing to exit */
                }
              }}
            />
          </View>
        ) : null}

        {/* Thumb Zone Scoring Pad (Bottom 45%) */}
        <View
          pointerEvents={padEnabled ? "auto" : "none"}
          style={{
            width: "100%",
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.hairlineStrong,
            opacity: padEnabled ? 1 : 0.45,
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
          {!isMatchLive ? (
            <View
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 14,
                marginBottom: 10,
                borderWidth: 1,
                borderRadius: 10,
                borderColor: colors.hairlineStrong,
                backgroundColor: colors.surfaceCard,
              }}
            >
              <Text style={{ fontSize: 13, fontFamily: FONTS.sansSemiBold, color: colors.ink }}>
                {match.resultText || "Match completed"}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: FONTS.sans, color: colors.ink2, marginTop: 2 }}>
                Scoring is closed for this match — view the scorecard from Matches.
              </Text>
            </View>
          ) : (
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
                  disabled={!padEnabled}
                  onPress={() => recordBall(run)}
                />
              );
            })}
          </View>
          )}

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
                setReplacementOnly(false);
                setSelectedFielderIds([]);
                setDismissedBatterId("");
                setDismissedEnd("striker");
                setRunOutCompletedRuns(0);
                setSelectedNextBatterId("");
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
        onClose={() => {
          // Dismissing mid-flow is a cancel: clear the selections so a
          // later wicket doesn't inherit stale fielders/batters, and never
          // leave replacementOnly armed.
          resetWicketSheet();
        }}
        title={replacementOnly ? "Set the Crease" : "Record Dismissal"}
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
                        } else {
                          // Every dismissal — including Retired Hurt — needs
                          // a replacement at the crease (the retired batter
                          // stays available to return later since retired-hurt
                          // is not out). The old flow recorded the ball with
                          // the retired batter STILL at the crease.
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
            <Text style={sheetLabel}>
              {selectedWicketType === "retired_hurt"
                ? "Who replaces the retired batter?"
                : "Select Incoming Batter"}
            </Text>
            {selectedWicketType === "retired_hurt" ? (
              <Text style={{ fontSize: 11, color: colors.ink2, fontFamily: FONTS.sans }}>
                Retired hurt is not out — {strikerPlayer?.name || "the batter"} can come back
                later. The replacement takes the crease now.
              </Text>
            ) : null}
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
              disabled={
                !replacementOnly &&
                availableNextBatters.length > 0 &&
                !selectedNextBatterId
              }
              onPress={handleConfirmWicket}
              style={{ marginTop: 8 }}
            >
              {replacementOnly ? "Set the Crease" : "Confirm Wicket"}
            </GullyButton>
          </View>
        )}
      </GullySheet>

      {/* --- NEXT BOWLER SHEET (END OF OVER) --- */}
      {/* isOpen is purely state-driven; the over-boundary effect opens it once. */}
      <GullySheet
        isOpen={showNextBowlerSheet}
        onClose={() => setShowNextBowlerSheet(false)}
        title="Select Bowler for Next Over"
      >
        <View style={{ flexDirection: "column", gap: 8 }}>
          <Text style={sheetLabel}>Bowling Team: {bowlingTeam?.name}</Text>
          {eligibleBowlers.length > 0 && eligibleBowlers.every((b) => !b.isEligible) && (
            <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }}>
              No bowler is eligible under the current quota rules. Close this sheet to
              continue with the previous bowler, or raise the quota in match rules.
            </Text>
          )}
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
                      onPress={() => handleDeleteBall(ball)}
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
              label="Runs Scored (0–36)"
              value={customRunsValue}
              onChangeText={(t) => {
                setCustomRunsValue(t.replace(/[^0-9]/g, ""));
                setCustomRunsError(null);
              }}
              keyboardType="number-pad"
              tabular
            />
            {customRunsError ? (
              <Text
                style={{
                  fontSize: 11,
                  color: colors.warning,
                  fontFamily: FONTS.sans,
                  marginTop: 6,
                }}
              >
                {customRunsError}
              </Text>
            ) : null}
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
                  const runs = parseInt(customRunsValue, 10);
                  if (isNaN(runs) || runs < 0 || runs > 36) {
                    setCustomRunsError(
                      "Enter a number between 0 and 36 (5 and 7 are the usual all-run cases)."
                    );
                    return;
                  }
                  setCustomRunsError(null);
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

      {/* --- START OF INNINGS: OPENERS + OPENING BOWLER SHEET (1.4.7-test-3) --- */}
      <GullySheet
        isOpen={showOpenersSheet}
        onClose={() => setShowOpenersSheet(false)}
        title="Start of Innings — Set the Crease"
      >
        <View style={{ flexDirection: "column", gap: 12 }}>
          <Text style={{ fontSize: 11, color: colors.ink2, fontFamily: FONTS.sans }}>
            Who opens the batting for {battingTeam?.name || "the batting team"}, and who takes the
            new ball for {bowlingTeam?.name || "the bowling team"}? Close this sheet to use the
            squad-order defaults.
          </Text>

          <View>
            <Text style={sheetLabel}>Striker (takes the first ball)</Text>
            <ScrollView
              style={{ maxHeight: 132, marginTop: 6 }}
              contentContainerStyle={{ flexDirection: "column", gap: 6 }}
              nestedScrollEnabled
            >
              {battingSquadIds.map((pId) => {
                const p = playersMap[pId];
                const isSelected = openersStrikerId === pId;
                return (
                  <Pressable
                    key={pId}
                    onPress={() => {
                      setOpenersStrikerId(pId);
                      // Keep the two ends distinct when possible.
                      if (openersNonStrikerId === pId) {
                        setOpenersNonStrikerId(
                          battingSquadIds.find((id) => id !== pId) || ""
                        );
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
          </View>

          <View>
            <Text style={sheetLabel}>Non-Striker</Text>
            <ScrollView
              style={{ maxHeight: 132, marginTop: 6 }}
              contentContainerStyle={{ flexDirection: "column", gap: 6 }}
              nestedScrollEnabled
            >
              {battingSquadIds
                .filter((pId) => pId !== openersStrikerId)
                .map((pId) => {
                  const p = playersMap[pId];
                  const isSelected = openersNonStrikerId === pId;
                  return (
                    <Pressable
                      key={pId}
                      onPress={() => setOpenersNonStrikerId(pId)}
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
          </View>

          <View>
            <Text style={sheetLabel}>Opening Bowler</Text>
            <ScrollView
              style={{ maxHeight: 132, marginTop: 6 }}
              contentContainerStyle={{ flexDirection: "column", gap: 6 }}
              nestedScrollEnabled
            >
              {bowlingSquadIds.map((pId) => {
                const p = playersMap[pId];
                const isSelected = openersBowlerId === pId;
                return (
                  <Pressable
                    key={pId}
                    onPress={() => setOpenersBowlerId(pId)}
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
          </View>

          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
            <GullyButton
              variant="quiet"
              fullWidth
              onPress={() => setShowOpenersSheet(false)}
            >
              Use Defaults
            </GullyButton>
            <GullyButton variant="primary" fullWidth onPress={handleConfirmOpeners}>
              Start Innings
            </GullyButton>
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

      {/* Umpire key sheet (audience → umpire entry point, 1.4.7) */}
      <UmpireKeySheet
        isOpen={keySheet.open}
        mode={keySheet.mode}
        onClose={() => setKeySheet((s) => ({ ...s, open: false }))}
      />
    </SafeAreaView>
  );
};
