/**
 * GullyScore cloud-sync coordinator (RN port of the tested Kotlin
 * SyncCoordinator + the web client behaviour described in docs/SYNC.md).
 *
 * Behaviour contract (Sync v1):
 *  - Row id: "d{deviceTag}.{localId}". deviceTag is a random 1..1048575 int
 *    generated once per device (persisted). Every id inside a pushed payload
 *    is the FULL remote key; pulled payload ids are remapped to local ids.
 *  - LWW merge: a pulled row applies only when remote updatedAtMs is
 *    strictly greater than the local row's updatedAt (or there is no local
 *    row). A pull NEVER deletes local rows except explicit tombstones
 *    (payload {"deleted": true}); tombstoned keys are never re-pushed.
 *  - PUSH: full local snapshot as canonical rows + tombstones for rows that
 *    were synced before but vanished locally. Failures are surfaced as a
 *    status string — local storage always stays the source of truth.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  CloudSyncError,
  createSpace,
  probeBackend,
  probeSpace,
  pullRows,
  pushRows,
  PulledRow,
  PushRow,
} from "./cloud";
import { db } from "./db";
import { Fixture, Match, Player, Team, Tournament } from "../types/cricket";

const STORAGE_KEY = "gullyscore_sync_v1";

export type SyncKind = "player" | "team" | "match" | "tournament" | "fixture";

export interface SyncState {
  /** 8-char Sync Space code, null when not connected */
  code: string | null;
  /** Space display name (from gs_spaces) */
  name: string | null;
  /** random 1..1048575, generated once per device */
  deviceTag: number;
  /** pull cursor (epoch ms of the newest row we have applied) */
  lastPullMs: number;
  /** localId -> { key: remoteKey, kind } */
  idMap: Record<string, { key: string; kind: SyncKind }>;
  /** remoteKeys already tombstoned — never pushed again */
  tombstones: string[];
  lastSyncAt: number;
  /** "" | "ok" | error message from the last sync */
  lastResult: string;
  lastSyncedCounts: { pushed: number; pulled: number };
}

const DEFAULT_STATE: SyncState = {
  code: null,
  name: null,
  deviceTag: 0,
  lastPullMs: 0,
  idMap: {},
  tombstones: [],
  lastSyncAt: 0,
  lastResult: "",
  lastSyncedCounts: { pushed: 0, pulled: 0 },
};

let state: SyncState = { ...DEFAULT_STATE };
let loaded = false;
let syncing = false;
const listeners = new Set<() => void>();

/** Live backend reachability (runtime only, re-probed on boot/sync/settings). */
export type BackendStatus = "checking" | "online" | "offline";
let backendStatus: BackendStatus = "checking";
const backendListeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
  backendListeners.forEach((l) => l());
}

function persist() {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

export function deviceLabel(): string {
  const os = Platform.OS === "web" ? "Web" : Platform.OS;
  return `GullyScore RN · ${os}`;
}

/** Load persisted sync meta once on boot (call after db.init()). */
export async function initSync(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncState>;
      state = { ...DEFAULT_STATE, ...parsed };
      if (!state.deviceTag) state.deviceTag = newDeviceTag();
    } else {
      state = { ...DEFAULT_STATE, deviceTag: newDeviceTag() };
      persist();
    }
  } catch {
    state = { ...DEFAULT_STATE, deviceTag: newDeviceTag() };
  }
  notify();
  // Probe the Supabase backend once on boot — the Settings indicator shows
  // "Online · No Space" instead of reading like an offline failure.
  void refreshBackendStatus();
}

/** Probe the Supabase REST backend (reachable + key valid + RLS active). */
export async function refreshBackendStatus(): Promise<void> {
  backendStatus = "checking";
  notify();
  const online = await probeBackend();
  backendStatus = online ? "online" : "offline";
  notify();
}

export function getBackendStatus(): BackendStatus {
  return backendStatus;
}

/** Listener for backend status changes (same channel as sync state). */
export function subscribeBackendStatus(listener: () => void): () => void {
  backendListeners.add(listener);
  return () => {
    backendListeners.delete(listener);
  };
}

function newDeviceTag(): number {
  return 1 + Math.floor(Math.random() * 1048575);
}

export function getSyncState(): SyncState {
  return { ...state, idMap: { ...state.idMap }, tombstones: [...state.tombstones] };
}

export function isSyncing(): boolean {
  return syncing;
}

export function isConfigured(): boolean {
  return !!state.code;
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ─── Space lifecycle ───────────────────────────────────────────────────────

export async function joinSpace(code: string): Promise<string> {
  const cleaned = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(cleaned)) throw new CloudSyncError("Codes are 8 characters");
  const name = await probeSpace(cleaned);
  if (!name) throw new CloudSyncError(`Space "${cleaned}" not found`);
  state = { ...state, code: cleaned, name, lastPullMs: 0, lastResult: "" };
  persist();
  notify();
  // Joining starts from a full mirror: pull everything, then push local data.
  await syncNow();
  return name;
}

export async function createNewSpace(name: string): Promise<string> {
  const code = await createSpace(name);
  state = { ...state, code, name, lastPullMs: 0, lastResult: "" };
  persist();
  notify();
  await syncNow();
  return code;
}

export function leaveSpace() {
  // Data stays local — the cloud is only ever a mirror (offline-first).
  state = {
    ...DEFAULT_STATE,
    deviceTag: state.deviceTag || newDeviceTag(),
    idMap: {},
    tombstones: [],
  };
  persist();
  notify();
}

// ─── Id mapping ────────────────────────────────────────────────────────────

/** remote key "d{tag}.{suffix}" -> suffix; falls back to the whole key. */
function stripPrefix(remoteKey: string): { tag: number | null; suffix: string } {
  const m = /^d(\d+)\.(.+)$/.exec(remoteKey);
  if (!m) return { tag: null, suffix: remoteKey };
  return { tag: parseInt(m[1], 10), suffix: m[2] };
}

/** Reverse idMap: remoteKey -> localId. */
function reverseMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [localId, entry] of Object.entries(state.idMap)) {
    out.set(entry.key, localId);
  }
  return out;
}

/** Map a pulled row's remote key to a local id, recording the pairing. */
function localIdForRemoteKey(remoteKey: string, kind: SyncKind): string {
  const rev = reverseMap();
  const known = rev.get(remoteKey);
  if (known) return known;
  const { tag, suffix } = stripPrefix(remoteKey);
  const localId = tag === state.deviceTag ? suffix : suffix;
  state.idMap[localId] = { key: remoteKey, kind };
  return localId;
}

/** The remote key for a local id, allocating one on first push. */
function remoteKeyForLocalId(localId: string, kind: SyncKind): string {
  const entry = state.idMap[localId];
  if (entry) return entry.key;
  const key = `d${state.deviceTag || newDeviceTag()}.${localId}`;
  state.idMap[localId] = { key, kind };
  return key;
}

/** Exact-string replacement over the whole payload tree (ids only match
 *  because they are opaque strings like "d42.7" or "p_1699_ab12f"). */
function deepRemap(value: unknown, mapping: Map<string, string>): unknown {
  if (typeof value === "string") return mapping.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => deepRemap(v, mapping));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepRemap(v, mapping);
    return out;
  }
  return value;
}

// ─── Pull ─────────────────────────────────────────────────────────────────

function entityUpdatedAt(e: { updatedAt?: number; createdAt?: number }): number {
  return e.updatedAt ?? 0;
}

function applyPulledRow(row: PulledRow, remoteToLocal: Map<string, string>): boolean {
  const payload = row.payload ?? {};

  // Tombstone: cloud-side delete of a row we (may) still hold locally.
  if (payload.deleted === true) {
    const rev = reverseMap();
    const localId = rev.get(row.id);
    if (localId && state.idMap[localId]) {
      const kind = state.idMap[localId].kind;
      db.removeSyncedEntity(kind, localId);
      delete state.idMap[localId];
    }
    if (!state.tombstones.includes(row.id)) state.tombstones.push(row.id);
    return true;
  }

  const kind = String(row.kind);
  if (!["player", "team", "match", "tournament", "fixture", "prediction"].includes(kind)) {
    return false; // unknown future kind — ignore, never corrupt local data
  }
  // Prediction rows are not stored by the RN app (v1). Skip BEFORE the id
  // mapping below: mapping them anyway polluted idMap with phantom entries
  // (kind "match"), which later produced bogus match tombstones on push and
  // a wrong-kind delete on a prediction tombstone pull.
  if (kind === "prediction") {
    if (payload.deleted === true && !state.tombstones.includes(row.id)) {
      state.tombstones.push(row.id);
    }
    return false;
  }
  // Map remote key -> local id, remap all interior refs to local ids.
  const localId = localIdForRemoteKey(row.id, kind as SyncKind);
  const local = deepRemap(payload, remoteToLocal) as Record<string, unknown>;

  local.id = localId;

  if (kind === "player") {
    const existing = db.getPlayer(localId);
    if (existing && entityUpdatedAt(existing) >= row.updatedAtMs) return false;
    const p = local as unknown as Player;
    p.updatedAt = row.updatedAtMs;
    db.applySyncedPlayer(p);
    return true;
  }
  if (kind === "team") {
    const existing = db.getTeam(localId);
    if (existing && entityUpdatedAt(existing) >= row.updatedAtMs) return false;
    const t = local as unknown as Team;
    t.updatedAt = row.updatedAtMs;
    db.applySyncedTeam(t);
    return true;
  }
  if (kind === "match") {
    const existing = db.getMatch(localId);
    if (existing && existing.updatedAt >= row.updatedAtMs) return false;
    const m = local as unknown as Match;
    m.updatedAt = row.updatedAtMs;
    db.applySyncedMatch(m);
    return true;
  }
  if (kind === "tournament") {
    const existing = db.getTournament(localId);
    if (existing && entityUpdatedAt(existing) >= row.updatedAtMs) return false;
    const t = local as unknown as Tournament;
    t.updatedAt = row.updatedAtMs;
    db.applySyncedTournament(t);
    return true;
  }
  // fixture
  const fixtures = db.getFixtures();
  const existing = fixtures.find((f) => f.id === localId);
  if (existing && entityUpdatedAt(existing) >= row.updatedAtMs) return false;
  const f = local as unknown as Fixture;
  f.updatedAt = row.updatedAtMs;
  db.applySyncedFixture(f);
  return true;
}

// ─── Push ─────────────────────────────────────────────────────────────────

function localSnapshot(): Array<{ kind: SyncKind; entity: Record<string, unknown> }> {
  const out: Array<{ kind: SyncKind; entity: Record<string, unknown> }> = [];
  db.getPlayers().forEach((p) => out.push({ kind: "player", entity: p as unknown as Record<string, unknown> }));
  db.getTeams().forEach((t) => out.push({ kind: "team", entity: t as unknown as Record<string, unknown> }));
  db.getMatches().forEach((m) => out.push({ kind: "match", entity: m as unknown as Record<string, unknown> }));
  db.getTournaments().forEach((t) => out.push({ kind: "tournament", entity: t as unknown as Record<string, unknown> }));
  db.getFixtures().forEach((f) => out.push({ kind: "fixture", entity: f as unknown as Record<string, unknown> }));
  return out;
}

function buildPushRows(): PushRow[] {
  const snapshot = localSnapshot();
  const now = Date.now();
  const rows: PushRow[] = [];

  // 1. Assign/lookup remote keys first so interior refs remap completely.
  const localToRemote = new Map<string, string>();
  for (const item of snapshot) {
    const id = String(item.entity.id);
    localToRemote.set(id, remoteKeyForLocalId(id, item.kind));
  }

  // 2. Canonical payloads: every id inside the payload is the full remote key.
  for (const item of snapshot) {
    const payload = deepRemap(item.entity, localToRemote) as Record<string, unknown>;
    const localId = String(item.entity.id);
    const remoteKey = localToRemote.get(localId)!;
    rows.push({
      id: remoteKey,
      kind: item.kind,
      payload,
      updatedAtMs: (item.entity.updatedAt as number | undefined) ?? now,
      updatedBy: deviceLabel(),
    });
  }

  // 3. Tombstones: rows we pushed before but that vanished locally since.
  const stillLocal = new Set(localToRemote.values());
  const rev = reverseMap();
  for (const [localId, entry] of Object.entries(state.idMap)) {
    if (stillLocal.has(entry.key)) continue;
    if (state.tombstones.includes(entry.key)) continue;
    rows.push({
      id: entry.key,
      kind: entry.kind,
      payload: { deleted: true, updatedAt: now },
      updatedAtMs: now,
      updatedBy: deviceLabel(),
    });
    state.tombstones.push(entry.key);
    delete state.idMap[localId];
  }
  return rows;
}

// ─── Orchestration ─────────────────────────────────────────────────────────

export async function syncNow(): Promise<void> {
  if (!state.code) throw new CloudSyncError("No Sync Space connected");
  if (syncing) return;
  syncing = true;
  notify();
  try {
    const online = await probeBackend();
    backendStatus = online ? "online" : "offline";
    notify();
    // PULL — apply remote changes first so the push that follows is a
    // superset (server LWW rejects stale writes either way).
    const rows = await pullRows(state.code, state.lastPullMs);
    const remoteToLocal = reverseMap();
    let applied = 0;
    let maxSeen = state.lastPullMs;
    for (const row of rows) {
      maxSeen = Math.max(maxSeen, row.updatedAtMs);
      const known = remoteToLocal.get(row.id);
      if (known) remoteToLocal.set(row.id, known);
      // note: localIdForRemoteKey inside applyPulledRow also extends the
      // idMap; refresh the remap view after the first row maps a new key.
      if (applyPulledRow(row, remoteToLocal)) applied += 1;
      const rev = reverseMap();
      for (const [k, v] of rev) remoteToLocal.set(k, v);
    }
    state.lastPullMs = maxSeen;
    if (applied > 0) db.notifyDataChanged();

    // PUSH — full snapshot + tombstones.
    const push = buildPushRows();
    await pushRows(state.code, push, deviceLabel());

    state.lastSyncAt = Date.now();
    state.lastResult = "ok";
    state.lastSyncedCounts = { pushed: push.length, pulled: applied };
    persist();
    notify();
  } catch (e) {
    state.lastSyncAt = Date.now();
    state.lastResult = e instanceof Error ? e.message : String(e);
    if (backendStatus === "checking") {
      backendStatus = "offline";
    }
    persist();
    notify();
    throw e;
  } finally {
    syncing = false;
    notify();
  }
}

/** App-start trigger (SYNC.md): pull-then-push when a space is configured. */
export async function maybeAutoSync(): Promise<void> {
  if (!state.code) return;
  try {
    await syncNow();
  } catch {
    // Best-effort by design; failure is already reflected in lastResult.
  }
}

/** Connectivity probe for the Settings indicator: is the space reachable? */
export async function checkCloudConnection(): Promise<boolean> {
  if (!state.code) return false;
  try {
    return (await probeSpace(state.code)) !== null;
  } catch {
    return false;
  }
}
