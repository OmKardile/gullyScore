# PORT MAP — full engine port status

Mirrors upstream `rust-anything map --write`: every export of the original
units, its Rust port, and its recorded-case proof. The original TypeScript
keeps running unchanged in `GullyScoreRN/`; a port only replaces a unit after
`diff` passes on its recorded cases — which it does for all of them
(**1124/1124 cases match — PASS**, see `cases.jsonl` / `recorded-from.json`).

Fingerprints (stale-recording guard, 4 files): `scoringEngine.ts`,
`playerStatsEngine.ts`, `predictionEngine.ts`, `types/cricket.ts` — if any
changes upstream, `diff` exits 2 until re-recorded.

## scoringEngine.ts — 11/11 exports ported (`engine/src/scoring.rs`)

| TS export | Rust port | Cases |
| --- | --- | --- |
| `formatOvers` | `format_overs` | 24 |
| `parseOversToDecimal` | `parse_overs_to_decimal` | 24 |
| `ballsToOversFraction` | `balls_to_overs_fraction` | 24 |
| `isDismissalCreditedToBowler` | `is_dismissal_credited_to_bowler` | 14 (whole enum) |
| `deriveLiveCrease` | `derive_live_crease` | 273 |
| `getDismissalText` | `get_dismissal_text` | 98 (every type × fielder/name/bowler variants) |
| `replayInnings` | `replay_innings` | 276 (incl. short-squad all-out, last-man, target quirks, extras quirks, 250 fuzz) |
| `calculateMatchMVPPoints` | `calculate_match_mvp_points` | 49 (every bonus tier + replayed pairs) |
| `calculateTournamentPointsTable` | `calculate_tournament_points_table` | 49 (ties, no-results, all-out NRR quota, missing squads) |
| `generateRoundRobinFixtures` | `generate_round_robin_fixtures` | 7 (0–7 teams, odd/even) |
| `generateBallCommentary` | `generate_ball_commentary` | 59 (every wicket type, extra, runs 0–7, directions) |

## playerStatsEngine.ts — 1/1 export ported (`engine/src/stats.rs`)

| TS export | Rust port | Cases |
| --- | --- | --- |
| `calculatePlayerDetailedStats` | `calculate_player_detailed_stats` | 39 (empty/unknown, events-only, stable-sort ties, POTM, super overs, 1–6 match fuzz) |

The TS module imports the app's storage for its DEFAULT arguments; the port
IS the override path (pure). The recorder records from `work/GullyScoreRN`
— a fresh copy each run whose only difference is the stubbed, never-called
db import (the recorder asserts the 4 engine files are byte-identical first).

## predictionEngine.ts — 6/6 exports ported (`engine/src/prediction.rs`)

| TS export | Rust port | Cases |
| --- | --- | --- |
| `calculateLiveWinProbability` | `calculate_live_win_probability` | 91 (1st-innings stages, chase branches: reached/all-out/tie/need-N-off-M) |
| `calculateProjectedScore` | `calculate_projected_score` | 41 (ball-type grid, death overs) |
| `calculateBatterProjection` | `calculate_batter_projection` | 15 (milestone ladder) |
| `calculatePreMatchPrediction` | `calculate_pre_match_prediction` | 21 (h2h, venue toss bias) |
| `simulateTournamentOutcomes` | `simulate_tournament_outcomes` | 5 — **deterministic branch only** (see deviations) |
| `calculateNrrScenario` | `calculate_nrr_scenario` | 15 (missing rows, negative NRR) |

## Honest deviations (documented, not hidden)

- **Monte Carlo randomness**: `Math.random()` cannot be seeded, so
  record/replay can only prove the simulator's deterministic branch
  (no pending fixtures). The random branch ports the algorithm exactly but
  draws from a seeded xorshift PRNG (`lib.rs::SeededRng`, fixed seed) so
  results are reproducible where the TS results are not.
- **Locale-dependent fallback**: the stats engine's
  `m.date || new Date(updatedAt).toLocaleDateString()` cannot be reproduced
  faithfully; the recorder always supplies a non-empty `date`, so that
  fallback stays outside the recorded contract. The constant fallbacks
  ("Local Ground", "Opponent", …) ARE ported.
- **BallEvent projection**: recorded events carry the 8 fields the engines
  read; the Rust struct models exactly those (serde ignores the rest, like
  the TS side ignores fields it never touches).

## Fidelity notes

- **`MatchRules`** is mirrored in full (all 10 fields) — same shape callers pass.
- **`null` ball logs**: the TS `!ballEvents` guard ports as
  `Option<&[BallEvent]>` (None = null/undefined) — a fidelity marker in the
  spirit of upstream X2.
- **Numbers**: counts are `i64`; decimal overs go through shortest decimal
  TEXT like `Number("2.1")`; `Number(x.toFixed(d))` is computed EXACTLY from
  the double's `m·2^e` decomposition (`js_to_fixed_num`) — JS toFixed rounds
  the exact decimal value with ties away from zero, and the naive
  `(x*10^d).round()` shortcut is wrong at boundaries the multiply itself
  creates (`2.675 → "2.67"` in JS, `2.68` with the shortcut).
- **Object key order**: `serde_json` runs with `preserve_order` so typed maps
  (teamsMap, playersMap) deserialize in the order JS callers see.
- **Insertion order**: bowlers/stats output orders are insertion-ordered
  (IndexMap), matching JS object semantics; stable sorts match JS sort.
- **`wicket?: null` vs absent**: `JSON.stringify` drops undefined keys —
  the port skips `None` rather than emitting `null`.
