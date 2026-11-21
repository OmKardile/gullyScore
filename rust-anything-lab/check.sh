#!/usr/bin/env bash
# rust-anything-lab — the whole loop in one command (mini `rust-anything gate`).
#
#   record -> fmt -> clippy -> test -> diff
#
# Everything is self-contained in this folder; GullyScoreRN is only ever READ.
set -euo pipefail
cd "$(dirname "$0")"
. ./env.sh

echo "== record: run the original TS engines on curated + fuzz cases =="
bun record/record.mjs

echo
echo "== fmt: cargo fmt --check =="
cargo fmt --manifest-path rust/Cargo.toml --all -- --check

echo
echo "== clippy: cargo clippy --all-targets -- -D warnings =="
cargo clippy --manifest-path rust/Cargo.toml --all-targets -- -D warnings

echo
echo "== test: cargo test (engine + app) =="
cargo test --manifest-path rust/Cargo.toml --quiet

echo
echo "== diff: replay every recorded case against the Rust port =="
(cd rust && cargo run --quiet -p gullyscore_engine -- ../cases.jsonl)

echo
echo "GATE PASS — recorded behavior proven identical, port clean"
