#![forbid(unsafe_code)]
//! Full Rust port of GullyScore's pure engines, proved against the original
//! TypeScript by recorded cases (the rust-anything Record → Port → Check loop).
//!
//! - `scoring`  — 100% of `GullyScoreRN/src/engine/scoringEngine.ts` (11 exports)
//! - `stats`    — `playerStatsEngine.ts` `calculatePlayerDetailedStats`
//!   (the override path: pure, no storage)
//! - `prediction` — `predictionEngine.ts` (5 deterministic exports + the
//!   Monte Carlo simulator, which is random by design and ports with a
//!   seeded PRNG — see its module docs)
//!
//! Fidelity rules used throughout (learned from upstream rust-anything):
//! - JS `||` fallbacks treat `""`/`0`/`undefined` as missing; ports reproduce
//!   that with explicit emptiness checks, not `Option::unwrap_or` alone.
//! - `Number(x.toFixed(d))` ports as [`js_to_fixed_num`] (JS toFixed rounds
//!   ties away from zero at the decimal level; plain Rust formatting does not).
//! - JSON objects compare order-insensitively via [`js_values_agree`] (JS has
//!   one number type; JSON `0` and `0.0` are the same value to a JS caller).

pub mod prediction;
pub mod scoring;
pub mod stats;

pub use prediction::*;
pub use scoring::*;
pub use stats::*;

use serde_json::Value;

// --------------------------------------------------------------------------
// JS number semantics
// --------------------------------------------------------------------------

/// JS `Number(x.toFixed(d))` — exact.
///
/// JS `toFixed` rounds the EXACT decimal value of the double, ties going to
/// the larger `n` (away from zero for positives). Multiplying by `10^d` in
/// f64 is NOT enough: `(2.675 * 100)` itself rounds up to exactly `267.5`,
/// and a subsequent `.round()` yields 268 where JS prints `"2.67"`. So this
/// decomposes `x = m · 2^e` (exact for every finite f64) and rounds
/// `m · 5^d · 2^(e+d)` on integers — exact for every input.
pub fn js_to_fixed_num(x: f64, d: u32) -> f64 {
    let (neg, n) = to_fixed_integer(x, d);
    let val = n as f64 / 10f64.powi(d as i32);
    if neg {
        -val
    } else {
        val
    }
}

/// JS `${x.toFixed(d)}` — same exact rounding, printed with exactly `d`
/// decimals straight from the rounded integer (no float formatting at all).
pub fn js_to_fixed_str(x: f64, d: u32) -> String {
    let (neg, n) = to_fixed_integer(x, d);
    let sign = if neg { "-" } else { "" };
    if d == 0 {
        return format!("{sign}{n}");
    }
    let p = 10u128.pow(d);
    let int = n / p;
    let frac = n % p;
    format!("{sign}{int}.{frac:0width$}", width = d as usize)
}

/// Exact `round_half_up_in_magnitude(x * 10^d)` as (was_negative, integer).
/// JS toFixed picks the LARGER n on ties: away from zero for positive x,
/// toward zero for negative x (i.e. half-up on the magnitude only when the
/// magnitude is the positive side). The engines only ever fix non-negative
/// values; negatives are handled per spec anyway.
fn to_fixed_integer(x: f64, d: u32) -> (bool, u128) {
    if !x.is_finite() {
        return (false, 0); // never reached in the engine domain
    }
    let neg = x.is_sign_negative();
    let ax = x.abs();
    let bits = ax.to_bits();
    let biased = ((bits >> 52) & 0x7ff) as i32;
    let m = if biased == 0 {
        bits & 0x000f_ffff_ffff_ffff // subnormal (includes 0)
    } else {
        (bits & 0x000f_ffff_ffff_ffff) | 0x0010_0000_0000_0000
    };
    let e = if biased == 0 { -1074 } else { biased - 1075 };
    // ax = m * 2^e exactly;  ax * 10^d = m * 5^d * 2^(e+d)
    let mut n: u128 = m as u128;
    for _ in 0..d {
        n = n.saturating_mul(5); // m ≤ 2^53, d ≤ 3 → n < 2^60
    }
    let shift = e + d as i32;
    let rounded: u128 = if shift >= 0 {
        // exact integer shift (values in the engine domain keep this small)
        if shift >= 127 {
            u128::MAX
        } else {
            n << shift
        }
    } else {
        // n / 2^k with k > 0: round half away from zero on the magnitude
        let k = -(shift) as u32;
        if k >= 128 {
            0
        } else {
            let half = 1u128 << (k - 1);
            if neg {
                // ties toward +inf on the value == ties toward zero on magnitude
                (n + half - 1) >> k
            } else {
                (n + half) >> k
            }
        }
    };
    (neg, rounded)
}

// --------------------------------------------------------------------------
// JS-faithful value comparison (used by the DIFF step in main.rs)
// --------------------------------------------------------------------------

/// Compare two JSON values the way a JS caller would: JSON has integers and
/// floats, JS has only f64 (`0 === 0.0` and both stringify to "0"), so a raw
/// serde_json equality would flag `0` vs `0.0` as a mismatch. Numbers compare
/// numerically, objects key-wise (order-free), arrays element-wise.
pub fn js_values_agree(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            if let (Some(xi), Some(yi)) = (x.as_i64(), y.as_i64()) {
                xi == yi
            } else {
                match (x.as_f64(), y.as_f64()) {
                    (Some(xf), Some(yf)) => xf == yf,
                    _ => x == y, // u64/i64 beyond f64 precision: compare exactly
                }
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(xa, ya)| js_values_agree(xa, ya))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter().all(|(k, xv)| match y.get(k) {
                    Some(yv) => js_values_agree(xv, yv),
                    None => false,
                })
        }
        _ => a == b,
    }
}

// --------------------------------------------------------------------------
// Seeded RNG for the Monte Carlo simulator
// --------------------------------------------------------------------------

/// xorshift64* PRNG. JS `Math.random()` cannot be seeded, so the simulator
/// port reproduces the ALGORITHM and distribution with a deterministic RNG —
/// record/replay can only prove its deterministic branch (see prediction.rs).
pub struct SeededRng(u64);

impl SeededRng {
    pub fn new(seed: u64) -> Self {
        // avoid the all-zero fixed point
        SeededRng(if seed == 0 { 0x9E3779B97F4A7C15 } else { seed })
    }

    /// Uniform f64 in [0, 1) with 53 bits of entropy, like Math.random().
    pub fn next_f64(&mut self) -> f64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        let r = x.wrapping_mul(0x2545F4914F6CDD1D);
        (r >> 11) as f64 / (1u64 << 53) as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_fixed_rounds_ties_away_from_zero_like_js() {
        // (43.25).toFixed(1) === "43.3" in JS; Rust's {:.1} gives "43.2".
        assert_eq!(js_to_fixed_str(43.25, 1), "43.3");
        assert_eq!(js_to_fixed_str(81.25, 1), "81.3");
        assert_eq!(js_to_fixed_str(12.0, 1), "12.0"); // trailing zero kept
        assert_eq!(js_to_fixed_num(43.25, 1), 43.3);
    }

    #[test]
    fn to_fixed_uses_the_double_not_the_decimal_literal() {
        // 2.675 the DOUBLE is 2.67499999999999982…, so JS says "2.67" —
        // even though 2.675 * 100 in f64 rounds up to exactly 267.5.
        assert_eq!((2.675_f64 * 100.0), 267.5); // the trap the exact algorithm avoids
        assert_eq!(js_to_fixed_str(2.675, 2), "2.67");
        assert_eq!(js_to_fixed_num(2.675, 2), 2.67);
        assert_eq!(js_to_fixed_str(2.6875, 3), "2.688"); // true exact tie → away from zero
        assert_eq!(js_to_fixed_str(0.0, 1), "0.0");
        assert_eq!(js_to_fixed_str(56.0, 0), "56");
    }

    #[test]
    fn json_int_and_float_are_the_same_number_to_js() {
        let zero_int: Value = serde_json::from_str("0").unwrap();
        let zero_float: Value = serde_json::to_value(0.0_f64).unwrap();
        assert_ne!(zero_int, zero_float); // raw serde_json equality: different
        assert!(js_values_agree(&zero_int, &zero_float)); // JS: 0 === 0.0
        let frac: Value = serde_json::from_str("0.16666666666666666").unwrap();
        let port_val = serde_json::to_value(scoring::balls_to_overs_fraction(1)).unwrap();
        assert!(js_values_agree(&frac, &port_val));
    }

    #[test]
    fn seeded_rng_is_deterministic_and_in_range() {
        let mut a = SeededRng::new(42);
        let mut b = SeededRng::new(42);
        for _ in 0..100 {
            let (x, y) = (a.next_f64(), b.next_f64());
            assert_eq!(x, y);
            assert!((0.0..1.0).contains(&x));
        }
    }
}
