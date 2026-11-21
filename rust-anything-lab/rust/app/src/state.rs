//! The app's live-match state machine, built directly on the proved engine.
//!
//! This mirrors the RN app's authoritative crease state (1.4.7-test-3+):
//! ball events record who faced THAT ball, and the app keeps the state AFTER
//! the last event — who is on strike NOW, who bowls NEXT. Recording follows
//! the same rules the engine documents: odd runs completed swap strike, a
//! completed over swaps ends and needs a new bowler, a dismissal brings the
//! next batter in at the dismissed end (retired hurt: replacement, not out).
//!
//! Undo is event-sourced: pop the event and replay the remaining transitions
//! — the state is always a pure function of the event log plus the setup.

use gullyscore_engine::stats::Match as EngineMatch;
use gullyscore_engine::{
    calculate_match_mvp_points, replay_innings, BallEvent, BallType, DismissalInfo, DismissedEnd,
    ExtraType, InningsScorecard, MatchRules, Player, PlayerRole, WicketType,
};
#[cfg(test)]
use gullyscore_engine::{derive_live_crease, LiveCreaseState};
use indexmap::IndexMap;

// ---------------------------------------------------------------------------
// Setup (pre-match)
// ---------------------------------------------------------------------------

pub const DEFAULT_PLAYERS: usize = 8;

#[derive(Debug, Clone, PartialEq)]
pub struct TeamSetup {
    pub name: String,
    pub players: Vec<String>,
}

impl TeamSetup {
    pub fn new(name: &str) -> Self {
        TeamSetup {
            name: name.to_string(),
            players: (0..DEFAULT_PLAYERS)
                .map(|i| format!("Player {}", i + 1))
                .collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SetupState {
    pub team_a: TeamSetup,
    pub team_b: TeamSetup,
    pub overs: i64,
    pub players_per_side: i64,
    pub ball_type: BallType,
    pub wide_run_value: i64,
    pub no_ball_run_value: i64,
    pub free_hit_on_no_ball: bool,
    pub last_man_batting: bool,
    pub max_overs_per_bowler: i64,
    pub no_consecutive_overs: bool,
}

impl Default for SetupState {
    fn default() -> Self {
        SetupState {
            team_a: TeamSetup::new("Team A"),
            team_b: TeamSetup::new("Team B"),
            overs: 8,
            players_per_side: 8,
            ball_type: BallType::Tennis,
            wide_run_value: 1,
            no_ball_run_value: 1,
            free_hit_on_no_ball: true,
            last_man_batting: false,
            max_overs_per_bowler: 2,
            no_consecutive_overs: true,
        }
    }
}

impl SetupState {
    pub fn rules(&self) -> MatchRules {
        MatchRules {
            overs: self.overs,
            players_per_side: self.players_per_side,
            ball_type: self.ball_type,
            wide_run_value: self.wide_run_value,
            no_ball_run_value: self.no_ball_run_value,
            free_hit_on_no_ball: self.free_hit_on_no_ball,
            last_man_batting: self.last_man_batting,
            max_overs_per_bowler: self.max_overs_per_bowler,
            no_consecutive_overs: self.no_consecutive_overs,
            super_over_on_tie: false,
            track_shot_direction: false,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.team_a.name.trim().is_empty() || self.team_b.name.trim().is_empty() {
            return Err("Both teams need a name".into());
        }
        if self.team_a.players.len() < 2 || self.team_b.players.len() < 2 {
            return Err("Each team needs at least 2 players".into());
        }
        if !(1..=40).contains(&self.overs) {
            return Err("Overs must be between 1 and 40".into());
        }
        if self.players_per_side < 2 {
            return Err("At least 2 players per side".into());
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Live match
// ---------------------------------------------------------------------------

/// A wicket being recorded from the UI.
#[derive(Debug, Clone, PartialEq)]
pub struct WicketInput {
    pub wicket_type: WicketType,
    /// which batter is out (the UI picks from the crease)
    pub dismissed_striker: bool,
    pub fielder_numbers: Vec<usize>,
    pub runs_completed: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LiveInnings {
    pub batting_team: usize,
    pub ball_events: Vec<BallEvent>,
    /// authoritative crease state AFTER the last event
    pub striker: String,
    pub non_striker: String,
    pub bowler: String,
    /// next squad index that has not batted yet
    next_batter_idx: usize,
    legal_balls_this_over: i64,
    pub awaiting_bowler: bool,
    /// free hit is live for the next ball (display rule only)
    pub free_hit: bool,
    pub is_super_over: bool,
    pub target_runs: Option<i64>,
}

impl LiveInnings {
    fn new(
        batting_team: usize,
        squad: &[String],
        bowler: Option<String>,
        target: Option<i64>,
    ) -> Self {
        let awaiting = bowler.is_none();
        let bowler = bowler.unwrap_or_default();
        LiveInnings {
            batting_team,
            ball_events: Vec::new(),
            striker: squad.first().cloned().unwrap_or_default(),
            non_striker: squad.get(1).cloned().unwrap_or_default(),
            bowler,
            next_batter_idx: 2.min(squad.len()),
            legal_balls_this_over: 0,
            awaiting_bowler: awaiting,
            free_hit: false,
            is_super_over: false,
            target_runs: target,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LiveMatch {
    pub setup: SetupState,
    /// stable player ids per team: A0.. / B0.. index = squad position
    pub player_ids: [Vec<String>; 2],
    pub player_names: [Vec<String>; 2],
    pub innings: Vec<LiveInnings>,
    pub winner: Option<usize>,
    pub result_text: String,
}

/// The engine's all-out ceiling, mirrored for the result text
/// (a short side is all out at squad_len − 1 without last-man).
fn max_wickets_for(rules: &MatchRules, squad_len: usize) -> i64 {
    let rules_max = if rules.last_man_batting {
        rules.players_per_side
    } else {
        rules.players_per_side - 1
    };
    1.max(rules_max.min(squad_len as i64 - if rules.last_man_batting { 0 } else { 1 }))
}

impl LiveMatch {
    pub fn new(setup: SetupState) -> Self {
        let a_ids: Vec<String> = (0..setup.team_a.players.len())
            .map(|i| format!("A{i}"))
            .collect();
        let b_ids: Vec<String> = (0..setup.team_b.players.len())
            .map(|i| format!("B{i}"))
            .collect();
        let mut m = LiveMatch {
            player_names: [setup.team_a.players.clone(), setup.team_b.players.clone()],
            player_ids: [a_ids, b_ids],
            setup,
            innings: Vec::new(),
            winner: None,
            result_text: String::new(),
        };
        // innings 1: team A bats, team B's first bowler opens
        let squad = m.player_ids[0].clone();
        let bowler = m.player_ids[1].first().cloned();
        m.innings.push(LiveInnings::new(0, &squad, bowler, None));
        m
    }

    pub fn current(&self) -> &LiveInnings {
        self.innings.last().expect("always at least one innings")
    }

    pub fn batting_squad(&self) -> &[String] {
        &self.player_ids[self.current().batting_team]
    }

    pub fn bowling_squad(&self) -> &[String] {
        &self.player_ids[1 - self.current().batting_team]
    }

    fn player_name(&self, id: &str) -> String {
        let team = if let Some(rest) = id.strip_prefix('A') {
            rest.parse::<usize>()
                .ok()
                .map(|i| self.player_names[0].get(i).cloned().unwrap_or_default())
                .unwrap_or_default()
        } else if let Some(rest) = id.strip_prefix('B') {
            rest.parse::<usize>()
                .ok()
                .map(|i| self.player_names[1].get(i).cloned().unwrap_or_default())
                .unwrap_or_default()
        } else {
            String::new()
        };
        if team.is_empty() {
            id.to_string()
        } else {
            team
        }
    }

    /// Bowlers the scorer may pick for the next over.
    pub fn eligible_bowlers(&self) -> Vec<(String, String)> {
        let rules = &self.setup;
        let events = &self.current().ball_events;
        let mut overs_bowled: IndexMap<String, i64> = IndexMap::new();
        let mut last_over_bowler: Option<String> = None;
        let mut count = 0i64;
        let mut prev_bowler = String::new();
        for b in events {
            if b.bowler_id != prev_bowler {
                if count > 0 {
                    *overs_bowled.entry(prev_bowler.clone()).or_insert(0) += 1;
                    last_over_bowler = Some(prev_bowler.clone());
                }
                count = 0;
                prev_bowler = b.bowler_id.clone();
            }
            if b.is_legal {
                count += 1;
                if count == 6 {
                    *overs_bowled.entry(prev_bowler.clone()).or_insert(0) += 1;
                    last_over_bowler = Some(prev_bowler.clone());
                    count = 0;
                }
            }
        }
        self.bowling_squad()
            .iter()
            .filter(|id| {
                if rules.no_consecutive_overs && last_over_bowler.as_deref() == Some(id.as_str()) {
                    return false;
                }
                if overs_bowled.get(*id).copied().unwrap_or(0) >= rules.max_overs_per_bowler {
                    return false;
                }
                true
            })
            .map(|id| (id.clone(), self.player_name(id)))
            .collect()
    }

    pub fn set_bowler(&mut self, bowler_id: String) {
        let inn = self.innings.last_mut().unwrap();
        inn.bowler = bowler_id;
        inn.awaiting_bowler = false;
    }

    /// Record a ball. Mirrors the RN recording rules (see module docs).
    pub fn record_ball(
        &mut self,
        runs_bat: i64,
        extra: ExtraType,
        extra_runs: i64,
        wicket: Option<WicketInput>,
    ) {
        // --- snapshot the pre-ball crease (owned, no borrow juggling)
        let (striker, non_striker, bowler) = {
            let inn = self.current();
            (
                inn.striker.clone(),
                inn.non_striker.clone(),
                inn.bowler.clone(),
            )
        };
        let is_legal = !matches!(extra, ExtraType::Wide | ExtraType::NoBall);

        let wicket_info = wicket.as_ref().map(|w| DismissalInfo {
            wicket_type: w.wicket_type,
            dismissed_player_id: if w.dismissed_striker {
                striker.clone()
            } else {
                non_striker.clone()
            },
            dismissed_end: if w.dismissed_striker {
                DismissedEnd::Striker
            } else {
                DismissedEnd::NonStriker
            },
            fielder_ids: w
                .fielder_numbers
                .iter()
                .map(|&n| {
                    self.bowling_squad()
                        .get(n)
                        .cloned()
                        .unwrap_or_else(|| format!("F{n}"))
                })
                .collect(),
            runs_completed: w.runs_completed,
        });

        let ev = BallEvent {
            striker_id: striker,
            non_striker_id: non_striker,
            bowler_id: bowler,
            runs_bat,
            extra_type: extra,
            extra_runs,
            is_legal,
            wicket: wicket_info,
        };
        self.innings.last_mut().unwrap().ball_events.push(ev);
        self.transition();
        self.check_completion();
    }

    /// Apply the after-ball transition for the LAST recorded event.
    ///
    /// The event carries the pre-ball crease (who faced that ball), which is
    /// restored first — so this single function serves both live recording
    /// and the undo replay, and can never drift between them.
    fn transition(&mut self) {
        let batting_team = self.innings.last().unwrap().batting_team;
        let squad = self.player_ids[batting_team].clone();
        let free_hit_rule = self.setup.free_hit_on_no_ball;
        let last_man = self.setup.last_man_batting;
        let ev = self
            .innings
            .last()
            .unwrap()
            .ball_events
            .last()
            .cloned()
            .expect("transition called with an event present");

        let inn = self.innings.last_mut().unwrap();
        // the event IS the pre-ball truth
        inn.striker = ev.striker_id.clone();
        inn.non_striker = ev.non_striker_id.clone();
        inn.bowler = ev.bowler_id.clone();
        inn.awaiting_bowler = false;

        // runs completed (wicket balls carry them on the wicket info);
        // bye/leg-bye extras count toward the parity swap
        let runs_completed = ev
            .wicket
            .as_ref()
            .map(|w| w.runs_completed)
            .unwrap_or(ev.runs_bat);
        let mut total_ran = runs_completed;
        if matches!(ev.extra_type, ExtraType::Bye | ExtraType::LegBye) {
            total_ran += ev.extra_runs;
        }
        let odd = total_ran % 2 != 0;
        let over_completed = ev.is_legal && inn.legal_balls_this_over + 1 == 6;
        if ev.is_legal {
            inn.legal_balls_this_over += 1;
        }
        if odd {
            std::mem::swap(&mut inn.striker, &mut inn.non_striker);
        }

        if let Some(w) = &ev.wicket {
            // dismissal or retirement: replace the dismissed PLAYER wherever
            // they sit after the crossing (odd runs moved them)
            let dismissed = if w.dismissed_end == DismissedEnd::Striker {
                ev.striker_id.clone()
            } else {
                ev.non_striker_id.clone()
            };
            if let Some(next) = squad.get(inn.next_batter_idx).cloned() {
                if inn.striker == dismissed {
                    inn.striker = next;
                } else {
                    inn.non_striker = next;
                }
            }
            let mut used = inn.next_batter_idx;
            for id in [&inn.striker, &inn.non_striker] {
                if let Some(pos) = squad.iter().position(|s| s == id) {
                    used = used.max(pos + 1);
                }
            }
            inn.next_batter_idx = used;
        }

        if over_completed {
            inn.legal_balls_this_over = 0;
            if !last_man {
                std::mem::swap(&mut inn.striker, &mut inn.non_striker);
            }
            inn.awaiting_bowler = true;
        }
        inn.free_hit = free_hit_rule && ev.extra_type == ExtraType::NoBall;
    }

    /// Undo: drop the last recorded ball and replay the remaining transitions.
    /// The transition function restores the crease from each event, so the
    /// replay uses exactly the same rules as live recording.
    pub fn undo(&mut self) {
        // if the current innings has no balls yet, we are right after an
        // innings break — go back to the previous innings' last ball
        if self.innings.len() > 1 && self.current().ball_events.is_empty() {
            self.innings.pop();
        }
        if self.innings.last_mut().unwrap().ball_events.pop().is_none() {
            return;
        }
        let batting_team = self.current().batting_team;
        let target = self.current().target_runs;
        let is_super = self.current().is_super_over;
        let events = self.current().ball_events.clone();
        let squad = self.player_ids[batting_team].clone();
        let opener = self.player_ids[1 - batting_team].first().cloned();
        let mut fresh = LiveInnings::new(batting_team, &squad, opener, target);
        fresh.is_super_over = is_super;
        *self.innings.last_mut().unwrap() = fresh;
        for ev in &events {
            self.innings
                .last_mut()
                .unwrap()
                .ball_events
                .push(ev.clone());
            self.transition();
        }
        self.winner = None;
        self.result_text = String::new();
    }

    // ------------------------------------------------------------------ views

    pub fn players_map(&self) -> IndexMap<String, Player> {
        let mut map = IndexMap::new();
        for (team, ids) in self.player_ids.iter().enumerate() {
            for (i, id) in ids.iter().enumerate() {
                map.insert(
                    id.clone(),
                    Player {
                        id: id.clone(),
                        name: self.player_names[team]
                            .get(i)
                            .cloned()
                            .unwrap_or_else(|| id.clone()),
                        nickname: None,
                        role: PlayerRole::AllRounder,
                        batting_hand: gullyscore_engine::BattingHand::Right,
                        bowling_style: gullyscore_engine::BowlingStyle::Rm,
                        photo_uri: None,
                        is_archived: false,
                        created_at: 0,
                        updated_at: None,
                    },
                );
            }
        }
        map
    }

    /// The current innings' scorecard (replayed through the proved engine).
    pub fn current_scorecard(&self) -> InningsScorecard {
        let inn = self.current();
        replay_innings(
            &inn.ball_events,
            &self.setup.rules(),
            self.batting_squad(),
            self.bowling_squad(),
            &self.players_map(),
            inn.target_runs,
            Some(inn.is_super_over),
        )
    }

    /// Public scorecard view of a completed/current innings (0-indexed).
    pub fn innings_scorecard(&self, idx: usize) -> InningsScorecard {
        self.scorecard_for(idx.min(self.innings.len().saturating_sub(1)))
    }

    fn scorecard_for(&self, idx: usize) -> InningsScorecard {
        let inn = &self.innings[idx];
        let target = if idx > 0 {
            self.innings
                .first()
                .map(|first| first.ball_events.iter().map(|b| b.runs_bat).sum::<i64>() + 1)
        } else {
            None
        };
        replay_innings(
            &inn.ball_events,
            &self.setup.rules(),
            &self.player_ids[inn.batting_team],
            &self.player_ids[1 - inn.batting_team],
            &self.players_map(),
            inn.target_runs.or(target),
            Some(inn.is_super_over),
        )
    }

    /// Call after every recorded ball: advances innings / ends the match.
    pub fn check_completion(&mut self) {
        let idx = self.innings.len() - 1;
        let sc = self.scorecard_for(idx);
        if !sc.is_completed {
            return;
        }
        if self.innings.len() == 1 {
            // innings break: set the chase target; the scorer picks the new
            // bowler (awaiting_bowler starts true)
            let target = sc.total_runs + 1;
            let squad = self.player_ids[1].clone();
            self.innings
                .push(LiveInnings::new(1, &squad, None, Some(target)));
        } else {
            self.finish_match();
        }
    }

    fn finish_match(&mut self) {
        let sc1 = self.scorecard_for(0);
        let sc2 = self.scorecard_for(1);
        let name0 = self.setup.team_a.name.clone();
        let name1 = self.setup.team_b.name.clone();
        let name_of = |t: usize| if t == 0 { &name0 } else { &name1 };
        if sc2.total_runs > sc1.total_runs {
            let ceiling = max_wickets_for(&self.setup.rules(), self.player_ids[1].len());
            let wickets_left = (ceiling - sc2.total_wickets).max(0);
            self.winner = Some(1);
            self.result_text = format!(
                "{} won by {} wicket{}",
                name_of(1),
                wickets_left,
                if wickets_left == 1 { "" } else { "s" }
            );
        } else if sc1.total_runs > sc2.total_runs {
            let margin = sc1.total_runs - sc2.total_runs;
            self.winner = Some(0);
            self.result_text = format!(
                "{} won by {} run{}",
                name_of(0),
                margin,
                if margin == 1 { "" } else { "s" }
            );
        } else {
            self.result_text = "Match tied".to_string();
        }
    }

    /// MVP ranking across both innings (best first): (player id, name, points)
    pub fn mvp_ranking(&self) -> Vec<(String, String, i64)> {
        if self.innings.is_empty() {
            return Vec::new();
        }
        let scs: Vec<InningsScorecard> = (0..self.innings.len().min(2))
            .map(|i| self.scorecard_for(i))
            .collect();
        let mvp = calculate_match_mvp_points(&scs);
        let names = self.players_map();
        let mut rows: Vec<(String, String, i64)> = mvp
            .into_iter()
            .map(|(id, p)| {
                let name = names
                    .get(&id)
                    .map(|pl| pl.name.clone())
                    .unwrap_or_else(|| id.clone());
                (id, name, p.total)
            })
            .collect();
        rows.sort_by(|a, b| b.2.cmp(&a.2).then(a.1.cmp(&b.1)));
        rows
    }

    /// Build the engine Match view for the prediction engine.
    pub fn engine_match_view(&self) -> EngineMatch {
        EngineMatch {
            id: "app".into(),
            team_a_id: "A".into(),
            team_b_id: "B".into(),
            team_a_player_ids: self.player_ids[0].clone(),
            team_b_player_ids: self.player_ids[1].clone(),
            date: String::new(),
            venue: String::new(),
            rules: self.setup.rules(),
            status: gullyscore_engine::stats::MatchStatus::Live,
            current_innings_index: (self.innings.len() - 1) as i64,
            innings: self
                .innings
                .iter()
                .map(|inn| gullyscore_engine::stats::MatchInnings {
                    batting_team_id: if inn.batting_team == 0 { "A" } else { "B" }.into(),
                    bowling_team_id: if inn.batting_team == 0 { "B" } else { "A" }.into(),
                    target_runs: inn.target_runs,
                    is_super_over: Some(inn.is_super_over),
                    ball_events: inn.ball_events.clone(),
                })
                .collect(),
            result_text: None,
            winner_team_id: self.winner.map(|w| {
                if w == 0 {
                    "A".to_string()
                } else {
                    "B".to_string()
                }
            }),
            player_of_the_match_id: None,
            updated_at: 0,
        }
    }
}

// ---------------------------------------------------------------------------
// App screen state
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub enum Screen {
    Setup,
    Live,
    Scorecard,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Overlay {
    None,
    Wicket,
    Bowler,
}

#[derive(Debug, Clone)]
pub struct GullyApp {
    pub screen: Screen,
    pub setup: SetupState,
    pub live: Option<LiveMatch>,
    pub overlay: Overlay,
    pub setup_error_hint: Option<String>,
}

impl Default for GullyApp {
    fn default() -> Self {
        GullyApp {
            screen: Screen::Setup,
            setup: SetupState::default(),
            live: None,
            overlay: Overlay::None,
            setup_error_hint: None,
        }
    }
}

impl GullyApp {
    pub fn start_match(&mut self) -> Result<(), String> {
        self.setup.validate()?;
        self.live = Some(LiveMatch::new(self.setup.clone()));
        self.screen = Screen::Live;
        self.overlay = Overlay::None;
        Ok(())
    }

    pub fn record(
        &mut self,
        runs: i64,
        extra: ExtraType,
        extra_runs: i64,
        wicket: Option<WicketInput>,
    ) {
        if let Some(live) = &mut self.live {
            live.record_ball(runs, extra, extra_runs, wicket);
            if live.winner.is_none() && live.current().awaiting_bowler {
                self.overlay = Overlay::Bowler;
            }
        }
    }

    pub fn undo(&mut self) {
        if let Some(live) = &mut self.live {
            live.undo();
            self.overlay = Overlay::None;
        }
    }
}

// ---------------------------------------------------------------------------
// Tests — the app state is pure and fully headless-testable
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn match_with(overs: i64, last_man: bool) -> LiveMatch {
        let setup = SetupState {
            overs,
            last_man_batting: last_man,
            no_consecutive_overs: false,
            max_overs_per_bowler: 99,
            ..SetupState::default()
        };
        LiveMatch::new(setup)
    }

    fn dot(m: &mut LiveMatch) {
        m.record_ball(0, ExtraType::None, 0, None);
    }

    #[test]
    fn odd_runs_rotate_strike_even_do_not() {
        let mut m = match_with(4, false);
        let (s0, ns0) = (m.current().striker.clone(), m.current().non_striker.clone());
        m.record_ball(1, ExtraType::None, 0, None);
        assert_eq!(
            (
                m.current().striker.as_str(),
                m.current().non_striker.as_str()
            ),
            (ns0.as_str(), s0.as_str())
        );
        let (s1, ns1) = (m.current().striker.clone(), m.current().non_striker.clone());
        m.record_ball(2, ExtraType::None, 0, None);
        assert_eq!(
            (
                m.current().striker.as_str(),
                m.current().non_striker.as_str()
            ),
            (s1.as_str(), ns1.as_str())
        );
    }

    #[test]
    fn over_completes_swaps_and_asks_for_bowler() {
        let mut m = match_with(4, false);
        for _ in 0..6 {
            dot(&mut m);
        }
        let inn = m.current();
        assert!(inn.awaiting_bowler);
        assert_eq!(inn.legal_balls_this_over, 0);
        // ends swapped (6 dots: no strike rotation, only the over swap)
        assert_eq!(inn.striker, "A1");
        assert_eq!(inn.non_striker, "A0");
    }

    #[test]
    fn wicket_brings_next_batter_in_at_the_end() {
        let mut m = match_with(4, false);
        m.record_ball(
            0,
            ExtraType::None,
            0,
            Some(WicketInput {
                wicket_type: WicketType::Bowled,
                dismissed_striker: true,
                fielder_numbers: vec![],
                runs_completed: 0,
            }),
        );
        let inn = m.current();
        assert_eq!(inn.striker, "A2", "next batter takes the striker end");
        assert_eq!(inn.non_striker, "A1");
        let sc = m.current_scorecard();
        assert_eq!(sc.total_wickets, 1);
        assert!(sc.batters.iter().any(|b| b.player_id == "A0" && b.is_out));
    }

    #[test]
    fn retired_hurt_replaces_but_does_not_count_as_out() {
        let mut m = match_with(4, false);
        m.record_ball(
            0,
            ExtraType::None,
            0,
            Some(WicketInput {
                wicket_type: WicketType::RetiredHurt,
                dismissed_striker: true,
                fielder_numbers: vec![],
                runs_completed: 0,
            }),
        );
        let sc = m.current_scorecard();
        assert_eq!(sc.total_wickets, 0);
        assert_eq!(m.current().striker, "A2");
    }

    #[test]
    fn undo_restores_the_exact_previous_state() {
        let mut m = match_with(4, false);
        for i in 0..14 {
            m.record_ball((i % 4) as i64, ExtraType::None, 0, None);
        }
        let before = m.current().clone();
        m.record_ball(1, ExtraType::Wide, 1, None);
        m.undo();
        assert_eq!(m.current(), &before);
    }

    #[test]
    fn innings_advances_with_target_and_chase_result() {
        let mut m = match_with(1, false); // 1-over innings
        for i in 0..6 {
            m.record_ball((i % 2) as i64, ExtraType::None, 0, None); // 3 runs
        }
        assert_eq!(m.innings.len(), 2, "innings break after overs completed");
        assert_eq!(m.current().target_runs, Some(4));
        assert_eq!(m.current().batting_team, 1);
        assert!(m.current().awaiting_bowler, "scorer picks the new bowler");
        m.set_bowler("A0".into());
        // chase it in one ball
        m.record_ball(4, ExtraType::None, 0, None);
        assert_eq!(m.winner, Some(1));
        assert_eq!(m.result_text, "Team B won by 7 wickets");
    }

    #[test]
    fn defended_total_reports_runs_margin() {
        let mut m = match_with(1, false);
        for _ in 0..6 {
            m.record_ball(2, ExtraType::None, 0, None); // 12 runs
        }
        assert_eq!(m.innings.len(), 2);
        m.set_bowler("A0".into());
        for _ in 0..6 {
            m.record_ball(0, ExtraType::None, 0, None); // 0 — 12-run win
        }
        assert!(
            m.result_text.contains("Team A won by 12 runs"),
            "{}",
            m.result_text
        );
    }

    /// The app's transition logic must agree with the engine's fallback
    /// derivation of the crease (deriveLiveCrease) on striker/non-striker.
    #[test]
    fn transition_agrees_with_engine_derivation() {
        let mut rng: u64 = 0x1234_5678;
        let mut next = || {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            rng
        };
        for case in 0..60u32 {
            let mut m = match_with(6, false);
            let n = (next() % 18) as i64;
            for _ in 0..n {
                let runs = (next() % 5) as i64;
                let extra = match next() % 6 {
                    0 => ExtraType::Wide,
                    1 => ExtraType::NoBall,
                    2 => ExtraType::Bye,
                    3 => ExtraType::LegBye,
                    _ => ExtraType::None,
                };
                let extra_runs = (next() % 3) as i64;
                let wicket = if next() % 8 == 0 {
                    Some(WicketInput {
                        wicket_type: if next() % 5 == 0 {
                            WicketType::RetiredHurt
                        } else {
                            WicketType::Bowled
                        },
                        dismissed_striker: next() % 2 == 0,
                        fielder_numbers: vec![],
                        runs_completed: (next() % 3) as i64,
                    })
                } else {
                    None
                };
                m.record_ball(runs, extra, extra_runs, wicket);
                if m.current().awaiting_bowler && m.winner.is_none() {
                    if let Some((id, _)) = m.eligible_bowlers().first().cloned() {
                        m.set_bowler(id);
                    }
                }
                if m.winner.is_some() {
                    break;
                }
            }
            let events = m.current().ball_events.clone();
            if events.is_empty() {
                continue;
            }
            let derived: Option<LiveCreaseState> = derive_live_crease(
                Some(&events),
                &m.setup.rules(),
                m.batting_squad(),
                m.bowling_squad(),
            );
            let inn = m.current();
            let derived = derived.expect("non-empty log derives a state");
            // The engine derivation cannot see the incoming batter after the
            // LAST ball of a log ending on a dismissal (pendingBatter) — and
            // a retiring batter IS replaced by the app (they may return
            // later), which the derivation also cannot know. Skip both.
            let last_is_replacement = inn
                .ball_events
                .last()
                .and_then(|b| b.wicket.as_ref())
                .is_some();
            if !derived.pending_batter && !last_is_replacement {
                assert_eq!(
                    (inn.striker.as_str(), inn.non_striker.as_str()),
                    (derived.striker_id.as_str(), derived.non_striker_id.as_str()),
                    "case {case}: {} events",
                    events.len()
                );
            }
        }
    }
}
