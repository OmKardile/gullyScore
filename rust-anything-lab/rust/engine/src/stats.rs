//! Port of `GullyScoreRN/src/engine/playerStatsEngine.ts` —
//! `calculatePlayerDetailedStats`, the override path (pure: matches, players
//! and teams are passed in; the storage layer never runs here).
//!
//! The TS module imports the app's `db` for its default arguments; the Rust
//! port IS the override path, so there is no storage dependency at all. The
//! recorder records from a working copy whose only difference is that unused
//! db import (asserted byte-identical engine files — see record/record.mjs).
//!
//! One deliberate deviation: the TS fallbacks
//! `m.date || new Date(m.updatedAt).toLocaleDateString()` and
//! `m.venue || "Local Ground"` are locale/time-dependent; the recorder always
//! supplies a non-empty `date`, so the date fallback stays outside the
//! recorded contract (the venue fallback is a constant and is ported).

use crate::js_to_fixed_num;
use crate::scoring::{
    calculate_match_mvp_points, replay_innings, BallEvent, InningsScorecard, MatchRules, Player,
};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Input domain types (the Match/Team shapes the engine reads)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchStatus {
    Setup,
    Live,
    Completed,
    Abandoned,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub id: String,
    pub name: String,
    pub short_name: String,
    /// accent color, e.g. "#2563EB"
    pub color: String,
    pub monogram: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captain_id: Option<String>,
    pub player_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_archived: Option<bool>,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
}

/// The innings slice of `Match` (crease fields exist on the wire but are not
/// read by this engine; serde ignores unknown fields).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchInnings {
    pub batting_team_id: String,
    pub bowling_team_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_runs: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_super_over: Option<bool>,
    pub ball_events: Vec<BallEvent>,
}

/// The Match shape the engines read (fields they never touch — toss, sync
/// cursors, fixture links — are ignored on deserialize).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub id: String,
    pub team_a_id: String,
    pub team_b_id: String,
    pub team_a_player_ids: Vec<String>,
    pub team_b_player_ids: Vec<String>,
    pub date: String,
    pub venue: String,
    pub rules: MatchRules,
    pub status: MatchStatus,
    pub current_innings_index: i64,
    pub innings: Vec<MatchInnings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub winner_team_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_of_the_match_id: Option<String>,
    pub updated_at: i64,
}

// ---------------------------------------------------------------------------
// Output types (DetailedPlayerProfileStats and its slices)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerRecentInnings {
    pub match_id: String,
    pub match_date: String,
    pub venue: String,
    pub opponent_team_id: String,
    pub opponent_name: String,
    pub opponent_short: String,
    pub runs: i64,
    pub balls_faced: i64,
    pub fours: i64,
    pub sixes: i64,
    pub strike_rate: f64,
    pub is_out: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissal_text: Option<String>,
    pub result: String,
    pub result_text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerRecentSpell {
    pub match_id: String,
    pub match_date: String,
    pub venue: String,
    pub opponent_team_id: String,
    pub opponent_name: String,
    pub opponent_short: String,
    pub overs_formatted: String,
    pub maidens: i64,
    pub runs_conceded: i64,
    pub wickets: i64,
    pub economy: f64,
    pub result: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchLogBatting {
    pub runs: i64,
    pub balls: i64,
    pub fours: i64,
    pub sixes: i64,
    pub strike_rate: f64,
    pub is_out: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dismissal_text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchLogBowling {
    pub overs_formatted: String,
    pub maidens: i64,
    pub runs: i64,
    pub wickets: i64,
    pub economy: f64,
    pub dots: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchLogFielding {
    pub catches: i64,
    pub stumpings: i64,
    pub run_outs: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerMatchLogItem {
    pub match_id: String,
    pub match_date: String,
    pub venue: String,
    pub team_id: String,
    pub team_name: String,
    pub team_short: String,
    pub opponent_id: String,
    pub opponent_name: String,
    pub opponent_short: String,
    pub opponent_color: String,
    pub result: String,
    pub result_text: String,
    pub is_player_of_the_match: bool,
    pub mvp_points: crate::scoring::MvpPoints,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub batting: Option<MatchLogBatting>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bowling: Option<MatchLogBowling>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fielding: Option<MatchLogFielding>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BestBowling {
    pub wickets: i64,
    pub runs: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MilestoneProjection {
    pub target: i64,
    pub runs_needed: i64,
    pub projected_matches: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BowlingMilestoneProjection {
    pub target: i64,
    pub wickets_needed: i64,
    pub projected_matches: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailedPlayerProfileStats {
    pub player: Player,
    pub teams: Vec<Team>,
    pub matches_count: i64,
    pub matches_won: i64,
    pub win_percentage: f64,
    pub potm_count: i64,
    pub total_mvp_points: i64,
    pub batting_mvp_points: i64,
    pub bowling_mvp_points: i64,
    pub fielding_mvp_points: i64,

    pub batting_innings: i64,
    pub not_outs: i64,
    pub runs: i64,
    pub balls_faced: i64,
    pub highest_score: i64,
    pub highest_score_not_out: bool,
    pub batting_average: f64,
    pub batting_strike_rate: f64,
    pub fours: i64,
    pub sixes: i64,
    pub boundary_runs: i64,
    pub boundary_runs_pct: f64,
    pub balls_per_boundary: f64,
    pub thirties: i64,
    pub fifties: i64,
    pub hundreds: i64,
    pub ducks: i64,
    pub recent_innings: Vec<PlayerRecentInnings>,

    pub bowling_innings: i64,
    pub legal_balls_bowled: i64,
    pub overs_bowled_formatted: String,
    pub maidens: i64,
    pub runs_conceded: i64,
    pub wickets: i64,
    pub bowling_average: f64,
    pub bowling_economy: f64,
    pub bowling_strike_rate: f64,
    pub best_bowling: BestBowling,
    pub three_wickets: i64,
    pub five_wickets: i64,
    pub dot_balls: i64,
    pub dot_ball_pct: f64,
    pub wides_conceded: i64,
    pub no_balls_conceded: i64,
    pub recent_spells: Vec<PlayerRecentSpell>,

    pub catches: i64,
    pub stumpings: i64,
    pub run_outs: i64,
    pub total_fielding_dismissals: i64,

    pub match_logs: Vec<PlayerMatchLogItem>,

    pub next_batting_milestone: MilestoneProjection,
    pub next_bowling_milestone: BowlingMilestoneProjection,
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/// TS: `calculatePlayerDetailedStats` — career aggregation over all matches.
pub fn calculate_player_detailed_stats(
    player_id: &str,
    matches: &[Match],
    players_map: &IndexMap<String, Player>,
    teams_map: &IndexMap<String, Team>,
) -> Option<DetailedPlayerProfileStats> {
    let player = players_map.get(player_id)?.clone();

    // Teams this player belongs to (Object.values insertion order — IndexMap)
    let teams: Vec<Team> = teams_map
        .values()
        .filter(|t| t.player_ids.iter().any(|id| id == player_id))
        .cloned()
        .collect();

    let mut matches_count: i64 = 0;
    let mut matches_won: i64 = 0;
    let mut potm_count: i64 = 0;
    let mut batting_mvp_points: i64 = 0;
    let mut bowling_mvp_points: i64 = 0;
    let mut fielding_mvp_points: i64 = 0;

    let mut batting_innings: i64 = 0;
    let mut not_outs: i64 = 0;
    let mut runs: i64 = 0;
    let mut balls_faced: i64 = 0;
    let mut highest_score: i64 = 0;
    let mut highest_score_not_out = false;
    let mut fours: i64 = 0;
    let mut sixes: i64 = 0;
    let mut thirties: i64 = 0;
    let mut fifties: i64 = 0;
    let mut hundreds: i64 = 0;
    let mut ducks: i64 = 0;
    let mut recent_innings: Vec<PlayerRecentInnings> = Vec::new();

    let mut bowling_innings: i64 = 0;
    let mut legal_balls_bowled: i64 = 0;
    let mut maidens: i64 = 0;
    let mut runs_conceded: i64 = 0;
    let mut wickets: i64 = 0;
    let mut best_bowling = BestBowling {
        wickets: 0,
        runs: 999,
    };
    let mut three_wickets: i64 = 0;
    let mut five_wickets: i64 = 0;
    let mut dot_balls: i64 = 0;
    let mut wides_conceded: i64 = 0;
    let mut no_balls_conceded: i64 = 0;
    let mut recent_spells: Vec<PlayerRecentSpell> = Vec::new();

    let mut catches: i64 = 0;
    let mut stumpings: i64 = 0;
    let mut run_outs: i64 = 0;

    let mut match_logs: Vec<PlayerMatchLogItem> = Vec::new();

    // Chronological ascending (stable, like JS sort)
    let mut sorted_matches: Vec<&Match> = matches.iter().collect();
    sorted_matches.sort_by_key(|m| m.updated_at);

    for m in &sorted_matches {
        let in_team_a = m.team_a_player_ids.iter().any(|id| id == player_id);
        let in_team_b = m.team_b_player_ids.iter().any(|id| id == player_id);

        // Appeared in ball events even if not in the formal team list
        let mut appeared_in_events = false;
        for inn in &m.innings {
            if inn.ball_events.iter().any(|b| {
                b.striker_id == player_id
                    || b.non_striker_id == player_id
                    || b.bowler_id == player_id
                    || b.wicket
                        .as_ref()
                        .map(|w| w.fielder_ids.iter().any(|f| f == player_id))
                        .unwrap_or(false)
            }) {
                appeared_in_events = true;
            }
        }
        if !in_team_a && !in_team_b && !appeared_in_events {
            continue;
        }

        matches_count += 1;

        let player_team_id = if in_team_a {
            &m.team_a_id
        } else if in_team_b {
            &m.team_b_id
        } else {
            &m.team_a_id
        };
        let opponent_team_id = if player_team_id == &m.team_a_id {
            &m.team_b_id
        } else {
            &m.team_a_id
        };
        let player_team = teams_map.get(player_team_id);
        let opponent_team = teams_map.get(opponent_team_id);

        if m.winner_team_id.as_deref() == Some(player_team_id.as_str()) {
            matches_won += 1;
        }
        let is_potm = m.player_of_the_match_id.as_deref() == Some(player_id);
        if is_potm {
            potm_count += 1;
        }

        let mut match_result = "nr".to_string();
        if let Some(winner) = &m.winner_team_id {
            match_result = if winner == player_team_id {
                "win".to_string()
            } else {
                "loss".to_string()
            };
        } else if m.status == MatchStatus::Completed {
            match_result = "tie".to_string();
        }

        // Replay every innings for the exact scorecard
        let scorecards: Vec<InningsScorecard> = m
            .innings
            .iter()
            .enumerate()
            .map(|(idx, inn)| {
                // Stored target, with the runsBat-only fallback (documented
                // quirk of the original: wides/no-balls/byes are excluded).
                let target = if idx > 0 {
                    inn.target_runs.or_else(|| {
                        m.innings.first().map(|first| {
                            first.ball_events.iter().map(|b| b.runs_bat).sum::<i64>() + 1
                        })
                    })
                } else {
                    None
                };
                replay_innings(
                    &inn.ball_events,
                    &m.rules,
                    if inn.batting_team_id == m.team_a_id {
                        &m.team_a_player_ids
                    } else {
                        &m.team_b_player_ids
                    },
                    if inn.bowling_team_id == m.team_a_id {
                        &m.team_a_player_ids
                    } else {
                        &m.team_b_player_ids
                    },
                    players_map,
                    target,
                    inn.is_super_over,
                )
            })
            .collect();

        let mvp_map = calculate_match_mvp_points(&scorecards);
        let player_mvp = mvp_map.get(player_id).copied().unwrap_or_default();
        batting_mvp_points += player_mvp.bat;
        bowling_mvp_points += player_mvp.bowl;
        fielding_mvp_points += player_mvp.field;

        let mut match_batting: Option<MatchLogBatting> = None;
        let mut match_bowling: Option<MatchLogBowling> = None;
        let mut match_fielding = MatchLogFielding {
            catches: 0,
            stumpings: 0,
            run_outs: 0,
        };

        for sc in &scorecards {
            // 1. Batting
            if let Some(b_stat) = sc.batters.iter().find(|b| b.player_id == player_id) {
                batting_innings += 1;
                runs += b_stat.runs;
                balls_faced += b_stat.balls_faced;
                fours += b_stat.fours;
                sixes += b_stat.sixes;

                if b_stat.runs > highest_score {
                    highest_score = b_stat.runs;
                    highest_score_not_out = !b_stat.is_out;
                } else if b_stat.runs == highest_score && !b_stat.is_out {
                    highest_score_not_out = true;
                }

                if !b_stat.is_out {
                    not_outs += 1;
                }
                if b_stat.is_out && b_stat.runs == 0 {
                    ducks += 1;
                }
                if b_stat.runs >= 100 {
                    hundreds += 1;
                } else if b_stat.runs >= 50 {
                    fifties += 1;
                } else if b_stat.runs >= 30 {
                    thirties += 1;
                }

                match_batting = Some(MatchLogBatting {
                    runs: b_stat.runs,
                    balls: b_stat.balls_faced,
                    fours: b_stat.fours,
                    sixes: b_stat.sixes,
                    strike_rate: b_stat.strike_rate,
                    is_out: b_stat.is_out,
                    dismissal_text: b_stat.dismissal_text.clone(),
                });

                recent_innings.push(PlayerRecentInnings {
                    match_id: m.id.clone(),
                    // locale-dependent TS fallback intentionally not ported:
                    // the recorder always supplies a non-empty date
                    match_date: m.date.clone(),
                    venue: if m.venue.is_empty() {
                        "Local Ground".to_string()
                    } else {
                        m.venue.clone()
                    },
                    opponent_team_id: opponent_team_id.clone(),
                    opponent_name: opponent_team
                        .map(|t| t.name.clone())
                        .filter(|n| !n.is_empty())
                        .unwrap_or_else(|| "Opponent".to_string()),
                    opponent_short: opponent_team
                        .map(|t| t.short_name.clone())
                        .filter(|s| !s.is_empty())
                        .unwrap_or_else(|| "OPP".to_string()),
                    runs: b_stat.runs,
                    balls_faced: b_stat.balls_faced,
                    fours: b_stat.fours,
                    sixes: b_stat.sixes,
                    strike_rate: b_stat.strike_rate,
                    is_out: b_stat.is_out,
                    dismissal_text: b_stat.dismissal_text.clone(),
                    result: match_result.clone(),
                    result_text: m.result_text.clone().unwrap_or_default(),
                });
            }

            // 2. Bowling
            if let Some(bw_stat) = sc.bowlers.iter().find(|bw| bw.player_id == player_id) {
                if bw_stat.legal_balls > 0 {
                    bowling_innings += 1;
                    legal_balls_bowled += bw_stat.legal_balls;
                    runs_conceded += bw_stat.runs_conceded;
                    wickets += bw_stat.wickets;
                    maidens += bw_stat.maidens;
                    dot_balls += bw_stat.dots;
                    wides_conceded += bw_stat.wides;
                    no_balls_conceded += bw_stat.no_balls;

                    if bw_stat.wickets >= 5 {
                        five_wickets += 1;
                    } else if bw_stat.wickets >= 3 {
                        three_wickets += 1;
                    }

                    if bw_stat.wickets > best_bowling.wickets
                        || (bw_stat.wickets == best_bowling.wickets
                            && bw_stat.runs_conceded < best_bowling.runs)
                    {
                        best_bowling = BestBowling {
                            wickets: bw_stat.wickets,
                            runs: bw_stat.runs_conceded,
                        };
                    }

                    let overs_formatted =
                        format!("{}.{}", bw_stat.legal_balls / 6, bw_stat.legal_balls % 6);

                    match_bowling = Some(MatchLogBowling {
                        overs_formatted: overs_formatted.clone(),
                        maidens: bw_stat.maidens,
                        runs: bw_stat.runs_conceded,
                        wickets: bw_stat.wickets,
                        economy: bw_stat.economy,
                        dots: bw_stat.dots,
                    });

                    recent_spells.push(PlayerRecentSpell {
                        match_id: m.id.clone(),
                        match_date: m.date.clone(),
                        venue: if m.venue.is_empty() {
                            "Local Ground".to_string()
                        } else {
                            m.venue.clone()
                        },
                        opponent_team_id: opponent_team_id.clone(),
                        opponent_name: opponent_team
                            .map(|t| t.name.clone())
                            .filter(|n| !n.is_empty())
                            .unwrap_or_else(|| "Opponent".to_string()),
                        opponent_short: opponent_team
                            .map(|t| t.short_name.clone())
                            .filter(|s| !s.is_empty())
                            .unwrap_or_else(|| "OPP".to_string()),
                        overs_formatted,
                        maidens: bw_stat.maidens,
                        runs_conceded: bw_stat.runs_conceded,
                        wickets: bw_stat.wickets,
                        economy: bw_stat.economy,
                        result: match_result.clone(),
                    });
                }
            }

            // 3. Fielding (credited on the dismissed batter's row)
            for b in &sc.batters {
                if b.is_out {
                    if let Some(fielder_ids) = &b.fielder_ids {
                        if fielder_ids.iter().any(|f| f == player_id) {
                            match b.wicket_type {
                                Some(crate::scoring::WicketType::RunOut) => {
                                    run_outs += 1;
                                    match_fielding.run_outs += 1;
                                }
                                Some(crate::scoring::WicketType::Stumped) => {
                                    stumpings += 1;
                                    match_fielding.stumpings += 1;
                                }
                                _ => {
                                    catches += 1;
                                    match_fielding.catches += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        match_logs.push(PlayerMatchLogItem {
            match_id: m.id.clone(),
            match_date: m.date.clone(),
            venue: if m.venue.is_empty() {
                "Local Ground".to_string()
            } else {
                m.venue.clone()
            },
            team_id: player_team_id.clone(),
            team_name: player_team
                .map(|t| t.name.clone())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "My Team".to_string()),
            team_short: player_team
                .map(|t| t.short_name.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "TM".to_string()),
            opponent_id: opponent_team_id.clone(),
            opponent_name: opponent_team
                .map(|t| t.name.clone())
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "Opponent".to_string()),
            opponent_short: opponent_team
                .map(|t| t.short_name.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "OPP".to_string()),
            opponent_color: opponent_team
                .map(|t| t.color.clone())
                .unwrap_or_else(|| "#5B5F66".to_string()),
            result: match_result.clone(),
            result_text: m
                .result_text
                .clone()
                .unwrap_or_else(|| "Match Completed".to_string()),
            is_player_of_the_match: is_potm,
            mvp_points: player_mvp,
            batting: match_batting,
            bowling: match_bowling,
            fielding: if match_fielding.catches > 0
                || match_fielding.stumpings > 0
                || match_fielding.run_outs > 0
            {
                Some(match_fielding)
            } else {
                None
            },
        });
    }

    // Batting derived stats
    let outs = batting_innings - not_outs;
    let batting_average = if outs > 0 {
        js_to_fixed_num(runs as f64 / outs as f64, 1)
    } else {
        runs as f64
    };
    let batting_strike_rate = if balls_faced > 0 {
        js_to_fixed_num((runs as f64 / balls_faced as f64) * 100.0, 1)
    } else {
        0.0
    };
    let boundary_runs = 4 * fours + 6 * sixes;
    let boundary_runs_pct = if runs > 0 {
        js_to_fixed_num((boundary_runs as f64 / runs as f64) * 100.0, 1)
    } else {
        0.0
    };
    let total_boundaries = fours + sixes;
    let balls_per_boundary = if total_boundaries > 0 {
        js_to_fixed_num(balls_faced as f64 / total_boundaries as f64, 1)
    } else {
        0.0
    };

    // Bowling derived stats
    let total_overs_fraction = legal_balls_bowled as f64 / 6.0;
    let overs_bowled_formatted = format!("{}.{}", legal_balls_bowled / 6, legal_balls_bowled % 6);
    let bowling_average = if wickets > 0 {
        js_to_fixed_num(runs_conceded as f64 / wickets as f64, 1)
    } else {
        0.0
    };
    let bowling_economy = if total_overs_fraction > 0.0 {
        js_to_fixed_num(runs_conceded as f64 / total_overs_fraction, 2)
    } else {
        0.0
    };
    let bowling_strike_rate = if wickets > 0 {
        js_to_fixed_num(legal_balls_bowled as f64 / wickets as f64, 1)
    } else {
        0.0
    };
    let dot_ball_pct = if legal_balls_bowled > 0 {
        js_to_fixed_num((dot_balls as f64 / legal_balls_bowled as f64) * 100.0, 1)
    } else {
        0.0
    };

    if best_bowling.wickets == 0 && best_bowling.runs == 999 {
        best_bowling = BestBowling {
            wickets: 0,
            runs: 0,
        };
    }

    // Milestones
    let next_batting_target = if runs < 50 {
        50
    } else if runs < 100 {
        100
    } else if runs < 250 {
        250
    } else {
        (((runs + 1) as f64 / 250.0).ceil() as i64) * 250
    };
    let runs_needed = 0.max(next_batting_target - runs);
    let avg_runs_per_match = if batting_innings > 0 {
        runs as f64 / batting_innings as f64
    } else {
        15.0
    };
    let projected_batting_matches = if avg_runs_per_match > 0.0 {
        (runs_needed as f64 / avg_runs_per_match).ceil() as i64
    } else {
        1
    };

    let next_bowling_target = if wickets < 5 {
        5
    } else if wickets < 10 {
        10
    } else if wickets < 25 {
        25
    } else {
        (((wickets + 1) as f64 / 25.0).ceil() as i64) * 25
    };
    let wickets_needed = 0.max(next_bowling_target - wickets);
    let avg_wickets_per_match = if bowling_innings > 0 {
        wickets as f64 / bowling_innings as f64
    } else {
        1.0
    };
    let projected_bowling_matches = if avg_wickets_per_match > 0.0 {
        (wickets_needed as f64 / avg_wickets_per_match).ceil() as i64
    } else {
        1
    };

    let win_percentage = if matches_count > 0 {
        js_to_fixed_num((matches_won as f64 / matches_count as f64) * 100.0, 1)
    } else {
        0.0
    };

    // Newest first (reverse of chronological)
    recent_innings.reverse();
    recent_spells.reverse();
    match_logs.reverse();

    Some(DetailedPlayerProfileStats {
        player,
        teams,
        matches_count,
        matches_won,
        win_percentage,
        potm_count,
        total_mvp_points: batting_mvp_points + bowling_mvp_points + fielding_mvp_points,
        batting_mvp_points,
        bowling_mvp_points,
        fielding_mvp_points,
        batting_innings,
        not_outs,
        runs,
        balls_faced,
        highest_score,
        highest_score_not_out,
        batting_average,
        batting_strike_rate,
        fours,
        sixes,
        boundary_runs,
        boundary_runs_pct,
        balls_per_boundary,
        thirties,
        fifties,
        hundreds,
        ducks,
        recent_innings,
        bowling_innings,
        legal_balls_bowled,
        overs_bowled_formatted,
        maidens,
        runs_conceded,
        wickets,
        bowling_average,
        bowling_economy,
        bowling_strike_rate,
        best_bowling,
        three_wickets,
        five_wickets,
        dot_balls,
        dot_ball_pct,
        wides_conceded,
        no_balls_conceded,
        recent_spells,
        catches,
        stumpings,
        run_outs,
        total_fielding_dismissals: catches + stumpings + run_outs,
        match_logs,
        next_batting_milestone: MilestoneProjection {
            target: next_batting_target,
            runs_needed,
            projected_matches: projected_batting_matches,
        },
        next_bowling_milestone: BowlingMilestoneProjection {
            target: next_bowling_target,
            wickets_needed,
            projected_matches: projected_bowling_matches,
        },
    })
}
