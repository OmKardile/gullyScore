//! DIFF step — replays every recorded case against the port
//! (mini re-implementation of `rust-anything diff`).
//!
//! Exits:
//!   0  every recorded case matches
//!   1  at least one case mismatched (or the files could not be read)
//!   2  the recording is STALE: the app's engine files changed since
//!      `record` ran — re-run `bun record/record.mjs` and diff again
//!
//! Upstream lessons applied: M3 (diff calls the port the way callers will),
//! L7 (both sides throwing counts as agreement — a `$threw` marker matches
//! only a Rust panic), and the recorded-from.json fingerprint ("keep up with
//! the original": an upstream change cannot pass silently).

use gullyscore_engine as port;
use gullyscore_engine::js_values_agree;

use indexmap::IndexMap;
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

#[derive(Deserialize)]
struct Case {
    id: String,
    #[serde(rename = "fn")]
    f: String,
    args: Value,
    expected: Value,
}

#[derive(Deserialize)]
struct Fingerprint {
    sha256: String,
}

#[derive(Deserialize)]
struct RecordedFrom {
    files: BTreeMap<String, Fingerprint>,
}

// ---- typed argument views (the port is called with real types, not raw JSON)

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegalBallsArgs {
    legal_balls: i64,
}

#[derive(Deserialize)]
struct WicketTypeArgs {
    #[serde(rename = "type")]
    wicket_type: port::WicketType,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreaseArgs {
    /// null -> None: the TS `!ballEvents` guard, as a type (upstream X2).
    ball_events: Option<Vec<port::BallEvent>>,
    rules: port::MatchRules,
    batting_squad_ids: Vec<String>,
    bowling_squad_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DismissalTextArgs {
    dismissal: port::DismissalInfo,
    players_map: IndexMap<String, port::Player>,
    bowler_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplayInningsArgs {
    ball_events: Vec<port::BallEvent>,
    rules: port::MatchRules,
    batting_squad_ids: Vec<String>,
    bowling_squad_ids: Vec<String>,
    players_map: IndexMap<String, port::Player>,
    target_runs: Option<i64>,
    is_super_over: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MvpArgs {
    scorecards: Vec<port::InningsScorecard>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TournamentTableArgs {
    matches: Vec<port::TournamentMatchSummary>,
    team_ids: Vec<String>,
    win_points: Option<i64>,
    tie_points: Option<i64>,
    nr_points: Option<i64>,
    players_map: Option<IndexMap<String, port::Player>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoundRobinArgs {
    team_ids: Vec<String>,
    tournament_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentaryArgs {
    ball: port::CommentaryBall,
    striker_name: String,
    bowler_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveWinArgs {
    #[serde(rename = "match")]
    match_: port::Match,
    current_scorecard: port::InningsScorecard,
    first_innings_total: Option<i64>,
    head_to_head_factor: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectedScoreArgs {
    current_runs: i64,
    legal_balls_faced: i64,
    total_overs: i64,
    wickets_lost: i64,
    total_wickets: i64,
    ball_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatterProjArgs {
    current_runs: i64,
    balls_faced: i64,
    legal_balls_remaining_in_innings: i64,
    team_wickets_remaining: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreMatchArgs {
    team_a: port::Team,
    team_b: port::Team,
    all_matches: Vec<port::Match>,
    rules: port::MatchRules,
    venue: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SimulateArgs {
    tournament: port::Tournament,
    fixtures: Vec<port::FixtureLite>,
    completed_matches: Vec<port::Match>,
    current_points_table: Vec<port::PointsTableRow>,
    iterations: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NrrArgs {
    team_a_id: String,
    team_b_id: String,
    target_team_id: String,
    points_table: Vec<port::PointsTableRow>,
    match_rules: port::MatchRules,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayerStatsArgs {
    player_id: String,
    matches: Vec<port::Match>,
    players_map: IndexMap<String, port::Player>,
    teams_map: IndexMap<String, port::Team>,
}

fn dispatch(f: &str, args: &Value) -> Result<Value, String> {
    let bad = |e: serde_json::Error| format!("bad args: {e}");
    match f {
        "formatOvers" => {
            let a: LegalBallsArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            Ok(serde_json::to_value(port::format_overs(a.legal_balls)).expect("serializable"))
        }
        "parseOversToDecimal" => {
            let a: LegalBallsArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            Ok(
                serde_json::to_value(port::parse_overs_to_decimal(a.legal_balls))
                    .expect("serializable"),
            )
        }
        "ballsToOversFraction" => {
            let a: LegalBallsArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            Ok(
                serde_json::to_value(port::balls_to_overs_fraction(a.legal_balls))
                    .expect("serializable"),
            )
        }
        "isDismissalCreditedToBowler" => {
            let a: WicketTypeArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            Ok(
                serde_json::to_value(port::is_dismissal_credited_to_bowler(a.wicket_type))
                    .expect("serializable"),
            )
        }
        "deriveLiveCrease" => {
            let a: CreaseArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            let state = port::derive_live_crease(
                a.ball_events.as_deref(),
                &a.rules,
                &a.batting_squad_ids,
                &a.bowling_squad_ids,
            );
            Ok(serde_json::to_value(state).expect("serializable"))
        }
        "getDismissalText" => {
            let a: DismissalTextArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            Ok(serde_json::to_value(port::get_dismissal_text(
                &a.dismissal,
                &a.players_map,
                &a.bowler_id,
            ))
            .expect("serializable"))
        }
        "replayInnings" => {
            let a: ReplayInningsArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            let sc = port::replay_innings(
                &a.ball_events,
                &a.rules,
                &a.batting_squad_ids,
                &a.bowling_squad_ids,
                &a.players_map,
                a.target_runs,
                a.is_super_over,
            );
            Ok(serde_json::to_value(sc).expect("serializable"))
        }
        "calculateMatchMVPPoints" => {
            let a: MvpArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            Ok(
                serde_json::to_value(port::calculate_match_mvp_points(&a.scorecards))
                    .expect("serializable"),
            )
        }
        "calculateTournamentPointsTable" => {
            let a: TournamentTableArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            // TS defaults: winPoints=2, tiePoints=1, nrPoints=1, playersMap={}
            let empty = IndexMap::new();
            let rows = port::calculate_tournament_points_table(
                &a.matches,
                &a.team_ids,
                a.win_points.unwrap_or(2),
                a.tie_points.unwrap_or(1),
                a.nr_points.unwrap_or(1),
                a.players_map.as_ref().unwrap_or(&empty),
            );
            Ok(serde_json::to_value(rows).expect("serializable"))
        }
        "generateRoundRobinFixtures" => {
            let a: RoundRobinArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            Ok(serde_json::to_value(port::generate_round_robin_fixtures(
                &a.team_ids,
                &a.tournament_id,
            ))
            .expect("serializable"))
        }
        "generateBallCommentary" => {
            let a: CommentaryArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            Ok(serde_json::to_value(port::generate_ball_commentary(
                &a.ball,
                &a.striker_name,
                &a.bowler_name,
            ))
            .expect("serializable"))
        }
        "calculateLiveWinProbability" => {
            let a: LiveWinArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            let p = port::calculate_live_win_probability(
                &a.match_,
                &a.current_scorecard,
                a.first_innings_total,
                a.head_to_head_factor.unwrap_or(0.5),
            );
            Ok(serde_json::to_value(p).expect("serializable"))
        }
        "calculateProjectedScore" => {
            let a: ProjectedScoreArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            let m = port::calculate_projected_score(
                a.current_runs,
                a.legal_balls_faced,
                a.total_overs,
                a.wickets_lost,
                a.total_wickets,
                a.ball_type.as_deref().unwrap_or("tennis"),
            );
            Ok(serde_json::to_value(m).expect("serializable"))
        }
        "calculateBatterProjection" => {
            let a: BatterProjArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            Ok(serde_json::to_value(port::calculate_batter_projection(
                a.current_runs,
                a.balls_faced,
                a.legal_balls_remaining_in_innings,
                a.team_wickets_remaining,
            ))
            .expect("serializable"))
        }
        "calculatePreMatchPrediction" => {
            let a: PreMatchArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            let p = port::calculate_pre_match_prediction(
                &a.team_a,
                &a.team_b,
                &a.all_matches,
                &a.rules,
                a.venue.as_deref(),
            );
            Ok(serde_json::to_value(p).expect("serializable"))
        }
        "simulateTournamentOutcomes" => {
            let a: SimulateArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            let r = port::simulate_tournament_outcomes(
                &a.tournament,
                &a.fixtures,
                &a.completed_matches,
                &a.current_points_table,
                a.iterations.unwrap_or(800),
            );
            Ok(serde_json::to_value(r).expect("serializable"))
        }
        "calculateNrrScenario" => {
            let a: NrrArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            let r = port::calculate_nrr_scenario(
                &a.team_a_id,
                &a.team_b_id,
                &a.target_team_id,
                &a.points_table,
                &a.match_rules,
            );
            Ok(serde_json::to_value(r).expect("serializable"))
        }
        "calculatePlayerDetailedStats" => {
            let a: PlayerStatsArgs = serde_json::from_value(args.clone()).map_err(bad)?;
            let r = port::calculate_player_detailed_stats(
                &a.player_id,
                &a.matches,
                &a.players_map,
                &a.teams_map,
            );
            Ok(serde_json::to_value(r).expect("serializable"))
        }
        other => Err(format!("unknown fn: {other}")),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Recursive path-level diff of two JSON values (debug mode).
fn diff_paths(a: &Value, b: &Value, path: &str, out: &mut Vec<String>) {
    let kind = |v: &Value| match v {
        Value::Null => "null".to_string(),
        Value::Bool(_) => "bool".to_string(),
        Value::Number(_) => "number".to_string(),
        Value::String(_) => "string".to_string(),
        Value::Array(_) => "array".to_string(),
        Value::Object(_) => "object".to_string(),
    };
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let mut seen = std::collections::BTreeSet::new();
            for k in x.keys().chain(y.keys()) {
                if !seen.insert(k.as_str()) {
                    continue; // shared key: visited once
                }
                match (x.get(k), y.get(k)) {
                    (Some(xv), Some(yv)) => diff_paths(xv, yv, &format!("{path}.{k}"), out),
                    (xv, yv) => out.push(format!(
                        "{path}.{k}: {} vs {}",
                        xv.map(|v| v.to_string()).unwrap_or_default(),
                        yv.map(|v| v.to_string()).unwrap_or_default()
                    )),
                }
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                out.push(format!("{path}: len {} vs {}", x.len(), y.len()));
            }
            for (i, (xv, yv)) in x.iter().zip(y).enumerate() {
                diff_paths(xv, yv, &format!("{path}[{i}]"), out);
            }
        }
        _ => {
            if !js_values_agree(a, b) {
                out.push(format!("{path} ({}): {a} vs {b}", kind(a)));
            }
        }
    }
}

fn main() -> ExitCode {
    let cases_path = PathBuf::from(
        std::env::args()
            .nth(1)
            .unwrap_or_else(|| "../cases.jsonl".to_string()),
    );
    // Canonicalize: Path::parent() is purely lexical, so a relative
    // "../cases.jsonl" would make lab_root ".." and repo_root "" — wrong.
    let cases_abs = cases_path
        .canonicalize()
        .unwrap_or_else(|_| cases_path.clone());
    let lab_root = cases_abs
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let repo_root = lab_root
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(".."));

    // ---- 1. stale-recording guard (recorded-from.json fingerprint) --------
    let rf_path = lab_root.join("recorded-from.json");
    let Ok(rf_raw) = std::fs::read_to_string(&rf_path) else {
        eprintln!(
            "STALE RECORDING: {} is missing — run `bun record/record.mjs`",
            rf_path.display()
        );
        return ExitCode::from(2);
    };
    let rf: RecordedFrom = match serde_json::from_str(&rf_raw) {
        Ok(rf) => rf,
        Err(e) => {
            eprintln!(
                "STALE RECORDING: {} does not parse ({e})",
                rf_path.display()
            );
            return ExitCode::from(2);
        }
    };
    let mut stale: Vec<String> = Vec::new();
    let mut fingerprinted = 0usize;
    for (rel, fp) in &rf.files {
        let abs = repo_root.join(rel);
        match std::fs::read(&abs) {
            Ok(bytes) => {
                fingerprinted += 1;
                if sha256_hex(&bytes) != fp.sha256 {
                    stale.push(rel.clone());
                }
            }
            Err(_) => stale.push(format!("{rel} (missing)")),
        }
    }
    if !stale.is_empty() {
        eprintln!("STALE RECORDING: the original changed since the cases were recorded:");
        for s in &stale {
            eprintln!("  - {s}");
        }
        eprintln!("Re-run: bun record/record.mjs  (then diff again)");
        return ExitCode::from(2);
    }

    // ---- 2. replay every recorded case against the port -------------------
    let Ok(raw) = std::fs::read_to_string(&cases_path) else {
        eprintln!(
            "cannot read {}: run `bun record/record.mjs` first",
            cases_path.display()
        );
        return ExitCode::from(1);
    };
    let mut cases: Vec<Case> = Vec::new();
    for (lineno, line) in raw.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str(line) {
            Ok(c) => cases.push(c),
            Err(e) => {
                eprintln!(
                    "{}:{}: bad case line ({e})",
                    cases_path.display(),
                    lineno + 1
                );
                return ExitCode::from(1);
            }
        }
    }

    let mut per_fn: BTreeMap<String, (usize, usize)> = BTreeMap::new(); // (matched, total)
    let mut mismatches: Vec<String> = Vec::new();

    // Debug mode: `-- <cases-path> --case <id>` prints a path-level diff for
    // that single case instead of the summary.
    let dbg_case = {
        let args: Vec<String> = std::env::args().collect();
        match args.iter().position(|a| a == "--case") {
            Some(i) => args.get(i + 1).cloned(),
            None => None,
        }
    };

    for case in &cases {
        if let Some(id) = &dbg_case {
            if &case.id != id {
                continue;
            }
        }
        let entry = per_fn.entry(case.f.clone()).or_insert((0, 0));
        entry.1 += 1;

        // Catch panics so one bad case cannot kill the whole diff run.
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            dispatch(&case.f, &case.args)
        }));

        let (agree, note) = match &outcome {
            Ok(Ok(value)) => {
                if case.expected.get("$threw").is_some() {
                    (
                        false,
                        format!(
                            "{} {}: original threw ($threw) but port returned {value}",
                            case.id, case.f
                        ),
                    )
                } else if js_values_agree(value, &case.expected) {
                    (true, String::new())
                } else if dbg_case.is_some() {
                    let mut paths = Vec::new();
                    diff_paths(&case.expected, value, "$", &mut paths);
                    eprintln!("--- case {} {} — differing paths ---", case.id, case.f);
                    for p in &paths {
                        eprintln!("  {p}");
                    }
                    (
                        false,
                        format!(
                            "{} {}: expected {} got {value}",
                            case.id, case.f, case.expected
                        ),
                    )
                } else {
                    (
                        false,
                        format!(
                            "{} {}: expected {} got {value}",
                            case.id, case.f, case.expected
                        ),
                    )
                }
            }
            Ok(Err(reason)) => (false, format!("{} {}: harness: {reason}", case.id, case.f)),
            Err(_) => {
                if case.expected.get("$threw").is_some() {
                    (true, String::new()) // both sides threw (L7)
                } else {
                    (
                        false,
                        format!(
                            "{} {}: port PANICKED, original returned {}",
                            case.id, case.f, case.expected
                        ),
                    )
                }
            }
        };
        if agree {
            entry.0 += 1;
        } else {
            mismatches.push(note);
        }
    }

    // ---- 3. verdict --------------------------------------------------------
    let total: usize = per_fn.values().map(|(_, t)| t).sum();
    let matched: usize = per_fn.values().map(|(m, _)| m).sum();
    println!("stale check: {fingerprinted} source file(s) fingerprinted OK");
    for (f, (m, t)) in &per_fn {
        println!("  {f:<29} {m:>4}/{t}");
    }
    if matched == total && total > 0 {
        println!("diff: {matched}/{total} cases match — PASS");
        ExitCode::SUCCESS
    } else {
        println!("diff: {matched}/{total} cases match — FAIL");
        for m in mismatches.iter().take(20) {
            eprintln!("  MISMATCH {m}");
        }
        if mismatches.len() > 20 {
            eprintln!("  … and {} more", mismatches.len() - 20);
        }
        ExitCode::FAILURE
    }
}
