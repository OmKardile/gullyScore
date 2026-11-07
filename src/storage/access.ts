/**
 * GullyScore Audience / Umpire access layer (1.4.7).
 *
 * ONE gate — `assertCanEdit()` — guards every match-data mutation in the app
 * (db.ts calls it from every user-facing mutator). Everything key-related
 * lives behind this module so the check can later be hardened server-side
 * (e.g. an RPC that verifies the key hash) without touching any UI code.
 *
 * Honest scope (documented in Help + README + docs/SECURITY.md): this is a
 * deliberate speed bump against accidental or casual edits inside a shared
 * Sync Space — the salted key hash syncs through the same space (audience
 * devices receive it too, by design: they must be able to validate a key on
 * entry), so a technical user with the space code could attempt an offline
 * attack against it. The 16-hex CSPRNG key + per-space salt + 10k rounds
 * make that expensive, but this is NOT cryptographic protection. Solo
 * devices (no Sync Space) are never gated — it's their own data.
 *
 * State kept here (all AsyncStorage-persisted):
 *  - install identity (random id → short tag like "#A3F9", NOT MAC/IP)
 *  - umpire session (name, validated key hash, optional 12h persistence)
 *  - wrong-key attempts + escalating lockout (5 wrong → 30s → doubles)
 * Inputs pushed in from db/sync (no imports of them here — no cycles):
 *  - setSpaceConfigured() / setSpaceKeyHash()
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { sha256Hex } from "../util/sha256";
import { secureRandomHex } from "../util/random";
import { InstallIdentity, SpaceKeyAlgo } from "../types/access";

const KEY_SESSION = "gullyscore_umpire_session_v1";
const KEY_LOCKOUT = "gullyscore_umpire_lockout_v1";
const KEY_INSTALL = "gullyscore_install_v1";
const KEY_STAY_PREF = "gullyscore_umpire_stay12h_v1";
const KEY_LAST_NAME = "gullyscore_last_umpire_name_v1";

/** 12 hours in ms — "stay in umpire mode" persistence window. */
export const STAY_MS = 12 * 60 * 60 * 1000;
/** Soft cap for the local activity log (spec: "roughly the latest 5,000"). */
export const ACTIVITY_LOG_CAP = 5000;

export type AccessMode = "solo" | "audience" | "umpire";

export interface UmpireSession {
  name: string;
  tag: string;
  model: string;
  startedAt: number;
  /** null = until the app restarts; epoch ms = persisted (12h toggle) */
  expiresAt: number | null;
  /** the key hash this session was granted against — rotation invalidates it */
  keyHash: string;
}

export interface AccessState {
  mode: AccessMode;
  session: UmpireSession | null;
  spaceConfigured: boolean;
  spaceHasKey: boolean;
  wrongAttempts: number;
  /** epoch ms the key input is locked until (0 = open) */
  lockedUntil: number;
  /** user pref: keep the umpire session for 12h across restarts */
  stayFor12h: boolean;
  /** identity summary like "Rahul · Redmi Note 11 · #A3F9" (once loaded) */
  identity: { tag: string; model: string } | null;
}

export class AudienceModeError extends Error {
  constructor(public action: string) {
    super(
      `Audience mode — "${action}" needs the umpire key. Enter it from Settings to edit.`,
    );
    this.name = "AudienceModeError";
  }
}

export class MatchLockedError extends Error {
  constructor() {
    super("This match is completed and read-only. Reopen it (with a reason) to edit.");
    this.name = "MatchLockedError";
  }
}

// ─── Module state ───────────────────────────────────────────────────────────

let session: UmpireSession | null = null;
let spaceConfigured = false;
let spaceKeyHash: string | null = null;
let wrongAttempts = 0;
let lockedUntil = 0;
let stayFor12h = false;
let lastName = ""; // last name typed on THIS device (prefill only — see below)
let identity: { id: string; tag: string; model: string } | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeAccess(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persistSession() {
  if (session && session.expiresAt !== null) {
    AsyncStorage.setItem(KEY_SESSION, JSON.stringify(session)).catch(() => {});
  } else {
    // A "until restart" session is never persisted — a cold start lands back
    // in Audience mode exactly like the spec asks (default off).
    AsyncStorage.removeItem(KEY_SESSION).catch(() => {});
  }
}

function persistLockout() {
  AsyncStorage.setItem(
    KEY_LOCKOUT,
    JSON.stringify({ wrongAttempts, lockedUntil }),
  ).catch(() => {});
}

/** Lazy expiry — checked on every read so a persisted session can never
 *  outlive its 12h window even if the app sat open the whole time. */
function expireIfNeeded() {
  if (session && session.expiresAt !== null && Date.now() > session.expiresAt) {
    session = null;
    persistSession();
    // The umpires-list end stamp + log entry are appended by db (bookkeeping
    // API below) — access only owns the session flag itself.
    notify();
    return true;
  }
  return false;
}

// ─── Identity (random install id — MAC/IP are blocked/unstable on Android) ──

function deviceModelLabel(): string {
  try {
    if (Platform.OS === "web") return "Web browser";
    const c = Platform as unknown as {
      constants?: { Model?: string; Manufacturer?: string };
    };
    const model = c?.constants?.Model;
    return model && model.trim() ? model.trim() : "Android device";
  } catch {
    return "Android device";
  }
}

function tagFromId(id: string): string {
  return `#${id.slice(-4).toUpperCase()}`;
}

/** CSPRNG install id; falls back to a clock+random hash ONLY if no secure
 *  source exists — it labels a device, it guards nothing (display tag). */
function freshInstallId(): string {
  try {
    return secureRandomHex(8);
  } catch {
    return sha256Hex(`${Date.now()}.${Math.random()}.${Math.random()}`).slice(0, 16);
  }
}

/** Loads identity/session/lockout once on boot (call after db.init). */
export async function initAccess(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY_INSTALL);
    if (raw) {
      const parsed = JSON.parse(raw) as InstallIdentity;
      identity = { id: parsed.id, tag: tagFromId(parsed.id), model: deviceModelLabel() };
    } else {
      // Secure random once per install (16 hex chars; display tag only).
      const id = freshInstallId();
      identity = { id, tag: tagFromId(id), model: deviceModelLabel() };
      await AsyncStorage.setItem(
        KEY_INSTALL,
        JSON.stringify({ id, createdAt: Date.now() } satisfies InstallIdentity),
      );
    }
  } catch {
    if (!identity) {
      const id = freshInstallId();
      identity = { id, tag: tagFromId(id), model: deviceModelLabel() };
    }
  }
  try {
    const s = await AsyncStorage.getItem(KEY_SESSION);
    if (s) session = JSON.parse(s) as UmpireSession;
  } catch {
    session = null;
  }
  try {
    const l = await AsyncStorage.getItem(KEY_LOCKOUT);
    if (l) {
      const parsed = JSON.parse(l) as { wrongAttempts: number; lockedUntil: number };
      wrongAttempts = parsed.wrongAttempts || 0;
      lockedUntil = parsed.lockedUntil || 0;
    }
  } catch {
    /* defaults */
  }
  try {
    stayFor12h = (await AsyncStorage.getItem(KEY_STAY_PREF)) === "1";
  } catch {
    stayFor12h = false;
  }
  try {
    lastName = (await AsyncStorage.getItem(KEY_LAST_NAME)) || "";
  } catch {
    lastName = "";
  }
  // A wrong-attempt lockout is only ever a short pause; clear stale ones.
  if (lockedUntil && Date.now() > lockedUntil) {
    lockedUntil = 0;
    wrongAttempts = 0;
    persistLockout();
  }
  expireIfNeeded();
  notify();
}

export function getIdentity(): { id: string; tag: string; model: string } | null {
  return identity;
}

// ─── Inputs from db/sync (cycle-free by design) ─────────────────────────────

export function setSpaceConfigured(configured: boolean) {
  if (spaceConfigured === configured) return;
  spaceConfigured = configured;
  expireIfNeeded();
  notify();
}

export function setSpaceKeyHash(hash: string | null) {
  const next = hash || null;
  if (spaceKeyHash === next) return;
  spaceKeyHash = next;
  // Rotation invalidates sessions granted against the old hash.
  expireIfNeeded();
  if (session && session.keyHash !== spaceKeyHash) {
    session = null;
    persistSession();
  }
  notify();
}

// ─── The single gate ────────────────────────────────────────────────────────

export function canEdit(): boolean {
  expireIfNeeded();
  if (!spaceConfigured) return true; // solo device — own data, no gate
  if (!session) return false; // audience mode
  if (spaceKeyHash && session.keyHash !== spaceKeyHash) return false; // rotated away
  return true;
}

export function currentAccessMode(): AccessMode {
  expireIfNeeded();
  if (!spaceConfigured) return "solo";
  return session ? "umpire" : "audience";
}

export function getAccessState(): AccessState {
  expireIfNeeded();
  return {
    mode: currentAccessModeInternal(),
    session: session ? { ...session } : null,
    spaceConfigured,
    spaceHasKey: !!spaceKeyHash,
    wrongAttempts,
    lockedUntil,
    stayFor12h,
    identity: identity ? { tag: identity.tag, model: identity.model } : null,
  };
}

function currentAccessModeInternal(): AccessMode {
  if (!spaceConfigured) return "solo";
  if (!session) return "audience";
  // A session granted against a key that has since been rotated away (or a
  // persisted session that expired) is NOT an umpire device, even though the
  // session object still exists. Screens derive their canEdit flag from this
  // mode, so it must agree with canEdit().
  if (spaceKeyHash && session.keyHash !== spaceKeyHash) return "audience";
  return "umpire";
}

/**
 * THE gate. Every user-facing mutator in db.ts calls this before writing.
 * Throws AudienceModeError in a shared space without an active umpire
 * session. Screens surface the message; sync pull-apply paths never call
 * the gated mutators, so remote merges are unaffected.
 */
export function assertCanEdit(action = "edit"): void {
  if (!canEdit()) throw new AudienceModeError(action);
}

// ─── Session lifecycle ──────────────────────────────────────────────────────

/** The last name someone typed when entering umpire mode on THIS device
 *  (1.4.7-test-3). Used only to prefill the name field — it stays a
 *  required, editable, typed field every time, and a handover (Switch
 *  umpire) starts from an EMPTY field so a new person is never logged
 *  under the previous name by accident. Never synced, never reused
 *  silently: the field is always visible in the sheet before unlocking. */
export function getLastUmpireName(): string {
  return lastName;
}

/** Grants a session (key already validated by the caller). */
export function beginUmpireSession(opts: {
  name: string;
  keyHash: string;
  persistFor12h: boolean;
}): void {
  if (!identity) {
    const id = freshInstallId();
    identity = { id, tag: tagFromId(id), model: deviceModelLabel() };
  }
  session = {
    name: opts.name.trim(),
    tag: identity.tag,
    model: identity.model,
    startedAt: Date.now(),
    expiresAt: opts.persistFor12h ? Date.now() + STAY_MS : null,
    keyHash: opts.keyHash,
  };
  lastName = session.name;
  AsyncStorage.setItem(KEY_LAST_NAME, lastName).catch(() => {});
  persistSession();
  notify();
}

/** Clears the session (user exit / invalidation). Idempotent. */
export function endUmpireSession(): UmpireSession | null {
  const ended = session;
  session = null;
  persistSession();
  notify();
  return ended;
}

export function isSessionActive(): boolean {
  expireIfNeeded();
  return session !== null;
}

export function setStayFor12h(on: boolean) {
  stayFor12h = on;
  AsyncStorage.setItem(KEY_STAY_PREF, on ? "1" : "0").catch(() => {});
  notify();
}

// ─── Key helpers + lockout ──────────────────────────────────────────────────

/** Iterations for the salted digest (1.4.7-test-3+). Slows any offline
 *  attack on the synced hash by ~10,000× while keeping unlock instant. */
export const KEY_HASH_ROUNDS = 10_000;

function normalizeUmpireKey(key: string): string {
  return key.trim().toLowerCase();
}

/** Legacy digest (≤1.4.7-test-2 rows): one unsalted SHA-256 round. Kept ONLY
 *  to verify old spaces — never used for new set/rotate. */
export function legacyHashUmpireKey(key: string): string {
  return sha256Hex(normalizeUmpireKey(key));
}

/** Salted, iterated digest (1.4.7-test-3+): h = sha256(salt:key), then
 *  9,999 further rounds of sha256(h). Per-space salt stops cross-space and
 *  rainbow-table amortization; rounds slow single-target brute force. */
export function saltedHashUmpireKey(key: string, salt: string): string {
  let h = sha256Hex(`${salt}:${normalizeUmpireKey(key)}`);
  for (let i = 1; i < KEY_HASH_ROUNDS; i++) h = sha256Hex(h);
  return h;
}

/** Fresh per-space salt (16 bytes → 32 hex, CSPRNG). */
export function newSpaceKeySalt(): string {
  return secureRandomHex(16);
}

/** Verify an entered key against a stored space-key row — either scheme. */
export function verifyUmpireKey(
  plainKey: string,
  sk: { keyHash: string; algo?: SpaceKeyAlgo | string; salt?: string },
): boolean {
  if (sk.algo === "sha256-salt" && typeof sk.salt === "string" && sk.salt) {
    return saltedHashUmpireKey(plainKey, sk.salt) === sk.keyHash;
  }
  return legacyHashUmpireKey(plainKey) === sk.keyHash;
}

/** True when the row predates 1.4.7-test-3 (unsalted single round). */
export function isLegacySpaceKey(
  sk: { algo?: SpaceKeyAlgo | string; salt?: string } | null,
): boolean {
  if (!sk) return false;
  return !(sk.algo === "sha256-salt" && typeof sk.salt === "string" && sk.salt);
}

/** Keys a reasonable person would call obvious: one repeated character,
 *  a short pattern tiled to 16, the full hex ladder, or a famous constant.
 *  (The 16-hex format itself is checked separately — this is about
 *  guessable CONTENT, which brute-force tools try first.) */
const WELL_KNOWN_KEYS = new Set([
  "deadbeefdeadbeef",
  "cafebabecafebabe",
  "feedfacefeedface",
  "badc0ffebadc0ffe",
  "0badc0de0badc0de",
  "abcdefabcdefabcd",
]);

export function validateUmpireKeyStrength(
  key: string,
): { ok: true } | { ok: false; error: string } {
  const k = normalizeUmpireKey(key);
  if (!/^[0-9a-f]{16}$/.test(k)) {
    return { ok: false, error: "The umpire key must be exactly 16 hex characters (0-9, a-f)." };
  }
  const weak =
    /^(.)\1+$/.test(k) || // aaaaaaaaaaaaaaaa
    /^(.{2,8})\1+$/.test(k) || // e2e2… / deadbeefdeadbeef / abcd1234abcd1234
    k === "0123456789abcdef" ||
    k === "fedcba9876543210" ||
    WELL_KNOWN_KEYS.has(k);
  if (weak) {
    return {
      ok: false,
      error: "That key is too easy to guess — use the generated one or a random-looking mix.",
    };
  }
  return { ok: true };
}

/** Generates a fresh 16-hex key from the CSPRNG (1.4.7-test-3+). Re-rolls on
 *  the (astronomically unlikely) chance of a weak draw. THROWS when no
 *  secure random source exists — key generation must fail loud, never
 *  silently fall back to Math.random. */
export function generateUmpireKey(): string {
  for (let i = 0; i < 10; i++) {
    const candidate = secureRandomHex(8); // 8 bytes → 16 hex chars
    if (validateUmpireKeyStrength(candidate).ok) return candidate;
  }
  throw new Error("Couldn't generate a secure key — no random source available.");
}

export function isLockedOut(): boolean {
  return lockedUntil > Date.now();
}

export function lockoutRemainingMs(): number {
  return Math.max(0, lockedUntil - Date.now());
}

/**
 * Wrong-key bookkeeping: 5 misses lock the input for 30s, each further miss
 * doubles the window (30s → 1m → 2m → … capped at 15m).
 */
export function registerWrongKeyAttempt(): { locked: boolean; lockedForMs: number } {
  wrongAttempts += 1;
  if (wrongAttempts >= 5) {
    const steps = wrongAttempts - 5; // 0 → 30s, 1 → 60s, 2 → 120s…
    const ms = Math.min(30_000 * Math.pow(2, steps), 15 * 60_000);
    lockedUntil = Date.now() + ms;
    persistLockout();
    notify();
    return { locked: true, lockedForMs: ms };
  }
  persistLockout();
  notify();
  return { locked: false, lockedForMs: 0 };
}

/** A successful entry (or sheet dismissal) resets the attempt counter. */
export function clearWrongAttempts() {
  if (wrongAttempts === 0 && lockedUntil === 0) return;
  wrongAttempts = 0;
  lockedUntil = 0;
  persistLockout();
  notify();
}
