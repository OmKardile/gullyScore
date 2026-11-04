/**
 * GullyScore Pure Scoring Engine
 * 
 * Event-sourced cricket engine with deterministic replay.
 * Zero external or UI dependencies.
 */

import {
  BallEvent,
  BatterInningsStat,
  BowlerInningsStat,
  DismissalInfo,
  ExtrasBreakdown,
  FallOfWicket,
  InningsScorecard,
  MatchRules,
  OverSummary,
  Partnership,
  Player,
  PlayerCareerStats,
  PointsTableRow,
  WicketType,
} from "../types/cricket";

export function formatOvers(legalBalls: number): string {
  const overs = Math.floor(legalBalls / 6);
  const balls = legalBalls % 6;
  return `${overs}.${balls}`;
}

export function parseOversToDecimal(legalBalls: number): number {
  const overs = Math.floor(legalBalls / 6);
  const balls = legalBalls % 6;
  return Number(`${overs}.${balls}`);
}

export function ballsToOversFraction(legalBalls: number): number {
  return legalBalls / 6;
}

export function isDismissalCreditedToBowler(type: WicketType): boolean {
  return (
    type === "bowled" ||
    type === "caught" ||
    type === "caught_bowled" ||
    type === "caught_behind" ||
    type === "lbw" ||
    type === "stumped" ||
    type === "hit_wicket"
  );
}

export function getDismissalText(
  dismissal: DismissalInfo,
  playersMap: Record<string, Player>,
  bowlerId: string
): string {
  const bowlerName = playersMap[bowlerId]?.name || "Bowler";
  const fielderNames = (dismissal.fielderIds || [])
    .map((id) => playersMap[id]?.name || "Fielder")
    .join(", ");

  switch (dismissal.type) {
    case "bowled":
      return `b ${bowlerName}`;
    case "caught":
      return fielderNames ? `c ${fielderNames} b ${bowlerName}` : `c & b ${bowlerName}`;
    case "caught_bowled":
      return `c & b ${bowlerName}`;
    case "caught_behind":
      return fielderNames ? `c †${fielderNames} b ${bowlerName}` : `c & b ${bowlerName}`;
    case "lbw":
      return `lbw b ${bowlerName}`;
    case "run_out":
      return fielderNames ? `run out (${fielderNames})` : `run out`;
    case "stumped":
      return fielderNames ? `st †${fielderNames} b ${bowlerName}` : `st b ${bowlerName}`;
    case "hit_wicket":
      return `hit wicket b ${bowlerName}`;
    case "hit_ball_twice":
      return "hit the ball twice";
    case "obstructing_field":
      return "obstructing the field";
    case "handled_ball":
      return "handled the ball";
    case "timed_out":
      return "timed out";
    case "retired_out":
      return "retired out";
    case "retired_hurt":
      return "retired hurt";
    default:
      return "out";
  }
}

/**
 * Deterministically replays a list of ball events to construct the complete innings scorecard.
 */
export function replayInnings(
  ballEvents: BallEvent[],
  rules: MatchRules,
  battingSquadIds: string[],
  bowlingSquadIds: string[],
  playersMap: Record<string, Player>,
  targetRuns?: number,
  isSuperOver?: boolean
): InningsScorecard {
  const extras: ExtrasBreakdown = {
    wides: 0,
    noBalls: 0,
    byes: 0,
    legByes: 0,
    penalties: 0,
    total: 0,
  };

  const battersMap: Record<string, BatterInningsStat> = {};
  const bowlersMap: Record<string, {
    legalBalls: number;
    runsConceded: number;
    wickets: number;
    wides: number;
    noBalls: number;
    dots: number;
    overBalls: BallEvent[][]; // grouped by over
  }> = {};

  const fallOfWickets: FallOfWicket[] = [];
  const partnerships: Partnership[] = [];
  const overSummaries: OverSummary[] = [];

  let totalRuns = 0;
  let totalWickets = 0;
  let legalBallsCount = 0;

  // Active batter & partnership trackers
  let currentStrikerId = "";
  let currentNonStrikerId = "";
  let currentBowlerId = "";
  let battingOrderCounter = 0;

  // Active partnership tracker
  let currentPartRuns = 0;
  let currentPartBalls = 0;
  let partP1Id = "";
  let partP1Runs = 0;
  let partP1Balls = 0;
  let partP2Id = "";
  let partP2Runs = 0;
  let partP2Balls = 0;

  let currentOverBalls: BallEvent[] = [];
  let currentOverIndex = 0;

  function ensureBatter(id: string): BatterInningsStat {
    if (!battersMap[id]) {
      battingOrderCounter++;
      battersMap[id] = {
        playerId: id,
        runs: 0,
        ballsFaced: 0,
        fours: 0,
        sixes: 0,
        strikeRate: 0,
        isOut: false,
        battingOrder: battingOrderCounter,
      };
    }
    return battersMap[id];
  }

  function ensureBowler(id: string) {
    if (!bowlersMap[id]) {
      bowlersMap[id] = {
        legalBalls: 0,
        runsConceded: 0,
        wickets: 0,
        wides: 0,
        noBalls: 0,
        dots: 0,
        overBalls: [],
      };
    }
    return bowlersMap[id];
  }

  // Iterate chronologically through each ball event
  for (let i = 0; i < ballEvents.length; i++) {
    const ball = ballEvents[i];
    currentStrikerId = ball.strikerId;
    currentNonStrikerId = ball.nonStrikerId;
    currentBowlerId = ball.bowlerId;

    const striker = ensureBatter(ball.strikerId);
    if (ball.nonStrikerId) ensureBatter(ball.nonStrikerId);
    const bowler = ensureBowler(ball.bowlerId);

    // Initialize partnership batters if needed
    if (!partP1Id || !partP2Id) {
      partP1Id = ball.strikerId;
      partP2Id = ball.nonStrikerId;
    }

    let runsThisBall = ball.runsBat;
    let bowlerRunsCharged = 0;

    // Handle extras
    if (ball.extraType === "wide") {
      const wideCost = ball.extraRuns > 0 ? ball.extraRuns : rules.wideRunValue;
      extras.wides += wideCost;
      extras.total += wideCost;
      runsThisBall += wideCost;
      bowlerRunsCharged += wideCost;
      bowler.wides++;
    } else if (ball.extraType === "no_ball") {
      const nbCost = ball.extraRuns > 0 ? ball.extraRuns : rules.noBallRunValue;
      extras.noBalls += nbCost;
      extras.total += nbCost;
      runsThisBall += nbCost;
      bowlerRunsCharged += nbCost;
      bowler.noBalls++;
      // Batter faced a ball on no ball
      striker.ballsFaced++;
      partP1Balls++;
    } else if (ball.extraType === "bye") {
      const byeRuns = ball.extraRuns;
      extras.byes += byeRuns;
      extras.total += byeRuns;
      runsThisBall += byeRuns;
      striker.ballsFaced++;
      partP1Balls++;
    } else if (ball.extraType === "leg_bye") {
      const lbRuns = ball.extraRuns;
      extras.legByes += lbRuns;
      extras.total += lbRuns;
      runsThisBall += lbRuns;
      striker.ballsFaced++;
      partP1Balls++;
    } else if (ball.extraType === "penalty") {
      extras.penalties += ball.extraRuns;
      extras.total += ball.extraRuns;
      runsThisBall += ball.extraRuns;
    } else {
      // Normal legal delivery
      striker.ballsFaced++;
      partP1Balls++;
      if (ball.runsBat === 0) {
        bowler.dots++;
      }
    }

    // Batter scoring
    if (ball.runsBat > 0 && ball.extraType !== "bye" && ball.extraType !== "leg_bye") {
      striker.runs += ball.runsBat;
      bowlerRunsCharged += ball.runsBat;
      if (ball.runsBat === 4) striker.fours++;
      if (ball.runsBat === 6) striker.sixes++;

      // Partnership contribution
      if (ball.strikerId === partP1Id) {
        partP1Runs += ball.runsBat;
      } else {
        partP2Runs += ball.runsBat;
      }
    }

    bowler.runsConceded += bowlerRunsCharged;
    totalRuns += runsThisBall;
    currentPartRuns += runsThisBall;
    currentPartBalls++;

    // Legal ball increment
    if (ball.isLegal) {
      legalBallsCount++;
      bowler.legalBalls++;
    }

    currentOverBalls.push(ball);

    // Handle wicket
    if (ball.wicket) {
      const w = ball.wicket;
      if (w.type !== "retired_hurt") {
        totalWickets++;

        if (isDismissalCreditedToBowler(w.type)) {
          bowler.wickets++;
        }

        const outBatter = ensureBatter(w.dismissedPlayerId);
        outBatter.isOut = true;
        outBatter.dismissalText = getDismissalText(w, playersMap, ball.bowlerId);
        outBatter.dismissedByBowlerId = ball.bowlerId;
        outBatter.fielderIds = w.fielderIds;
        outBatter.wicketType = w.type;

        // Record fall of wicket
        fallOfWickets.push({
          wicketNumber: totalWickets,
          score: totalRuns,
          overs: formatOvers(legalBallsCount),
          playerId: w.dismissedPlayerId,
          partnershipRuns: currentPartRuns,
        });

        // Record completed partnership
        partnerships.push({
          wicketNumber: totalWickets,
          player1Id: partP1Id,
          player1Runs: partP1Runs,
          player1Balls: partP1Balls,
          player2Id: partP2Id,
          player2Runs: partP2Runs,
          player2Balls: partP2Balls,
          totalRuns: currentPartRuns,
          totalBalls: currentPartBalls,
        });

        // Reset partnership for next wicket
        currentPartRuns = 0;
        currentPartBalls = 0;
        partP1Id = w.dismissedPlayerId === ball.strikerId ? ball.nonStrikerId : ball.strikerId;
        partP1Runs = 0;
        partP1Balls = 0;
        partP2Id = ""; // to be assigned by next batter
        partP2Runs = 0;
        partP2Balls = 0;
      }
    }

    // End of over check (6 legal balls in current over)
    const legalBallsInCurrentOver = currentOverBalls.filter((b) => b.isLegal).length;
    if (legalBallsInCurrentOver === 6) {
      currentOverIndex++;
      const overRuns = currentOverBalls.reduce((acc, b) => {
        let r = b.runsBat;
        if (b.extraType === "wide" || b.extraType === "no_ball") {
          r += b.extraRuns > 0 ? b.extraRuns : (b.extraType === "wide" ? rules.wideRunValue : rules.noBallRunValue);
        } else if (b.extraType === "bye" || b.extraType === "leg_bye" || b.extraType === "penalty") {
          r += b.extraRuns;
        }
        return acc + r;
      }, 0);
      const overWickets = currentOverBalls.filter((b) => b.wicket && b.wicket.type !== "retired_hurt").length;

      overSummaries.push({
        overNumber: currentOverIndex,
        bowlerId: ball.bowlerId,
        runs: overRuns,
        wickets: overWickets,
        balls: [...currentOverBalls],
        cumulativeScore: totalRuns,
        cumulativeWickets: totalWickets,
      });

      currentOverBalls = [];
    }
  }

  // Calculate strike rates
  Object.values(battersMap).forEach((b) => {
    b.strikeRate = b.ballsFaced > 0 ? Number(((b.runs / b.ballsFaced) * 100).toFixed(1)) : 0;
  });

  // Calculate bowling maidens and economies
  const bowlingStats: BowlerInningsStat[] = [];
  Object.entries(bowlersMap).forEach(([pId, b]) => {
    const oversDecimal = parseOversToDecimal(b.legalBalls);
    const oversFraction = ballsToOversFraction(b.legalBalls);
    const econ = oversFraction > 0 ? Number((b.runsConceded / oversFraction).toFixed(2)) : 0;

    // Count maidens from over summaries bowled by this player
    const playerOverSummaries = overSummaries.filter((o) => o.bowlerId === pId);
    let maidens = 0;
    for (const os of playerOverSummaries) {
      // Maiden: 6 legal balls and 0 runs charged to bowler
      const bowlerRunsInOver = os.balls.reduce((acc, bl) => {
        let r = 0;
        if (bl.runsBat > 0 && bl.extraType !== "bye" && bl.extraType !== "leg_bye") {
          r += bl.runsBat;
        }
        if (bl.extraType === "wide") {
          r += bl.extraRuns > 0 ? bl.extraRuns : rules.wideRunValue;
        }
        if (bl.extraType === "no_ball") {
          r += bl.extraRuns > 0 ? bl.extraRuns : rules.noBallRunValue;
        }
        return acc + r;
      }, 0);
      if (bowlerRunsInOver === 0) maidens++;
    }

    bowlingStats.push({
      playerId: pId,
      overs: oversDecimal,
      legalBalls: b.legalBalls,
      maidens,
      runsConceded: b.runsConceded,
      wickets: b.wickets,
      economy: econ,
      wides: b.wides,
      noBalls: b.noBalls,
      dots: b.dots,
    });
  });

  // Did not bat players
  const battedPlayerIds = new Set(Object.keys(battersMap));
  const didNotBatPlayerIds = battingSquadIds.filter((id) => !battedPlayerIds.has(id));

  // Determine completion status
  const maxWickets = rules.lastManBatting ? rules.playersPerSide : rules.playersPerSide - 1;
  const maxLegalBalls = rules.overs * 6;

  let isCompleted = false;
  let completionReason: "all_out" | "overs_completed" | "target_reached" | "manual" | undefined;

  if (targetRuns !== undefined && totalRuns >= targetRuns) {
    isCompleted = true;
    completionReason = "target_reached";
  } else if (totalWickets >= maxWickets && battingSquadIds.length > 1) {
    isCompleted = true;
    completionReason = "all_out";
  } else if (legalBallsCount >= maxLegalBalls) {
    isCompleted = true;
    completionReason = "overs_completed";
  }

  const runRate = legalBallsCount > 0
    ? Number((totalRuns / ballsToOversFraction(legalBallsCount)).toFixed(2))
    : 0;

  // Batters sorted by batting order
  const sortedBatters = Object.values(battersMap).sort(
    (a, b) => a.battingOrder - b.battingOrder
  );

  return {
    inningsIndex: 0,
    battingTeamId: "",
    bowlingTeamId: "",
    totalRuns,
    totalWickets,
    legalBallsCount,
    oversFormatted: formatOvers(legalBallsCount),
    runRate,
    extras,
    batters: sortedBatters,
    bowlers: bowlingStats,
    fallOfWickets,
    partnerships,
    overSummaries,
    didNotBatPlayerIds,
    currentStrikerId,
    currentNonStrikerId,
    currentBowlerId,
    isCompleted,
    completionReason,
    targetRuns,
    isSuperOver,
  };
}

/**
 * Calculates MVP points according to documented formula in help.md:
 * - Batting: 1 pt per run, +10 for 30+, +20 for 50+, +50 for 100+, +10 if SR > 150 (min 15 runs).
 * - Bowling: 25 pts per wicket, +20 for 3W, +50 for 5W, +20 per maiden, +15 if Econ < 6.0 (min 2 overs).
 * - Fielding: 10 pts per catch/stumping, 15 pts per run out assist/dismissal.
 */
export function calculateMatchMVPPoints(
  scorecards: InningsScorecard[]
): Record<string, { total: number; bat: number; bowl: number; field: number }> {
  const mvpMap: Record<string, { total: number; bat: number; bowl: number; field: number }> = {};

  function ensure(id: string) {
    if (!mvpMap[id]) mvpMap[id] = { total: 0, bat: 0, bowl: 0, field: 0 };
    return mvpMap[id];
  }

  for (const sc of scorecards) {
    // Batting
    for (const b of sc.batters) {
      const p = ensure(b.playerId);
      let batPts = b.runs;
      if (b.runs >= 100) batPts += 50;
      else if (b.runs >= 50) batPts += 20;
      else if (b.runs >= 30) batPts += 10;

      if (b.runs >= 15 && b.strikeRate >= 150) {
        batPts += 10;
      }
      p.bat += batPts;
      p.total += batPts;
    }

    // Bowling
    for (const bw of sc.bowlers) {
      const p = ensure(bw.playerId);
      let bowlPts = bw.wickets * 25;
      if (bw.wickets >= 5) bowlPts += 50;
      else if (bw.wickets >= 3) bowlPts += 20;

      bowlPts += bw.maidens * 20;

      // Econ bonus if >= 2 overs bowled and econ < 6.0
      if (bw.legalBalls >= 12 && bw.economy < 6.0) {
        bowlPts += 15;
      }

      p.bowl += bowlPts;
      p.total += bowlPts;
    }

    // Fielding
    for (const b of sc.batters) {
      if (b.isOut && b.fielderIds) {
        for (const fId of b.fielderIds) {
          const p = ensure(fId);
          if (b.wicketType === "run_out") {
            p.field += 15;
            p.total += 15;
          } else if (b.wicketType === "caught" || b.wicketType === "caught_behind" || b.wicketType === "stumped") {
            p.field += 10;
            p.total += 10;
          }
        }
      }
    }
  }

  return mvpMap;
}

/**
 * Standard ICC Net Run Rate (NRR) computation.
 * When a team is all out within their quota, their overs faced are counted as the full quota.
 */
export function calculateTournamentPointsTable(
  matches: Array<{
    rules: MatchRules;
    status: string;
    winnerTeamId?: string;
    resultText?: string;
    innings: Array<{
      battingTeamId: string;
      bowlingTeamId: string;
      ballEvents: BallEvent[];
    }>;
  }>,
  teamIds: string[],
  winPoints = 2,
  tiePoints = 1,
  nrPoints = 1,
  playersMap: Record<string, Player> = {}
): PointsTableRow[] {
  const table: Record<string, PointsTableRow> = {};

  for (const tId of teamIds) {
    table[tId] = {
      teamId: tId,
      played: 0,
      won: 0,
      lost: 0,
      tied: 0,
      noResult: 0,
      points: 0,
      nrr: 0,
      runsScored: 0,
      oversFaced: 0,
      runsConceded: 0,
      oversBowled: 0,
    };
  }

  for (const match of matches) {
    if (match.status !== "completed") continue;
    if (!match.innings || match.innings.length < 2) continue;

    const inn1 = match.innings[0];
    const inn2 = match.innings[1];
    const sc1 = replayInnings(inn1.ballEvents, match.rules, [], [], playersMap);
    const sc2 = replayInnings(inn2.ballEvents, match.rules, [], [], playersMap, sc1.totalRuns + 1);

    const team1 = inn1.battingTeamId;
    const team2 = inn2.battingTeamId;

    if (!table[team1]) continue;
    if (!table[team2]) continue;

    table[team1].played++;
    table[team2].played++;

    // Result & points
    if (match.winnerTeamId === team1) {
      table[team1].won++;
      table[team1].points += winPoints;
      table[team2].lost++;
    } else if (match.winnerTeamId === team2) {
      table[team2].won++;
      table[team2].points += winPoints;
      table[team1].lost++;
    } else if (sc1.totalRuns === sc2.totalRuns) {
      table[team1].tied++;
      table[team2].tied++;
      table[team1].points += tiePoints;
      table[team2].points += tiePoints;
    } else {
      table[team1].noResult++;
      table[team2].noResult++;
      table[team1].points += nrPoints;
      table[team2].points += nrPoints;
    }

    // NRR Calculation
    // Full overs quota used if all-out
    const inn1OversFaced = sc1.completionReason === "all_out"
      ? match.rules.overs
      : ballsToOversFraction(sc1.legalBallsCount);

    const inn2OversFaced = sc2.completionReason === "all_out"
      ? match.rules.overs
      : ballsToOversFraction(sc2.legalBallsCount);

    table[team1].runsScored += sc1.totalRuns;
    table[team1].oversFaced += inn1OversFaced;
    table[team1].runsConceded += sc2.totalRuns;
    table[team1].oversBowled += inn2OversFaced;

    table[team2].runsScored += sc2.totalRuns;
    table[team2].oversFaced += inn2OversFaced;
    table[team2].runsConceded += sc1.totalRuns;
    table[team2].oversBowled += inn1OversFaced;
  }

  // Final NRR = (Total Runs For / Total Overs Faced) - (Total Runs Against / Total Overs Bowled)
  return Object.values(table).map((row) => {
    const forRate = row.oversFaced > 0 ? row.runsScored / row.oversFaced : 0;
    const againstRate = row.oversBowled > 0 ? row.runsConceded / row.oversBowled : 0;
    const nrr = Number((forRate - againstRate).toFixed(3));
    return { ...row, nrr };
  }).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return b.nrr - a.nrr;
  });
}

/**
 * Circle Method round-robin fixture generator
 */
export function generateRoundRobinFixtures(
  teamIds: string[],
  tournamentId: string
): Array<{
  id: string;
  tournamentId: string;
  roundName: string;
  teamAId: string;
  teamBId: string;
  status: "pending";
}> {
  const teams = [...teamIds];
  if (teams.length % 2 !== 0) {
    teams.push("BYE");
  }

  const numRounds = teams.length - 1;
  const half = teams.length / 2;
  const fixtures: Array<{
    id: string;
    tournamentId: string;
    roundName: string;
    teamAId: string;
    teamBId: string;
    status: "pending";
  }> = [];

  let currentTeams = [...teams];

  for (let round = 0; round < numRounds; round++) {
    for (let i = 0; i < half; i++) {
      const teamA = currentTeams[i];
      const teamB = currentTeams[currentTeams.length - 1 - i];

      if (teamA !== "BYE" && teamB !== "BYE") {
        fixtures.push({
          id: `fix_${tournamentId}_${round + 1}_${i + 1}`,
          tournamentId,
          roundName: `Round ${round + 1}`,
          teamAId: teamA,
          teamBId: teamB,
          status: "pending",
        });
      }
    }

    // Rotate elements, keeping first fixed
    const fixed = currentTeams[0];
    const rest = currentTeams.slice(1);
    const last = rest.pop()!;
    currentTeams = [fixed, last, ...rest];
  }

  return fixtures;
}

/**
 * Plain-text template-based commentary generator (zero network, zero AI)
 */
export function generateBallCommentary(
  ball: {
    runsBat: number;
    extraType: string;
    extraRuns: number;
    isLegal: boolean;
    wicket?: DismissalInfo;
    shotDirection?: string;
  },
  strikerName: string,
  bowlerName: string
): string {
  if (ball.wicket) {
    const w = ball.wicket;
    switch (w.type) {
      case "bowled":
        return `WICKET! Clean bowled! ${bowlerName} breaks through the defence of ${strikerName}. Absolute ripper!`;
      case "caught":
      case "caught_behind":
        return `WICKET! In the air and TAKEN! ${strikerName} departs off the bowling of ${bowlerName}.`;
      case "lbw":
        return `WICKET! Loud appeal, given! ${strikerName} trapped in front by ${bowlerName}.`;
      case "run_out":
        return `WICKET! Run out! Direct hit or quick work at the stumps finds ${strikerName} short of ground.`;
      case "stumped":
        return `WICKET! Stumped! ${strikerName} steps out, beaten in flight, keeper takes the bails off in a flash.`;
      default:
        return `WICKET! ${strikerName} is dismissed (${w.type.replace("_", " ")}). Big moment in the match!`;
    }
  }

  if (ball.extraType === "wide") {
    return `${bowlerName} sprays it wide outside the tramline. Wide called by the umpire.`;
  }
  if (ball.extraType === "no_ball") {
    return `No-ball called! Overstepping by ${bowlerName}. Free hit coming up!`;
  }
  if (ball.extraType === "bye") {
    return `Beaten outside off, batters steal ${ball.extraRuns} bye(s).`;
  }
  if (ball.extraType === "leg_bye") {
    return `Off the pads, deflects into the gap for ${ball.extraRuns} leg-bye(s).`;
  }

  const dirText = ball.shotDirection ? ` toward ${ball.shotDirection.replace("_", " ")}` : "";

  switch (ball.runsBat) {
    case 0:
      return `${bowlerName} lands it on a good length to ${strikerName}, defended cleanly. Dot ball.`;
    case 1:
      return `${strikerName} works it gently${dirText} for a brisk single.`;
    case 2:
      return `Nicely placed in the gap${dirText}. Excellent running between the wickets for a brace.`;
    case 3:
      return `Pushed deep into the outfield${dirText}, good hustle allows them to turn for three runs.`;
    case 4:
      return `FOUR! Beautifully timed by ${strikerName}${dirText}, races across the turf for a boundary!`;
    case 6:
      return `SIX! High, handsome and into the crowd! Massive hit by ${strikerName}${dirText}!`;
    default:
      return `${strikerName} picks up ${ball.runsBat} runs${dirText}.`;
  }
}
