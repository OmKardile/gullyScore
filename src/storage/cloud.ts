/**
 * Supabase Sync Spaces REST client (RN port).
 *
 * 1:1 port of the tested Kotlin client (GullyScore data/sync/SupabaseSync.kt)
 * and docs/SYNC.md contract v1:
 *  - Plain `fetch`: no Supabase SDK, no auth, no accounts.
 *  - Every request sends the publishable key + the `x-gs-space` code header;
 *    RLS on the backend keeps spaces isolated (the publishable key is public
 *    by design — same one the Android app and docs ship).
 *  - Transport only: LWW merge, id mapping and tombstones live in sync.ts.
 */

export const SUPABASE_URL = "https://wqgfftwxvbhlwftsknzo.supabase.co";
// Publishable (anon) key — safe to embed; RLS + space codes protect data.
const PUBLISHABLE_KEY = "sb_publishable_Qc32TSsQefru1Vgu3K9_wQ_AJoNHhtT";

const PUSH_BATCH_SIZE = 100;
const PULL_LIMIT = 1000;
const REQUEST_TIMEOUT_MS = 15000;

export interface PushRow {
  id: string;          // "d{deviceTag}.{localId}"
  kind: string;        // team|player|match|tournament|fixture|prediction
  payload: Record<string, unknown>;
  updatedAtMs: number; // epoch ms, client clock
  updatedBy: string;    // device label
}

export interface PulledRow {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  updatedAtMs: number;
  updatedBy: string;
}

export class CloudSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudSyncError";
  }
}

function headers(spaceCode: string | null, upsert = false): Record<string, string> {
  const h: Record<string, string> = {
    apikey: PUBLISHABLE_KEY,
    Authorization: `Bearer ${PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
  };
  if (spaceCode) h["x-gs-space"] = spaceCode;
  if (upsert) h["Prefer"] = "resolution=merge-duplicates";
  return h;
}

async function request(
  method: "GET" | "POST",
  url: string,
  spaceCode: string | null,
  body?: unknown,
  upsert = false,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: headers(spaceCode, upsert),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new CloudSyncError(`HTTP ${res.status}${text ? ` — ${text.slice(0, 140)}` : ""}`);
    }
    return text;
  } catch (e) {
    if (e instanceof CloudSyncError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new CloudSyncError(`Network error: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Spaces ────────────────────────────────────────────────────────────────

/** Creates a Sync Space via RPC and returns its fresh 8-char code. */
export async function createSpace(name: string): Promise<string> {
  const text = await request(
    "POST",
    `${SUPABASE_URL}/rest/v1/rpc/gs_create_space`,
    null,
    { p_name: name },
  );
  // PostgREST returns the code as a JSON string (or bare text).
  let parsed = "";
  try {
    const v = JSON.parse(text);
    parsed = typeof v === "string" ? v : String(v);
  } catch {
    parsed = text.trim().replace(/^"|"$/g, "");
  }
  const code = parsed.trim().replace(/^"|"$/g, "");
  if (!code) throw new CloudSyncError("Space creation returned no code");
  return code;
}

/** Probes a space code; returns the space name when valid, null otherwise. */
export async function probeSpace(code: string): Promise<string | null> {
  try {
    const text = await request(
      "GET",
      `${SUPABASE_URL}/rest/v1/gs_spaces?select=name&code=eq.${encodeURIComponent(code)}`,
      code,
    );
    const rows = JSON.parse(text) as Array<{ name?: string }>;
    if (Array.isArray(rows) && rows.length === 1) {
      return rows[0].name || "Sync Space";
    }
    return null;
  } catch (e) {
    // An invalid/unknown code must surface as "not found", not as a throw.
    if (e instanceof CloudSyncError && e.message.includes("HTTP 4")) return null;
    throw e;
  }
}

// ─── Rows ─────────────────────────────────────────────────────────────────

/** Pushes (upserts) canonical rows via the gs_push_rows RPC, batched. */
export async function pushRows(
  spaceCode: string,
  rows: PushRow[],
  updatedBy: string,
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += PUSH_BATCH_SIZE) {
    const batch = rows.slice(i, i + PUSH_BATCH_SIZE);
    await request(
      "POST",
      `${SUPABASE_URL}/rest/v1/rpc/gs_push_rows`,
      spaceCode,
      {
        p_rows: batch.map((r) => ({
          id: r.id,
          kind: r.kind,
          payload: r.payload,
          updated_at: r.updatedAtMs,
          updated_by: r.updatedBy || updatedBy,
        })),
      },
      true, // upsert
    );
  }
}

/** Pulls every row changed since the epoch-ms cursor (max 1000, oldest first). */
export async function pullRows(spaceCode: string, sinceMs: number): Promise<PulledRow[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/gs_rows?select=id,kind,payload,updated_at,updated_by` +
    `&updated_at=gt.${sinceMs}&order=updated_at.asc&limit=${PULL_LIMIT}`;
  const text = await request("GET", url, spaceCode);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CloudSyncError("Pull returned invalid JSON");
  }
  if (!Array.isArray(parsed)) throw new CloudSyncError("Pull returned invalid JSON");
  return parsed
    .map((row): PulledRow | null => {
      try {
        const o = row as Record<string, unknown>;
        return {
          id: String(o.id),
          kind: String(o.kind),
          payload: (o.payload as Record<string, unknown>) || {},
          updatedAtMs: Number(o.updated_at),
          updatedBy: String(o.updated_by ?? ""),
        };
      } catch {
        return null;
      }
    })
    .filter((r): r is PulledRow => r !== null);
}
