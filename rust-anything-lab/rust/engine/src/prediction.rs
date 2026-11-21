//! Port of `GullyScoreRN/src/engine/predictionEngine.ts` — 100% offline,
//! deterministic statistical modeling.
//!
//! Five of the six exports are pure and proved by recorded cases. The sixth,
//! `simulateTournamentOutcomes`, is a Monte Carlo built on `Math.random()`,
//! which cannot be seeded: record/replay can only prove its DETERMINISTIC
//! branch (no pending fixtures). The random branch ports the algorithm
//! exactly but draws from a seeded xorshift PRNG
//! ([`crate::SeededRng`], fixed seed), so results are reproducible where the
//! TS results are not — a documented, necessary deviation.

use crate::scoring::{balls_to_overs_fraction, InningsScorecard, MatchRules, PointsTableRow};
use crate::stats::{Match, Team};
use crate::{js_to_fixed_num, js_to_fixed_str, SeededRng};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveWinProbability {
    pub team_a_win_prob: i64,
    pub team_b_win_prob: i64,
    pub tie_prob: i64,
    pub favorite_team_id: String,
    pub margin_description: String,
    pub key_factor: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedScoreModel {
    pub at_current_rate: i64,
    pub at_par_rate: i64,
    pub projected_min: i64,
    pub projected_median: i64,
    pub projected_max: i64,
    pub acceleration_factor: f64,
    pub par_score: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatterMilestoneProjection {
    pub player_id: String,
    pub current_runs: i64,
    pub balls_faced: i64,
    pub projected_runs: i64,
    pub next_milestone: Option<i64>,
    pub estimated_balls_to_milestone: Option<i64>,
    pub probability_of_milestone: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreMatchPrediction {
    pub team_a_win_prob: i64,
    pub team_b_win_prob: i64,
    pub head_to_head_summary: String,
    pub predicted_par_score: i64,
    pub toss_advantage: String,
    pub toss_advantage_pct: i64,
    pub prediction_rationale: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TournamentSimulationResult {
    pub team_id: String,
    pub champion_probability: i64,
    pub top_two_probability: i64,
    pub projected_average_points: f64,
    pub projected_rank: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BattingFirstEquation {
    pub assumed_team_score: i64,
    pub max_runs_opponent_allowed: i64,
    pub margin_runs_required: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChasingEquation {
    pub target_to_chase: i64,
    pub max_overs_allowed: String,
    pub max_balls_allowed: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NrrScenarioRequirement {
    pub team_id: String,
    pub target_opponent_id: String,
    pub batting_first_equation: BattingFirstEquation,
    pub chasing_equation: ChasingEquation,
}

// ---------------------------------------------------------------------------
// Input types (Tournament / Fixture slices the simulator reads)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tournament {
    pub id: String,
    pub name: String,
    pub team_ids: Vec<String>,
    pub win_points: i64,
    pub tie_points: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nr_points: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureLite {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_id: Option<String>,
    pub team_a_id: String,
    pub team_b_id: String,
}

// ---------------------------------------------------------------------------
// 1. LIVE WIN PROBABILITY ENGINE
// ---------------------------------------------------------------------------

/// TS: `calculateLiveWinProbability`. `head_to_head_factor` mirrors the TS
/// default of 0.5 (the DIFF layer applies the default when a case omits it).
pub fn calculate_live_win_probability(
    match_: &Match,
    current_scorecard: &InningsScorecard,
    first_innings_total: Option<i64>,
    head_to_head_factor: f64,
) -> LiveWinProbability {
    let current_innings_idx = match_.current_innings_index;
    let rules = &match_.rules;
    let total_overs = rules.overs;
    let max_balls = total_overs * 6;
    let balls_bowled = current_scorecard.legal_balls_count;
    let balls_remaining = 0.max(max_balls - balls_bowled);
    // Squad-aware wickets ceiling (short gully sides)
    let batting_squad_len = match_
        .innings
        .get(current_innings_idx as usize)
        .map(|inn| inn.batting_team_id.as_str())
        .map(|bat_id| {
            if bat_id == match_.team_a_id {
                match_.team_a_player_ids.len()
            } else {
                match_.team_b_player_ids.len()
            }
        })
        .unwrap_or_else(|| match_.team_b_player_ids.len()) as i64;
    let total_wickets = 1.max(
        (if rules.last_man_batting {
            rules.players_per_side
        } else {
            rules.players_per_side - 1
        })
        .min(batting_squad_len - if rules.last_man_batting { 0 } else { 1 }),
    );
    let wickets_lost = current_scorecard.total_wickets;
    let wickets_in_hand = 0.max(total_wickets - wickets_lost);

    let team_a_id = &match_.team_a_id;
    let team_b_id = &match_.team_b_id;
    let batting_team_id = match_
        .innings
        .get(current_innings_idx as usize)
        .map(|inn| inn.batting_team_id.clone())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| team_a_id.clone());
    let bowling_team_id = if batting_team_id == *team_a_id {
        team_b_id.clone()
    } else {
        team_a_id.clone()
    };

    // ---- 1st INNINGS MODEL
    if current_innings_idx == 0 {
        let base_rpo = match rules.ball_type {
            crate::scoring::BallType::Tennis => 8.2,
            crate::scoring::BallType::Box => 7.0,
            crate::scoring::BallType::Leather => 6.8,
        };
        let expected_par_total = base_rpo * total_overs as f64;

        // WASP-style remaining-resources curve
        let resource_weight = if total_wickets > 0 {
            (wickets_in_hand as f64 / total_wickets as f64).powf(0.7)
                * (balls_remaining as f64 / max_balls as f64)
        } else {
            balls_remaining as f64 / max_balls as f64
        };

        let projected_runs = current_scorecard.total_runs as f64
            + resource_weight * (base_rpo * (balls_remaining as f64 / 6.0) * 1.15);

        let delta = projected_runs - expected_par_total;
        // Logistic: delta of 15 runs ≈ 65%
        let z = delta / (total_overs as f64 * 2.2);
        let mut batting_win_prob = 1.0 / (1.0 + (-z).exp());

        let team_a_prior = if batting_team_id == *team_a_id {
            head_to_head_factor
        } else {
            1.0 - head_to_head_factor
        };
        batting_win_prob = batting_win_prob * 0.85 + team_a_prior * 0.15;

        // Clamp 5%..95% during the 1st innings
        batting_win_prob = 0.05_f64.max(0.95_f64.min(batting_win_prob));
        let bowling_win_prob = 1.0 - batting_win_prob;

        let team_a_prob = if batting_team_id == *team_a_id {
            batting_win_prob
        } else {
            bowling_win_prob
        };
        let team_b_prob = if batting_team_id == *team_b_id {
            batting_win_prob
        } else {
            bowling_win_prob
        };

        let fav_id = if team_a_prob >= team_b_prob {
            team_a_id.clone()
        } else {
            team_b_id.clone()
        };
        let max_p = (team_a_prob.max(team_b_prob) * 100.0).round() as i64;

        return LiveWinProbability {
            team_a_win_prob: (team_a_prob * 100.0).round() as i64,
            team_b_win_prob: (team_b_prob * 100.0).round() as i64,
            tie_prob: 0,
            favorite_team_id: fav_id,
            margin_description: format!("{max_p}% favored (1st Innings pace)"),
            key_factor: if wickets_in_hand as f64 > total_wickets as f64 / 2.0 {
                format!("{wickets_in_hand} wickets in hand favors late surge")
            } else {
                format!("{wickets_lost} wickets lost increases collapse risk")
            },
        };
    }

    // ---- 2nd INNINGS CHASE MODEL
    // JS `targetRuns || fallback`: 0 is falsy.
    let target = if current_scorecard.target_runs.unwrap_or(0) != 0 {
        current_scorecard.target_runs.unwrap()
    } else if let Some(f) = first_innings_total {
        f + 1
    } else {
        1
    };
    let runs_remaining = 0.max(target - current_scorecard.total_runs);

    if current_scorecard.total_runs >= target {
        let is_bat_team_a = batting_team_id == *team_a_id;
        return LiveWinProbability {
            team_a_win_prob: if is_bat_team_a { 100 } else { 0 },
            team_b_win_prob: if is_bat_team_a { 0 } else { 100 },
            tie_prob: 0,
            favorite_team_id: batting_team_id.clone(),
            margin_description: "Target reached".to_string(),
            key_factor: "Chase successfully completed".to_string(),
        };
    }

    if wickets_in_hand <= 0 || balls_remaining <= 0 {
        if current_scorecard.total_runs == target - 1 {
            return LiveWinProbability {
                team_a_win_prob: 50,
                team_b_win_prob: 50,
                tie_prob: 100,
                favorite_team_id: "tie".to_string(),
                margin_description: "Scores Level".to_string(),
                key_factor: "Match tied".to_string(),
            };
        }
        let is_bowl_team_a = bowling_team_id == *team_a_id;
        return LiveWinProbability {
            team_a_win_prob: if is_bowl_team_a { 100 } else { 0 },
            team_b_win_prob: if is_bowl_team_a { 0 } else { 100 },
            tie_prob: 0,
            favorite_team_id: bowling_team_id.clone(),
            margin_description: "Target defended".to_string(),
            key_factor: if wickets_in_hand <= 0 {
                "All out".to_string()
            } else {
                "Overs exhausted".to_string()
            },
        };
    }

    let rrr = runs_remaining as f64 / (balls_remaining as f64 / 6.0);
    // The original computes CRR here and never uses it (dead code in the TS);
    // not ported.

    let wicket_factor = if total_wickets > 0 {
        (wickets_in_hand as f64 / total_wickets as f64).powf(0.85)
    } else {
        0.5
    };

    let runs_per_ball = runs_remaining as f64 / balls_remaining as f64;

    let difficulty = (runs_per_ball - 1.2) * 2.4 - (wicket_factor - 0.5) * 2.8;
    let mut chase_win_prob = 1.0 / (1.0 + difficulty.exp());

    let mut tie_probability = 0.0;
    if balls_remaining <= 6 && runs_remaining <= 8 {
        tie_probability = 0.08;
        chase_win_prob *= 0.92;
    }

    let defend_win_prob = 0f64.max(1.0 - chase_win_prob - tie_probability);

    let team_a_prob = if batting_team_id == *team_a_id {
        chase_win_prob
    } else {
        defend_win_prob
    };
    let team_b_prob = if batting_team_id == *team_b_id {
        chase_win_prob
    } else {
        defend_win_prob
    };

    let fav_id = if team_a_prob >= team_b_prob {
        team_a_id.clone()
    } else {
        team_b_id.clone()
    };
    let max_pct = (team_a_prob.max(team_b_prob) * 100.0).round() as i64;

    LiveWinProbability {
        team_a_win_prob: (team_a_prob * 100.0).round() as i64,
        team_b_win_prob: (team_b_prob * 100.0).round() as i64,
        tie_prob: (tie_probability * 100.0).round() as i64,
        favorite_team_id: fav_id,
        margin_description: format!(
            "{max_pct}% chance · Need {runs_remaining} off {balls_remaining}b (RRR {})",
            js_to_fixed_str(rrr, 1)
        ),
        key_factor: if rrr > 11.0 {
            format!(
                "High required rate ({} rpo) puts bowling team on top",
                js_to_fixed_str(rrr, 1)
            )
        } else if wickets_in_hand >= 4 {
            format!("{wickets_in_hand} wickets in hand provides solid chasing cushion")
        } else {
            format!("Tense finish: only {wickets_in_hand} wickets in hand remaining")
        },
    }
}

// ---------------------------------------------------------------------------
// 2. PROJECTED SCORE & RESOURCE MODEL
// ---------------------------------------------------------------------------

/// TS: `calculateProjectedScore`.
pub fn calculate_projected_score(
    current_runs: i64,
    legal_balls_faced: i64,
    total_overs: i64,
    wickets_lost: i64,
    total_wickets: i64,
    ball_type: &str,
) -> ProjectedScoreModel {
    let max_balls = total_overs * 6;
    let balls_remaining = 0.max(max_balls - legal_balls_faced);
    let overs_remaining = balls_remaining as f64 / 6.0;
    let wickets_in_hand = 0.max(total_wickets - wickets_lost);

    let par_rpo = if ball_type == "box" {
        7.2
    } else if ball_type == "tennis" {
        8.4
    } else {
        6.8
    };
    let par_score = (par_rpo * total_overs as f64).round() as i64;

    let crr = if legal_balls_faced > 0 {
        current_runs as f64 / (legal_balls_faced as f64 / 6.0)
    } else {
        par_rpo
    };
    let at_current_rate = (current_runs as f64 + crr * overs_remaining).round() as i64;

    // Death-overs acceleration
    let is_death_overs = legal_balls_faced as f64 >= max_balls as f64 * 0.7;
    let has_wickets_reserve = wickets_in_hand as f64 >= total_wickets as f64 * 0.5;

    let acceleration_factor = if is_death_overs && has_wickets_reserve {
        1.35
    } else if !has_wickets_reserve {
        0.85
    } else {
        1.0
    };

    let at_par_rate = (current_runs as f64 + par_rpo * overs_remaining).round() as i64;

    let projected_min = current_runs.max(
        (current_runs as f64 + 4.5_f64.max(crr * 0.75) * overs_remaining * 0.9).round() as i64,
    );
    let projected_median =
        (current_runs as f64 + crr * overs_remaining * acceleration_factor).round() as i64;
    let projected_max =
        (current_runs as f64 + crr.max(par_rpo) * overs_remaining * 1.45).round() as i64;

    ProjectedScoreModel {
        at_current_rate,
        at_par_rate,
        projected_min,
        projected_median,
        projected_max,
        acceleration_factor,
        par_score,
    }
}

// ---------------------------------------------------------------------------
// 3. BATTER MILESTONE & INNINGS PROJECTION
// ---------------------------------------------------------------------------

/// TS: `calculateBatterProjection`.
pub fn calculate_batter_projection(
    current_runs: i64,
    balls_faced: i64,
    legal_balls_remaining_in_innings: i64,
    team_wickets_remaining: i64,
) -> BatterMilestoneProjection {
    let strike_rate = if balls_faced > 0 {
        (current_runs as f64 / balls_faced as f64) * 100.0
    } else {
        120.0
    };
    let runs_per_ball = strike_rate / 100.0;

    // In partnerships a batter faces roughly half the remaining balls
    let expected_balls_to_face = legal_balls_remaining_in_innings
        .min((legal_balls_remaining_in_innings as f64 * 0.52).round() as i64);

    let projected_runs =
        (current_runs as f64 + expected_balls_to_face as f64 * runs_per_ball).round() as i64;

    let next_milestone: Option<i64> = if current_runs < 30 {
        Some(30)
    } else if current_runs < 50 {
        Some(50)
    } else if current_runs < 100 {
        Some(100)
    } else {
        None
    };

    let mut estimated_balls_to_milestone: Option<i64> = None;
    let mut probability_of_milestone: i64 = 0;

    if let Some(milestone) = next_milestone {
        let runs_needed = milestone - current_runs;
        if runs_per_ball > 0.0 {
            let est = (runs_needed as f64 / runs_per_ball).ceil() as i64;
            estimated_balls_to_milestone = Some(est);
            if est <= expected_balls_to_face && team_wickets_remaining >= 2 {
                let ratio = expected_balls_to_face as f64 / est as f64;
                probability_of_milestone = 95.min((1.0_f64.min(ratio) * 85.0).round() as i64);
            } else {
                probability_of_milestone = 5.max(
                    ((expected_balls_to_face as f64 / est.max(1) as f64) * 40.0).round() as i64,
                );
            }
        }
    }

    BatterMilestoneProjection {
        player_id: String::new(),
        current_runs,
        balls_faced,
        projected_runs,
        next_milestone,
        estimated_balls_to_milestone,
        probability_of_milestone,
    }
}

// ---------------------------------------------------------------------------
// 4. PRE-MATCH HEAD-TO-HEAD PREDICTOR
// ---------------------------------------------------------------------------

/// TS: `calculatePreMatchPrediction`.
pub fn calculate_pre_match_prediction(
    team_a: &Team,
    team_b: &Team,
    all_matches: &[Match],
    rules: &MatchRules,
    venue: Option<&str>,
) -> PreMatchPrediction {
    let completed_matches: Vec<&Match> = all_matches
        .iter()
        .filter(|m| m.status == crate::stats::MatchStatus::Completed)
        .collect();

    let h2h: Vec<&&Match> = completed_matches
        .iter()
        .filter(|m| {
            (m.team_a_id == team_a.id && m.team_b_id == team_b.id)
                || (m.team_a_id == team_b.id && m.team_b_id == team_a.id)
        })
        .collect();

    let mut team_a_wins = 0;
    let mut team_b_wins = 0;
    for m in &h2h {
        if m.winner_team_id.as_deref() == Some(team_a.id.as_str()) {
            team_a_wins += 1;
        }
        if m.winner_team_id.as_deref() == Some(team_b.id.as_str()) {
            team_b_wins += 1;
        }
    }

    let team_a_matches: Vec<&&Match> = completed_matches
        .iter()
        .filter(|m| m.team_a_id == team_a.id || m.team_b_id == team_a.id)
        .collect();
    let team_b_matches: Vec<&&Match> = completed_matches
        .iter()
        .filter(|m| m.team_a_id == team_b.id || m.team_b_id == team_b.id)
        .collect();

    let team_a_record = team_a_matches
        .iter()
        .filter(|m| m.winner_team_id.as_deref() == Some(team_a.id.as_str()))
        .count();
    let team_b_record = team_b_matches
        .iter()
        .filter(|m| m.winner_team_id.as_deref() == Some(team_b.id.as_str()))
        .count();

    let team_a_rate = if !team_a_matches.is_empty() {
        team_a_record as f64 / team_a_matches.len() as f64
    } else {
        0.5
    };
    let team_b_rate = if !team_b_matches.is_empty() {
        team_b_record as f64 / team_b_matches.len() as f64
    } else {
        0.5
    };

    // Venue toss bias
    let mut bat_first_wins = 0;
    let mut bowl_first_wins = 0;
    let venue_matches: Vec<&&Match> = completed_matches
        .iter()
        .filter(|m| venue.is_none_or(|v| m.venue == v))
        .collect();
    for m in &venue_matches {
        if m.innings.len() >= 2 {
            if let Some(winner) = &m.winner_team_id {
                if *winner == m.innings[0].batting_team_id {
                    bat_first_wins += 1;
                } else {
                    bowl_first_wins += 1;
                }
            }
        }
    }

    let mut toss_advantage = "neutral".to_string();
    let mut toss_advantage_pct = 50;
    if bat_first_wins > bowl_first_wins && venue_matches.len() >= 3 {
        toss_advantage = "bat".to_string();
        toss_advantage_pct =
            ((bat_first_wins as f64 / venue_matches.len() as f64) * 100.0).round() as i64;
    } else if bowl_first_wins > bat_first_wins && venue_matches.len() >= 3 {
        toss_advantage = "bowl".to_string();
        toss_advantage_pct =
            ((bowl_first_wins as f64 / venue_matches.len() as f64) * 100.0).round() as i64;
    }

    // H2H + recent form (both branches assign in the original; 0.5 is dead)
    let team_a_prob = if h2h.len() >= 2 {
        let h2h_rate = team_a_wins as f64 / h2h.len() as f64;
        h2h_rate * 0.6 + team_a_rate * 0.4
    } else {
        let sum = team_a_rate + team_b_rate;
        if sum > 0.0 {
            team_a_rate / sum
        } else {
            0.5
        }
    };

    let team_a_prob = 0.2_f64.max(0.8_f64.min(team_a_prob));
    let team_b_prob = 1.0 - team_a_prob;

    let base_par_rpo = match rules.ball_type {
        crate::scoring::BallType::Tennis => 8.5,
        _ => 7.0,
    };
    let predicted_par_score = (base_par_rpo * rules.overs as f64).round() as i64;

    let h2h_text = if !h2h.is_empty() {
        format!(
            "{} head-to-head match(es): {} ({}) vs {} ({})",
            h2h.len(),
            team_a.short_name,
            team_a_wins,
            team_b.short_name,
            team_b_wins
        )
    } else {
        "First recorded encounter between these two teams".to_string()
    };

    let rationale = if team_a_prob > 0.55 {
        format!(
            "{} enters as statistical favorite based on a {}% season win rate.",
            team_a.name,
            js_to_fixed_str(team_a_rate * 100.0, 0)
        )
    } else if team_b_prob > 0.55 {
        format!(
            "{} favored based on recent match momentum and squad balance.",
            team_b.name
        )
    } else {
        "Evenly matched contest with closely matched win records.".to_string()
    };

    PreMatchPrediction {
        team_a_win_prob: (team_a_prob * 100.0).round() as i64,
        team_b_win_prob: (team_b_prob * 100.0).round() as i64,
        head_to_head_summary: h2h_text,
        predicted_par_score,
        toss_advantage,
        toss_advantage_pct,
        prediction_rationale: rationale,
    }
}

// ---------------------------------------------------------------------------
// 5. TOURNAMENT MONTE CARLO SIMULATOR
// ---------------------------------------------------------------------------

/// Fixed seed: JS `Math.random()` cannot be seeded, so the port makes the
/// simulation reproducible instead (documented deviation — the distribution
/// logic is identical).
const SIM_SEED: u64 = 0xC0FFEE;

/// TS: `simulateTournamentOutcomes`. `iterations` defaults to 800 in TS; the
/// DIFF layer applies that default for cases that omit it.
pub fn simulate_tournament_outcomes(
    tournament: &Tournament,
    fixtures: &[FixtureLite],
    _completed_matches: &[Match],
    current_points_table: &[PointsTableRow],
    iterations: i64,
) -> Vec<TournamentSimulationResult> {
    let team_ids = &tournament.team_ids;
    let pending_fixtures: Vec<&FixtureLite> = fixtures
        .iter()
        .filter(|f| f.status == "pending" || f.match_id.is_none())
        .collect();

    // Tournament already completed — the deterministic branch
    if pending_fixtures.is_empty() {
        return current_points_table
            .iter()
            .enumerate()
            .map(|(idx, row)| TournamentSimulationResult {
                team_id: row.team_id.clone(),
                champion_probability: if idx == 0 { 100 } else { 0 },
                top_two_probability: if idx < 2 { 100 } else { 0 },
                projected_average_points: row.points as f64,
                projected_rank: idx as i64 + 1,
            })
            .collect();
    }

    // Baseline team strengths from current points & NRR
    let mut team_strength: HashMap<String, f64> = HashMap::new();
    for t_id in team_ids {
        let row = current_points_table.iter().find(|r| &r.team_id == t_id);
        let win_rate = match row {
            Some(r) if r.played > 0 => (r.won as f64 + r.tied as f64 * 0.5) / r.played as f64,
            _ => 0.5,
        };
        let nrr_boost = row
            .map(|r| (-1.5_f64).max(1.5_f64.min(r.nrr)) * 0.15)
            .unwrap_or(0.0);
        team_strength.insert(t_id.clone(), 0.2_f64.max(0.8_f64.min(win_rate + nrr_boost)));
    }

    let mut champion_count: HashMap<String, i64> = HashMap::new();
    let mut top_two_count: HashMap<String, i64> = HashMap::new();
    let mut total_simulated_points: HashMap<String, f64> = HashMap::new();
    for t_id in team_ids {
        champion_count.insert(t_id.clone(), 0);
        top_two_count.insert(t_id.clone(), 0);
        total_simulated_points.insert(t_id.clone(), 0.0);
    }

    let mut rng = SeededRng::new(SIM_SEED);
    for _ in 0..iterations.max(0) {
        let mut sim_points: HashMap<String, i64> = HashMap::new();
        let mut sim_nrr: HashMap<String, f64> = HashMap::new();
        for t_id in team_ids {
            let row = current_points_table.iter().find(|r| &r.team_id == t_id);
            sim_points.insert(t_id.clone(), row.map(|r| r.points).unwrap_or(0));
            sim_nrr.insert(t_id.clone(), row.map(|r| r.nrr).unwrap_or(0.0));
        }

        for fix in &pending_fixtures {
            let s_a = team_strength.get(&fix.team_a_id).copied().unwrap_or(0.5);
            let s_b = team_strength.get(&fix.team_b_id).copied().unwrap_or(0.5);
            let prob_a = s_a / (s_a + s_b);

            let roll = rng.next_f64();
            if roll < prob_a {
                *sim_points.entry(fix.team_a_id.clone()).or_insert(0) += tournament.win_points;
                *sim_nrr.entry(fix.team_a_id.clone()).or_insert(0.0) += 0.35;
                *sim_nrr.entry(fix.team_b_id.clone()).or_insert(0.0) -= 0.35;
            } else if roll < prob_a + 0.05 {
                *sim_points.entry(fix.team_a_id.clone()).or_insert(0) += tournament.tie_points;
                *sim_points.entry(fix.team_b_id.clone()).or_insert(0) += tournament.tie_points;
            } else {
                *sim_points.entry(fix.team_b_id.clone()).or_insert(0) += tournament.win_points;
                *sim_nrr.entry(fix.team_b_id.clone()).or_insert(0.0) += 0.35;
                *sim_nrr.entry(fix.team_a_id.clone()).or_insert(0.0) -= 0.35;
            }
        }

        // Rank this iteration (points desc, NRR desc; stable like JS sort)
        let mut ranked: Vec<String> = team_ids.clone();
        ranked.sort_by(|a, b| {
            sim_points.get(b).cmp(&sim_points.get(a)).then(
                sim_nrr
                    .get(b)
                    .partial_cmp(&sim_nrr.get(a))
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
        });

        if let Some(champ) = ranked.first() {
            *champion_count.entry(champ.clone()).or_insert(0) += 1;
            *top_two_count.entry(champ.clone()).or_insert(0) += 1;
        }
        if let Some(second) = ranked.get(1) {
            *top_two_count.entry(second.clone()).or_insert(0) += 1;
        }

        for t_id in team_ids {
            *total_simulated_points.entry(t_id.clone()).or_insert(0.0) +=
                *sim_points.get(t_id).unwrap_or(&0) as f64;
        }
    }

    let mut results: Vec<TournamentSimulationResult> = team_ids
        .iter()
        .map(|t_id| TournamentSimulationResult {
            team_id: t_id.clone(),
            champion_probability: ((champion_count.get(t_id).copied().unwrap_or(0) as f64
                / iterations as f64)
                * 100.0)
                .round() as i64,
            top_two_probability: ((top_two_count.get(t_id).copied().unwrap_or(0) as f64
                / iterations as f64)
                * 100.0)
                .round() as i64,
            projected_average_points: js_to_fixed_num(
                total_simulated_points.get(t_id).copied().unwrap_or(0.0) / iterations as f64,
                1,
            ),
            projected_rank: 0,
        })
        .collect();
    results.sort_by_key(|r| std::cmp::Reverse(r.champion_probability));
    for (index, res) in results.iter_mut().enumerate() {
        res.projected_rank = index as i64 + 1;
    }
    results
}

// ---------------------------------------------------------------------------
// 6. NRR "WHAT DO WE NEED?" SCENARIO SOLVER
// ---------------------------------------------------------------------------

/// TS: `calculateNrrScenario`.
pub fn calculate_nrr_scenario(
    team_a_id: &str,
    team_b_id: &str,
    target_team_id: &str,
    points_table: &[PointsTableRow],
    match_rules: &MatchRules,
) -> NrrScenarioRequirement {
    let team_row = points_table.iter().find(|r| r.team_id == team_a_id);
    let target_row = points_table.iter().find(|r| r.team_id == target_team_id);

    let overs = match_rules.overs;
    let assumed_team_score = (overs as f64 * 8.5).round() as i64;

    // Team has not played, or target is the same/missing
    if team_row.is_none() || target_row.is_none() {
        return NrrScenarioRequirement {
            team_id: team_a_id.to_string(),
            target_opponent_id: team_b_id.to_string(),
            batting_first_equation: BattingFirstEquation {
                assumed_team_score,
                max_runs_opponent_allowed: (assumed_team_score as f64 * 0.75).round() as i64,
                margin_runs_required: (assumed_team_score as f64 * 0.25).round() as i64,
            },
            chasing_equation: ChasingEquation {
                target_to_chase: 75,
                max_overs_allowed: js_to_fixed_str(overs as f64 * 0.75, 1),
                max_balls_allowed: (overs as f64 * 6.0 * 0.75).round() as i64,
            },
        };
    }

    let team_row = team_row.unwrap();
    let target_row = target_row.unwrap();

    let target_nrr = target_row.nrr;
    let current_runs_scored = team_row.runs_scored;
    let current_overs_faced = team_row.overs_faced;
    let current_runs_conceded = team_row.runs_conceded;
    let current_overs_bowled = team_row.overs_bowled;

    // SCENARIO 1: Batting first
    let new_runs_scored = current_runs_scored + assumed_team_score;
    let new_overs_faced = current_overs_faced + overs as f64;
    let for_rate = new_runs_scored as f64 / new_overs_faced;

    let required_against_rate = for_rate - (target_nrr + 0.005);
    let max_conceded_allowed = 0.max(
        (required_against_rate * (current_overs_bowled + overs as f64)
            - current_runs_conceded as f64)
            .floor() as i64,
    );
    let margin_required = 1.max(assumed_team_score - max_conceded_allowed);

    // SCENARIO 2: Chasing
    let target_to_chase = assumed_team_score + 1;
    let new_conceded = current_runs_conceded + assumed_team_score;
    let new_bowled = current_overs_bowled + overs as f64;
    let against_rate = new_conceded as f64 / new_bowled;

    let required_for_rate = target_nrr + against_rate + 0.005;
    let max_overs_faced_total = (current_runs_scored + target_to_chase) as f64 / required_for_rate;
    let max_overs_allowed_decimal =
        1.0_f64.max((overs as f64).min(max_overs_faced_total - current_overs_faced));

    let max_balls_allowed =
        (overs * 6).min(6.max((max_overs_allowed_decimal * 6.0).floor() as i64));
    let max_overs_string = format!("{}.{}", max_balls_allowed / 6, max_balls_allowed % 6);

    NrrScenarioRequirement {
        team_id: team_a_id.to_string(),
        target_opponent_id: team_b_id.to_string(),
        batting_first_equation: BattingFirstEquation {
            assumed_team_score,
            max_runs_opponent_allowed: (assumed_team_score - 1).min(max_conceded_allowed),
            margin_runs_required: margin_required,
        },
        chasing_equation: ChasingEquation {
            target_to_chase,
            max_overs_allowed: max_overs_string,
            max_balls_allowed,
        },
    }
}

/// Re-exported for the app: overs fraction helper used by prediction screens.
pub fn overs_fraction(legal_balls: i64) -> f64 {
    balls_to_overs_fraction(legal_balls)
}
