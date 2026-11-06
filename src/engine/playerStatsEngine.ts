/**
 * GullyScore Player Stats Aggregation Engine
 * 
 * Computes deep historical career stats, match-by-match game logs,
 * batting & bowling splits, milestone progression, and all-round MVP metrics
 * across all matches stored in the local database.
 */

import { Match, Player, Team, InningsScorecard } from "../types/cricket";
import { replayInnings, calculateMatchMVPPoints } from "./scoringEngine";
import { db } from "../storage/db";

export interface PlayerRecentInnings {
  matchId: string;
  matchDate: string;
  venue: string;
  opponentTeamId: string;
  opponentName: string;
  opponentShort: string;
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
  strikeRate: number;
  isOut: boolean;
  dismissalText?: string;
  result: "win" | "loss" | "tie" | "nr";
  resultText: string;
}

export interface PlayerRecentSpell {
  matchId: string;
  matchDate: string;
  venue: string;
  opponentTeamId: string;
  opponentName: string;
  opponentShort: string;
  oversFormatted: string;
  maidens: number;
  runsConceded: number;
  wickets: number;
  economy: number;
  result: "win" | "loss" | "tie" | "nr";
}

export interface PlayerMatchLogItem {
  matchId: string;
  matchDate: string;
  venue: string;
  teamId: string;
  teamName: string;
  teamShort: string;
  opponentId: string;
  opponentName: string;
  opponentShort: string;
  opponentColor: string;
  result: "win" | "loss" | "tie" | "nr";
  resultText: string;
  isPlayerOfTheMatch: boolean;
  mvpPoints: {
    bat: number;
    bowl: number;
    field: number;
    total: number;
  };
  batting?: {
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
    strikeRate: number;
    isOut: boolean;
    dismissalText?: string;
  };
  bowling?: {
    oversFormatted: string;
    maidens: number;
    runs: number;
    wickets: number;
    economy: number;
    dots: number;
  };
  fielding?: {
    catches: number;
    stumpings: number;
    runOuts: number;
  };
}

export interface DetailedPlayerProfileStats {
  player: Player;
  teams: Team[];
  // Match overview
  matchesCount: number;
  matchesWon: number;
  winPercentage: number;
  potmCount: number;
  totalMvpPoints: number;
  battingMvpPoints: number;
  bowlingMvpPoints: number;
  fieldingMvpPoints: number;

  // Batting career
  battingInnings: number;
  notOuts: number;
  runs: number;
  ballsFaced: number;
  highestScore: number;
  highestScoreNotOut: boolean;
  battingAverage: number;
  battingStrikeRate: number;
  fours: number;
  sixes: number;
  boundaryRuns: number;
  boundaryRunsPct: number;
  ballsPerBoundary: number;
  thirties: number;
  fifties: number;
  hundreds: number;
  ducks: number;
  recentInnings: PlayerRecentInnings[];

  // Bowling career
  bowlingInnings: number;
  legalBallsBowled: number;
  oversBowledFormatted: string;
  maidens: number;
  runsConceded: number;
  wickets: number;
  bowlingAverage: number;
  bowlingEconomy: number;
  bowlingStrikeRate: number;
  bestBowling: {
    wickets: number;
    runs: number;
  };
  threeWickets: number;
  fiveWickets: number;
  dotBalls: number;
  dotBallPct: number;
  widesConceded: number;
  noBallsConceded: number;
  recentSpells: PlayerRecentSpell[];

  // Fielding career
  catches: number;
  stumpings: number;
  runOuts: number;
  totalFieldingDismissals: number;

  // Chronological match log
  matchLogs: PlayerMatchLogItem[];

  // Milestone projections
  nextBattingMilestone: {
    target: number;
    runsNeeded: number;
    projectedMatches: number;
  };
  nextBowlingMilestone: {
    target: number;
    wicketsNeeded: number;
    projectedMatches: number;
  };
}

/**
 * Calculates complete aggregated historical stats for a player across all matches in the local database.
 */
export function calculatePlayerDetailedStats(
  playerId: string,
  matchesOverride?: Match[],
  playersMapOverride?: Record<string, Player>,
  teamsMapOverride?: Record<string, Team>
): DetailedPlayerProfileStats | null {
  const playersMap = playersMapOverride || db.getPlayersMap();
  const player = playersMap[playerId];
  if (!player) return null;

  const matches = matchesOverride || db.getMatches();
  const teamsMap = teamsMapOverride || db.getTeamsMap();

  // Find teams this player belongs to
  const teams = Object.values(teamsMap).filter((t) => t.playerIds.includes(playerId));

  // Initialize accumulators
  let matchesCount = 0;
  let matchesWon = 0;
  let potmCount = 0;
  let battingMvpPoints = 0;
  let bowlingMvpPoints = 0;
  let fieldingMvpPoints = 0;

  // Batting
  let battingInnings = 0;
  let notOuts = 0;
  let runs = 0;
  let ballsFaced = 0;
  let highestScore = 0;
  let highestScoreNotOut = false;
  let fours = 0;
  let sixes = 0;
  let thirties = 0;
  let fifties = 0;
  let hundreds = 0;
  let ducks = 0;
  const recentInnings: PlayerRecentInnings[] = [];

  // Bowling
  let bowlingInnings = 0;
  let legalBallsBowled = 0;
  let maidens = 0;
  let runsConceded = 0;
  let wickets = 0;
  let bestBowling = { wickets: 0, runs: 999 };
  let threeWickets = 0;
  let fiveWickets = 0;
  let dotBalls = 0;
  let widesConceded = 0;
  let noBallsConceded = 0;
  const recentSpells: PlayerRecentSpell[] = [];

  // Fielding
  let catches = 0;
  let stumpings = 0;
  let runOuts = 0;

  // Match Logs
  const matchLogs: PlayerMatchLogItem[] = [];

  // Sort matches chronologically ascending for progression, but logs can be viewed descending
  const sortedMatches = [...matches].sort((a, b) => a.updatedAt - b.updatedAt);

  sortedMatches.forEach((m) => {
    const inTeamA = m.teamAPlayerIds.includes(playerId);
    const inTeamB = m.teamBPlayerIds.includes(playerId);

    // Also check if player appeared in ball events even if not formally in team list
    let appearedInEvents = false;
    m.innings.forEach((inn) => {
      if (
        inn.ballEvents.some(
          (b) =>
            b.strikerId === playerId ||
            b.nonStrikerId === playerId ||
            b.bowlerId === playerId ||
            b.wicket?.fielderIds?.includes(playerId)
        )
      ) {
        appearedInEvents = true;
      }
    });

    if (!inTeamA && !inTeamB && !appearedInEvents) return;

    matchesCount++;

    const playerTeamId = inTeamA ? m.teamAId : inTeamB ? m.teamBId : m.teamAId;
    const opponentTeamId = playerTeamId === m.teamAId ? m.teamBId : m.teamAId;
    const playerTeam = teamsMap[playerTeamId];
    const opponentTeam = teamsMap[opponentTeamId];

    const isWinner = m.winnerTeamId === playerTeamId;
    if (isWinner) matchesWon++;

    const isPOTM = m.playerOfTheMatchId === playerId;
    if (isPOTM) potmCount++;

    let matchResult: "win" | "loss" | "tie" | "nr" = "nr";
    if (m.winnerTeamId) {
      matchResult = m.winnerTeamId === playerTeamId ? "win" : "loss";
    } else if (m.status === "completed") {
      matchResult = "tie";
    }

    // Replay innings to get exact scorecard
    const scorecards: InningsScorecard[] = m.innings.map((inn, idx) => {
      // Stored target (set by the scorer, extras included) with a
      // runsBat-only fallback: runsBat excludes wides/no-balls/byes, so the
      // old fallback understated the target and could mark a chase complete
      // before it actually was.
      const target =
        idx > 0
          ? inn.targetRuns ??
            (m.innings[0] ? m.innings[0].ballEvents.reduce((acc, b) => acc + b.runsBat, 0) + 1 : undefined)
          : undefined;
      return replayInnings(
        inn.ballEvents,
        m.rules,
        inn.battingTeamId === m.teamAId ? m.teamAPlayerIds : m.teamBPlayerIds,
        inn.bowlingTeamId === m.teamAId ? m.teamAPlayerIds : m.teamBPlayerIds,
        playersMap,
        target,
        inn.isSuperOver
      );
    });

    const mvpMap = calculateMatchMVPPoints(scorecards);
    const playerMvp = mvpMap[playerId] || { bat: 0, bowl: 0, field: 0, total: 0 };
    battingMvpPoints += playerMvp.bat;
    bowlingMvpPoints += playerMvp.bowl;
    fieldingMvpPoints += playerMvp.field;

    let matchBatting: PlayerMatchLogItem["batting"] | undefined;
    let matchBowling: PlayerMatchLogItem["bowling"] | undefined;
    let matchFielding: PlayerMatchLogItem["fielding"] = { catches: 0, stumpings: 0, runOuts: 0 };

    scorecards.forEach((sc) => {
      // 1. Batting check
      const bStat = sc.batters.find((b) => b.playerId === playerId);
      if (bStat) {
        battingInnings++;
        runs += bStat.runs;
        ballsFaced += bStat.ballsFaced;
        fours += bStat.fours;
        sixes += bStat.sixes;

        if (bStat.runs > highestScore) {
          highestScore = bStat.runs;
          highestScoreNotOut = !bStat.isOut;
        } else if (bStat.runs === highestScore && !bStat.isOut) {
          highestScoreNotOut = true;
        }

        if (!bStat.isOut) notOuts++;
        if (bStat.isOut && bStat.runs === 0) ducks++;
        if (bStat.runs >= 100) hundreds++;
        else if (bStat.runs >= 50) fifties++;
        else if (bStat.runs >= 30) thirties++;

        matchBatting = {
          runs: bStat.runs,
          balls: bStat.ballsFaced,
          fours: bStat.fours,
          sixes: bStat.sixes,
          strikeRate: bStat.strikeRate,
          isOut: bStat.isOut,
          dismissalText: bStat.dismissalText,
        };

        recentInnings.push({
          matchId: m.id,
          matchDate: m.date || new Date(m.updatedAt).toLocaleDateString(),
          venue: m.venue || "Local Ground",
          opponentTeamId,
          opponentName: opponentTeam?.name || "Opponent",
          opponentShort: opponentTeam?.shortName || "OPP",
          runs: bStat.runs,
          ballsFaced: bStat.ballsFaced,
          fours: bStat.fours,
          sixes: bStat.sixes,
          strikeRate: bStat.strikeRate,
          isOut: bStat.isOut,
          dismissalText: bStat.dismissalText,
          result: matchResult,
          resultText: m.resultText || "",
        });
      }

      // 2. Bowling check
      const bwStat = sc.bowlers.find((bw) => bw.playerId === playerId);
      if (bwStat && bwStat.legalBalls > 0) {
        bowlingInnings++;
        legalBallsBowled += bwStat.legalBalls;
        runsConceded += bwStat.runsConceded;
        wickets += bwStat.wickets;
        maidens += bwStat.maidens;
        dotBalls += bwStat.dots;
        widesConceded += bwStat.wides;
        noBallsConceded += bwStat.noBalls;

        if (bwStat.wickets >= 5) fiveWickets++;
        else if (bwStat.wickets >= 3) threeWickets++;

        // Best Bowling evaluation: more wickets, or if equal, fewer runs
        if (
          bwStat.wickets > bestBowling.wickets ||
          (bwStat.wickets === bestBowling.wickets && bwStat.runsConceded < bestBowling.runs)
        ) {
          bestBowling = {
            wickets: bwStat.wickets,
            runs: bwStat.runsConceded,
          };
        }

        const oversFormatted = `${Math.floor(bwStat.legalBalls / 6)}.${bwStat.legalBalls % 6}`;

        matchBowling = {
          oversFormatted,
          maidens: bwStat.maidens,
          runs: bwStat.runsConceded,
          wickets: bwStat.wickets,
          economy: bwStat.economy,
          dots: bwStat.dots,
        };

        recentSpells.push({
          matchId: m.id,
          matchDate: m.date || new Date(m.updatedAt).toLocaleDateString(),
          venue: m.venue || "Local Ground",
          opponentTeamId,
          opponentName: opponentTeam?.name || "Opponent",
          opponentShort: opponentTeam?.shortName || "OPP",
          oversFormatted,
          maidens: bwStat.maidens,
          runsConceded: bwStat.runsConceded,
          wickets: bwStat.wickets,
          economy: bwStat.economy,
          result: matchResult,
        });
      }

      // 3. Fielding check
      sc.batters.forEach((b) => {
        if (b.isOut && b.fielderIds?.includes(playerId)) {
          if (b.wicketType === "run_out") {
            runOuts++;
            matchFielding.runOuts++;
          } else if (b.wicketType === "stumped") {
            stumpings++;
            matchFielding.stumpings++;
          } else {
            catches++;
            matchFielding.catches++;
          }
        }
      });
    });

    matchLogs.push({
      matchId: m.id,
      matchDate: m.date || new Date(m.updatedAt).toLocaleDateString(),
      venue: m.venue || "Local Ground",
      teamId: playerTeamId,
      teamName: playerTeam?.name || "My Team",
      teamShort: playerTeam?.shortName || "TM",
      opponentId: opponentTeamId,
      opponentName: opponentTeam?.name || "Opponent",
      opponentShort: opponentTeam?.shortName || "OPP",
      opponentColor: opponentTeam?.color || "#5B5F66",
      result: matchResult,
      resultText: m.resultText || "Match Completed",
      isPlayerOfTheMatch: isPOTM,
      mvpPoints: playerMvp,
      batting: matchBatting,
      bowling: matchBowling,
      fielding:
        matchFielding.catches > 0 || matchFielding.stumpings > 0 || matchFielding.runOuts > 0
          ? matchFielding
          : undefined,
    });
  });

  // Calculate Batting derived stats
  const outs = battingInnings - notOuts;
  const battingAverage = outs > 0 ? Number((runs / outs).toFixed(1)) : runs;
  const battingStrikeRate = ballsFaced > 0 ? Number(((runs / ballsFaced) * 100).toFixed(1)) : 0;
  const boundaryRuns = 4 * fours + 6 * sixes;
  const boundaryRunsPct = runs > 0 ? Number(((boundaryRuns / runs) * 100).toFixed(1)) : 0;
  const totalBoundaries = fours + sixes;
  const ballsPerBoundary = totalBoundaries > 0 ? Number((ballsFaced / totalBoundaries).toFixed(1)) : 0;

  // Calculate Bowling derived stats
  const totalOversFraction = legalBallsBowled / 6;
  const oversBowledFormatted = `${Math.floor(legalBallsBowled / 6)}.${legalBallsBowled % 6}`;
  const bowlingAverage = wickets > 0 ? Number((runsConceded / wickets).toFixed(1)) : 0;
  const bowlingEconomy =
    totalOversFraction > 0 ? Number((runsConceded / totalOversFraction).toFixed(2)) : 0;
  const bowlingStrikeRate = wickets > 0 ? Number((legalBallsBowled / wickets).toFixed(1)) : 0;
  const dotBallPct =
    legalBallsBowled > 0 ? Number(((dotBalls / legalBallsBowled) * 100).toFixed(1)) : 0;

  // If no wickets were taken ever, reset best bowling placeholder
  if (bestBowling.wickets === 0 && bestBowling.runs === 999) {
    bestBowling = { wickets: 0, runs: 0 };
  }

  // Next Milestones calculation
  const nextBattingTarget = runs < 50 ? 50 : runs < 100 ? 100 : runs < 250 ? 250 : Math.ceil((runs + 1) / 250) * 250;
  const runsNeeded = Math.max(0, nextBattingTarget - runs);
  const avgRunsPerMatch = battingInnings > 0 ? runs / battingInnings : 15;
  const projectedBattingMatches = avgRunsPerMatch > 0 ? Math.ceil(runsNeeded / avgRunsPerMatch) : 1;

  const nextBowlingTarget = wickets < 5 ? 5 : wickets < 10 ? 10 : wickets < 25 ? 25 : Math.ceil((wickets + 1) / 25) * 25;
  const wicketsNeeded = Math.max(0, nextBowlingTarget - wickets);
  const avgWicketsPerMatch = bowlingInnings > 0 ? wickets / bowlingInnings : 1;
  const projectedBowlingMatches = avgWicketsPerMatch > 0 ? Math.ceil(wicketsNeeded / avgWicketsPerMatch) : 1;

  const winPercentage = matchesCount > 0 ? Number(((matchesWon / matchesCount) * 100).toFixed(1)) : 0;

  return {
    player,
    teams,
    matchesCount,
    matchesWon,
    winPercentage,
    potmCount,
    totalMvpPoints: battingMvpPoints + bowlingMvpPoints + fieldingMvpPoints,
    battingMvpPoints,
    bowlingMvpPoints,
    fieldingMvpPoints,

    // Batting
    battingInnings,
    notOuts,
    runs,
    ballsFaced,
    highestScore,
    highestScoreNotOut,
    battingAverage,
    battingStrikeRate,
    fours,
    sixes,
    boundaryRuns,
    boundaryRunsPct,
    ballsPerBoundary,
    thirties,
    fifties,
    hundreds,
    ducks,
    recentInnings: recentInnings.reverse(), // Newest first

    // Bowling
    bowlingInnings,
    legalBallsBowled,
    oversBowledFormatted,
    maidens,
    runsConceded,
    wickets,
    bowlingAverage,
    bowlingEconomy,
    bowlingStrikeRate,
    bestBowling,
    threeWickets,
    fiveWickets,
    dotBalls,
    dotBallPct,
    widesConceded,
    noBallsConceded,
    recentSpells: recentSpells.reverse(), // Newest first

    // Fielding
    catches,
    stumpings,
    runOuts,
    totalFieldingDismissals: catches + stumpings + runOuts,

    // Match logs (newest first)
    matchLogs: matchLogs.reverse(),

    // Projections
    nextBattingMilestone: {
      target: nextBattingTarget,
      runsNeeded,
      projectedMatches: projectedBattingMatches,
    },
    nextBowlingMilestone: {
      target: nextBowlingTarget,
      wicketsNeeded,
      projectedMatches: projectedBowlingMatches,
    },
  };
}
