/**
 * Domain types for the Audience / Umpire access layer (GullyScore 1.4.7).
 *
 * These entities are stored locally (db) and shared through Sync Spaces as
 * new row kinds: "spacekey" (one per space), "umpire" (one entry per
 * umpire session, append-only) and "log" (append-only activity entries).
 */

/**
 * SHA-256 digest of the space's umpire key (never the key itself).
 *
 * Two schemes, kept compatible:
 *  - "sha256"      — legacy (≤1.4.7-test-2): one unsalted round. Still
 *                    accepted on entry so old spaces keep working; the
 *                    first successful entry upgrades the row to "sha256-salt".
 *  - "sha256-salt" — 1.4.7-test-3+: per-space random salt + 10,000 rounds
 *                    (see access.ts). Every new set/rotate uses it.
 */
export type SpaceKeyAlgo = "sha256" | "sha256-salt";

export interface SpaceKeyInfo {
  /** Fixed canonical sync id — "space.key" on every device (no device prefix). */
  id: string;
  keyHash: string;
  algo: SpaceKeyAlgo;
  /** 32-hex (16-byte) random salt — present only when algo = "sha256-salt". */
  salt?: string;
  /** epoch ms — LWW cursor for sync */
  updatedAt: number;
  /** display name of the umpire who set/rotated the key last */
  setBy: string;
  setAt: number;
}

/** One row per umpire session (append-only; ends get stamped, never deleted). */
export interface UmpireEntry {
  id: string;
  name: string;
  /** short device tag, e.g. "#A3F9" */
  tag: string;
  /** device model label, e.g. "Redmi Note 11" or "Web browser" */
  model: string;
  startedAt: number;
  /** epoch ms when the session ended (exit / expiry / key rotation); undefined while active */
  endedAt?: number;
  updatedAt: number;
}

export type ActivityAction =
  | "ball_scored"
  | "ball_edited"
  | "ball_removed"
  | "striker_swapped"
  | "match_created"
  | "match_completed"
  | "match_reopened"
  | "match_archived"
  | "match_deleted"
  | "team_saved"
  | "team_deleted"
  | "player_saved"
  | "player_deleted"
  | "tournament_saved"
  | "tournament_deleted"
  | "fixture_saved"
  | "key_set"
  | "key_rotated"
  | "key_upgraded"
  | "umpire_entered"
  | "umpire_exited"
  | "data_wiped"
  | "demo_reseeded"
  | "backup_imported"
  | "match_imported";

/** Append-only human-readable audit entry. Corrections are new rows. */
export interface ActivityLogEntry {
  id: string;
  /** epoch ms of the change */
  ts: number;
  /** umpire name (or "You" for solo edits on this device) */
  actorName: string;
  /** actor device tag "#A3F9" */
  actorTag: string;
  /** actor device model */
  actorModel: string;
  /** local match id when the change touched a match */
  matchId?: string;
  /** cached "SPW vs GST" label so entries stay readable after the match is gone */
  matchLabel?: string;
  action: ActivityAction;
  /** short human sentence fragment, e.g. "Scored 4 runs — over 12.3" */
  detail: string;
  /** before value for corrections (plain text) */
  before?: string;
  /** after value (plain text) */
  after?: string;
  /** true for corrections (edits/removals/reopens) — gets the subtle highlight */
  correction?: boolean;
  /** epoch ms — LWW cursor for sync (same as ts; kept separate for clarity) */
  updatedAt: number;
}

/** Local device identity — random install id, NOT MAC/IP (both unreliable). */
export interface InstallIdentity {
  /** 8-byte hex string generated once per install */
  id: string;
  createdAt: number;
}
