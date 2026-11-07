/**
 * Secure random hex (1.4.7-test-3).
 *
 * Keys must come from a CSPRNG — never `Math.random` (predictable, and the
 * old clock+random seed could be brute-forced offline from the synced hash).
 * `expo-crypto` is Expo's first-party module for this (the only new
 * dependency in test-3, added for exactly this reason).
 *
 * Resolution order, both cryptographic:
 *  1. WebCrypto `globalThis.crypto.getRandomValues` — web build + any
 *     runtime that exposes it (skips the native bridge entirely).
 *  2. `expo-crypto.getRandomValues` — Android/iOS native CSPRNG.
 *
 * NOTE: expo-crypto's `getRandomBytes` is deliberately NOT used — it falls
 * back to `Math.random` under remote JS debugging, which we refuse for keys.
 * If neither source is available this THROWS: key generation must fail loud,
 * never silently downgrade to weak randomness. (The install-id fallback in
 * access.ts is a display tag, not a secret — that's the only allowed
 * fallback.)
 */

import * as Crypto from "expo-crypto";

/** CSPRNG bytes as lowercase hex (2·byteLength characters). Throws if no
 *  secure source exists — callers decide whether that is fatal. */
export function secureRandomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  const g = globalThis as {
    crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
  };
  if (typeof g.crypto?.getRandomValues === "function") {
    g.crypto.getRandomValues(bytes); // web / WebCrypto-capable runtimes
  } else {
    Crypto.getRandomValues(bytes); // native CSPRNG (expo-crypto)
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
