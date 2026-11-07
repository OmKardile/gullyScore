/**
 * GullyScore Audience / Umpire access layer (1.4.7).
 *
 * ONE gate — `assertCanEdit()` — guards every match-data mutation in the app
 * (db.ts calls it from every user-facing mutator). Everything key-related
 * lives behind this module so the check can later be hardened server-side
 * (e.g. an RPC that verifies the key hash) without touching any UI code.
 *
 * Honest scope (documented in Help + README): this is a deliberate speed
 * bump against accidental or casual edits inside a shared Sync Space — the
 * key hash syncs through the same space, so a technical user with the space
 * code could extract it. It is NOT cryptographic protection. Solo devices
 * (no Sync Space) are never gated — it's their own data.
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
import { InstallIdentity } from "../types/access";

const KEY_SESSION = "gullyscore_umpire_session_v1";
const KEY_LOCKOUT = "gullyscore_umpire_lockout_v1";
const KEY_INSTALL = "gullyscore_install_v1";
const KEY_STAY_PREF = "gullyscore_umpire_stay12h_v1";

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
      // 8 random bytes from Math.random + clock + counter, hashed for uniform
      // spread (no native crypto dep; entropy is fine for a display tag).
      const seed = `${Date.now()}.${Math.random()}.${Math.random()}.${sessionSalt++}`;
      const id = sha256Hex(seed).slice(0, 16);
      identity = { id, tag: tagFromId(id), model: deviceModelLabel() };
      await AsyncStorage.setItem(
        KEY_INSTALL,
        JSON.stringify({ id, createdAt: Date.now() } satisfies InstallIdentity),
      );
    }
  } catch {
    if (!identity) {
      const id = sha256Hex(`${Date.now()}.${Math.random()}`).slice(0, 16);
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
  // A wrong-attempt lockout is only ever a short pause; clear stale ones.
  if (lockedUntil && Date.now() > lockedUntil) {
    lockedUntil = 0;
    wrongAttempts = 0;
    persistLockout();
  }
  expireIfNeeded();
  notify();
}
let sessionSalt = 1;

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
  return session ? "umpire" : "audience";
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

/** Grants a session (key already validated by the caller). */
export function beginUmpireSession(opts: {
  name: string;
  keyHash: string;
  persistFor12h: boolean;
}): void {
  if (!identity) {
    const id = sha256Hex(`${Date.now()}.${Math.random()}`).slice(0, 16);
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

/** Normalizes + hashes an entered key for comparison against the space hash. */
export function hashUmpireKey(key: string): string {
  return sha256Hex(key.trim().toLowerCase());
}

/** Generates a fresh 16-hex-char key (creator may also type their own). */
export function generateUmpireKey(): string {
  return sha256Hex(`${Date.now()}.${Math.random()}.${Math.random()}.${sessionSalt++}`)
    .slice(0, 16);
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
