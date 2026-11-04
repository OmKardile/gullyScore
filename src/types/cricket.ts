/**
 * Domain Models for GullyScore
 * Offline-first, event-sourced cricket scoring and tournament engine.
 */

export type PlayerRole = "batsman" | "bowler" | "all_rounder" | "wicket_keeper";
export type BattingHand = "right" | "left";
export type BowlingStyle = 
  | "rf"       // Right-arm Fast
  | "rm"       // Right-arm Medium
  | "spin_off" // Off spin
  | "spin_leg" // Leg spin
  | "lf"       // Left-arm Fast
  | "lm"       // Left-arm Medium
  | "sla"      // Slow Left-arm
  | "other";

export interface Player {
  id: string;
  name: string;
  nickname?: string;
  role: PlayerRole;
  battingHand: BattingHand;
  bowlingStyle: BowlingStyle;
  photoUri?: string;
  isArchived: boolean;
  createdAt: number;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  color: string;      // 2dp accent line/dot (e.g. #2563EB, #059669, #D97706)
  monogram: string;   // 2-3 char serif letters
  captainId?: string;
  playerIds: string[];
  isArchived?: boolean;
  createdAt: number;
}

export type BallType = "tennis" | "leather" | "box";

export interface MatchRules {
  overs: number;
  playersPerSide: number;
  ballType: BallType;
  wideRunValue: number;       // 0, 1, or 2 (default 1)
  noBallRunValue: number;     // 1 or 2 (default 1)
  freeHitOnNoBall: boolean;   // default true
  lastManBatting: boolean;    // default false
  maxOversPerBowler: number;  // default ceil(overs/5)
  noConsecutiveOvers: boolean;// default true
  superOverOnTie: boolean;    // default false
  trackShotDirection: boolean;// default true
}

export interface Toss {
  winnerTeamId: string;
  decision: "bat" | "bowl";
}

export type ExtraType = "none" | "wide" | "no_ball" | "bye" | "leg_bye" | "penalty";

export type WicketType = 
  | "bowled"
  | "caught"
  | "caught_bowled"
  | "caught_behind"
  | "lbw"
  | "run_out"
  | "stumped"
  | "hit_wicket"
  | "hit_ball_twice"
  | "obstructing_field"
  | "handled_ball"
  | "timed_out"
  | "retired_out"
  | "retired_hurt"; // Not a wicket; player can return

export type ShotDirection = 
  | "fine_leg"
  | "square_leg"
  | "mid_wicket"
  | "long_on"
  | "straight"
  | "long_off"
  | "cover"
  | "point"
  | "third_man";

export interface DismissalInfo {
  type: WicketType;
  dismissedPlayerId: string;
  dismissedEnd: "striker" | "non_striker";
  fielderIds: string[];       // e.g. for catch, run out assist
  runsCompleted: number;      // runs completed before run out
}

export interface BallEvent {
  id: string;
  seq: number;                // 1..N order in the innings
  inningsIndex: number;       // 0 = 1st innings, 1 = 2nd innings, 2 = super over
  overNumber: number;         // 0-indexed (e.g. 0 for 1st over)
  ballInOver: number;         // 1..6 legal ball index
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  runsBat: number;            // 0, 1, 2, 3, 4, 6
  extraType: ExtraType;
  extraRuns: number;          // additional runs from wide/nb/penalty
  isLegal: boolean;           // false if wide or no-ball
  wicket?: DismissalInfo;
  shotDirection?: ShotDirection;
  isFreeHit: boolean;
  timestamp: number;
  commentaryText: string;
}

export interface BatterInningsStat {
  playerId: string;
  runs: number;
  ballsFaced: number;
  fours: number;
  sixes: number;
  strikeRate: number;
  isOut: boolean;
  dismissalText?: string;
  dismissedByBowlerId?: string;
  fielderIds?: string[];
  wicketType?: WicketType;
  battingOrder: number;
}

export interface BowlerInningsStat {
  playerId: string;
  overs: number;              // decimal representation (e.g. 3.4)
  legalBalls: number;
  maidens: number;
  runsConceded: number;
  wickets: number;
  economy: number;
  wides: number;
  noBalls: number;
  dots: number;
}

export interface FallOfWicket {
  wicketNumber: number;
  score: number;
  overs: string;
  playerId: string;
  partnershipRuns: number;
}

export interface Partnership {
  wicketNumber: number;
  player1Id: string;
  player1Runs: number;
  player1Balls: number;
  player2Id: string;
  player2Runs: number;
  player2Balls: number;
  totalRuns: number;
  totalBalls: number;
}

export interface OverSummary {
  overNumber: number;         // 1-indexed
  bowlerId: string;
  runs: number;
  wickets: number;
  balls: BallEvent[];
  cumulativeScore: number;
  cumulativeWickets: number;
}

export interface ExtrasBreakdown {
  wides: number;
  noBalls: number;
  byes: number;
  legByes: number;
  penalties: number;
  total: number;
}

export interface InningsScorecard {
  inningsIndex: number;
  battingTeamId: string;
  bowlingTeamId: string;
  totalRuns: number;
  totalWickets: number;
  legalBallsCount: number;
  oversFormatted: string;     // e.g. "14.2"
  runRate: number;
  extras: ExtrasBreakdown;
  batters: BatterInningsStat[];
  bowlers: BowlerInningsStat[];
  fallOfWickets: FallOfWicket[];
  partnerships: Partnership[];
  overSummaries: OverSummary[];
  didNotBatPlayerIds: string[];
  currentStrikerId?: string;
  currentNonStrikerId?: string;
  currentBowlerId?: string;
  isCompleted: boolean;
  completionReason?: "all_out" | "overs_completed" | "target_reached" | "manual";
  targetRuns?: number;
  isSuperOver?: boolean;
}

export type MatchStatus = "setup" | "live" | "completed" | "abandoned";

export interface Match {
  id: string;
  teamAId: string;
  teamBId: string;
  teamAPlayerIds: string[];
  teamBPlayerIds: string[];
  date: string;
  venue: string;
  rules: MatchRules;
  toss?: Toss;
  status: MatchStatus;
  currentInningsIndex: number;
  innings: {
    battingTeamId: string;
    bowlingTeamId: string;
    targetRuns?: number;
    isSuperOver?: boolean;
    ballEvents: BallEvent[];
  }[];
  resultText?: string;
  winnerTeamId?: string;
  playerOfTheMatchId?: string;
  playerOfTheMatchOverridden?: boolean;
  tournamentId?: string;
  fixtureId?: string;
  isArchived?: boolean;
  updatedAt: number;
}

export type TournamentFormat = "round_robin" | "knockout" | "round_robin_knockout";

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  teamIds: string[];
  rules: MatchRules;
  status: "upcoming" | "in_progress" | "completed";
  winPoints: number;
  tiePoints: number;
  nrPoints: number;
  createdAt: number;
}

export interface Fixture {
  id: string;
  tournamentId: string;
  roundName: string;
  teamAId: string;
  teamBId: string;
  matchId?: string;
  scheduledDate?: string;
  venue?: string;
  status: "pending" | "completed";
}

export interface PointsTableRow {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  noResult: number;
  points: number;
  nrr: number;
  runsScored: number;
  oversFaced: number;
  runsConceded: number;
  oversBowled: number;
}

export interface PlayerCareerStats {
  playerId: string;
  matches: number;
  innings: number;
  runs: number;
  ballsFaced: number;
  highestScore: number;
  highestScoreNotOut: boolean;
  average: number;
  strikeRate: number;
  fours: number;
  sixes: number;
  thirties: number;
  fifties: number;
  hundreds: number;
  notOuts: number;
  ducks: number;
  // Bowling
  oversBowled: number;
  maidens: number;
  runsConceded: number;
  wickets: number;
  bowlingAverage: number;
  bowlingEconomy: number;
  bowlingStrikeRate: number;
  bestBowlingWickets: number;
  bestBowlingRuns: number;
  threeWickets: number;
  fiveWickets: number;
  widesConceded: number;
  noBallsConceded: number;
  // Fielding
  catches: number;
  stumpings: number;
  runOuts: number;
  // MVP
  mvpPoints: number;
}
