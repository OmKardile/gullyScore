//! egui rendering of the GullyScore app — a thin layer over the pure state
//! machine in state.rs. Every mutation goes through GullyApp methods; this
//! file only lays out widgets and reads derived views from the engine.
//!
//! Borrow discipline: each view first collects OWNED data from `&app`
//! (names, scorecards, predictions), then renders it — so widget callbacks
//! can call `&mut app` actions freely.

use crate::state::{GullyApp, Overlay, Screen, TeamSetup, WicketInput};
use eframe::egui;
use gullyscore_engine::{
    calculate_live_win_probability, calculate_projected_score, generate_ball_commentary,
    CommentaryBall, ExtraType, InningsScorecard, WicketType,
};

/// Transient UI state (dialog selections, tab focus) — never domain data.
#[derive(Debug, Default)]
pub struct UiState {
    pub wicket_type: Option<WicketType>,
    pub dismissed_striker: bool,
    pub fielders: Vec<bool>,
    pub runs_completed: i64,
    pub extra_runs: i64,
    pub tab: u8,
    pub scorecard_innings: usize,
}

const WICKET_TYPES: [WicketType; 14] = [
    WicketType::Bowled,
    WicketType::Caught,
    WicketType::CaughtBehind,
    WicketType::CaughtBowled,
    WicketType::Lbw,
    WicketType::RunOut,
    WicketType::Stumped,
    WicketType::HitWicket,
    WicketType::HitBallTwice,
    WicketType::ObstructingField,
    WicketType::HandledBall,
    WicketType::TimedOut,
    WicketType::RetiredOut,
    WicketType::RetiredHurt,
];

/// The wire string the commentary engine compares against.
fn extra_wire_name(e: ExtraType) -> &'static str {
    match e {
        ExtraType::None => "none",
        ExtraType::Wide => "wide",
        ExtraType::NoBall => "no_ball",
        ExtraType::Bye => "bye",
        ExtraType::LegBye => "leg_bye",
        ExtraType::Penalty => "penalty",
    }
}

fn ball_type_name(b: gullyscore_engine::BallType) -> &'static str {
    match b {
        gullyscore_engine::BallType::Tennis => "tennis",
        gullyscore_engine::BallType::Box => "box",
        gullyscore_engine::BallType::Leather => "leather",
    }
}

pub fn draw(app: &mut GullyApp, ui_state: &mut UiState, ctx: &egui::Context) {
    match app.screen {
        Screen::Setup => draw_setup(app, ctx),
        Screen::Live | Screen::Scorecard => draw_live(app, ui_state, ctx),
    }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

fn draw_setup(app: &mut GullyApp, ctx: &egui::Context) {
    egui::CentralPanel::default().show(ctx, |ui| {
        ui.heading("GullyScore");
        ui.label("Rust port — powered by the proved engine");
        ui.add_space(8.0);

        egui::ScrollArea::vertical().show(ui, |ui| {
            team_panel(ui, &mut app.setup.team_a, "Team A — batting first");
            team_panel(ui, &mut app.setup.team_b, "Team B — bowling first");

            ui.add_space(10.0);
            ui.heading("Rules");
            egui::Grid::new("rules").num_columns(2).show(ui, |ui| {
                ui.label("Overs");
                ui.add(egui::DragValue::new(&mut app.setup.overs).range(1..=40));
                ui.end_row();
                ui.label("Players per side");
                ui.add(egui::DragValue::new(&mut app.setup.players_per_side).range(2..=15));
                ui.end_row();
                ui.label("Ball type");
                egui::ComboBox::from_id_salt("balltype")
                    .selected_text(ball_type_name(app.setup.ball_type))
                    .show_ui(ui, |ui| {
                        for (t, n) in [
                            (gullyscore_engine::BallType::Tennis, "tennis"),
                            (gullyscore_engine::BallType::Box, "box"),
                            (gullyscore_engine::BallType::Leather, "leather"),
                        ] {
                            ui.selectable_value(&mut app.setup.ball_type, t, n);
                        }
                    });
                ui.end_row();
                ui.label("Wide runs");
                ui.add(egui::DragValue::new(&mut app.setup.wide_run_value).range(0..=2));
                ui.end_row();
                ui.label("No-ball runs");
                ui.add(egui::DragValue::new(&mut app.setup.no_ball_run_value).range(1..=2));
                ui.end_row();
                ui.label("Max overs per bowler");
                ui.add(egui::DragValue::new(&mut app.setup.max_overs_per_bowler).range(1..=10));
                ui.end_row();
            });
            ui.checkbox(&mut app.setup.free_hit_on_no_ball, "Free hit on no-ball");
            ui.checkbox(&mut app.setup.last_man_batting, "Last man batting");
            ui.checkbox(&mut app.setup.no_consecutive_overs, "No consecutive overs");

            ui.add_space(14.0);
            let started = ui
                .add(
                    egui::Button::new(egui::RichText::new("▶  Start Match").size(22.0))
                        .min_size(egui::vec2(ui.available_width(), 52.0)),
                )
                .clicked();
            if let Some(err) = &app.setup_error_hint {
                ui.colored_label(egui::Color32::RED, err);
            }
            if started {
                if let Err(e) = app.start_match() {
                    app.setup_error_hint = Some(e);
                } else {
                    app.setup_error_hint = None;
                }
            }
        });
    });
}

fn team_panel(ui: &mut egui::Ui, team: &mut TeamSetup, tag: &str) {
    ui.group(|ui| {
        ui.strong(tag);
        ui.text_edit_singleline(&mut team.name);
        for (i, name) in team.players.iter_mut().enumerate() {
            ui.horizontal(|ui| {
                ui.label(format!("#{}", i + 1));
                ui.text_edit_singleline(name);
            });
        }
        ui.horizontal(|ui| {
            if ui.button("+ player").clicked() && team.players.len() < 15 {
                team.players
                    .push(format!("Player {}", team.players.len() + 1));
            }
            if ui.button("− player").clicked() && team.players.len() > 2 {
                team.players.pop();
            }
        });
    });
}

// ---------------------------------------------------------------------------
// Live match
// ---------------------------------------------------------------------------

fn draw_live(app: &mut GullyApp, ui_state: &mut UiState, ctx: &egui::Context) {
    // ---- owned header data (immutable borrow of app ends here)
    let (score_line, sub_line, batting_name, match_over) = {
        let live = app.live.as_ref().expect("live screen implies a match");
        let sc = live.current_scorecard();
        let batting_name = if live.current().batting_team == 0 {
            live.setup.team_a.name.clone()
        } else {
            live.setup.team_b.name.clone()
        };
        let sub_line = match (live.current().target_runs, live.innings.len()) {
            (Some(t), 2) => {
                format!("Target {t} · need {}", (t - sc.total_runs).max(0))
            }
            _ => format!("Innings {}", live.innings.len()),
        };
        (
            format!(
                "{} {} / {} ({})",
                batting_name, sc.total_runs, sc.total_wickets, sc.overs_formatted
            ),
            sub_line,
            batting_name,
            live.winner.is_some(),
        )
    };
    let _ = &batting_name;

    // ---- overlays may mutate the app (bowler pick, wicket record)
    draw_overlays(app, ui_state, ctx);

    egui::CentralPanel::default().show(ctx, |ui| {
        if match_over {
            draw_result(app, ui);
            return;
        }
        ui.heading(egui::RichText::new(&score_line).size(24.0).strong());
        ui.label(sub_line);
        ui.add_space(4.0);
        ui.horizontal(|ui| {
            ui.selectable_value(&mut ui_state.tab, 0, "Ball");
            ui.selectable_value(&mut ui_state.tab, 1, "Scorecard");
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                if ui.button("⟲ Undo").clicked() {
                    app.undo();
                }
            });
        });
        ui.separator();
        if ui_state.tab == 0 {
            draw_ball_tab(app, ui_state, ui);
        } else {
            draw_scorecard_tab(app, ui_state, ui);
        }
    });
}

fn draw_ball_tab(app: &mut GullyApp, ui_state: &mut UiState, ui: &mut egui::Ui) {
    // ---- owned view data
    struct View {
        striker: (String, String),
        non_striker: (String, String),
        bowler: (String, String),
        free_hit: bool,
        commentary: String,
        win_a: i64,
        win_b: i64,
        team_a: String,
        team_b: String,
        proj_line: Option<String>,
    }
    let view = {
        let live = app.live.as_ref().unwrap();
        let sc = live.current_scorecard();
        let names = live.players_map();
        let name = |id: &str| {
            names
                .get(id)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| id.to_string())
        };
        let bat = |id: &str| {
            sc.batters
                .iter()
                .find(|b| b.player_id == id)
                .map(|b| format!("{} ({})", b.runs, b.balls_faced))
                .unwrap_or_else(|| "0 (0)".into())
        };
        let bowl = |id: &str| {
            sc.bowlers
                .iter()
                .find(|b| b.player_id == id)
                .map(|b| format!("{}/{} · {} ov", b.wickets, b.runs_conceded, b.overs))
                .unwrap_or_else(|| "0/0".into())
        };
        let inn = live.current();
        let striker = (name(&inn.striker), bat(&inn.striker));
        let non_striker = (name(&inn.non_striker), bat(&inn.non_striker));
        let bowler = (name(&inn.bowler), bowl(&inn.bowler));

        let commentary = inn
            .ball_events
            .last()
            .map(|last| {
                generate_ball_commentary(
                    &CommentaryBall {
                        runs_bat: last.runs_bat,
                        extra_type: extra_wire_name(last.extra_type).to_string(),
                        extra_runs: last.extra_runs,
                        is_legal: last.is_legal,
                        wicket: last.wicket.clone(),
                        shot_direction: None,
                    },
                    &name(&last.striker_id),
                    &name(&last.bowler_id),
                )
            })
            .unwrap_or_default();

        let (win_a, win_b, proj_line) = if inn.ball_events.is_empty() {
            (50, 50, None)
        } else {
            let engine_match = live.engine_match_view();
            let first_total = if live.innings.len() == 2 {
                live.innings
                    .first()
                    .map(|i| i.ball_events.iter().map(|b| b.runs_bat).sum::<i64>())
            } else {
                None
            };
            let wp = calculate_live_win_probability(&engine_match, &sc, first_total, 0.5);
            let rules = live.setup.rules();
            let rules_max = if rules.last_man_batting {
                rules.players_per_side
            } else {
                rules.players_per_side - 1
            };
            let ceiling = 1.max(rules_max.min(
                live.batting_squad().len() as i64 - if rules.last_man_batting { 0 } else { 1 },
            ));
            let proj = calculate_projected_score(
                sc.total_runs,
                sc.legal_balls_count,
                live.setup.overs,
                sc.total_wickets,
                ceiling,
                ball_type_name(live.setup.ball_type),
            );
            (
                wp.team_a_win_prob,
                wp.team_b_win_prob,
                Some(format!(
                    "Projected {} – {} · par {}",
                    proj.projected_min, proj.projected_max, proj.par_score
                )),
            )
        };
        View {
            striker,
            non_striker,
            bowler,
            free_hit: inn.free_hit,
            commentary,
            win_a,
            win_b,
            team_a: live.setup.team_a.name.clone(),
            team_b: live.setup.team_b.name.clone(),
            proj_line,
        }
    };

    // ---- crease
    ui.group(|ui| {
        ui.horizontal_wrapped(|ui| {
            ui.label(egui::RichText::new(format!("*{}", view.striker.0)).strong());
            ui.monospace(&view.striker.1);
            ui.separator();
            ui.label(&view.non_striker.0);
            ui.monospace(&view.non_striker.1);
            ui.separator();
            ui.label(format!("{} · {}", view.bowler.0, view.bowler.1));
        });
    });
    if view.free_hit {
        ui.colored_label(egui::Color32::from_rgb(200, 60, 20), "FREE HIT");
    }
    ui.add_space(6.0);

    // ---- runs
    ui.horizontal_wrapped(|ui| {
        for r in [0i64, 1, 2, 3, 4, 6, 5] {
            let label = r.to_string();
            if ui
                .add(
                    egui::Button::new(egui::RichText::new(label).size(22.0))
                        .min_size(egui::vec2(52.0, 52.0)),
                )
                .clicked()
            {
                app.record(r, ExtraType::None, 0, None);
            }
        }
    });

    // ---- extras
    ui.add_space(4.0);
    ui.horizontal_wrapped(|ui| {
        ui.add(egui::DragValue::new(&mut ui_state.extra_runs).range(0..=5));
        for (label, extra) in [
            ("Wide", ExtraType::Wide),
            ("No-ball", ExtraType::NoBall),
            ("Bye", ExtraType::Bye),
            ("Leg-bye", ExtraType::LegBye),
        ] {
            if ui
                .add(egui::Button::new(label).min_size(egui::vec2(78.0, 40.0)))
                .clicked()
            {
                let runs = match extra {
                    ExtraType::Wide | ExtraType::NoBall => 0, // rules value applies
                    _ => ui_state.extra_runs,
                };
                app.record(0, extra, runs, None);
            }
        }
    });

    // ---- wicket
    ui.add_space(4.0);
    if ui
        .add(
            egui::Button::new(egui::RichText::new("WICKET").size(18.0))
                .min_size(egui::vec2(140.0, 44.0)),
        )
        .clicked()
    {
        ui_state.wicket_type = Some(WicketType::Bowled);
        ui_state.dismissed_striker = true;
        ui_state.runs_completed = 0;
        app.overlay = Overlay::Wicket;
    }

    // ---- commentary + predictions
    if !view.commentary.is_empty() {
        ui.add_space(6.0);
        ui.label(format!("🎤 {}", view.commentary));
    }
    if let Some(proj) = &view.proj_line {
        ui.add_space(4.0);
        ui.label(proj);
        let a = view.win_a as f32 / 100.0;
        ui.horizontal(|ui| {
            ui.label(format!("{} {}%", view.team_a, view.win_a));
            ui.add(egui::ProgressBar::new(a).desired_width(ui.available_width() * 0.6));
            ui.label(format!("{} {}%", view.team_b, view.win_b));
        });
    }
}

fn draw_scorecard_tab(app: &mut GullyApp, ui_state: &mut UiState, ui: &mut egui::Ui) {
    let (sc, names) = {
        let live = app.live.as_ref().unwrap();
        let count = live.innings.len().min(2);
        let idx = ui_state.scorecard_innings.min(count - 1);
        (live.innings_scorecard(idx), live.players_map())
    };
    let count = app
        .live
        .as_ref()
        .map(|l| l.innings.len().min(2))
        .unwrap_or(1);
    ui.horizontal(|ui| {
        for i in 0..count {
            let label = format!("Innings {}", i + 1);
            if ui
                .selectable_label(ui_state.scorecard_innings == i, &label)
                .clicked()
            {
                ui_state.scorecard_innings = i;
            }
        }
    });
    ui.separator();

    ui.heading("Batting");
    egui::Grid::new("batting").striped(true).show(ui, |ui| {
        ui.strong("Batter");
        ui.strong("R");
        ui.strong("B");
        ui.strong("4s");
        ui.strong("6s");
        ui.strong("SR");
        ui.end_row();
        for b in &sc.batters {
            let name = names
                .get(&b.player_id)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| b.player_id.clone());
            let star = if b.is_out { "" } else { "*" };
            ui.label(format!("{star}{name}"));
            ui.label(b.runs.to_string());
            ui.label(b.balls_faced.to_string());
            ui.label(b.fours.to_string());
            ui.label(b.sixes.to_string());
            ui.label(format!("{:.1}", b.strike_rate));
            ui.end_row();
            if let Some(d) = &b.dismissal_text {
                ui.label(
                    egui::RichText::new(d.as_str())
                        .small()
                        .color(egui::Color32::GRAY),
                );
                ui.end_row();
            }
        }
    });

    ui.add_space(6.0);
    ui.heading("Bowling");
    egui::Grid::new("bowling").striped(true).show(ui, |ui| {
        ui.strong("Bowler");
        ui.strong("O");
        ui.strong("M");
        ui.strong("R");
        ui.strong("W");
        ui.strong("Econ");
        ui.end_row();
        for b in &sc.bowlers {
            let name = names
                .get(&b.player_id)
                .map(|p| p.name.clone())
                .unwrap_or_else(|| b.player_id.clone());
            ui.label(name);
            ui.label(format!("{}", b.overs));
            ui.label(b.maidens.to_string());
            ui.label(b.runs_conceded.to_string());
            ui.label(b.wickets.to_string());
            ui.label(format!("{:.2}", b.economy));
            ui.end_row();
        }
    });

    ui.add_space(6.0);
    ui.label(format!(
        "Extras {} (wd {}, nb {}, b {}, lb {}, pen {})",
        sc.extras.total,
        sc.extras.wides,
        sc.extras.no_balls,
        sc.extras.byes,
        sc.extras.leg_byes,
        sc.extras.penalties
    ));
    if !sc.fall_of_wickets.is_empty() {
        let fow = sc
            .fall_of_wickets
            .iter()
            .map(|f| format!("{}-{} ({}w)", f.score, f.overs, f.wicket_number))
            .collect::<Vec<_>>()
            .join(", ");
        ui.label(format!("FOW: {fow}"));
    }
}

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

fn draw_overlays(app: &mut GullyApp, ui_state: &mut UiState, ctx: &egui::Context) {
    match app.overlay {
        Overlay::Bowler => {
            let eligible = app
                .live
                .as_ref()
                .map(|l| l.eligible_bowlers())
                .unwrap_or_default();
            egui::Window::new("Next bowler")
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, egui::vec2(0.0, 0.0))
                .show(ctx, |ui| {
                    for (id, name) in &eligible {
                        if ui
                            .add(
                                egui::Button::new(egui::RichText::new(name.as_str()).size(18.0))
                                    .min_size(egui::vec2(240.0, 44.0)),
                            )
                            .clicked()
                        {
                            if let Some(live) = &mut app.live {
                                live.set_bowler(id.clone());
                            }
                            app.overlay = Overlay::None;
                        }
                    }
                    if eligible.is_empty() {
                        ui.label("No eligible bowler — check max-overs / no-consecutive rules");
                        if ui.button("Allow anyone").clicked() {
                            if let Some(live) = &mut app.live {
                                if let Some(first) = live.bowling_squad().first() {
                                    let f = first.clone();
                                    live.set_bowler(f);
                                }
                            }
                            app.overlay = Overlay::None;
                        }
                    }
                });
        }
        Overlay::Wicket => {
            // owned data for the dialog
            let (striker_name, non_striker_name, fielder_names) = {
                let live = app.live.as_ref().unwrap();
                let names = live.players_map();
                let n = |id: &str| {
                    names
                        .get(id)
                        .map(|p| p.name.clone())
                        .unwrap_or_else(|| id.to_string())
                };
                (
                    n(&live.current().striker),
                    n(&live.current().non_striker),
                    live.bowling_squad()
                        .iter()
                        .map(|id| n(id))
                        .collect::<Vec<_>>(),
                )
            };
            egui::Window::new("Wicket!")
                .collapsible(false)
                .resizable(false)
                .anchor(egui::Align2::CENTER_CENTER, egui::vec2(0.0, 0.0))
                .show(ctx, |ui| {
                    let wt = ui_state.wicket_type.get_or_insert(WicketType::Bowled);
                    egui::ComboBox::from_id_salt("wicket_type")
                        .selected_text(wicket_name(*wt))
                        .show_ui(ui, |ui| {
                            for t in WICKET_TYPES {
                                ui.selectable_value(wt, t, wicket_name(t));
                            }
                        });
                    ui.horizontal(|ui| {
                        ui.selectable_value(
                            &mut ui_state.dismissed_striker,
                            true,
                            format!("*{striker_name}"),
                        );
                        ui.selectable_value(
                            &mut ui_state.dismissed_striker,
                            false,
                            non_striker_name.as_str(),
                        );
                    });
                    ui.horizontal(|ui| {
                        ui.label("Runs completed");
                        ui.add(egui::DragValue::new(&mut ui_state.runs_completed).range(0..=4));
                    });
                    let needs_fielder = matches!(
                        wt,
                        WicketType::Caught
                            | WicketType::CaughtBehind
                            | WicketType::CaughtBowled
                            | WicketType::RunOut
                            | WicketType::Stumped
                    );
                    if needs_fielder {
                        ui.label("Fielders");
                        if ui_state.fielders.len() != fielder_names.len() {
                            ui_state.fielders = vec![false; fielder_names.len()];
                        }
                        egui::Grid::new("fielders").num_columns(2).show(ui, |ui| {
                            for (i, name) in fielder_names.iter().enumerate() {
                                ui.checkbox(&mut ui_state.fielders[i], name.as_str());
                            }
                        });
                    }
                    ui.add_space(6.0);
                    ui.horizontal(|ui| {
                        if ui
                            .add(egui::Button::new("✔ Record").min_size(egui::vec2(110.0, 40.0)))
                            .clicked()
                        {
                            let wicket_type =
                                *ui_state.wicket_type.get_or_insert(WicketType::Bowled);
                            let fielders = ui_state
                                .fielders
                                .iter()
                                .enumerate()
                                .filter(|(_, b)| **b)
                                .map(|(i, _)| i)
                                .collect();
                            app.record(
                                0,
                                ExtraType::None,
                                0,
                                Some(WicketInput {
                                    wicket_type,
                                    dismissed_striker: ui_state.dismissed_striker,
                                    fielder_numbers: fielders,
                                    runs_completed: ui_state.runs_completed,
                                }),
                            );
                            app.overlay = Overlay::None;
                        }
                        if ui.button("Cancel").clicked() {
                            app.overlay = Overlay::None;
                        }
                    });
                });
        }
        Overlay::None => {}
    }
}

fn wicket_name(t: WicketType) -> &'static str {
    use WicketType::*;
    match t {
        Bowled => "Bowled",
        Caught => "Caught",
        CaughtBowled => "Caught & bowled",
        CaughtBehind => "Caught behind",
        Lbw => "LBW",
        RunOut => "Run out",
        Stumped => "Stumped",
        HitWicket => "Hit wicket",
        HitBallTwice => "Hit ball twice",
        ObstructingField => "Obstructing the field",
        HandledBall => "Handled the ball",
        TimedOut => "Timed out",
        RetiredOut => "Retired out",
        RetiredHurt => "Retired hurt",
    }
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

fn draw_result(app: &mut GullyApp, ui: &mut egui::Ui) {
    let (result_text, mvp) = {
        let live = app.live.as_ref().unwrap();
        (live.result_text.clone(), live.mvp_ranking())
    };
    ui.heading(egui::RichText::new(&result_text).size(26.0));
    ui.add_space(8.0);
    ui.heading("Top MVP points");
    for (i, (_, name, pts)) in mvp.iter().take(5).enumerate() {
        ui.label(format!("{}. {} — {} pts", i + 1, name, pts));
    }
    ui.add_space(10.0);
    if ui
        .add(
            egui::Button::new(egui::RichText::new("New match").size(20.0))
                .min_size(egui::vec2(200.0, 48.0)),
        )
        .clicked()
    {
        app.screen = Screen::Setup;
        app.live = None;
    }
}

/// Re-exported for main.rs so the desktop binary can show the same app.
pub fn run_with_options(options: eframe::NativeOptions) -> eframe::Result {
    eframe::run_native(
        "GullyScore",
        options,
        Box::new(|_cc| {
            Ok(Box::new(EguiApp {
                app: GullyApp::default(),
                ui_state: UiState::default(),
            }))
        }),
    )
}

/// The eframe app wrapper.
pub struct EguiApp {
    pub app: GullyApp,
    pub ui_state: UiState,
}

impl eframe::App for EguiApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        draw(&mut self.app, &mut self.ui_state, ctx);
    }
}

/// Scorecard view helper (used by tests through the public API).
pub fn scorecard_view(live: &crate::state::LiveMatch, idx: usize) -> InningsScorecard {
    live.innings_scorecard(idx)
}
