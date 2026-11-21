# rust-anything-lab

A self-contained lab for [erkamyaman/rust-anything](https://github.com/erkamyaman/rust-anything)
— the toolkit for rewriting an existing app in Rust **one unit at a time,
proved against the original's recorded behavior**. Everything lives in this
one folder; the GullyScore RN app is only ever **read**, never written.

## What is in here

**The whole GullyScore engine, ported to Rust and PROVED.** The lab runs the
rust-anything Record → Port → Check loop against the real TypeScript engines:

- **1124 recorded cases** (`cases.jsonl`) — curated edge cases + deterministic
  seeded fuzz (short-squad all-out, last-man, extras quirks, chase branches,
  MVP bonus tiers, NRR scenarios, stable-sort ties, non-ASCII names, …).
- **diff: 1124/1124 cases match — PASS** — every ported function behaves
  identically to the TypeScript original on every recorded input
  (`./check.sh` re-proves it end to end: record → fmt → clippy `-D warnings`
  → tests → diff with the stale-recording fingerprint guard).
- Ported units (see `rust/PORT_MAP.md` for the full map + honest deviations):
  - `scoringEngine.ts` — 11/11 exports
  - `playerStatsEngine.ts` — `calculatePlayerDetailedStats` (pure override path)
  - `predictionEngine.ts` — 6/6 exports (the Monte Carlo simulator is random
    by design; only its deterministic branch is record-provable, the rest
    ports the algorithm with a seeded PRNG — documented deviation)

**A GullyScore Android app in pure Rust** (`rust/app/`): egui/eframe on
NativeActivity (no Java/Kotlin code at all), built on the proved engine:

- Match setup: teams, editable player lists, rules (overs, ball type, wide /
  no-ball values, free hit, last man, max overs per bowler, no consecutive overs)
- Live scoring: crease state with automatic strike rotation, over-end swaps
  with bowler picker (constrained by the rules), wickets (all 14 types,
  fielders, runs completed, retired hurt), extras (wide / no-ball / bye /
  leg-bye), free-hit indicator, undo (event-sourced), ball commentary,
  live win probability + projected score
- Full scorecards per innings (batting, bowling, FOW, extras), match result
  text, MVP top-5, innings break with chase target

Not in this round (the RN app keeps them): player career profiles,
tournaments/points-table UI, wagon wheel, PDF export, sync. The ENGINE for
all of those is ported — the UI is what remains.

## Layout

```
rust-anything-lab/
├── check.sh               the whole gate: record → fmt → clippy → test → diff
├── env.sh                 toolchain env (Rust + Android SDK live inside the lab)
├── cases.jsonl            1124 recorded cases — the proof artifact (committed)
├── recorded-from.json     sha256 fingerprint of the 4 ported app files
├── record/record.mjs      RECORD: runs the real TS engines (bun), deterministic
├── rust/
│   ├── engine/            gullyscore_engine — the proved port + the diff bin
│   │   └── src/{scoring,stats,prediction}.rs
│   ├── app/               gullyscore_app — the egui Android app (cdylib + bin)
│   │   └── src/{state,ui}.rs  (state machine is pure + unit-tested headless)
│   └── PORT_MAP.md        unit status: everything ported + honest deviations
├── android/               AndroidManifest.xml (NativeActivity, hasCode=false)
├── scripts/
│   ├── setup-android-sdk.sh  fetch SDK + NDK inside the lab (gitignored)
│   └── build-apk.sh          cargo release (aarch64) → aapt2 → sign → verify
├── work/                  verified working copy of GullyScoreRN (gitignored;
│                          recorder asserts byte-identical engine files, then
│                          stubs ONLY the never-called storage import)
├── GullyScore-rust-0.2.0.apk   the signed, installable APK (committed)
├── upstream/              (optional) reference copy of rust-anything — untrusted
├── toolchain/             local rustup + Android SDK + NDK (gitignored)
└── LEARNING.md            what the upstream repo teaches, applied here
```

## Run it

```sh
cd rust-anything-lab
./check.sh                        # the whole proof, end to end
./scripts/build-apk.sh            # rebuild the APK (needs scripts/setup-android-sdk.sh once)
adb install GullyScore-rust-0.2.0.apk   # dev.omkardile.gullyscore.rust — installs
                                        # alongside the RN app (dev.omkardile.gullyscore)
```

Nothing global was installed: the Rust toolchain, the Android SDK and the NDK
all live inside this folder (gitignored), and the RN project is only read.

## Safety notes

- `GullyScoreRN/` is read, hashed and (by the recorder) copied — never
  modified. If someone edits the app's engines later, `diff` exits
  **2 — STALE RECORDING** and tells them to re-record.
- `upstream/` (if present) is downloaded data treated as read-only reference.
- The work copy's only patch is the stubbed `db` import in
  `playerStatsEngine.ts` — a module that is never called on the recorded
  (override) path; the recorder proves the file was byte-identical before
  stubbing.
