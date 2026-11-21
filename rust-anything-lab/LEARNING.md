# LEARNING.md — what rust-anything teaches, and how this lab applies it

Study notes from [erkamyaman/rust-anything](https://github.com/erkamyaman/rust-anything)
(upstream 6.2k★, MIT, made by Erkam Yaman, sponsored by CodeRabbit). Sources
read for this lab: `upstream/README.md`, `upstream/docs/how-it-works.md`,
`upstream/DECISIONS.md`, plus the `src/` and `docs/` file layout.

---

## 1. The core idea

> "It doesn't translate code; it proves the rewrite."

Rust-anything is not a transpiler. You (or your AI agent) write the Rust; the
tool supplies what an agent cannot reliably guess: **profiling** to find what
is worth porting, a **bridge** so callers keep the original API, and a
**recorded-behavior harness** that proves each ported unit behaves identically
to the original — including thrown errors and side effects.

The workflow: **Record** (original runs on generated edge cases + user inputs;
outputs and throws are captured) → **Port** (Rust crate + wrapper preserving
the calling interface) → **Check** (`diff` replays every case; nothing
advances until all match) → **Lift** (replay 100% in Rust, zero fallback →
pure Rust binary).

Real results quoted upstream: a Rust Prettier port 19x faster with
byte-identical output on 2,360 files; json-server as a 3.5 MB Rust binary vs
a 74 MB Node process; Fuse.js search 32x faster per query.

## 2. The loop (upstream docs/how-it-works.md)

```
profile ──> analyze ──> bridge ──> record ──> port.rs ──> diff ──> bench ──> shadow ──> gate
where the    what to     the Rust   what the    you or      every     faster?    both side   done means
time goes    port first  crate and  original    your agent  recorded  the        by side in  this passes
             (analyze)   wrapper    does        writes it   case      verdict    production
```

- **profile** — run a REAL workload under the language's own profiler; which
  code to port is a property of how it is called, not of the code.
- **analyze** — units, port order, risks with `file:line`, bridge per unit.
- **bridge** — generates the crate + the wrapper the source language loads.
- **record** — generated edge cases + semantic traps per parameter +
  `--from-tests` (every call the original's own test suite makes) → `cases.jsonl`.
- **diff** — replay, called the way the original's callers call it.
- **shadow** — run both in production; return the original's result; report mismatches.
- **gate** — fmt, clippy `-D warnings`, tests, `unsafe` audit, error-path
  cases, no `unwrap`/`panic!` where the original returns errors.
- Whole apps: the same loop unit by unit inside a frame (`front door`, `wire`,
  `lift`), with fallback shrinking as units pass.

## 3. The ideas worth stealing (with where they live upstream)

1. **The original is the source of truth.** Never reason about what the code
   "should" do — run it and record what it DOES. (README, how-it-works)
2. **Fingerprint what you recorded from.** `record` saves a fingerprint of the
   unit's files (`recorded-from.json`); when the original changes later,
   `diff` warns and `gate` fails — an upstream change cannot pass silently.
3. **Deterministic recording.** Inputs are generated from a seed (L5), so a
   recording can be replayed, diffed and regenerated exactly.
4. **Errors are behavior.** Both sides throwing counts as agreement (L7);
   error text is not compared (rarely a contract). Error paths need a recorded
   failing case each (gate).
5. **Fidelity markers for what JSON cannot say.** `undefined`, `NaN`,
   `Infinity`, `-0`, lone surrogates cross as `{"$undefined":true}`,
   `{"$num":"NaN"}`, `{"$utf16":[…]}` (X2) — each marker came from a REAL
   mismatch they hit while porting x18n.
6. **Floats.** `serde_json` with `float_roundtrip` everywhere — the default
   parser can be one ULP off (M9, found via Java's `Double.toString` in 43
   cases). Formatting must match exactly; tolerance forgives rounding only.
7. **Compare what a JS caller sees.** Recording/diffing run in the source
   language's runtime with a lossless codec (L6) — wrapper bugs, type
   conversions and exception mapping are inside the comparison.
8. **Keep the original's shape.** One crate per unit, same exported names,
   same arguments and errors; change the design AFTER the port matches.
   A `PORT_MAP` tracks every unit: ported / kept / stale.
9. **Batches beat per-call bridges.** A port called once per item pays the
   bridge per item and loses to a JIT; `--batch fn:param` moves the loop into
   Rust and runs it on all cores (x18n search: 18–22x).
10. **Know what passing means.** "Passing means the Rust matches every case
    that was recorded, nothing more" — inputs nobody recorded, an original
    that moved on, regex dialects, and anything not in the output are the
    honest edges.

## 4. How this lab applied those lessons

| Upstream concept | This lab (`rust-anything-lab/`) |
| --- | --- |
| `record` on the original | `record/record.mjs` — bun imports the REAL TS engines (read-only), **1124 cases**: curated edges per function + seeded-fuzz innings/matches/tournaments (`mulberry32(0xc0ffee)`, L5); the stats engine records from a verified byte-identical work copy (only the never-called storage import stubbed) |
| `cases.jsonl` | `cases.jsonl` — `{id, fn, args, expected}` per line, 18 functions |
| `recorded-from.json` fingerprint | same file, sha256 of the 4 ported source files; the diff bin exits **2 STALE** if any changes (observed working when the paths were wrong) |
| `$`-fidelity markers (X2) | `$threw` marker for exceptions; TS's `!ballEvents` null-guard ports as `Option<&[BallEvent]>` |
| float_roundtrip (M9) | `serde_json = { features = ["float_roundtrip", "preserve_order"] }` in `rust/Cargo.toml` |
| JS-faithful comparison (L6) | `js_values_agree` in `lib.rs`: JSON has int/float, JS has only f64 — `0` vs `0.0` is a false mismatch without it (unit-tested) |
| port.rs plain, no unsafe (L1) | `rust/engine/src/` with `#![forbid(unsafe_code)]` |
| `diff` via the caller's interface (M3) | `rust/engine/src/main.rs` deserializes typed args and calls the port's public API (+ a `--case <id>` path-level debug mode) |
| `gate` | `./check.sh`: record → `cargo fmt --check` → `clippy -D warnings` → `cargo test` (12) → diff (**1124/1124**) |
| `map` / PORT_MAP | `rust/PORT_MAP.md` — all 18 exports of the 3 engine files ported, with case counts + honest deviations |
| profile / bench / shadow / lift | out of scope — documented as next steps in `README.md` |

Two porting lessons round 1 hit in practice (both predicted by upstream):

- **JS number semantics**: `Number("2.1")` builds decimal overs through TEXT
  (2.1), not division (13/6 = 2.166…). The port formats the string and parses
  it back — the unit test asserts `parse_overs_to_decimal(13) != 13.0/6.0`.
- **JS division/modulo mix**: `Math.floor(n/6)` floors but `%` truncates; in
  Rust that is `div_euclid` + `%`, not one function.

## 4b. Round 2/3 lessons — porting the WHOLE engine (1124 cases)

Extending the loop from the crease unit to all 18 exports of the three
engine files surfaced four more real traps, each caught by `diff` or by the
port's own unit tests — every one a JS-fidelity issue, exactly the class of
bug the record/replay harness exists to catch:

1. **`rename` vs `rename_all`** on a serde enum renames the TYPE, not the
   variants — `#[serde(rename = "lowercase")]` silently accepts nothing.
   Symptom: every case whose args contain a `Player` failed deserialization.
2. **`JSON.stringify` drops undefined keys** — the original omits `wicket`
   from non-wicket balls, so the port must `skip_serializing_if` on
   `Option::None`; serializing `null` is a mismatch even though the values
   are "the same".
3. **JSON object key order is caller-visible** — `teamsMap` iteration order
   (JS insertion order) survived neither BTreeMap (alphabetical) nor default
   serde_json (BTreeMap-backed `Value`). Fix: the `preserve_order` feature +
   `IndexMap`. Upstream's "keep the original's shape" made real here.
4. **`toFixed` must be computed from the EXACT double** —
   `(x * 10^d).round()` is wrong at boundaries the multiply itself creates:
   `2.675 * 100` rounds UP to exactly `267.5` in f64, so the shortcut yields
   2.68 where JS says `2.67`. The port decomposes `x = m·2^e` and rounds on
   integers (exact for every input). The lab's own unit test caught this
   before a recorded case did.

Plus two structural learnings:

- **Record from a project copy** (upstream's own safety rule): the stats
  engine imports the app's storage layer for its default arguments. The
  recorder refreshes a work copy, ASSERTS the engine files are byte-identical
  to the originals, then stubs only that never-called import — the recorded
  behavior is the original's, provably.
- **Random functions define their own honesty**: `Math.random()` cannot be
  seeded, so the Monte Carlo simulator's random branch is outside the
  recorded contract by nature. Only its deterministic branch is
  record-provable; the rest ports the algorithm with a seeded PRNG, and
  PORT_MAP says so instead of pretending.

## 5. What this lab is NOT

- The RN app still owns the UI that ships today: this lab's APK is a pure
  Rust round-1 app (match setup → live scoring → scorecards → result/MVP).
  Player career profiles, tournament screens, wagon wheel, PDF export and
  sync are NOT in the APK yet — their ENGINES are ported and proved, the
  UI is what remains.
- It does not use the upstream `rust-anything` binary to drive the port;
  the loop is re-implemented from scratch to learn the mechanics (the CLI
  is installed in the lab toolchain for future `analyze`/`bridge` rounds).
- It does not touch the app: no file in `GullyScoreRN/` changed
  (`git status` clean outside this folder; the app's own
  `scripts/test_shortside_engine.ts` still passes 8/8).
- 1124 passing cases prove the ports on THOSE inputs, nothing more — the
  upstream honesty rule applies to this lab too.

## 6. Next steps with the real tool

1. Run the installed `rust-anything analyze` on the repo for the tool's own
   unit plan (bridge choices, risks with file:line, port order).
2. Let its `bridge`/`record`/`diff`/`gate` drive the remaining surface
   (storage layer, the RN app's hooks) — the hand-rolled loop here is the
   seed and the proof pattern, not the destination.
3. Grow the APK app toward feature parity: career profiles
   (`calculate_player_detailed_stats` is proved), tournament screens
   (`calculate_tournament_points_table` + `simulate_tournament_outcomes`),
   pre-match predictions (`calculate_pre_match_prediction`).
