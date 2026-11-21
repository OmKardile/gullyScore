//! Port of `GullyScoreRN/src/engine/scoringEngine.ts` — 100% of its exports.
//!
//! Event-sourced cricket engine, deterministic replay, zero UI dependencies.
//! Each function mirrors its TS original one-to-one (see the fidelity notes
//! inline); the recorded cases in `cases.jsonl` are the behavioral proof.

use crate::js_to_fixed_num;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

// ===========================================================================
// Domain types (mirrors of GullyScoreRN/src/types/cricket.ts — camelCase wire)
// ===========================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BallType {
    Tennis,
    Leather,
    Box,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtraType {
    None,
    Wide,
    NoBall,
    Bye,
    LegBye,
    Penalty,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WicketType {
    Bowled,
    Caught,
    CaughtBowled,
    CaughtBehind,
    Lbw,
    RunOut,
    Stumped,
    HitWicket,
    HitBallTwice,
    ObstructingField,
    HandledBall,
    TimedOut,
    RetiredOut,
    RetiredHurt, // not a wicket; the player can return
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DismissedEnd {
    Striker,
    NonStriker,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DismissalInfo {
    #[serde(rename = "type")]
    pub wicket_type: WicketType,
    pub dismissed_player_id: String,
    pub dismissed_end: DismissedEnd,
    pub fielder_ids: Vec<String>,
    pub runs_completed: i64,
}

/// BallEvent projection: the 8 fields the engines read (see rust/PORT_MAP.md).
/// Unknown fields in recorded JSON are ignored, like the TS side ignoring
/// fields it never touches.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BallEvent {
    pub striker_id: String,
    pub non_striker_id: String,
    pub bowler_id: String,
    pub runs_bat: i64,
    pub extra_type: ExtraType,
    pub extra_runs: i64,
    pub is_legal: bool,
    /// TS `wicket?: DismissalInfo` — absent when no dismissal, so None must
    /// not serialize as `null` (JSON.stringify drops undefined keys).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wicket: Option<DismissalInfo>,
}

/// Full MatchRules shape (all 10 fields), mirroring the original interface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchRules {
    pub overs: i64,
    pub players_per_side: i64,
    pub ball_type: BallType,
    pub wide_run_value: i64,
    pub no_ball_run_value: i64,
    pub free_hit_on_no_ball: bool,
    pub last_man_batting: bool,
    pub max_overs_per_bowler: i64,
    pub no_consecutive_overs: bool,
    pub super_over_on_tie: bool,
    pub track_shot_direction: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlayerRole {
    Batsman,
    Bowler,
    AllRounder,
    WicketKeeper,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BattingHand {
    Right,
    Left,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BowlingStyle {
    Rf,
    Rm,
    SpinOff,
    SpinLeg,
    Lf,
    Lm,
    Sla,
    Other,
}

/// Player domain type — only echoed and name-looked-up by the engines.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nickname: Option<String>,
    pub role: PlayerRole,
    pub batting_hand: BattingHand,
    pub bowling_style: BowlingStyle,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photo_uri: Option<String>,
    pub is_archived: bool,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

/// Live crease/bowling state derived from an event log.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveCreaseState {
    pub striker_id: String,
    pub non_striker_id: String,
    pub bowler_id: String,
    pub pending_batter: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtrasBreakdown {
    pub wides: i64,
    pub no_balls: i64,
    pub byes: i64,
    pub leg_byes: i64,
    pub penalties: i64,
    pub total: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatterInningsStat {
    pub player_id: String,
    pub runs: i64,
    pub balls_faced: i64,
    pub fours: i64,
    pub sixes: i64,
    pub strike_rate: f64,
    pub is_out: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissal_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissed_by_bowler_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fielder_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wicket_type: Option<WicketType>,
    pub batting_order: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BowlerInningsStat {
    /// decimal overs representation, e.g. 3.4 (via parseOversToDecimal)
    pub overs: f64,
    pub legal_balls: i64,
    pub maidens: i64,
    pub runs_conceded: i64,
    pub wickets: i64,
    pub economy: f64,
    pub wides: i64,
    pub no_balls: i64,
    pub dots: i64,
    // note: the TS accumulator also keeps an (unused) overBalls field that
    // never reaches the output; the port keeps player_id via the map key.
    pub player_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FallOfWicket {
    pub wicket_number: i64,
    pub score: i64,
    pub overs: String,
    pub player_id: String,
    pub partnership_runs: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Partnership {
    pub wicket_number: i64,
    pub player1_id: String,
    pub player1_runs: i64,
    pub player1_balls: i64,
    pub player2_id: String,
    pub player2_runs: i64,
    pub player2_balls: i64,
    pub total_runs: i64,
    pub total_balls: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverSummary {
    pub over_number: i64,
    pub bowler_id: String,
    pub runs: i64,
    pub wickets: i64,
    pub balls: Vec<BallEvent>,
    pub cumulative_score: i64,
    pub cumulative_wickets: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InningsScorecard {
    pub innings_index: i64,
    pub batting_team_id: String,
    pub bowling_team_id: String,
    pub total_runs: i64,
    pub total_wickets: i64,
    pub legal_balls_count: i64,
    pub overs_formatted: String,
    pub run_rate: f64,
    pub extras: ExtrasBreakdown,
    pub batters: Vec<BatterInningsStat>,
    pub bowlers: Vec<BowlerInningsStat>,
    pub fall_of_wickets: Vec<FallOfWicket>,
    pub partnerships: Vec<Partnership>,
    pub over_summaries: Vec<OverSummary>,
    pub did_not_bat_player_ids: Vec<String>,
    pub current_striker_id: String,
    pub current_non_striker_id: String,
    pub current_bowler_id: String,
    pub is_completed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_runs: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_super_over: Option<bool>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MvpPoints {
    pub total: i64,
    pub bat: i64,
    pub bowl: i64,
    pub field: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointsTableRow {
    pub team_id: String,
    pub played: i64,
    pub won: i64,
    pub lost: i64,
    pub tied: i64,
    pub no_result: i64,
    pub points: i64,
    pub nrr: f64,
    pub runs_scored: i64,
    pub overs_faced: f64,
    pub runs_conceded: i64,
    pub overs_bowled: f64,
}

/// Innings slice used by `calculateTournamentPointsTable` (its own local type
/// in TS — status is a loose string there, kept as String for fidelity).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentMatchInnings {
    pub batting_team_id: String,
    pub bowling_team_id: String,
    pub ball_events: Vec<BallEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentMatchSummary {
    pub rules: MatchRules,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner_team_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_a_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_a_player_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team_b_player_ids: Option<Vec<String>>,
    pub innings: Vec<TournamentMatchInnings>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundRobinFixture {
    pub id: String,
    pub tournament_id: String,
    pub round_name: String,
    pub team_a_id: String,
    pub team_b_id: String,
    /// the generator always emits "pending"
    pub status: String,
}

/// The loose ball shape `generateBallCommentary` takes (extraType and
/// shotDirection are plain strings in the TS signature).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentaryBall {
    pub runs_bat: i64,
    pub extra_type: String,
    pub extra_runs: i64,
    pub is_legal: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wicket: Option<DismissalInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shot_direction: Option<String>,
}

// ===========================================================================
// Round 1 — the crease unit
// ===========================================================================

/// TS: `formatOvers` — `${Math.floor(n / 6)}.${n % 6}`.
///
/// JS `%` truncates toward zero while `Math.floor` rounds toward -inf;
/// `div_euclid` is floor division and `%` is truncating, so together they
/// reproduce the JS pair exactly for every integer input.
pub fn format_overs(legal_balls: i64) -> String {
    let overs = legal_balls.div_euclid(6);
    let balls = legal_balls % 6;
    format!("{overs}.{balls}")
}

/// TS: `parseOversToDecimal` — `Number(`${overs}.${balls}`)`.
///
/// The value goes through shortest decimal TEXT, so 13 legal balls is 2.1,
/// not 13/6 = 2.1666… — the decimal overs notation carries "3.4" = 3 overs
/// AND 4 balls, not 3.4.
pub fn parse_overs_to_decimal(legal_balls: i64) -> f64 {
    let overs = legal_balls.div_euclid(6);
    let balls = legal_balls % 6;
    format!("{overs}.{balls}")
        .parse::<f64>()
        .unwrap_or(f64::NAN)
}

/// TS: `ballsToOversFraction` — `n / 6` as a true fraction (for run rates).
pub fn balls_to_overs_fraction(legal_balls: i64) -> f64 {
    legal_balls as f64 / 6.0
}

/// TS: `isDismissalCreditedToBowler` — the 7 dismissal types charged to the bowler.
pub fn is_dismissal_credited_to_bowler(wicket_type: WicketType) -> bool {
    matches!(
        wicket_type,
        WicketType::Bowled
            | WicketType::Caught
            | WicketType::CaughtBowled
            | WicketType::CaughtBehind
            | WicketType::Lbw
            | WicketType::Stumped
            | WicketType::HitWicket
    )
}

/// TS: `deriveLiveCrease` — simulate the crease forward from an event log.
///
/// `ball_events` is `Option` because JS callers can pass `null`/`undefined`
/// and the original guards with `!ballEvents` — the Option IS that guard.
#[allow(clippy::needless_pass_by_value)]
pub fn derive_live_crease(
    ball_events: Option<&[BallEvent]>,
    rules: &MatchRules,
    batting_squad_ids: &[String],
    bowling_squad_ids: &[String],
) -> Option<LiveCreaseState> {
    let events = ball_events?;
    if events.is_empty() {
        return None;
    }
    let mut striker = batting_squad_ids.first().cloned().unwrap_or_default();
    let mut non_striker = batting_squad_ids.get(1).cloned().unwrap_or_default();
    let mut bowler = bowling_squad_ids.first().cloned().unwrap_or_default();
    let mut legal_balls: i64 = 0;
    let mut pending_batter = false;

    for ball in events {
        if !ball.striker_id.is_empty() {
            striker = ball.striker_id.clone();
        }
        if !ball.non_striker_id.is_empty() {
            non_striker = ball.non_striker_id.clone();
        }
        if !ball.bowler_id.is_empty() {
            bowler = ball.bowler_id.clone();
        }
        pending_batter = false;

        let runs_completed = ball
            .wicket
            .as_ref()
            .map(|w| w.runs_completed)
            .unwrap_or(ball.runs_bat);
        let mut total_runs_ran = runs_completed;
        if matches!(ball.extra_type, ExtraType::Bye | ExtraType::LegBye) {
            total_runs_ran += ball.extra_runs;
        }
        if total_runs_ran % 2 != 0 && !striker.is_empty() && !non_striker.is_empty() {
            std::mem::swap(&mut striker, &mut non_striker);
        }

        if let Some(w) = &ball.wicket {
            if w.wicket_type != WicketType::RetiredHurt {
                pending_batter = true;
            }
        }

        if ball.is_legal {
            legal_balls += 1;
            if legal_balls % 6 == 0
                && !rules.last_man_batting
                && !striker.is_empty()
                && !non_striker.is_empty()
            {
                std::mem::swap(&mut striker, &mut non_striker);
            }
        }
    }

    Some(LiveCreaseState {
        striker_id: striker,
        non_striker_id: non_striker,
        bowler_id: bowler,
        pending_batter,
    })
}

// ===========================================================================
// Round 2 — the rest of the engine
// ===========================================================================

/// TS: `getDismissalText` — scorecard dismissal line.
///
/// JS `||` semantics matter: an EMPTY player name falls back to
/// "Bowler"/"Fielder", and missing fielders produce the `c & b` variants.
pub fn get_dismissal_text(
    dismissal: &DismissalInfo,
    players_map: &IndexMap<String, Player>,
    bowler_id: &str,
) -> String {
    // playersMap[bowlerId]?.name || "Bowler"
    let bowler_name = players_map
        .get(bowler_id)
        .map(|p| p.name.clone())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Bowler".to_string());
    let fielder_names = dismissal
        .fielder_ids
        .iter()
        .map(|id| {
            players_map
                .get(id)
                .map(|p| p.name.clone())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "Fielder".to_string())
        })
        .collect::<Vec<_>>()
        .join(", ");

    match dismissal.wicket_type {
        WicketType::Bowled => format!("b {bowler_name}"),
        WicketType::Caught => {
            if !fielder_names.is_empty() {
                format!("c {fielder_names} b {bowler_name}")
            } else {
                format!("c & b {bowler_name}")
            }
        }
        WicketType::CaughtBowled => format!("c & b {bowler_name}"),
        WicketType::CaughtBehind => {
            if !fielder_names.is_empty() {
                format!("c †{fielder_names} b {bowler_name}")
            } else {
                format!("c & b {bowler_name}")
            }
        }
        WicketType::Lbw => format!("lbw b {bowler_name}"),
        WicketType::RunOut => {
            if !fielder_names.is_empty() {
                format!("run out ({fielder_names})")
            } else {
                "run out".to_string()
            }
        }
        WicketType::Stumped => {
            if !fielder_names.is_empty() {
                format!("st †{fielder_names} b {bowler_name}")
            } else {
                format!("st b {bowler_name}")
            }
        }
        WicketType::HitWicket => format!("hit wicket b {bowler_name}"),
        WicketType::HitBallTwice => "hit the ball twice".to_string(),
        WicketType::ObstructingField => "obstructing the field".to_string(),
        WicketType::HandledBall => "handled the ball".to_string(),
        WicketType::TimedOut => "timed out".to_string(),
        WicketType::RetiredOut => "retired out".to_string(),
        WicketType::RetiredHurt => "retired hurt".to_string(),
    }
}

/// Accumulator mirroring the TS `bowlersMap` values (the unused `overBalls`
/// field of the original is dead data and is not ported).
#[derive(Debug, Clone, Default)]
struct BowlerAcc {
    legal_balls: i64,
    runs_conceded: i64,
    wickets: i64,
    wides: i64,
    no_balls: i64,
    dots: i64,
}

/// TS: `replayInnings` — deterministically replays a ball-event log into the
/// complete innings scorecard. The single most important function in the app.
#[allow(clippy::too_many_arguments)]
pub fn replay_innings(
    ball_events: &[BallEvent],
    rules: &MatchRules,
    batting_squad_ids: &[String],
    _bowling_squad_ids: &[String],
    players_map: &IndexMap<String, Player>,
    target_runs: Option<i64>,
    is_super_over: Option<bool>,
) -> InningsScorecard {
    let mut extras = ExtrasBreakdown::default();

    // IndexMaps keep JS object insertion order (batters are re-sorted by
    // batting order at the end; bowlers come out in first-appearance order).
    let mut batters: IndexMap<String, BatterInningsStat> = IndexMap::new();
    let mut bowlers: IndexMap<String, BowlerAcc> = IndexMap::new();
    let mut batting_order_counter: i64 = 0;

    let mut fall_of_wickets: Vec<FallOfWicket> = Vec::new();
    let mut partnerships: Vec<Partnership> = Vec::new();
    let mut over_summaries: Vec<OverSummary> = Vec::new();

    let mut total_runs: i64 = 0;
    let mut total_wickets: i64 = 0;
    let mut legal_balls_count: i64 = 0;

    let mut current_striker_id = String::new();
    let mut current_non_striker_id = String::new();
    let mut current_bowler_id = String::new();

    // Active partnership trackers
    let mut current_part_runs: i64 = 0;
    let mut current_part_balls: i64 = 0;
    let mut part_p1_id = String::new();
    let mut part_p1_runs: i64 = 0;
    let mut part_p1_balls: i64 = 0;
    let mut part_p2_id = String::new();
    let mut part_p2_runs: i64 = 0;
    let mut part_p2_balls: i64 = 0;

    let mut current_over_balls: Vec<BallEvent> = Vec::new();
    let mut current_over_index: i64 = 0;

    fn ensure_batter(
        id: &str,
        batters: &mut IndexMap<String, BatterInningsStat>,
        counter: &mut i64,
    ) {
        if !batters.contains_key(id) {
            *counter += 1;
            batters.insert(
                id.to_string(),
                BatterInningsStat {
                    player_id: id.to_string(),
                    runs: 0,
                    balls_faced: 0,
                    fours: 0,
                    sixes: 0,
                    strike_rate: 0.0,
                    is_out: false,
                    dismissal_text: None,
                    dismissed_by_bowler_id: None,
                    fielder_ids: None,
                    wicket_type: None,
                    batting_order: *counter,
                },
            );
        }
    }

    for ball in ball_events {
        current_striker_id = ball.striker_id.clone();
        current_non_striker_id = ball.non_striker_id.clone();
        current_bowler_id = ball.bowler_id.clone();

        ensure_batter(&ball.striker_id, &mut batters, &mut batting_order_counter);
        if !ball.non_striker_id.is_empty() {
            ensure_batter(
                &ball.non_striker_id,
                &mut batters,
                &mut batting_order_counter,
            );
        }
        // ensureBowler runs unconditionally — an empty bowlerId still creates
        // a "" entry in the original.
        bowlers.entry(ball.bowler_id.clone()).or_default();

        // Initialize partnership batters if needed
        if part_p1_id.is_empty() || part_p2_id.is_empty() {
            part_p1_id = ball.striker_id.clone();
            part_p2_id = ball.non_striker_id.clone();
        }

        let mut runs_this_ball = ball.runs_bat;
        let mut bowler_runs_charged: i64 = 0;

        match ball.extra_type {
            ExtraType::Wide => {
                let wide_cost = if ball.extra_runs > 0 {
                    ball.extra_runs
                } else {
                    rules.wide_run_value
                };
                extras.wides += wide_cost;
                extras.total += wide_cost;
                runs_this_ball += wide_cost;
                bowler_runs_charged += wide_cost;
                bowlers.get_mut(&ball.bowler_id).unwrap().wides += 1;
            }
            ExtraType::NoBall => {
                let nb_cost = if ball.extra_runs > 0 {
                    ball.extra_runs
                } else {
                    rules.no_ball_run_value
                };
                extras.no_balls += nb_cost;
                extras.total += nb_cost;
                runs_this_ball += nb_cost;
                bowler_runs_charged += nb_cost;
                bowlers.get_mut(&ball.bowler_id).unwrap().no_balls += 1;
                // Batter faced a ball on no ball
                batters.get_mut(&ball.striker_id).unwrap().balls_faced += 1;
                if ball.striker_id == part_p1_id {
                    part_p1_balls += 1;
                } else {
                    part_p2_balls += 1;
                }
            }
            ExtraType::Bye => {
                let bye_runs = ball.extra_runs;
                extras.byes += bye_runs;
                extras.total += bye_runs;
                runs_this_ball += bye_runs;
                batters.get_mut(&ball.striker_id).unwrap().balls_faced += 1;
                if ball.striker_id == part_p1_id {
                    part_p1_balls += 1;
                } else {
                    part_p2_balls += 1;
                }
            }
            ExtraType::LegBye => {
                let lb_runs = ball.extra_runs;
                extras.leg_byes += lb_runs;
                extras.total += lb_runs;
                runs_this_ball += lb_runs;
                batters.get_mut(&ball.striker_id).unwrap().balls_faced += 1;
                if ball.striker_id == part_p1_id {
                    part_p1_balls += 1;
                } else {
                    part_p2_balls += 1;
                }
            }
            ExtraType::Penalty => {
                extras.penalties += ball.extra_runs;
                extras.total += ball.extra_runs;
                runs_this_ball += ball.extra_runs;
            }
            ExtraType::None => {
                // Normal legal delivery
                batters.get_mut(&ball.striker_id).unwrap().balls_faced += 1;
                if ball.striker_id == part_p1_id {
                    part_p1_balls += 1;
                } else {
                    part_p2_balls += 1;
                }
                if ball.runs_bat == 0 {
                    bowlers.get_mut(&ball.bowler_id).unwrap().dots += 1;
                }
            }
        }

        // Batter scoring (byes and leg-byes never credit the batter)
        if ball.runs_bat > 0
            && ball.extra_type != ExtraType::Bye
            && ball.extra_type != ExtraType::LegBye
        {
            let striker = batters.get_mut(&ball.striker_id).unwrap();
            striker.runs += ball.runs_bat;
            if ball.runs_bat == 4 {
                striker.fours += 1;
            }
            if ball.runs_bat == 6 {
                striker.sixes += 1;
            }
            bowler_runs_charged += ball.runs_bat;

            if ball.striker_id == part_p1_id {
                part_p1_runs += ball.runs_bat;
            } else {
                part_p2_runs += ball.runs_bat;
            }
        }

        bowlers.get_mut(&ball.bowler_id).unwrap().runs_conceded += bowler_runs_charged;
        total_runs += runs_this_ball;
        current_part_runs += runs_this_ball;
        current_part_balls += 1;

        if ball.is_legal {
            legal_balls_count += 1;
            bowlers.get_mut(&ball.bowler_id).unwrap().legal_balls += 1;
        }

        current_over_balls.push(ball.clone());

        // Handle wicket
        if let Some(w) = &ball.wicket {
            if w.wicket_type != WicketType::RetiredHurt {
                total_wickets += 1;

                if is_dismissal_credited_to_bowler(w.wicket_type) {
                    bowlers.get_mut(&ball.bowler_id).unwrap().wickets += 1;
                }

                ensure_batter(
                    &w.dismissed_player_id,
                    &mut batters,
                    &mut batting_order_counter,
                );
                let out_batter = batters.get_mut(&w.dismissed_player_id).unwrap();
                out_batter.is_out = true;
                out_batter.dismissal_text =
                    Some(get_dismissal_text(w, players_map, &ball.bowler_id));
                out_batter.dismissed_by_bowler_id = Some(ball.bowler_id.clone());
                out_batter.fielder_ids = Some(w.fielder_ids.clone());
                out_batter.wicket_type = Some(w.wicket_type);

                fall_of_wickets.push(FallOfWicket {
                    wicket_number: total_wickets,
                    score: total_runs,
                    overs: format_overs(legal_balls_count),
                    player_id: w.dismissed_player_id.clone(),
                    partnership_runs: current_part_runs,
                });

                partnerships.push(Partnership {
                    wicket_number: total_wickets,
                    player1_id: part_p1_id.clone(),
                    player1_runs: part_p1_runs,
                    player1_balls: part_p1_balls,
                    player2_id: part_p2_id.clone(),
                    player2_runs: part_p2_runs,
                    player2_balls: part_p2_balls,
                    total_runs: current_part_runs,
                    total_balls: current_part_balls,
                });

                // Reset partnership for the next pair
                current_part_runs = 0;
                current_part_balls = 0;
                part_p1_id = if w.dismissed_player_id == ball.striker_id {
                    ball.non_striker_id.clone()
                } else {
                    ball.striker_id.clone()
                };
                part_p1_runs = 0;
                part_p1_balls = 0;
                part_p2_id = String::new(); // assigned by the next batter
                part_p2_runs = 0;
                part_p2_balls = 0;
            }
        }

        // End of over: 6 legal balls in the current over
        let legal_balls_in_current_over = current_over_balls.iter().filter(|b| b.is_legal).count();
        if legal_balls_in_current_over == 6 {
            current_over_index += 1;
            let over_runs: i64 = current_over_balls.iter().fold(0, |acc, b| {
                let mut r = b.runs_bat;
                if b.extra_type == ExtraType::Wide || b.extra_type == ExtraType::NoBall {
                    r += if b.extra_runs > 0 {
                        b.extra_runs
                    } else if b.extra_type == ExtraType::Wide {
                        rules.wide_run_value
                    } else {
                        rules.no_ball_run_value
                    };
                } else if matches!(
                    b.extra_type,
                    ExtraType::Bye | ExtraType::LegBye | ExtraType::Penalty
                ) {
                    r += b.extra_runs;
                }
                acc + r
            });
            let over_wickets = current_over_balls
                .iter()
                .filter(|b| {
                    b.wicket
                        .as_ref()
                        .map(|w| w.wicket_type != WicketType::RetiredHurt)
                        .unwrap_or(false)
                })
                .count() as i64;

            over_summaries.push(OverSummary {
                over_number: current_over_index,
                bowler_id: ball.bowler_id.clone(),
                runs: over_runs,
                wickets: over_wickets,
                balls: current_over_balls.clone(),
                cumulative_score: total_runs,
                cumulative_wickets: total_wickets,
            });

            current_over_balls.clear();
        }
    }

    // Strike rates
    for b in batters.values_mut() {
        b.strike_rate = if b.balls_faced > 0 {
            js_to_fixed_num((b.runs as f64 / b.balls_faced as f64) * 100.0, 1)
        } else {
            0.0
        };
    }

    // Bowling stats: overs, economy, maidens
    let mut bowling_stats: Vec<BowlerInningsStat> = Vec::new();
    for (p_id, b) in &bowlers {
        let overs_decimal = parse_overs_to_decimal(b.legal_balls);
        let overs_fraction = balls_to_overs_fraction(b.legal_balls);
        let econ = if overs_fraction > 0.0 {
            js_to_fixed_num(b.runs_conceded as f64 / overs_fraction, 2)
        } else {
            0.0
        };

        // Maidens from this bowler's completed overs
        let mut maidens = 0;
        for os in over_summaries.iter().filter(|o| o.bowler_id == *p_id) {
            let bowler_runs_in_over: i64 = os.balls.iter().fold(0, |acc, bl| {
                let mut r = 0;
                if bl.runs_bat > 0
                    && bl.extra_type != ExtraType::Bye
                    && bl.extra_type != ExtraType::LegBye
                {
                    r += bl.runs_bat;
                }
                if bl.extra_type == ExtraType::Wide {
                    r += if bl.extra_runs > 0 {
                        bl.extra_runs
                    } else {
                        rules.wide_run_value
                    };
                }
                if bl.extra_type == ExtraType::NoBall {
                    r += if bl.extra_runs > 0 {
                        bl.extra_runs
                    } else {
                        rules.no_ball_run_value
                    };
                }
                acc + r
            });
            if bowler_runs_in_over == 0 {
                maidens += 1;
            }
        }

        bowling_stats.push(BowlerInningsStat {
            player_id: p_id.clone(),
            overs: overs_decimal,
            legal_balls: b.legal_balls,
            maidens,
            runs_conceded: b.runs_conceded,
            wickets: b.wickets,
            economy: econ,
            wides: b.wides,
            no_balls: b.no_balls,
            dots: b.dots,
        });
    }

    // Did not bat
    let did_not_bat_player_ids: Vec<String> = batting_squad_ids
        .iter()
        .filter(|id| !batters.contains_key(*id))
        .cloned()
        .collect();

    // Completion: a side is all out at playersPerSide−1 (playersPerSide with
    // last-man), never later than the SQUAD allows (short gully sides).
    let rules_max_wickets = if rules.last_man_batting {
        rules.players_per_side
    } else {
        rules.players_per_side - 1
    };
    let max_wickets = 1.max(
        rules_max_wickets
            .min(batting_squad_ids.len() as i64 - if rules.last_man_batting { 0 } else { 1 }),
    );
    let max_legal_balls = rules.overs * 6;

    let mut is_completed = false;
    let mut completion_reason: Option<String> = None;

    if let Some(t) = target_runs {
        if total_runs >= t {
            is_completed = true;
            completion_reason = Some("target_reached".to_string());
        }
    }
    if !is_completed && total_wickets >= max_wickets && batting_squad_ids.len() > 1 {
        is_completed = true;
        completion_reason = Some("all_out".to_string());
    }
    if !is_completed && legal_balls_count >= max_legal_balls {
        is_completed = true;
        completion_reason = Some("overs_completed".to_string());
    }

    let run_rate = if legal_balls_count > 0 {
        js_to_fixed_num(
            total_runs as f64 / balls_to_overs_fraction(legal_balls_count),
            2,
        )
    } else {
        0.0
    };

    let mut sorted_batters: Vec<BatterInningsStat> = batters.into_values().collect();
    sorted_batters.sort_by_key(|b| b.batting_order);

    InningsScorecard {
        innings_index: 0, // the original hardcodes these three
        batting_team_id: String::new(),
        bowling_team_id: String::new(),
        total_runs,
        total_wickets,
        legal_balls_count,
        overs_formatted: format_overs(legal_balls_count),
        run_rate,
        extras,
        batters: sorted_batters,
        bowlers: bowling_stats,
        fall_of_wickets,
        partnerships,
        over_summaries,
        did_not_bat_player_ids,
        current_striker_id,
        current_non_striker_id,
        current_bowler_id,
        is_completed,
        completion_reason,
        target_runs,
        is_super_over,
    }
}

/// TS: `calculateMatchMVPPoints` — documented formula from help.md:
/// batting 1pt/run + milestone/SR bonuses, bowling 25/wicket + bonuses,
/// fielding 10/catch, 15/run-out. Output is an insertion-ordered map like the
/// TS Record (object key order does not affect the recorded comparison).
pub fn calculate_match_mvp_points(scorecards: &[InningsScorecard]) -> IndexMap<String, MvpPoints> {
    let mut mvp_map: IndexMap<String, MvpPoints> = IndexMap::new();

    for sc in scorecards {
        // Batting
        for b in &sc.batters {
            let p = mvp_map.entry(b.player_id.clone()).or_default();
            let mut bat_pts = b.runs;
            if b.runs >= 100 {
                bat_pts += 50;
            } else if b.runs >= 50 {
                bat_pts += 20;
            } else if b.runs >= 30 {
                bat_pts += 10;
            }
            if b.runs >= 15 && b.strike_rate >= 150.0 {
                bat_pts += 10;
            }
            p.bat += bat_pts;
            p.total += bat_pts;
        }

        // Bowling
        for bw in &sc.bowlers {
            let p = mvp_map.entry(bw.player_id.clone()).or_default();
            let mut bowl_pts = bw.wickets * 25;
            if bw.wickets >= 5 {
                bowl_pts += 50;
            } else if bw.wickets >= 3 {
                bowl_pts += 20;
            }
            bowl_pts += bw.maidens * 20;
            if bw.legal_balls >= 12 && bw.economy < 6.0 {
                bowl_pts += 15;
            }
            p.bowl += bowl_pts;
            p.total += bowl_pts;
        }

        // Fielding (credited on the dismissed batter's row)
        for b in &sc.batters {
            if b.is_out {
                if let Some(fielder_ids) = &b.fielder_ids {
                    for f_id in fielder_ids {
                        let p = mvp_map.entry(f_id.to_string()).or_default();
                        match b.wicket_type {
                            Some(WicketType::RunOut) => {
                                p.field += 15;
                                p.total += 15;
                            }
                            Some(
                                WicketType::Caught
                                | WicketType::CaughtBehind
                                | WicketType::CaughtBowled
                                | WicketType::Stumped,
                            ) => {
                                p.field += 10;
                                p.total += 10;
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    mvp_map
}

/// TS: `calculateTournamentPointsTable` — standard ICC NRR; a side all out
/// within its quota is credited the full quota of overs.
#[allow(clippy::too_many_arguments)]
pub fn calculate_tournament_points_table(
    matches: &[TournamentMatchSummary],
    team_ids: &[String],
    win_points: i64,
    tie_points: i64,
    nr_points: i64,
    players_map: &IndexMap<String, Player>,
) -> Vec<PointsTableRow> {
    let mut table: IndexMap<String, PointsTableRow> = IndexMap::new();
    for t_id in team_ids {
        table.insert(
            t_id.clone(),
            PointsTableRow {
                team_id: t_id.clone(),
                played: 0,
                won: 0,
                lost: 0,
                tied: 0,
                no_result: 0,
                points: 0,
                nrr: 0.0,
                runs_scored: 0,
                overs_faced: 0.0,
                runs_conceded: 0,
                overs_bowled: 0.0,
            },
        );
    }

    for m in matches {
        if m.status != "completed" {
            continue;
        }
        if m.innings.len() < 2 {
            continue;
        }

        let inn1 = &m.innings[0];
        let inn2 = &m.innings[1];
        // Real batting squads (NOT empty): replayInnings only marks "all_out"
        // when a squad is present, so the ICC full-quota NRR rule can fire.
        let inn1_squad: &[String] = if Some(inn1.batting_team_id.as_str()) == m.team_a_id.as_deref()
        {
            m.team_a_player_ids.as_deref().unwrap_or(&[])
        } else {
            m.team_b_player_ids.as_deref().unwrap_or(&[])
        };
        let inn2_squad: &[String] = if Some(inn2.batting_team_id.as_str()) == m.team_a_id.as_deref()
        {
            m.team_a_player_ids.as_deref().unwrap_or(&[])
        } else {
            m.team_b_player_ids.as_deref().unwrap_or(&[])
        };
        let sc1 = replay_innings(
            &inn1.ball_events,
            &m.rules,
            inn1_squad,
            &[],
            players_map,
            None,
            None,
        );
        let sc2 = replay_innings(
            &inn2.ball_events,
            &m.rules,
            inn2_squad,
            &[],
            players_map,
            Some(sc1.total_runs + 1),
            None,
        );

        let team1 = &inn1.batting_team_id;
        let team2 = &inn2.batting_team_id;

        if !table.contains_key(team1) {
            continue;
        }
        if !table.contains_key(team2) {
            continue;
        }

        table.get_mut(team1).unwrap().played += 1;
        table.get_mut(team2).unwrap().played += 1;

        if m.winner_team_id.as_deref() == Some(team1.as_str()) {
            let t1 = table.get_mut(team1).unwrap();
            t1.won += 1;
            t1.points += win_points;
            table.get_mut(team2).unwrap().lost += 1;
        } else if m.winner_team_id.as_deref() == Some(team2.as_str()) {
            let t2 = table.get_mut(team2).unwrap();
            t2.won += 1;
            t2.points += win_points;
            table.get_mut(team1).unwrap().lost += 1;
        } else if sc1.total_runs == sc2.total_runs {
            let t1 = table.get_mut(team1).unwrap();
            t1.tied += 1;
            t1.points += tie_points;
            let t2 = table.get_mut(team2).unwrap();
            t2.tied += 1;
            t2.points += tie_points;
        } else {
            let t1 = table.get_mut(team1).unwrap();
            t1.no_result += 1;
            t1.points += nr_points;
            let t2 = table.get_mut(team2).unwrap();
            t2.no_result += 1;
            t2.points += nr_points;
        }

        // NRR: full overs quota used if all out
        let inn1_overs_faced = if sc1.completion_reason.as_deref() == Some("all_out") {
            m.rules.overs as f64
        } else {
            balls_to_overs_fraction(sc1.legal_balls_count)
        };
        let inn2_overs_faced = if sc2.completion_reason.as_deref() == Some("all_out") {
            m.rules.overs as f64
        } else {
            balls_to_overs_fraction(sc2.legal_balls_count)
        };

        let t1 = table.get_mut(team1).unwrap();
        t1.runs_scored += sc1.total_runs;
        t1.overs_faced += inn1_overs_faced;
        t1.runs_conceded += sc2.total_runs;
        t1.overs_bowled += inn2_overs_faced;

        let t2 = table.get_mut(team2).unwrap();
        t2.runs_scored += sc2.total_runs;
        t2.overs_faced += inn2_overs_faced;
        t2.runs_conceded += sc1.total_runs;
        t2.overs_bowled += inn1_overs_faced;
    }

    // Final NRR, then sort by points desc, NRR desc (stable, like JS sort)
    let mut rows: Vec<PointsTableRow> = table.into_values().collect();
    for row in &mut rows {
        let for_rate = if row.overs_faced > 0.0 {
            row.runs_scored as f64 / row.overs_faced
        } else {
            0.0
        };
        let against_rate = if row.overs_bowled > 0.0 {
            row.runs_conceded as f64 / row.overs_bowled
        } else {
            0.0
        };
        row.nrr = js_to_fixed_num(for_rate - against_rate, 3);
    }
    rows.sort_by(|a, b| {
        b.points.cmp(&a.points).then(
            b.nrr
                .partial_cmp(&a.nrr)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
    });
    rows
}

/// TS: `generateRoundRobinFixtures` — the circle method.
pub fn generate_round_robin_fixtures(
    team_ids: &[String],
    tournament_id: &str,
) -> Vec<RoundRobinFixture> {
    let mut teams: Vec<String> = team_ids.to_vec();
    if !teams.len().is_multiple_of(2) {
        teams.push("BYE".to_string());
    }

    let num_rounds = teams.len() as i64 - 1;
    let half = teams.len() / 2;
    let mut fixtures: Vec<RoundRobinFixture> = Vec::new();

    let mut current_teams = teams.clone();

    for round in 0..num_rounds.max(0) {
        for i in 0..half {
            let team_a = &current_teams[i];
            let team_b = &current_teams[current_teams.len() - 1 - i];

            if team_a != "BYE" && team_b != "BYE" {
                fixtures.push(RoundRobinFixture {
                    id: format!("fix_{tournament_id}_{}_{}", round + 1, i + 1),
                    tournament_id: tournament_id.to_string(),
                    round_name: format!("Round {}", round + 1),
                    team_a_id: team_a.clone(),
                    team_b_id: team_b.clone(),
                    status: "pending".to_string(),
                });
            }
        }

        // Rotate, keeping the first fixed
        if let Some(fixed) = current_teams.first().cloned() {
            let mut rest: Vec<String> = current_teams[1..].to_vec();
            let last = rest.pop(); // never None once the list is even-sized
            if let Some(last) = last {
                let mut next = vec![fixed, last];
                next.append(&mut rest);
                current_teams = next;
            }
        }
    }

    fixtures
}

/// TS: `generateBallCommentary` — template-based, zero network, zero AI.
pub fn generate_ball_commentary(
    ball: &CommentaryBall,
    striker_name: &str,
    bowler_name: &str,
) -> String {
    if let Some(w) = &ball.wicket {
        return match w.wicket_type {
            WicketType::Bowled => format!(
                "WICKET! Clean bowled! {bowler_name} breaks through the defence of {striker_name}. Absolute ripper!"
            ),
            WicketType::Caught | WicketType::CaughtBehind => format!(
                "WICKET! In the air and TAKEN! {striker_name} departs off the bowling of {bowler_name}."
            ),
            WicketType::Lbw => format!(
                "WICKET! Loud appeal, given! {strikerName} trapped in front by {bowlerName}.",
                strikerName = striker_name,
                bowlerName = bowler_name
            ),
            WicketType::RunOut => format!(
                "WICKET! Run out! Direct hit or quick work at the stumps finds {striker_name} short of ground."
            ),
            WicketType::Stumped => format!(
                "WICKET! Stumped! {striker_name} steps out, beaten in flight, keeper takes the bails off in a flash."
            ),
            _ => format!(
                "WICKET! {striker_name} is dismissed ({}). Big moment in the match!",
                w.wicket_type.wicket_type_name().replacen('_', " ", 1)
            ),
        };
    }

    if ball.extra_type == "wide" {
        return format!(
            "{bowler_name} sprays it wide outside the tramline. Wide called by the umpire."
        );
    }
    if ball.extra_type == "no_ball" {
        return format!("No-ball called! Overstepping by {bowler_name}. Free hit coming up!");
    }
    if ball.extra_type == "bye" {
        return format!(
            "Beaten outside off, batters steal {} bye(s).",
            ball.extra_runs
        );
    }
    if ball.extra_type == "leg_bye" {
        return format!(
            "Off the pads, deflects into the gap for {} leg-bye(s).",
            ball.extra_runs
        );
    }

    let dir_text = match &ball.shot_direction {
        // JS replace() swaps only the FIRST underscore
        Some(d) => format!(" toward {}", d.replacen('_', " ", 1)),
        None => String::new(),
    };

    match ball.runs_bat {
        0 => format!("{bowler_name} lands it on a good length to {striker_name}, defended cleanly. Dot ball."),
        1 => format!("{striker_name} works it gently{dir_text} for a brisk single."),
        2 => format!("Nicely placed in the gap{dir_text}. Excellent running between the wickets for a brace."),
        3 => format!("Pushed deep into the outfield{dir_text}, good hustle allows them to turn for three runs."),
        4 => format!("FOUR! Beautifully timed by {striker_name}{dir_text}, races across the turf for a boundary!"),
        6 => format!("SIX! High, handsome and into the crowd! Massive hit by {striker_name}{dir_text}!"),
        _ => format!("{striker_name} picks up {} runs{dir_text}.", ball.runs_bat),
    }
}

impl WicketType {
    /// The TS wire string (snake_case, same as serde uses).
    pub fn wicket_type_name(&self) -> &'static str {
        match self {
            WicketType::Bowled => "bowled",
            WicketType::Caught => "caught",
            WicketType::CaughtBowled => "caught_bowled",
            WicketType::CaughtBehind => "caught_behind",
            WicketType::Lbw => "lbw",
            WicketType::RunOut => "run_out",
            WicketType::Stumped => "stumped",
            WicketType::HitWicket => "hit_wicket",
            WicketType::HitBallTwice => "hit_ball_twice",
            WicketType::ObstructingField => "obstructing_field",
            WicketType::HandledBall => "handled_ball",
            WicketType::TimedOut => "timed_out",
            WicketType::RetiredOut => "retired_out",
            WicketType::RetiredHurt => "retired_hurt",
        }
    }
}
