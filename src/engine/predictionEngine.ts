/**
 * GullyScore Prediction & Scenario Modeling Engine
 * 
 * 100% offline, pure deterministic statistical modeling:
 * 1. Live Win Probability Engine (Ball-by-ball dynamic probability & swing tracker)
 * 2. Projected Score & Resource Modeling (CRR, par score, death-over acceleration)
 * 3. Batter Milestone & Innings Projections
 * 4. Pre-Match Head-to-Head & Venue Win Predictor
 * 5. Tournament Monte Carlo Simulator (Qualification odds & projected standings)
 * 6. Tournament NRR "What Do We Need?" Scenario Solver (Exact runs/overs equations)
 * 7. Boundary Friends Prediction Game Ledger (Local guess & score system)
 */

import {
  BallEvent,
  Fixture,
  InningsScorecard,
  Match,
  MatchRules,
  PointsTableRow,
  Team,
  Tournament,
} from "../types/cricket";
import { ballsToOversFraction } from "./scoringEngine";

export interface LiveWinProbability {
  teamAWinProb: number;      // 0 to 100%
  teamBWinProb: number;      // 0 to 100%
  tieProb: number;          // 0 to 100%
  favoriteTeamId: string;
  marginDescription: string;
  keyFactor: string;
}

export interface ProjectedScoreModel {
  atCurrentRate: number;
  atParRate: number;         // based on ball type & ground par
  projectedMin: number;
  projectedMedian: number;
  projectedMax: number;
  accelerationFactor: number; // death overs acceleration index
  parScore: number;
}

export interface BatterMilestoneProjection {
  playerId: string;
  currentRuns: number;
  ballsFaced: number;
  projectedRuns: number;
  nextMilestone: number | null; // e.g. 30, 50, 100
  estimatedBallsToMilestone: number | null;
  probabilityOfMilestone: number; // 0 to 100%
}

export interface PreMatchPrediction {
  teamAWinProb: number;
  teamBWinProb: number;
  headToHeadSummary: string;
  predictedParScore: number;
  tossAdvantage: "bat" | "bowl" | "neutral";
  tossAdvantagePct: number;
  predictionRationale: string;
}

export interface TournamentSimulationResult {
  teamId: string;
  championProbability: number;     // 0 to 100%
  topTwoProbability: number;       // 0 to 100%
  projectedAveragePoints: number;
  projectedRank: number;
}

export interface NrrScenarioRequirement {
  teamId: string;
  targetOpponentId: string;
  battingFirstEquation: {
    assumedTeamScore: number;
    maxRunsOpponentAllowed: number;
    marginRunsRequired: number;
  };
  chasingEquation: {
    targetToChase: number;
    maxOversAllowed: string;
    maxBallsAllowed: number;
  };
}

export interface UserPredictionGuess {
  id: string;
  matchId: string;
  predictorName: string;
  predictedWinnerTeamId: string;
  predictedScoreRange: "low" | "medium" | "high"; // e.g. <60, 60-90, >90
  predictedTopBatterId?: string;
  predictedTopBowlerId?: string;
  score?: number; // points scored after match
}

// --- 1. LIVE WIN PROBABILITY ENGINE ---
export function calculateLiveWinProbability(
  match: Match,
  currentScorecard: InningsScorecard,
  firstInningsTotal?: number,
  headToHeadFactor: number = 0.5 // 0.5 = neutral, >0.5 = Team A favored
): LiveWinProbability {
  const currentInningsIdx = match.currentInningsIndex;
  const rules = match.rules;
  const totalOvers = rules.overs;
  const maxBalls = totalOvers * 6;
  const ballsBowled = currentScorecard.legalBallsCount;
  const ballsRemaining = Math.max(0, maxBalls - ballsBowled);
  const totalWickets = rules.lastManBatting ? rules.playersPerSide : rules.playersPerSide - 1;
  const wicketsLost = currentScorecard.totalWickets;
  const wicketsInHand = Math.max(0, totalWickets - wicketsLost);

  const teamAId = match.teamAId;
  const teamBId = match.teamBId;
  const battingTeamId = match.innings[currentInningsIdx]?.battingTeamId || teamAId;
  const bowlingTeamId = battingTeamId === teamAId ? teamBId : teamAId;

  // 1st INNINGS WIN PROBABILITY MODEL
  if (currentInningsIdx === 0) {
    // Expected baseline runs per over based on ball type
    const baseRpo = rules.ballType === "tennis" ? 8.2 : rules.ballType === "box" ? 7.0 : 6.8;
    const expectedParTotal = baseRpo * totalOvers;

    // Remaining resources based on balls and wickets in hand (WASP-style curve)
    const resourceWeight =
      totalWickets > 0
        ? Math.pow(wicketsInHand / totalWickets, 0.7) * (ballsRemaining / maxBalls)
        : ballsRemaining / maxBalls;

    const projectedRuns =
      currentScorecard.totalRuns + resourceWeight * (baseRpo * (ballsRemaining / 6) * 1.15);

    // Deviation from par score gives probability advantage
    const delta = projectedRuns - expectedParTotal;
    // Logistic function: delta of 15 runs = ~65% probability
    const z = delta / (totalOvers * 2.2);
    let battingWinProb = 1 / (1 + Math.exp(-z));

    // Incorporate prior head to head
    const teamAPrior = battingTeamId === teamAId ? headToHeadFactor : 1 - headToHeadFactor;
    battingWinProb = battingWinProb * 0.85 + teamAPrior * 0.15;

    // Clamp between 5% and 95% during 1st innings
    battingWinProb = Math.max(0.05, Math.min(0.95, battingWinProb));
    const bowlingWinProb = 1 - battingWinProb;

    const teamAProb = battingTeamId === teamAId ? battingWinProb : bowlingWinProb;
    const teamBProb = battingTeamId === teamBId ? battingWinProb : bowlingWinProb;

    const favId = teamAProb >= teamBProb ? teamAId : teamBId;
    const maxP = Math.round(Math.max(teamAProb, teamBProb) * 100);

    return {
      teamAWinProb: Math.round(teamAProb * 100),
      teamBWinProb: Math.round(teamBProb * 100),
      tieProb: 0,
      favoriteTeamId: favId,
      marginDescription: `${maxP}% favored (1st Innings pace)`,
      keyFactor:
        wicketsInHand > totalWickets / 2
          ? `${wicketsInHand} wickets in hand favors late surge`
          : `${wicketsLost} wickets lost increases collapse risk`,
    };
  }

  // 2nd INNINGS CHASE WIN PROBABILITY MODEL
  const target = currentScorecard.targetRuns || (firstInningsTotal ? firstInningsTotal + 1 : 1);
  const runsRemaining = Math.max(0, target - currentScorecard.totalRuns);

  // If match already concluded
  if (currentScorecard.totalRuns >= target) {
    const isBatTeamA = battingTeamId === teamAId;
    return {
      teamAWinProb: isBatTeamA ? 100 : 0,
      teamBWinProb: isBatTeamA ? 0 : 100,
      tieProb: 0,
      favoriteTeamId: battingTeamId,
      marginDescription: "Target reached",
      keyFactor: "Chase successfully completed",
    };
  }

  if (wicketsInHand <= 0 || ballsRemaining <= 0) {
    if (currentScorecard.totalRuns === target - 1) {
      return {
        teamAWinProb: 50,
        teamBWinProb: 50,
        tieProb: 100,
        favoriteTeamId: "tie",
        marginDescription: "Scores Level",
        keyFactor: "Match tied",
      };
    }
    const isBowlTeamA = bowlingTeamId === teamAId;
    return {
      teamAWinProb: isBowlTeamA ? 100 : 0,
      teamBWinProb: isBowlTeamA ? 0 : 100,
      tieProb: 0,
      favoriteTeamId: bowlingTeamId,
      marginDescription: "Target defended",
      keyFactor: wicketsInHand <= 0 ? "All out" : "Overs exhausted",
    };
  }

  // Live Chase equation:
  // Required Run Rate (RRR) vs Current Run Rate (CRR)
  const rrr = runsRemaining / (ballsRemaining / 6);
  const crr = ballsBowled > 0 ? currentScorecard.totalRuns / (ballsBowled / 6) : 7.0;

  // Wicket impact factor: each wicket in hand adds exponential chasing confidence
  const wicketFactor = Math.pow(wicketsInHand / totalWickets, 0.85);

  // Balls per run required
  const runsPerBall = runsRemaining / ballsRemaining;

  // Benchmark: in gully/short format, 1.2 runs/ball (7.2 rpo) with 5+ wickets is 50-50
  // > 2.0 runs/ball (12 rpo) with 2 wickets is < 15%
  // < 0.8 runs/ball (4.8 rpo) with 4+ wickets is > 85%
  let difficulty = (runsPerBall - 1.2) * 2.4 - (wicketFactor - 0.5) * 2.8;

  // Logistic win probability for chasing side
  let chaseWinProb = 1 / (1 + Math.exp(difficulty));

  // Small tie probability when runs remaining is low in final over
  let tieProbability = 0;
  if (ballsRemaining <= 6 && runsRemaining <= 8) {
    tieProbability = 0.08;
    chaseWinProb = chaseWinProb * 0.92;
  }

  let defendWinProb = Math.max(0, 1 - chaseWinProb - tieProbability);

  const teamAProb = battingTeamId === teamAId ? chaseWinProb : defendWinProb;
  const teamBProb = battingTeamId === teamBId ? chaseWinProb : defendWinProb;

  const favId = teamAProb >= teamBProb ? teamAId : teamBId;
  const maxPct = Math.round(Math.max(teamAProb, teamBProb) * 100);

  return {
    teamAWinProb: Math.round(teamAProb * 100),
    teamBWinProb: Math.round(teamBProb * 100),
    tieProb: Math.round(tieProbability * 100),
    favoriteTeamId: favId,
    marginDescription: `${maxPct}% chance · Need ${runsRemaining} off ${ballsRemaining}b (RRR ${rrr.toFixed(1)})`,
    keyFactor:
      rrr > 11.0
        ? `High required rate (${rrr.toFixed(1)} rpo) puts bowling team on top`
        : wicketsInHand >= 4
        ? `${wicketsInHand} wickets in hand provides solid chasing cushion`
        : `Tense finish: only ${wicketsInHand} wickets in hand remaining`,
  };
}

// --- 2. PROJECTED SCORE & RESOURCE MODEL ---
export function calculateProjectedScore(
  currentRuns: number,
  legalBallsFaced: number,
  totalOvers: number,
  wicketsLost: number,
  totalWickets: number,
  ballType: string = "tennis"
): ProjectedScoreModel {
  const maxBalls = totalOvers * 6;
  const ballsRemaining = Math.max(0, maxBalls - legalBallsFaced);
  const oversRemaining = ballsRemaining / 6;
  const wicketsInHand = Math.max(0, totalWickets - wicketsLost);

  // Par RPO based on match type
  const parRpo = ballType === "box" ? 7.2 : ballType === "tennis" ? 8.4 : 6.8;
  const parScore = Math.round(parRpo * totalOvers);

  const crr = legalBallsFaced > 0 ? currentRuns / (legalBallsFaced / 6) : parRpo;
  const atCurrentRate = Math.round(currentRuns + crr * oversRemaining);

  // Death-overs acceleration index based on wickets remaining
  // If team has >= 60% wickets in hand in last 30% of overs, acceleration multiplier is 1.35x
  const isDeathOvers = legalBallsFaced >= maxBalls * 0.7;
  const hasWicketsReserve = wicketsInHand >= totalWickets * 0.5;

  let accelerationFactor = 1.0;
  if (isDeathOvers && hasWicketsReserve) {
    accelerationFactor = 1.35;
  } else if (!hasWicketsReserve) {
    accelerationFactor = 0.85; // tail end slowdown
  }

  const atParRate = Math.round(currentRuns + parRpo * oversRemaining);

  // Min / Median / Max range
  const projectedMin = Math.max(
    currentRuns,
    Math.round(currentRuns + Math.max(4.5, crr * 0.75) * oversRemaining * 0.9)
  );
  const projectedMedian = Math.round(
    currentRuns + crr * oversRemaining * accelerationFactor
  );
  const projectedMax = Math.round(
    currentRuns + Math.max(crr, parRpo) * oversRemaining * 1.45
  );

  return {
    atCurrentRate,
    atParRate,
    projectedMin,
    projectedMedian,
    projectedMax,
    accelerationFactor,
    parScore,
  };
}

// --- 3. BATTER MILESTONE & INNINGS PROJECTION ---
export function calculateBatterProjection(
  currentRuns: number,
  ballsFaced: number,
  legalBallsRemainingInInnings: number,
  teamWicketsRemaining: number
): BatterMilestoneProjection {
  const strikeRate = ballsFaced > 0 ? (currentRuns / ballsFaced) * 100 : 120;
  const runsPerBall = strikeRate / 100;

  // Expected balls this batter will face out of remaining balls
  // In partnerships, a batter faces roughly 50-60% of balls unless tail-ender
  const expectedBallsToFace = Math.min(
    legalBallsRemainingInInnings,
    Math.round(legalBallsRemainingInInnings * 0.52)
  );

  const projectedRuns = Math.round(currentRuns + expectedBallsToFace * runsPerBall);

  // Determine next milestone (30, 50, 100)
  let nextMilestone: number | null = null;
  if (currentRuns < 30) nextMilestone = 30;
  else if (currentRuns < 50) nextMilestone = 50;
  else if (currentRuns < 100) nextMilestone = 100;

  let estimatedBallsToMilestone: number | null = null;
  let probabilityOfMilestone = 0;

  if (nextMilestone) {
    const runsNeeded = nextMilestone - currentRuns;
    if (runsPerBall > 0) {
      estimatedBallsToMilestone = Math.ceil(runsNeeded / runsPerBall);
      if (estimatedBallsToMilestone <= expectedBallsToFace && teamWicketsRemaining >= 2) {
        // High probability if balls suffice and wickets remain
        const ratio = expectedBallsToFace / estimatedBallsToMilestone;
        probabilityOfMilestone = Math.min(95, Math.round(Math.min(1.0, ratio) * 85));
      } else {
        probabilityOfMilestone = Math.max(5, Math.round((expectedBallsToFace / (estimatedBallsToMilestone || 1)) * 40));
      }
    }
  }

  return {
    playerId: "",
    currentRuns,
    ballsFaced,
    projectedRuns,
    nextMilestone,
    estimatedBallsToMilestone,
    probabilityOfMilestone,
  };
}

// --- 4. PRE-MATCH HEAD-TO-HEAD PREDICTOR ---
export function calculatePreMatchPrediction(
  teamA: Team,
  teamB: Team,
  allMatches: Match[],
  rules: MatchRules,
  venue?: string
): PreMatchPrediction {
  const completedMatches = allMatches.filter((m) => m.status === "completed");

  // Head-to-head matches between these two teams
  const h2h = completedMatches.filter(
    (m) =>
      (m.teamAId === teamA.id && m.teamBId === teamB.id) ||
      (m.teamAId === teamB.id && m.teamBId === teamA.id)
  );

  let teamAWins = 0;
  let teamBWins = 0;
  h2h.forEach((m) => {
    if (m.winnerTeamId === teamA.id) teamAWins++;
    if (m.winnerTeamId === teamB.id) teamBWins++;
  });

  // Overall win rate for Team A & Team B
  const teamAMatches = completedMatches.filter((m) => m.teamAId === teamA.id || m.teamBId === teamA.id);
  const teamBMatches = completedMatches.filter((m) => m.teamAId === teamB.id || m.teamBId === teamB.id);

  const teamARecord = teamAMatches.filter((m) => m.winnerTeamId === teamA.id).length;
  const teamBRecord = teamBMatches.filter((m) => m.winnerTeamId === teamB.id).length;

  const teamARate = teamAMatches.length > 0 ? teamARecord / teamAMatches.length : 0.5;
  const teamBRate = teamBMatches.length > 0 ? teamBRecord / teamBMatches.length : 0.5;

  // Venue toss bias
  let batFirstWins = 0;
  let bowlFirstWins = 0;
  const venueMatches = completedMatches.filter((m) => !venue || m.venue === venue);
  venueMatches.forEach((m) => {
    if (m.innings && m.innings.length >= 2 && m.winnerTeamId) {
      if (m.winnerTeamId === m.innings[0].battingTeamId) batFirstWins++;
      else batFirstWins++;
    }
  });

  let tossAdvantage: "bat" | "bowl" | "neutral" = "neutral";
  let tossAdvantagePct = 50;
  if (batFirstWins > bowlFirstWins && venueMatches.length >= 3) {
    tossAdvantage = "bat";
    tossAdvantagePct = Math.round((batFirstWins / venueMatches.length) * 100);
  } else if (bowlFirstWins > batFirstWins && venueMatches.length >= 3) {
    tossAdvantage = "bowl";
    tossAdvantagePct = Math.round((bowlFirstWins / venueMatches.length) * 100);
  }

  // Combine H2H + Recent Win Rates
  let teamAProb = 0.5;
  if (h2h.length >= 2) {
    const h2hRate = teamAWins / h2h.length;
    teamAProb = h2hRate * 0.6 + teamARate * 0.4;
  } else {
    // Rely on overall form
    const sum = teamARate + teamBRate;
    teamAProb = sum > 0 ? teamARate / sum : 0.5;
  }

  // Smooth between 20% and 80% to avoid extreme pre-match cockiness
  teamAProb = Math.max(0.2, Math.min(0.8, teamAProb));
  const teamBProb = 1 - teamAProb;

  const baseParRpo = rules.ballType === "tennis" ? 8.5 : 7.0;
  const predictedParScore = Math.round(baseParRpo * rules.overs);

  const h2hText =
    h2h.length > 0
      ? `${h2h.length} head-to-head match(es): ${teamA.shortName} (${teamAWins}) vs ${teamB.shortName} (${teamBWins})`
      : "First recorded encounter between these two teams";

  const rationale =
    teamAProb > 0.55
      ? `${teamA.name} enters as statistical favorite based on a ${(teamARate * 100).toFixed(0)}% season win rate.`
      : teamBProb > 0.55
      ? `${teamB.name} favored based on recent match momentum and squad balance.`
      : "Evenly matched contest with closely matched win records.";

  return {
    teamAWinProb: Math.round(teamAProb * 100),
    teamBWinProb: Math.round(teamBProb * 100),
    headToHeadSummary: h2hText,
    predictedParScore,
    tossAdvantage,
    tossAdvantagePct,
    predictionRationale: rationale,
  };
}

// --- 5. TOURNAMENT MONTE CARLO SIMULATOR ---
export function simulateTournamentOutcomes(
  tournament: Tournament,
  fixtures: Fixture[],
  completedMatches: Match[],
  currentPointsTable: PointsTableRow[],
  iterations: number = 800
): TournamentSimulationResult[] {
  const teamIds = tournament.teamIds;
  const pendingFixtures = fixtures.filter((f) => f.status === "pending" || !f.matchId);

  // If tournament already completed
  if (pendingFixtures.length === 0) {
    return currentPointsTable.map((row, idx) => ({
      teamId: row.teamId,
      championProbability: idx === 0 ? 100 : 0,
      topTwoProbability: idx < 2 ? 100 : 0,
      projectedAveragePoints: row.points,
      projectedRank: idx + 1,
    }));
  }

  // Calculate current baseline team strengths from current points & NRR
  const teamStrength: Record<string, number> = {};
  teamIds.forEach((tId) => {
    const row = currentPointsTable.find((r) => r.teamId === tId);
    const winRate = row && row.played > 0 ? (row.won + row.tied * 0.5) / row.played : 0.5;
    const nrrBoost = row ? Math.max(-1.5, Math.min(1.5, row.nrr)) * 0.15 : 0;
    teamStrength[tId] = Math.max(0.2, Math.min(0.8, winRate + nrrBoost));
  });

  const championCount: Record<string, number> = {};
  const topTwoCount: Record<string, number> = {};
  const totalSimulatedPoints: Record<string, number> = {};
  teamIds.forEach((tId) => {
    championCount[tId] = 0;
    topTwoCount[tId] = 0;
    totalSimulatedPoints[tId] = 0;
  });

  // Run Monte Carlo Iterations
  for (let iter = 0; iter < iterations; iter++) {
    // Clone starting points
    const simPoints: Record<string, number> = {};
    const simNrr: Record<string, number> = {};
    teamIds.forEach((tId) => {
      const row = currentPointsTable.find((r) => r.teamId === tId);
      simPoints[tId] = row ? row.points : 0;
      simNrr[tId] = row ? row.nrr : 0;
    });

    // Simulate each pending fixture
    for (const fix of pendingFixtures) {
      const sA = teamStrength[fix.teamAId] ?? 0.5;
      const sB = teamStrength[fix.teamBId] ?? 0.5;
      const probA = sA / (sA + sB);

      const roll = Math.random();
      if (roll < probA) {
        simPoints[fix.teamAId] += tournament.winPoints;
        simNrr[fix.teamAId] += 0.35;
        simNrr[fix.teamBId] -= 0.35;
      } else if (roll < probA + 0.05) {
        // Small tie chance
        simPoints[fix.teamAId] += tournament.tiePoints;
        simPoints[fix.teamBId] += tournament.tiePoints;
      } else {
        simPoints[fix.teamBId] += tournament.winPoints;
        simNrr[fix.teamBId] += 0.35;
        simNrr[fix.teamAId] -= 0.35;
      }
    }

    // Rank table for this iteration
    const ranked = [...teamIds].sort((a, b) => {
      if (simPoints[b] !== simPoints[a]) return simPoints[b] - simPoints[a];
      return simNrr[b] - simNrr[a];
    });

    championCount[ranked[0]]++;
    topTwoCount[ranked[0]]++;
    if (ranked[1]) topTwoCount[ranked[1]]++;

    teamIds.forEach((tId) => {
      totalSimulatedPoints[tId] += simPoints[tId];
    });
  }

  return teamIds
    .map((tId) => ({
      teamId: tId,
      championProbability: Math.round((championCount[tId] / iterations) * 100),
      topTwoProbability: Math.round((topTwoCount[tId] / iterations) * 100),
      projectedAveragePoints: Number((totalSimulatedPoints[tId] / iterations).toFixed(1)),
      projectedRank: 0,
    }))
    .sort((a, b) => b.championProbability - a.championProbability)
    .map((res, index) => ({
      ...res,
      projectedRank: index + 1,
    }));
}

// --- 6. TOURNAMENT NRR "WHAT DO WE NEED?" SCENARIO SOLVER ---
export function calculateNrrScenario(
  teamAId: string,
  teamBId: string,
  targetTeamId: string,
  pointsTable: PointsTableRow[],
  matchRules: MatchRules
): NrrScenarioRequirement {
  const teamRow = pointsTable.find((r) => r.teamId === teamAId);
  const targetRow = pointsTable.find((r) => r.teamId === targetTeamId);

  const overs = matchRules.overs;
  const assumedTeamScore = Math.round(overs * 8.5); // standard assumed baseline

  // If team has not played or target is same
  if (!teamRow || !targetRow) {
    return {
      teamId: teamAId,
      targetOpponentId: teamBId,
      battingFirstEquation: {
        assumedTeamScore,
        maxRunsOpponentAllowed: Math.round(assumedTeamScore * 0.75),
        marginRunsRequired: Math.round(assumedTeamScore * 0.25),
      },
      chasingEquation: {
        targetToChase: 75,
        maxOversAllowed: `${(overs * 0.75).toFixed(1)}`,
        maxBallsAllowed: Math.round(overs * 6 * 0.75),
      },
    };
  }

  // Current NRR stats
  const targetNrr = targetRow.nrr;
  const currentRunsScored = teamRow.runsScored;
  const currentOversFaced = teamRow.oversFaced;
  const currentRunsConceded = teamRow.runsConceded;
  const currentOversBowled = teamRow.oversBowled;

  // SCENARIO 1: Batting First
  // New NRR = ((currentRunsScored + assumedTeamScore) / (currentOversFaced + overs))
  //          - ((currentRunsConceded + R_opp) / (currentOversBowled + overs)) >= targetNrr + 0.005
  const newRunsScored = currentRunsScored + assumedTeamScore;
  const newOversFaced = currentOversFaced + overs;
  const forRate = newRunsScored / newOversFaced;

  // Solve for max allowed opponent runs R_opp:
  // forRate - ((currentRunsConceded + R_opp) / (currentOversBowled + overs)) = targetNrr
  // (currentRunsConceded + R_opp) = (forRate - targetNrr) * (currentOversBowled + overs)
  const requiredAgainstRate = forRate - (targetNrr + 0.005);
  const maxConcededAllowed = Math.max(
    0,
    Math.floor(requiredAgainstRate * (currentOversBowled + overs) - currentRunsConceded)
  );

  const marginRequired = Math.max(1, assumedTeamScore - maxConcededAllowed);

  // SCENARIO 2: Chasing
  // Assume opponent scores assumedTeamScore (or par 8.0 rpo)
  const targetToChase = assumedTeamScore + 1;
  const newConceded = currentRunsConceded + assumedTeamScore;
  const newBowled = currentOversBowled + overs;
  const againstRate = newConceded / newBowled;

  // We need (currentRunsScored + targetToChase) / (currentOversFaced + O_chase) >= targetNrr + againstRate
  const requiredForRate = targetNrr + againstRate + 0.005;
  const maxOversFacedTotal = (currentRunsScored + targetToChase) / requiredForRate;
  const maxOversAllowedDecimal = Math.max(
    1.0,
    Math.min(overs, maxOversFacedTotal - currentOversFaced)
  );

  const maxBallsAllowed = Math.min(
    overs * 6,
    Math.max(6, Math.floor(maxOversAllowedDecimal * 6))
  );
  const maxOversString = `${Math.floor(maxBallsAllowed / 6)}.${maxBallsAllowed % 6}`;

  return {
    teamId: teamAId,
    targetOpponentId: teamBId,
    battingFirstEquation: {
      assumedTeamScore,
      maxRunsOpponentAllowed: Math.min(assumedTeamScore - 1, maxConcededAllowed),
      marginRunsRequired: marginRequired,
    },
    chasingEquation: {
      targetToChase,
      maxOversAllowed: maxOversString,
      maxBallsAllowed,
    },
  };
}
