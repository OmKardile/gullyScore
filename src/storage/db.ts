/**
 * GullyScoreRN Local Storage & Persistence Engine (AsyncStorage port)
 *
 * Ported 1:1 from the web app's localStorage engine. The synchronous read API
 * is preserved: the class keeps everything in memory and App calls
 * `await db.init()` once on boot. Writes are fire-and-forget AsyncStorage
 * writes, so every screen keeps using `db.getMatches()` etc. unchanged.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Fixture,
  Match,
  MatchRules,
  Player,
  Team,
  Tournament,
} from "../types/cricket";
import {
  ActivityAction,
  ActivityLogEntry,
  SpaceKeyInfo,
  UmpireEntry,
} from "../types/access";
import { generateRoundRobinFixtures } from "../engine/scoringEngine";
import {
  ACTIVITY_LOG_CAP,
  assertCanEdit,
  beginUmpireSession,
  clearWrongAttempts,
  endUmpireSession,
  getAccessState,
  getIdentity,
  hashUmpireKey,
  MatchLockedError,
  registerWrongKeyAttempt,
  setSpaceKeyHash,
} from "./access";

export const SCHEMA_VERSION = 1;
const STORAGE_KEY_PLAYERS = "gullyscore_players_v1";
const STORAGE_KEY_TEAMS = "gullyscore_teams_v1";
const STORAGE_KEY_MATCHES = "gullyscore_matches_v1";
const STORAGE_KEY_TOURNAMENTS = "gullyscore_tournaments_v1";
const STORAGE_KEY_FIXTURES = "gullyscore_fixtures_v1";
const STORAGE_KEY_SETTINGS = "gullyscore_settings_v1";
const STORAGE_KEY_ACTIVE_MATCH_ID = "gullyscore_active_match_id";
// Access layer (1.4.7): per-space umpire key hash, the synced umpires list
// and the append-only activity log. Mirrors of Sync Space rows.
const STORAGE_KEY_SPACE_KEY = "gullyscore_space_key_v1";
const STORAGE_KEY_UMPIRES = "gullyscore_umpires_v1";
const STORAGE_KEY_ACTIVITY_LOG = "gullyscore_activity_log_v1";
// Set ("1") after a deliberate Wipe All Local Data. Distinguishes "user wiped
// everything on purpose" from "fresh install" — init() reseeds demo data for
// fresh installs only, so a wiped device must STAY empty across restarts.
const STORAGE_KEY_WIPED = "gullyscore_wiped_v1";

export interface AppSettings {
  theme: "light" | "dark" | "system";
  padHand: "right" | "left";
  keepScreenOn: boolean;
  haptics: boolean;
  defaultRules: MatchRules;
  /** Whether the first-launch guide tour has been seen (shown/skipped). */
  tourCompleted: boolean;
}

export const DEFAULT_RULES: MatchRules = {
  overs: 10,
  playersPerSide: 11,
  ballType: "tennis",
  wideRunValue: 1,
  noBallRunValue: 1,
  freeHitOnNoBall: true,
  lastManBatting: false,
  maxOversPerBowler: 2,
  noConsecutiveOvers: true,
  superOverOnTie: false,
  trackShotDirection: true,
};

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  padHand: "right",
  keepScreenOn: true,
  haptics: true,
  defaultRules: DEFAULT_RULES,
  tourCompleted: false,
};

class GullyDb {
  private players: Record<string, Player> = {};
  private teams: Record<string, Team> = {};
  private matches: Record<string, Match> = {};
  private tournaments: Record<string, Tournament> = {};
  private fixtures: Record<string, Fixture> = {};
  private spaceKey: SpaceKeyInfo | null = null;
  private umpires: Record<string, UmpireEntry> = {};
  private activityLog: Record<string, ActivityLogEntry> = {};
  /** ts watermark: entries at/below it were trimmed locally and must not be
   *  re-added on pull nor tombstoned on push (server keeps full history). */
  private logTrimWatermarkMs = 0;
  private settings: AppSettings = DEFAULT_SETTINGS;
  private activeMatchId: string | null = null;
  private listeners: Set<() => void> = new Set();
  private ready = false;
  private readyPromise: Promise<void> | null = null;

  // ─── Stable derived collections (perf/hang fix) ─────────────────────────
  // getMatches()/getPlayersMap()/etc. used to build a NEW array/object on
  // every call, so every screen that memoized on [matches, playersMap, ...]
  // re-ran its heavy computation (full-league innings replays, 800-iteration
  // Monte Carlo, career stats) on EVERY render — typing one character in a
  // text field re-replayed the entire match history. That is the same
  // "screen freezes" family as the reported scoring-pad hang, and it grows
  // with data. Fix: return cached references, invalidated together in
  // notify() (bumped once per data change; cloud sync batches via
  // notifyDataChanged). No caller mutates these collections in place
  // (verified), and objects inside remain live references as before.
  private revision = 0;
  private playersCache: Player[] | null = null;
  private teamsCache: Team[] | null = null;
  private matchesCache: Match[] | null = null;
  private tournamentsCache: Tournament[] | null = null;
  private fixturesCache: Fixture[] | null = null;
  private playersMapCache: Record<string, Player> | null = null;
  private teamsMapCache: Record<string, Team> | null = null;
  private umpiresCache: UmpireEntry[] | null = null;
  private activityLogCache: ActivityLogEntry[] | null = null;
  /** Registered by sync.ts: purge trimmed log ids from the remote id map
   *  WITHOUT emitting tombstones (server history is kept). */
  private logTrimHook: ((localIds: string[]) => void) | null = null;

  constructor() {
    // Do NOT touch AsyncStorage here (native module may not be ready at
    // module-evaluation time on cold start). App must call `await db.init()`.
  }

  /** Hydrate from AsyncStorage once on boot. Safe to call multiple times. */
  public init(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      try {
        const pRaw = await AsyncStorage.getItem(STORAGE_KEY_PLAYERS);
        if (pRaw) this.players = JSON.parse(pRaw);

        const tRaw = await AsyncStorage.getItem(STORAGE_KEY_TEAMS);
        if (tRaw) this.teams = JSON.parse(tRaw);

        const mRaw = await AsyncStorage.getItem(STORAGE_KEY_MATCHES);
        if (mRaw) this.matches = JSON.parse(mRaw);

        const trRaw = await AsyncStorage.getItem(STORAGE_KEY_TOURNAMENTS);
        if (trRaw) this.tournaments = JSON.parse(trRaw);

        const fRaw = await AsyncStorage.getItem(STORAGE_KEY_FIXTURES);
        if (fRaw) this.fixtures = JSON.parse(fRaw);

        const sRaw = await AsyncStorage.getItem(STORAGE_KEY_SETTINGS);
        if (sRaw) this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(sRaw) };

        const aRaw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVE_MATCH_ID);
        this.activeMatchId = aRaw ?? null;

        const skRaw = await AsyncStorage.getItem(STORAGE_KEY_SPACE_KEY);
        if (skRaw) {
          const parsed = JSON.parse(skRaw) as SpaceKeyInfo;
          if (parsed && typeof parsed.keyHash === "string") this.spaceKey = parsed;
        }
        const uRaw = await AsyncStorage.getItem(STORAGE_KEY_UMPIRES);
        if (uRaw) this.umpires = JSON.parse(uRaw);
        const lRaw = await AsyncStorage.getItem(STORAGE_KEY_ACTIVITY_LOG);
        if (lRaw) {
          const parsed = JSON.parse(lRaw) as {
            entries: Record<string, ActivityLogEntry>;
            trimWatermarkMs?: number;
          };
          this.activityLog = parsed.entries || {};
          this.logTrimWatermarkMs = parsed.trimWatermarkMs || 0;
        }

        const wipedRaw = await AsyncStorage.getItem(STORAGE_KEY_WIPED);
        const intentionallyWiped = wipedRaw === "1";

        if (Object.keys(this.players).length === 0 && !intentionallyWiped) {
          this.seedInitialData();
        }
      } catch (e) {
        console.error("Failed to load GullyScore database from AsyncStorage:", e);
        // Seed only when the failure looks like a fresh install (no data at
        // all AND no deliberate wipe marker) — a wiped device stays empty.
        const wipedRaw = await AsyncStorage.getItem(STORAGE_KEY_WIPED).catch(() => null);
        if (Object.keys(this.players).length === 0 && wipedRaw !== "1") {
          this.seedInitialData();
        }
      }
      this.ready = true;
      setSpaceKeyHash(this.spaceKey ? this.spaceKey.keyHash : null);
      this.notify();
    })();
    return this.readyPromise;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Monotonic data-change counter — stable useMemo dep for heavy screens. */
  public getRevision(): number {
    return this.revision;
  }

  private notify() {
    this.revision++;
    this.playersCache = null;
    this.teamsCache = null;
    this.matchesCache = null;
    this.tournamentsCache = null;
    this.fixturesCache = null;
    this.playersMapCache = null;
    this.teamsMapCache = null;
    this.umpiresCache = null;
    this.activityLogCache = null;
    this.listeners.forEach((l) => l());
  }

  private persist(key: string, data: unknown) {
    try {
      AsyncStorage.setItem(key, JSON.stringify(data)).catch(() => {});
    } catch (e) {
      console.error("Failed to persist key:", key, e);
    }
  }

  private persistActivityLog() {
    this.persist(STORAGE_KEY_ACTIVITY_LOG, {
      entries: this.activityLog,
      trimWatermarkMs: this.logTrimWatermarkMs,
    });
  }

  /** Short "SPW vs GST" label used by log rows + umpire chips. */
  public matchLabel(matchId?: string): string | undefined {
    if (!matchId) return undefined;
    const m = this.matches[matchId];
    if (!m) return undefined;
    const a = this.teams[m.teamAId]?.shortName || this.teams[m.teamAId]?.name || "Team A";
    const b = this.teams[m.teamBId]?.shortName || this.teams[m.teamBId]?.name || "Team B";
    return `${a} vs ${b}`;
  }

  /** "over 12.3" display for a ball (overNumber is 0-indexed in BallEvent). */
  public overLabel(overNumber: number, ballInOver: number): string {
    return `over ${overNumber + 1}.${ballInOver}`;
  }

  // --- Players CRUD ---
  public getPlayers(): Player[] {
    if (!this.playersCache) this.playersCache = Object.values(this.players);
    return this.playersCache;
  }

  public getPlayer(id: string): Player | undefined {
    return this.players[id];
  }

  public getPlayersMap(): Record<string, Player> {
    if (!this.playersMapCache) this.playersMapCache = { ...this.players };
    return this.playersMapCache;
  }

  public savePlayer(player: Player) {
    assertCanEdit(`save player ${player.name}`);
    const existed = !!this.players[player.id];
    player.updatedAt = Date.now();
    this.players[player.id] = player;
    this.persist(STORAGE_KEY_PLAYERS, this.players);
    this.logActivity("player_saved", {
      detail: `${existed ? "Edited" : "Added"} player ${player.name}${player.nickname ? ` (${player.nickname})` : ""}`,
      after: player.name,
    });
    this.notify();
  }

  public quickAddPlayer(name: string, teamId?: string): Player {
    const id = `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const newPlayer: Player = {
      id,
      name: name.trim(),
      role: "all_rounder",
      battingHand: "right",
      bowlingStyle: "rm",
      isArchived: false,
      createdAt: Date.now(),
    };
    this.savePlayer(newPlayer);

    if (teamId && this.teams[teamId]) {
      const team = this.teams[teamId];
      if (!team.playerIds.includes(id)) {
        team.playerIds.push(id);
        this.saveTeam(team);
      }
    }

    return newPlayer;
  }

  public deleteOrArchivePlayer(id: string): boolean {
    assertCanEdit("delete player");
    const target = this.players[id];
    const wasDeleted =
      !target ||
      !Object.values(this.matches).some(
        (m) => m.teamAPlayerIds.includes(id) || m.teamBPlayerIds.includes(id)
      );
    const result = this.deleteOrArchivePlayerInner(id);
    this.logActivity("player_deleted", {
      detail: `${wasDeleted ? "Deleted" : "Archived"} player ${target?.name || id}`,
      before: target?.name,
      correction: true,
    });
    return result;
  }

  private deleteOrArchivePlayerInner(id: string): boolean {
    // Check if player has match history
    const hasHistory = Object.values(this.matches).some((m) =>
      m.teamAPlayerIds.includes(id) || m.teamBPlayerIds.includes(id)
    );
    if (hasHistory) {
      // Archive instead of hard delete
      if (this.players[id]) {
        this.players[id].isArchived = true;
        this.players[id].updatedAt = Date.now();
        this.persist(STORAGE_KEY_PLAYERS, this.players);
        this.notify();
      }
      return false; // archived
    } else {
      delete this.players[id];
      // remove from teams
      Object.values(this.teams).forEach((t) => {
        t.playerIds = t.playerIds.filter((p) => p !== id);
      });
      Object.values(this.teams).forEach((t) => {
        if (t.playerIds.length) t.updatedAt = Date.now();
      });
      this.persist(STORAGE_KEY_PLAYERS, this.players);
      this.persist(STORAGE_KEY_TEAMS, this.teams);
      this.notify();
      return true; // deleted
    }
  }

  // --- Teams CRUD ---
  public getTeams(): Team[] {
    if (!this.teamsCache) this.teamsCache = Object.values(this.teams);
    return this.teamsCache;
  }

  public getTeam(id: string): Team | undefined {
    return this.teams[id];
  }

  public getTeamsMap(): Record<string, Team> {
    if (!this.teamsMapCache) this.teamsMapCache = { ...this.teams };
    return this.teamsMapCache;
  }

  public saveTeam(team: Team) {
    assertCanEdit(`save team ${team.name}`);
    const existed = !!this.teams[team.id];
    team.updatedAt = Date.now();
    this.teams[team.id] = team;
    this.persist(STORAGE_KEY_TEAMS, this.teams);
    this.logActivity("team_saved", {
      detail: `${existed ? "Edited" : "Added"} team ${team.name}`,
      after: team.name,
    });
    this.notify();
  }

  public deleteOrArchiveTeam(id: string): boolean {
    assertCanEdit("delete team");
    const target = this.teams[id];
    const result = this.deleteOrArchiveTeamInner(id);
    this.logActivity("team_deleted", {
      detail: `${result ? "Deleted" : "Archived"} team ${target?.name || id}`,
      before: target?.name,
      correction: true,
    });
    return result;
  }

  private deleteOrArchiveTeamInner(id: string): boolean {
    // A team referenced by ANYWHERE (a played match, a tournament roster or a
    // pending fixture) is ARCHIVED, never hard-deleted: hard-deleting orphans
    // Tournament.teamIds / Fixture.teamAId-teamBId (broken " vs " rows, teams
    // missing from points tables) with no tombstone for cloud sync to clean.
    const hasHistory = Object.values(this.matches).some(
      (m) => m.teamAId === id || m.teamBId === id
    );
    const inTournament = Object.values(this.tournaments).some((t) =>
      t.teamIds.includes(id)
    );
    const inFixture = Object.values(this.fixtures).some(
      (f) => f.teamAId === id || f.teamBId === id
    );
    if (hasHistory || inTournament || inFixture) {
      if (this.teams[id]) {
        this.teams[id].isArchived = true;
        this.teams[id].updatedAt = Date.now();
        this.persist(STORAGE_KEY_TEAMS, this.teams);
        this.notify();
      }
      return false;
    } else {
      delete this.teams[id];
      this.persist(STORAGE_KEY_TEAMS, this.teams);
      this.notify();
      return true;
    }
  }

  // --- Matches CRUD & Auto-Save ---
  public getMatches(): Match[] {
    if (!this.matchesCache) {
      this.matchesCache = Object.values(this.matches).sort(
        (a, b) => b.updatedAt - a.updatedAt
      );
    }
    return this.matchesCache;
  }

  public getMatch(id: string): Match | undefined {
    return this.matches[id];
  }

  public saveMatch(match: Match) {
    assertCanEdit("save match");
    const existing = this.matches[match.id];
    if (existing && existing.status === "completed") {
      this.assertCompletedMatchEditable(existing, match);
    }
    match.updatedAt = Date.now();
    this.matches[match.id] = match;
    this.persist(STORAGE_KEY_MATCHES, this.matches);

    if (match.status === "live") {
      this.setActiveMatchId(match.id);
    } else if (this.activeMatchId === match.id && match.status === "completed") {
      this.setActiveMatchId(null);
    }

    this.notify();
  }

  /** Completed matches are read-only (1.4.7). A save on a completed match
   *  is allowed ONLY for archive toggles; anything else — including status
   *  changes — must go through reopenMatch(id, reason), which logs the
   *  reason. Throws MatchLockedError otherwise. */
  private assertCompletedMatchEditable(existing: Match, incoming: Match) {
    const onlyArchiveChanged =
      incoming.status === "completed" &&
      JSON.stringify(existing.innings) === JSON.stringify(incoming.innings) &&
      existing.resultText === incoming.resultText &&
      existing.winnerTeamId === incoming.winnerTeamId &&
      existing.playerOfTheMatchId === incoming.playerOfTheMatchId &&
      existing.teamAId === incoming.teamAId &&
      existing.teamBId === incoming.teamBId &&
      JSON.stringify(existing.teamAPlayerIds) === JSON.stringify(incoming.teamAPlayerIds) &&
      JSON.stringify(existing.teamBPlayerIds) === JSON.stringify(incoming.teamBPlayerIds) &&
      JSON.stringify(existing.rules) === JSON.stringify(incoming.rules) &&
      JSON.stringify(existing.toss) === JSON.stringify(incoming.toss);
    if (!onlyArchiveChanged) {
      throw new MatchLockedError();
    }
  }

  /** Reopens a completed match so it can be edited again. Requires a
   *  reason; the reopen (with reason) lands in the activity log. */
  public reopenMatch(id: string, reason: string): Match | null {
    assertCanEdit("reopen match");
    const trimmed = reason.trim();
    if (!trimmed) throw new Error("A reason is required to reopen a match.");
    const match = this.matches[id];
    if (!match || match.status !== "completed") return match ?? null;
    const before = `Completed — ${match.resultText || "result recorded"}`;
    match.status = "live";
    match.updatedAt = Date.now();
    this.persist(STORAGE_KEY_MATCHES, this.matches);
    this.setActiveMatchId(match.id);
    this.logActivity("match_reopened", {
      matchId: id,
      detail: `Reopened the match — reason: ${trimmed}`,
      before,
      after: "Live again",
      correction: true,
    });
    this.notify();
    return match;
  }

  public deleteMatch(id: string) {
    assertCanEdit("delete match");
    const label = this.matchLabel(id);
    delete this.matches[id];
    if (this.activeMatchId === id) {
      this.setActiveMatchId(null);
    }
    this.persist(STORAGE_KEY_MATCHES, this.matches);
    this.logActivity("match_deleted", {
      matchId: undefined,
      detail: `Deleted match ${label || id}`,
      before: label,
      correction: true,
    });
    this.notify();
  }

  public toggleArchiveMatch(id: string): boolean {
    assertCanEdit("archive match");
    const match = this.matches[id];
    if (!match) return false;
    match.isArchived = !match.isArchived;
    match.updatedAt = Date.now();
    this.persist(STORAGE_KEY_MATCHES, this.matches);
    this.logActivity("match_archived", {
      matchId: id,
      detail: match.isArchived ? "Archived the match" : "Unarchived the match",
      before: match.isArchived ? "Active" : "Archived",
      after: match.isArchived ? "Archived" : "Active",
    });
    this.notify();
    return !!match.isArchived;
  }

  public archiveMatch(id: string) {
    assertCanEdit("archive match");
    const match = this.matches[id];
    if (match) {
      match.isArchived = true;
      match.updatedAt = Date.now();
      this.persist(STORAGE_KEY_MATCHES, this.matches);
      this.logActivity("match_archived", {
        matchId: id,
        detail: "Archived the match",
        before: "Active",
        after: "Archived",
      });
      this.notify();
    }
  }

  public unarchiveMatch(id: string) {
    assertCanEdit("unarchive match");
    const match = this.matches[id];
    if (match) {
      match.isArchived = false;
      match.updatedAt = Date.now();
      this.persist(STORAGE_KEY_MATCHES, this.matches);
      this.logActivity("match_archived", {
        matchId: id,
        detail: "Unarchived the match",
        before: "Archived",
        after: "Active",
      });
      this.notify();
    }
  }

  public getActiveMatch(): Match | null {
    if (!this.activeMatchId) return null;
    const m = this.matches[this.activeMatchId];
    if (m && m.status === "live") return m;
    return null;
  }

  public setActiveMatchId(id: string | null) {
    this.activeMatchId = id;
    if (id) {
      AsyncStorage.setItem(STORAGE_KEY_ACTIVE_MATCH_ID, id).catch(() => {});
    } else {
      AsyncStorage.removeItem(STORAGE_KEY_ACTIVE_MATCH_ID).catch(() => {});
    }
    this.notify();
  }

  // --- Tournaments CRUD ---
  public getTournaments(): Tournament[] {
    if (!this.tournamentsCache) {
      this.tournamentsCache = Object.values(this.tournaments).sort(
        (a, b) => b.createdAt - a.createdAt
      );
    }
    return this.tournamentsCache;
  }

  public getTournament(id: string): Tournament | undefined {
    return this.tournaments[id];
  }

  public saveTournament(tournament: Tournament) {
    assertCanEdit(`save tournament ${tournament.name}`);
    const existed = !!this.tournaments[tournament.id];
    tournament.updatedAt = Date.now();
    this.tournaments[tournament.id] = tournament;
    this.persist(STORAGE_KEY_TOURNAMENTS, this.tournaments);
    this.logActivity("tournament_saved", {
      detail: `${existed ? "Edited" : "Created"} tournament ${tournament.name}`,
      after: tournament.name,
    });
    this.notify();
  }

  public getFixtures(tournamentId?: string): Fixture[] {
    if (!tournamentId) {
      if (!this.fixturesCache) this.fixturesCache = Object.values(this.fixtures);
      return this.fixturesCache;
    }
    return this.fixturesCache
      ? this.fixturesCache.filter((f) => f.tournamentId === tournamentId)
      : Object.values(this.fixtures).filter((f) => f.tournamentId === tournamentId);
  }

  public saveFixture(fixture: Fixture) {
    assertCanEdit("save fixture");
    const existed = !!this.fixtures[fixture.id];
    fixture.updatedAt = Date.now();
    this.fixtures[fixture.id] = fixture;
    this.persist(STORAGE_KEY_FIXTURES, this.fixtures);
    this.logActivity("fixture_saved", {
      matchId: fixture.matchId,
      detail: `${existed ? "Updated" : "Scheduled"} fixture ${this.fixtureLabel(fixture)}`,
    });
    this.notify();
  }

  private fixtureLabel(f: Fixture): string {
    const a = this.teams[f.teamAId]?.shortName || "?";
    const b = this.teams[f.teamBId]?.shortName || "?";
    return `${a} vs ${b} (${f.roundName})`;
  }

  // --- Cloud sync application points (Supabase Sync Spaces v1) ---
  // Upsert a row pulled from the cloud WITHOUT stamping the local clock:
  // the remote `updated_at` (already written into entity.updatedAt by the
  // sync coordinator) is the LWW authority. These deliberately skip
  // notify() — the coordinator calls notifyDataChanged() once per sync so
  // screens re-render a single time instead of per row.
  public applySyncedPlayer(p: Player) {
    this.players[p.id] = p;
    this.persist(STORAGE_KEY_PLAYERS, this.players);
  }

  public applySyncedTeam(t: Team) {
    this.teams[t.id] = t;
    this.persist(STORAGE_KEY_TEAMS, this.teams);
  }

  public applySyncedMatch(m: Match) {
    this.matches[m.id] = m;
    this.persist(STORAGE_KEY_MATCHES, this.matches);
    if (m.status === "live") {
      this.setActiveMatchId(m.id);
    } else if (this.activeMatchId === m.id && m.status === "completed") {
      this.setActiveMatchId(null);
    }
  }

  public applySyncedTournament(t: Tournament) {
    this.tournaments[t.id] = t;
    this.persist(STORAGE_KEY_TOURNAMENTS, this.tournaments);
  }

  public applySyncedFixture(f: Fixture) {
    this.fixtures[f.id] = f;
    this.persist(STORAGE_KEY_FIXTURES, this.fixtures);
  }

  /** Access-layer mirrors pulled from a Sync Space (never gated — they are
   *  remote merges, not local edits). LWW by updatedAt. */
  public applySyncedSpaceKey(sk: SpaceKeyInfo) {
    if (!sk || typeof sk.keyHash !== "string") return;
    const next: SpaceKeyInfo = {
      id: "space.key",
      keyHash: sk.keyHash,
      algo: "sha256",
      updatedAt: sk.updatedAt || 0,
      setBy: sk.setBy || "",
      setAt: sk.setAt || 0,
    };
    if (this.spaceKey && this.spaceKey.updatedAt >= next.updatedAt) return;
    this.spaceKey = next;
    this.persist(STORAGE_KEY_SPACE_KEY, this.spaceKey);
    setSpaceKeyHash(this.spaceKey.keyHash);
  }

  public applySyncedUmpire(u: UmpireEntry) {
    if (!u || typeof u.id !== "string") return;
    const existing = this.umpires[u.id];
    if (existing && existing.updatedAt >= (u.updatedAt || 0)) return;
    this.umpires[u.id] = { ...u, updatedAt: u.updatedAt || 0 };
    this.persist(STORAGE_KEY_UMPIRES, this.umpires);
  }

  public applySyncedActivity(e: ActivityLogEntry) {
    if (!e || typeof e.id !== "string") return;
    // Trimmed-away entries must not come back (per-device latest-5000 view;
    // the server keeps the full history).
    if ((e.ts || 0) <= this.logTrimWatermarkMs) return;
    const existing = this.activityLog[e.id];
    if (existing && existing.updatedAt >= (e.updatedAt || 0)) return;
    this.activityLog[e.id] = { ...e, updatedAt: e.updatedAt || 0 };
    this.persistActivityLog();
  }

  /** Tombstone application: remove a cloud-deleted entity. */
  public removeSyncedEntity(kind: "player" | "team" | "match" | "tournament" | "fixture" | "umpire" | "log", localId: string) {
    if (kind === "player") delete this.players[localId];
    if (kind === "team") delete this.teams[localId];
    if (kind === "match") {
      delete this.matches[localId];
      if (this.activeMatchId === localId) this.setActiveMatchId(null);
    }
    if (kind === "tournament") delete this.tournaments[localId];
    if (kind === "fixture") delete this.fixtures[localId];
    if (kind === "umpire") delete this.umpires[localId];
    if (kind === "log") {
      delete this.activityLog[localId];
      this.persistActivityLog();
      return; // already persisted — skip the bulk writes below
    }
    this.persist(STORAGE_KEY_PLAYERS, this.players);
    this.persist(STORAGE_KEY_TEAMS, this.teams);
    this.persist(STORAGE_KEY_MATCHES, this.matches);
    this.persist(STORAGE_KEY_TOURNAMENTS, this.tournaments);
    this.persist(STORAGE_KEY_FIXTURES, this.fixtures);
    this.persist(STORAGE_KEY_UMPIRES, this.umpires);
  }

  /** One re-render after a batch of cloud rows was applied. */
  public notifyDataChanged() {
    this.notify();
  }

  // ─── Access layer: umpire key, umpires list, activity log (1.4.7) ────────
  // All of this data lives in the SAME LWW sync stream as cricket data, as
  // three new row kinds. The umpire key itself never leaves this device —
  // only its SHA-256 hash syncs.

  public getSpaceKey(): SpaceKeyInfo | null {
    return this.spaceKey ? { ...this.spaceKey } : null;
  }

  /** Creator flow: sets the space's first umpire key (only when none exists
   *  — first setter wins) and immediately grants the setter a session.
   *  The caller shows the plain key ONCE with a copy action + "save this". */
  public setUmpireKey(plainKey: string, name: string): { key: string; spaceKey: SpaceKeyInfo } {
    if (this.spaceKey) {
      throw new Error("This space already has an umpire key. An umpire can change it from Settings.");
    }
    const trimmedKey = plainKey.trim();
    if (!/^[0-9a-f]{16}$/.test(trimmedKey.toLowerCase())) {
      throw new Error("The umpire key must be exactly 16 hex characters (0-9, a-f).");
    }
    const actor = this.actorFields(name);
    const now = Date.now();
    this.spaceKey = {
      id: "space.key",
      keyHash: hashUmpireKey(trimmedKey),
      algo: "sha256",
      updatedAt: now,
      setBy: actor.name,
      setAt: now,
    };
    this.persist(STORAGE_KEY_SPACE_KEY, this.spaceKey);
    setSpaceKeyHash(this.spaceKey.keyHash);
    beginUmpireSession({ name: actor.name, keyHash: this.spaceKey.keyHash, persistFor12h: false });
    this.stampOpenUmpireEntries(actor.tag, Date.now());
    this.appendUmpireEntry(actor);
    this.logActivity("key_set", {
      detail: "Set this space's umpire key (shown once)",
      actor: actor,
    });
    this.logActivity("umpire_entered", { detail: "Entered umpire mode", actor: actor });
    this.notify();
    return { key: trimmedKey, spaceKey: { ...this.spaceKey } };
  }

  /** Umpire-only: rotates the key (invalidates every other umpire session)
   *  and re-grants the rotator. Returns the plain key — shown ONCE. */
  public rotateUmpireKey(plainKey: string): string {
    assertCanEdit("change the umpire key");
    const trimmedKey = plainKey.trim();
    if (!/^[0-9a-f]{16}$/.test(trimmedKey.toLowerCase())) {
      throw new Error("The umpire key must be exactly 16 hex characters (0-9, a-f).");
    }
    const actor = this.actorFields();
    const now = Date.now();
    if (!this.spaceKey) throw new Error("This space has no umpire key yet — set one first.");
    this.spaceKey = {
      ...this.spaceKey,
      keyHash: hashUmpireKey(trimmedKey),
      updatedAt: now,
      setBy: actor.name,
      setAt: now,
    };
    this.persist(STORAGE_KEY_SPACE_KEY, this.spaceKey);
    setSpaceKeyHash(this.spaceKey.keyHash);
    beginUmpireSession({ name: actor.name, keyHash: this.spaceKey.keyHash, persistFor12h: getAccessState().stayFor12h });
    this.logActivity("key_rotated", {
      detail: "Changed the umpire key — other umpire sessions ended",
      actor,
      correction: true,
    });
    this.notify();
    return trimmedKey;
  }

  /** Validates an entered key against the space hash and grants a session.
   *  Tracks wrong attempts (5 → escalating lockout) via access. */
  public enterUmpireMode(
    plainKey: string,
    name: string,
    stayFor12h: boolean,
  ): { ok: true } | { ok: false; error: string; lockedForMs?: number } {
    const state = getAccessState();
    if (!state.spaceConfigured) {
      return { ok: false, error: "You're not in a Sync Space — solo devices already have full access." };
    }
    if (!this.spaceKey) {
      return { ok: false, error: "This space has no umpire key yet. If you created it, set one below." };
    }
    if (state.lockedUntil > Date.now()) {
      return {
        ok: false,
        error: "Too many wrong keys — the input is paused for a moment.",
        lockedForMs: state.lockedUntil - Date.now(),
      };
    }
    if (!name.trim()) {
      return { ok: false, error: "Please enter your name — it shows next to every change you make." };
    }
    if (hashUmpireKey(plainKey) !== this.spaceKey.keyHash) {
      const attempt = registerWrongKeyAttempt();
      const left = Math.max(0, 5 - getAccessState().wrongAttempts);
      return {
        ok: false,
        error: attempt.locked
          ? "Too many wrong keys — the input is paused for a moment."
          : `That key doesn't match. ${left === 1 ? "One try left before a short pause." : `${left} tries left.`}`,
        lockedForMs: attempt.locked ? attempt.lockedForMs : undefined,
      };
    }
    clearWrongAttempts();
    const actor = this.actorFields(name);
    beginUmpireSession({ name: actor.name, keyHash: this.spaceKey.keyHash, persistFor12h: stayFor12h });
    // A previous session of this device that never got an end stamp (kill,
    // expiry, rotation elsewhere) must not linger as "Active".
    this.stampOpenUmpireEntries(actor.tag, Date.now());
    this.appendUmpireEntry(actor);
    this.logActivity("umpire_entered", { detail: "Entered umpire mode", actor });
    this.notify();
    return { ok: true };
  }

  /** Ends the session, stamps the umpires-list entry and logs the exit. */
  public exitUmpireMode(): void {
    const ended = endUmpireSession();
    if (!ended) return;
    this.stampOpenUmpireEntries(ended.tag, Date.now());
    this.logActivity("umpire_exited", {
      detail: "Left umpire mode",
      actor: { name: ended.name, tag: ended.tag, model: ended.model },
    });
    this.notify();
  }

  /** Boot-time bookkeeping: a session that ended without an explicit exit
   *  (app killed, 12h expiry, key rotation on another device) gets its
   *  umpires-list entry stamped + a log row so the shared list stays honest. */
  public postBootAccessBookkeeping(): void {
    const state = getAccessState();
    if (state.session || !getIdentity()) return;
    const now = Date.now();
    const stamped = this.stampOpenUmpireEntries(getIdentity()!.tag, now);
    if (stamped > 0) {
      this.logActivity("umpire_exited", {
        detail: "Umpire session ended (restart, expiry or key change)",
      });
      this.notify();
    }
  }

  private stampOpenUmpireEntries(tag: string, endedAt: number): number {
    let stamped = 0;
    for (const u of Object.values(this.umpires)) {
      if (u.tag === tag && u.endedAt === undefined) {
        this.umpires[u.id] = { ...u, endedAt, updatedAt: endedAt };
        stamped++;
      }
    }
    if (stamped > 0) this.persist(STORAGE_KEY_UMPIRES, this.umpires);
    return stamped;
  }

  private appendUmpireEntry(actor: { name: string; tag: string; model: string }) {
    const id = `u_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.umpires[id] = {
      id,
      name: actor.name,
      tag: actor.tag,
      model: actor.model,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.persist(STORAGE_KEY_UMPIRES, this.umpires);
  }

  /** Umpires list (synced), newest first. Visible to everyone. */
  public getUmpires(): UmpireEntry[] {
    if (!this.umpiresCache) {
      this.umpiresCache = Object.values(this.umpires).sort((a, b) => b.startedAt - a.startedAt);
    }
    return this.umpiresCache;
  }

  /** The space's currently-active umpire (latest entry without an end), for
   *  the "Umpire: <name>" chip on live matches. Accountability, not proof. */
  public getActiveUmpire(): UmpireEntry | null {
    const open = Object.values(this.umpires)
      .filter((u) => u.endedAt === undefined)
      .sort((a, b) => b.startedAt - a.startedAt);
    return open[0] ?? null;
  }

  /** True when another umpire entry shares this name with a different tag —
   *  shown as a subtle flag in the umpires list / log (identity is not proof). */
  public hasDuplicateUmpireName(entry: UmpireEntry): boolean {
    return Object.values(this.umpires).some(
      (u) => u.id !== entry.id && u.name === entry.name && u.tag !== entry.tag,
    );
  }

  public getActivityLog(): ActivityLogEntry[] {
    if (!this.activityLogCache) {
      this.activityLogCache = Object.values(this.activityLog).sort((a, b) => b.ts - a.ts);
    }
    return this.activityLogCache;
  }

  public getLogEntry(id: string): ActivityLogEntry | undefined {
    return this.activityLog[id];
  }

  /** Actor = the active umpire session, or this device ("You") when solo. */
  private actorFields(nameOverride?: string): { name: string; tag: string; model: string } {
    const state = getAccessState();
    const identity = getIdentity();
    if (state.session) {
      return { name: nameOverride?.trim() || state.session.name, tag: state.session.tag, model: state.session.model };
    }
    return {
      name: nameOverride?.trim() || "You",
      tag: identity?.tag || "#????",
      model: identity?.model || "This device",
    };
  }

  /** Appends a human-readable audit row (append-only; corrections are new
   *  rows). Soft-capped at the latest ACTIVITY_LOG_CAP entries — trimming
   *  only affects this device's view; the server keeps full history. */
  public logActivity(
    action: ActivityAction,
    opts: {
      matchId?: string;
      detail: string;
      before?: string;
      after?: string;
      correction?: boolean;
      actor?: { name: string; tag: string; model: string };
    },
  ): ActivityLogEntry | null {
    try {
      const actor = opts.actor ?? this.actorFields();
      const id = `l_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const entry: ActivityLogEntry = {
        id,
        ts: Date.now(),
        actorName: actor.name,
        actorTag: actor.tag,
        actorModel: actor.model,
        matchId: opts.matchId,
        matchLabel: opts.matchId ? this.matchLabel(opts.matchId) : undefined,
        action,
        detail: opts.detail,
        before: opts.before,
        after: opts.after,
        correction: opts.correction,
        updatedAt: Date.now(),
      };
      this.activityLog[id] = entry;
      this.trimActivityLog();
      this.persistActivityLog();
      this.activityLogCache = null;
      this.notify();
      return entry;
    } catch (e) {
      // The audit log must never break the action it records.
      console.error("logActivity failed:", e);
      return null;
    }
  }

  private trimActivityLog() {
    const ids = Object.keys(this.activityLog);
    if (ids.length <= ACTIVITY_LOG_CAP) return;
    const sorted = Object.values(this.activityLog).sort((a, b) => a.ts - b.ts);
    const drop = sorted.slice(0, ids.length - ACTIVITY_LOG_CAP);
    for (const e of drop) delete this.activityLog[e.id];
    this.logTrimWatermarkMs = Math.max(this.logTrimWatermarkMs, drop[drop.length - 1].ts);
    // Let sync purge the remote-id map entries WITHOUT tombstoning them.
    if (this.logTrimHook) this.logTrimHook(drop.map((e) => e.id));
  }

  /** sync.ts registers this so trimmed rows vanish from the remote id map
   *  without generating tombstones (server history is preserved). */
  public registerLogTrimHook(hook: (localIds: string[]) => void): void {
    this.logTrimHook = hook;
  }

  public getLogTrimWatermarkMs(): number {
    return this.logTrimWatermarkMs;
  }

  /** Log rows this device should push: newer than the last pushed cursor
   *  (log rows are append-only, so an incremental push is safe). */
  public getLogRowsNewerThan(ms: number): ActivityLogEntry[] {
    return Object.values(this.activityLog).filter((e) => e.updatedAt > ms);
  }

  /** Deletes ALL local cricket data (players, teams, matches, tournaments,
   *  fixtures, active-match pointer). User settings (theme, haptics, tour
   *  seen) are intentionally KEPT so the app still feels like yours. Marks
   *  storage as deliberately-wiped so the next boot does NOT reseed demo
   *  data — an empty GullyScore stays empty until the user adds content. */
  public wipeAllData() {
    assertCanEdit("wipe all data");
    this.players = {};
    this.teams = {};
    this.matches = {};
    this.tournaments = {};
    this.fixtures = {};
    this.umpires = {};
    this.activityLog = {};
    this.logTrimWatermarkMs = 0;
    this.spaceKey = null;
    this.activeMatchId = null;
    this.persist(STORAGE_KEY_PLAYERS, this.players);
    this.persist(STORAGE_KEY_TEAMS, this.teams);
    this.persist(STORAGE_KEY_MATCHES, this.matches);
    this.persist(STORAGE_KEY_TOURNAMENTS, this.tournaments);
    this.persist(STORAGE_KEY_FIXTURES, this.fixtures);
    this.persist(STORAGE_KEY_UMPIRES, this.umpires);
    this.persistActivityLog();
    this.persist(STORAGE_KEY_SPACE_KEY, null);
    AsyncStorage.removeItem(STORAGE_KEY_ACTIVE_MATCH_ID).catch(() => {});
    AsyncStorage.setItem(STORAGE_KEY_WIPED, "1").catch(() => {});
    setSpaceKeyHash(null);
    // The wipe itself is logged AFTER clearing so the entry survives (and
    // syncs, if a space is still connected) as the log's first row.
    this.logActivity("data_wiped", {
      detail: "Wiped all local data",
      before: "Everything",
      after: "Empty",
      correction: true,
    });
    this.notify();
  }

  /** Re-arms the fresh-install experience: clears the wiped marker so the
   *  demo teams/matches/tournament get seeded again on next init/seed call. */
  public reseedDemoData() {
    assertCanEdit("reload demo data");
    AsyncStorage.setItem(STORAGE_KEY_WIPED, "0").catch(() => {});
    this.seedInitialData();
    this.logActivity("demo_reseeded", {
      detail: "Reset and reloaded the demo data",
    });
  }

  // --- Settings ---
  public getSettings(): AppSettings {
    return { ...this.settings };
  }

  public saveSettings(newSettings: Partial<AppSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    this.persist(STORAGE_KEY_SETTINGS, this.settings);
    this.notify();
  }

  // --- Backup & Restore (JSON) ---
  /** Import validators: a malformed/truncated backup row must be SKIPPED,
   *  never merged — a merged match without `innings: BallEvent[][]` makes
   *  every screen that renders scorecards throw on every subsequent launch
   *  (persistent crash loop, only fixable by clearing app data). */
  private sanitizeImportedRecord<K extends string, V>(rows: unknown, isValid: (v: unknown, key: string) => boolean): { clean: Record<K, V>; skipped: number } {
    const clean: Record<string, unknown> = {};
    let skipped = 0;
    if (!rows || typeof rows !== "object" || Array.isArray(rows)) {
      return { clean: clean as Record<K, V>, skipped };
    }
    for (const [key, value] of Object.entries(rows as Record<string, unknown>)) {
      if (isValid(value, key)) clean[key] = value;
      else skipped++;
    }
    return { clean: clean as Record<K, V>, skipped };
  }

  public exportAllToJson(): string {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      appName: "GullyScore",
      exportedAt: new Date().toISOString(),
      players: this.players,
      teams: this.teams,
      matches: this.matches,
      tournaments: this.tournaments,
      fixtures: this.fixtures,
      umpires: this.umpires,
      activityLog: this.activityLog,
      settings: this.settings,
    };
    return JSON.stringify(payload, null, 2);
  }

  public importAllFromJson(jsonStr: string): { success: boolean; message: string } {
    assertCanEdit("restore a backup");
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed.players || !parsed.teams || typeof parsed !== "object") {
        return { success: false, message: "Invalid backup file format." };
      }

      const players = this.sanitizeImportedRecord<string, Player>(parsed.players, (v, key) =>
        !!v && typeof v === "object" && typeof key === "string" &&
        typeof (v as Player).id === "string" && typeof (v as Player).name === "string"
      );
      const teams = this.sanitizeImportedRecord<string, Team>(parsed.teams, (v, key) =>
        !!v && typeof v === "object" && typeof key === "string" &&
        typeof (v as Team).id === "string" && typeof (v as Team).name === "string" &&
        Array.isArray((v as Team).playerIds)
      );
      const matches = this.sanitizeImportedRecord<string, Match>(parsed.matches || {}, (v, key) =>
        !!v && typeof v === "object" && typeof key === "string" &&
        typeof (v as Match).id === "string" && Array.isArray((v as Match).innings) &&
        (v as Match).innings.every(
          (i) => !!i && typeof i === "object" && Array.isArray((i as { ballEvents?: unknown }).ballEvents)
        )
      );
      const tournaments = this.sanitizeImportedRecord<string, Tournament>(parsed.tournaments || {}, (v, key) =>
        !!v && typeof v === "object" && typeof key === "string" &&
        typeof (v as Tournament).id === "string" && Array.isArray((v as Tournament).teamIds)
      );
      const fixtures = this.sanitizeImportedRecord<string, Fixture>(parsed.fixtures || {}, (v, key) =>
        !!v && typeof v === "object" && typeof key === "string" &&
        typeof (v as Fixture).id === "string" && typeof (v as Fixture).tournamentId === "string" &&
        (v as Fixture).tournamentId.length > 0
      );

      const skippedTotal =
        players.skipped + teams.skipped + matches.skipped + tournaments.skipped + fixtures.skipped;

      this.players = { ...this.players, ...players.clean };
      this.teams = { ...this.teams, ...teams.clean };
      this.matches = { ...this.matches, ...matches.clean };
      this.tournaments = { ...this.tournaments, ...tournaments.clean };
      this.fixtures = { ...this.fixtures, ...fixtures.clean };
      // Access-layer mirrors (1.4.7): merged only when well-formed. The
      // key hash rides along (it is synced data, not a secret) but backups
      // created before 1.4.7 simply don't carry these fields — that's fine.
      if (parsed.umpires && typeof parsed.umpires === "object" && !Array.isArray(parsed.umpires)) {
        const validUmpires = Object.values(parsed.umpires as Record<string, unknown>).filter(
          (u): u is UmpireEntry =>
            !!u && typeof u === "object" && typeof (u as UmpireEntry).id === "string" &&
            typeof (u as UmpireEntry).name === "string" && typeof (u as UmpireEntry).startedAt === "number"
        );
        for (const u of validUmpires) {
          const existing = this.umpires[u.id];
          if (!existing || existing.updatedAt < (u.updatedAt || 0)) this.umpires[u.id] = u;
        }
        this.persist(STORAGE_KEY_UMPIRES, this.umpires);
      }
      if (parsed.activityLog && typeof parsed.activityLog === "object" && !Array.isArray(parsed.activityLog)) {
        const validLog = Object.values(parsed.activityLog as Record<string, unknown>).filter(
          (e): e is ActivityLogEntry =>
            !!e && typeof e === "object" && typeof (e as ActivityLogEntry).id === "string" &&
            typeof (e as ActivityLogEntry).ts === "number" && typeof (e as ActivityLogEntry).detail === "string"
        );
        for (const e of validLog) {
          if (e.ts <= this.logTrimWatermarkMs) continue;
          const existing = this.activityLog[e.id];
          if (!existing || existing.updatedAt < (e.updatedAt || 0)) this.activityLog[e.id] = e;
        }
        this.trimActivityLog();
        this.persistActivityLog();
      }
      if (parsed.settings && typeof parsed.settings === "object") {
        this.settings = { ...this.settings, ...parsed.settings };
      }

      this.persist(STORAGE_KEY_PLAYERS, this.players);
      this.persist(STORAGE_KEY_TEAMS, this.teams);
      this.persist(STORAGE_KEY_MATCHES, this.matches);
      this.persist(STORAGE_KEY_TOURNAMENTS, this.tournaments);
      this.persist(STORAGE_KEY_FIXTURES, this.fixtures);
      this.persist(STORAGE_KEY_SETTINGS, this.settings);

      this.logActivity("backup_imported", {
        detail: `Restored a backup (${players.clean ? Object.keys(players.clean).length : 0} players, ${matches.clean ? Object.keys(matches.clean).length : 0} matches merged)`,
      });
      this.notify();
      return {
        success: true,
        message:
          skippedTotal > 0
            ? `Restored and merged! (${skippedTotal} malformed row${skippedTotal === 1 ? "" : "s"} skipped)`
            : "Backup data successfully restored and merged!",
      };
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      return { success: false, message: `Failed to restore: ${err}` };
    }
  }

  public exportMatchToJson(matchId: string): string {
    const match = this.matches[matchId];
    if (!match) throw new Error("Match not found");
    const involvedPlayerIds = new Set([...match.teamAPlayerIds, ...match.teamBPlayerIds]);
    const players: Record<string, Player> = {};
    involvedPlayerIds.forEach((id) => {
      if (this.players[id]) players[id] = this.players[id];
    });

    const payload = {
      schemaVersion: SCHEMA_VERSION,
      type: "gullyscore_single_match",
      exportedAt: new Date().toISOString(),
      match,
      teamA: this.teams[match.teamAId],
      teamB: this.teams[match.teamBId],
      players,
    };
    return JSON.stringify(payload, null, 2);
  }

  public importMatchFromJson(jsonStr: string): { success: boolean; matchId?: string; message: string } {
    assertCanEdit("import a match");
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed.match || !parsed.match.id) {
        return { success: false, message: "Invalid match file format." };
      }

      if (parsed.players) {
        this.players = { ...this.players, ...parsed.players };
        this.persist(STORAGE_KEY_PLAYERS, this.players);
      }
      if (parsed.teamA) {
        this.teams[parsed.teamA.id] = parsed.teamA;
      }
      if (parsed.teamB) {
        this.teams[parsed.teamB.id] = parsed.teamB;
      }
      this.persist(STORAGE_KEY_TEAMS, this.teams);

      this.matches[parsed.match.id] = parsed.match;
      this.persist(STORAGE_KEY_MATCHES, this.matches);
      this.logActivity("match_imported", {
        matchId: parsed.match.id,
        detail: `Imported a match (${this.matchLabel(parsed.match.id) || parsed.match.id})`,
      });
      this.notify();

      return { success: true, matchId: parsed.match.id, message: "Match successfully imported!" };
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      return { success: false, message: `Failed to import match: ${err}` };
    }
  }

  /**
   * Seeds demo data: 4 local teams, 32 players, 1 completed 8-over match,
   * 1 live match in progress, 1 tournament with fixtures.
   */
  public seedInitialData() {
    const playersList: Player[] = [
      // Shivaji Park Warriors (Team 1)
      { id: "p_101", name: "Omkar Kardile", nickname: "Omi", role: "all_rounder", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_102", name: "Rohit Shinde", nickname: "Hitman", role: "batsman", battingHand: "right", bowlingStyle: "spin_off", isArchived: false, createdAt: 1 },
      { id: "p_103", name: "Siddhesh Rane", nickname: "Sid", role: "wicket_keeper", battingHand: "left", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_104", name: "Aditya Patil", nickname: "Aadi", role: "all_rounder", battingHand: "right", bowlingStyle: "rf", isArchived: false, createdAt: 1 },
      { id: "p_105", name: "Chinmay Kadam", nickname: "Chinny", role: "bowler", battingHand: "right", bowlingStyle: "spin_leg", isArchived: false, createdAt: 1 },
      { id: "p_106", name: "Kunal Sawant", nickname: "Kuni", role: "bowler", battingHand: "left", bowlingStyle: "sla", isArchived: false, createdAt: 1 },
      { id: "p_107", name: "Prathamesh More", nickname: "Prathu", role: "batsman", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_108", name: "Yash Gaikwad", nickname: "Yashu", role: "bowler", battingHand: "right", bowlingStyle: "rf", isArchived: false, createdAt: 1 },

      // Gully Strikers (Team 2)
      { id: "p_201", name: "Tanmay Deshmukh", nickname: "Tanny", role: "batsman", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_202", name: "Varun Nair", nickname: "Vazza", role: "all_rounder", battingHand: "left", bowlingStyle: "rf", isArchived: false, createdAt: 1 },
      { id: "p_203", name: "Sameer Khan", nickname: "Sam", role: "wicket_keeper", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_204", name: "Harsh Vardhan", nickname: "Harshu", role: "bowler", battingHand: "right", bowlingStyle: "spin_off", isArchived: false, createdAt: 1 },
      { id: "p_205", name: "Nikhil Joshi", nickname: "Nick", role: "batsman", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_206", name: "Chetan Parab", nickname: "Chets", role: "bowler", battingHand: "left", bowlingStyle: "lf", isArchived: false, createdAt: 1 },
      { id: "p_207", name: "Abhishek Mane", nickname: "Abhi", role: "all_rounder", battingHand: "right", bowlingStyle: "spin_leg", isArchived: false, createdAt: 1 },
      { id: "p_208", name: "Sanket Dalvi", nickname: "Sanky", role: "bowler", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },

      // Marine Drive CC (Team 3)
      { id: "p_301", name: "Gaurav Mehta", nickname: "GM", role: "batsman", battingHand: "left", bowlingStyle: "spin_off", isArchived: false, createdAt: 1 },
      { id: "p_302", name: "Kavish Parekh", nickname: "Kavi", role: "all_rounder", battingHand: "right", bowlingStyle: "rf", isArchived: false, createdAt: 1 },
      { id: "p_303", name: "Mihir Shah", nickname: "Mickey", role: "wicket_keeper", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_304", name: "Dhruv Merchant", nickname: "Dhruvi", role: "bowler", battingHand: "left", bowlingStyle: "sla", isArchived: false, createdAt: 1 },
      { id: "p_305", name: "Jayesh Chawla", nickname: "Jay", role: "batsman", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_306", name: "Parth Soni", nickname: "Parthu", role: "bowler", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_307", name: "Anand Rathi", nickname: "Andy", role: "all_rounder", battingHand: "right", bowlingStyle: "spin_leg", isArchived: false, createdAt: 1 },
      { id: "p_308", name: "Devang Vora", nickname: "Dev", role: "bowler", battingHand: "right", bowlingStyle: "rf", isArchived: false, createdAt: 1 },

      // Bandra Blasters (Team 4)
      { id: "p_401", name: "Zaid Shaikh", nickname: "Zaidi", role: "batsman", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_402", name: "Farhan Ali", nickname: "Farhi", role: "all_rounder", battingHand: "left", bowlingStyle: "lf", isArchived: false, createdAt: 1 },
      { id: "p_403", name: "Imran Qureshi", nickname: "Immu", role: "wicket_keeper", battingHand: "right", bowlingStyle: "spin_off", isArchived: false, createdAt: 1 },
      { id: "p_404", name: "Rizwan Baig", nickname: "Riz", role: "bowler", battingHand: "right", bowlingStyle: "rf", isArchived: false, createdAt: 1 },
      { id: "p_405", name: "Arif Ansari", nickname: "Arifu", role: "batsman", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_406", name: "Danish Merchant", nickname: "Dani", role: "bowler", battingHand: "right", bowlingStyle: "spin_leg", isArchived: false, createdAt: 1 },
      { id: "p_407", name: "Faizan Siddiqui", nickname: "Faizi", role: "all_rounder", battingHand: "right", bowlingStyle: "rm", isArchived: false, createdAt: 1 },
      { id: "p_408", name: "Tariq Mahmood", nickname: "Tari", role: "bowler", battingHand: "left", bowlingStyle: "sla", isArchived: false, createdAt: 1 },
    ];

    this.players = {};
    playersList.forEach((p) => {
      this.players[p.id] = p;
    });

    // 4 Teams
    const teamsList: Team[] = [
      {
        id: "t_spw",
        name: "Shivaji Park Warriors",
        shortName: "SPW",
        color: "#0E1B2E", // Navy
        monogram: "SPW",
        captainId: "p_101",
        playerIds: ["p_101", "p_102", "p_103", "p_104", "p_105", "p_106", "p_107", "p_108"],
        createdAt: 1,
      },
      {
        id: "t_gst",
        name: "Gully Strikers",
        shortName: "GST",
        color: "#B4232A", // Cricket ball crimson
        monogram: "GST",
        captainId: "p_201",
        playerIds: ["p_201", "p_202", "p_203", "p_204", "p_205", "p_206", "p_207", "p_208"],
        createdAt: 1,
      },
      {
        id: "t_mdc",
        name: "Marine Drive CC",
        shortName: "MDC",
        color: "#1F7A43", // Deep forest turf
        monogram: "MDC",
        captainId: "p_301",
        playerIds: ["p_301", "p_302", "p_303", "p_304", "p_305", "p_306", "p_307", "p_308"],
        createdAt: 1,
      },
      {
        id: "t_bbl",
        name: "Bandra Blasters",
        shortName: "BBL",
        color: "#D97706", // Amber
        monogram: "BBL",
        captainId: "p_401",
        playerIds: ["p_401", "p_402", "p_403", "p_404", "p_405", "p_406", "p_407", "p_408"],
        createdAt: 1,
      },
    ];

    this.teams = {};
    teamsList.forEach((t) => {
      this.teams[t.id] = t;
    });

    // Seed 1 Tournament
    const tourneyId = "tourn_monsoon_2026";
    const tournament: Tournament = {
      id: tourneyId,
      name: "Monsoon Gully Premier League 2026",
      format: "round_robin",
      teamIds: ["t_spw", "t_gst", "t_mdc", "t_bbl"],
      rules: { ...DEFAULT_RULES, overs: 8, playersPerSide: 8, maxOversPerBowler: 2 },
      status: "in_progress",
      winPoints: 2,
      tiePoints: 1,
      nrPoints: 1,
      createdAt: Date.now() - 86400000 * 3,
    };
    this.tournaments = { [tourneyId]: tournament };

    // Generate round robin fixtures
    const fixList = generateRoundRobinFixtures(tournament.teamIds, tourneyId);
    this.fixtures = {};
    fixList.forEach((f) => {
      this.fixtures[f.id] = {
        ...f,
        scheduledDate: "Weekend 4:00 PM",
        venue: "Shivaji Park Ground 3",
      };
    });

    // Seed Completed Match 1 (SPW vs GST - 8 overs)
    const match1Id = "m_seed_completed_1";
    const match1: Match = {
      id: match1Id,
      teamAId: "t_spw",
      teamBId: "t_gst",
      teamAPlayerIds: ["p_101", "p_102", "p_103", "p_104", "p_105", "p_106", "p_107", "p_108"],
      teamBPlayerIds: ["p_201", "p_202", "p_203", "p_204", "p_205", "p_206", "p_207", "p_208"],
      date: "2026-10-25",
      venue: "Shivaji Park Ground 2",
      rules: { ...DEFAULT_RULES, overs: 8, playersPerSide: 8, maxOversPerBowler: 2 },
      toss: { winnerTeamId: "t_spw", decision: "bat" },
      status: "completed",
      currentInningsIndex: 1,
      tournamentId: tourneyId,
      fixtureId: fixList[0]?.id,
      playerOfTheMatchId: "p_101", // Omkar Kardile (scored 48*, took 2 wickets)
      resultText: "Shivaji Park Warriors won by 14 runs",
      winnerTeamId: "t_spw",
      updatedAt: Date.now() - 86400000 * 2,
      innings: [
        {
          battingTeamId: "t_spw",
          bowlingTeamId: "t_gst",
          ballEvents: this.createSampleInningsEvents(
            "t_spw",
            "t_gst",
            ["p_101", "p_102", "p_103", "p_104"],
            ["p_201", "p_202", "p_204", "p_206"],
            78,
            3
          ),
        },
        {
          battingTeamId: "t_gst",
          bowlingTeamId: "t_spw",
          targetRuns: 79,
          ballEvents: this.createSampleInningsEvents(
            "t_gst",
            "t_spw",
            ["p_201", "p_202", "p_205", "p_207"],
            ["p_101", "p_104", "p_105", "p_108"],
            64,
            5
          ),
        },
      ],
    };
    this.matches = { [match1Id]: match1 };
    if (this.fixtures[fixList[0]?.id]) {
      this.fixtures[fixList[0].id].matchId = match1Id;
      this.fixtures[fixList[0].id].status = "completed";
    }

    // Seed Active Match in Progress (MDC vs BBL - thrilling live chase!)
    const matchLiveId = "m_seed_live_1";
    const liveMatch: Match = {
      id: matchLiveId,
      teamAId: "t_mdc",
      teamBId: "t_bbl",
      teamAPlayerIds: ["p_301", "p_302", "p_303", "p_304", "p_305", "p_306", "p_307", "p_308"],
      teamBPlayerIds: ["p_401", "p_402", "p_403", "p_404", "p_405", "p_406", "p_407", "p_408"],
      date: "Today",
      venue: "Marine Drive Promenade Nets",
      rules: { ...DEFAULT_RULES, overs: 6, playersPerSide: 6, maxOversPerBowler: 2 },
      toss: { winnerTeamId: "t_mdc", decision: "bat" },
      status: "live",
      currentInningsIndex: 1,
      tournamentId: tourneyId,
      fixtureId: fixList[1]?.id,
      updatedAt: Date.now() - 300000,
      innings: [
        {
          battingTeamId: "t_mdc",
          bowlingTeamId: "t_bbl",
          ballEvents: this.createSampleInningsEvents(
            "t_mdc",
            "t_bbl",
            ["p_301", "p_302", "p_303"],
            ["p_401", "p_402", "p_404"],
            52,
            2
          ),
        },
        {
          battingTeamId: "t_bbl",
          bowlingTeamId: "t_mdc",
          targetRuns: 53,
          ballEvents: this.createSampleInningsEvents(
            "t_bbl",
            "t_mdc",
            ["p_401", "p_402", "p_405"],
            ["p_301", "p_302"],
            34,
            1,
            22 // 22 legal balls (3.4 overs)
          ),
        },
      ],
    };
    this.matches[matchLiveId] = liveMatch;
    this.activeMatchId = matchLiveId;

    this.persist(STORAGE_KEY_PLAYERS, this.players);
    this.persist(STORAGE_KEY_TEAMS, this.teams);
    this.persist(STORAGE_KEY_TOURNAMENTS, this.tournaments);
    this.persist(STORAGE_KEY_FIXTURES, this.fixtures);
    this.persist(STORAGE_KEY_MATCHES, this.matches);
    AsyncStorage.setItem(STORAGE_KEY_ACTIVE_MATCH_ID, matchLiveId).catch(() => {});
    this.notify();
  }

  private createSampleInningsEvents(
    _batTeamId: string,
    _bowlTeamId: string,
    batters: string[],
    bowlers: string[],
    targetRunsApprox: number,
    wicketsToFall: number,
    limitLegalBalls = 48
  ) {
    const events = [];
    let curStriker = batters[0];
    let curNonStriker = batters[1];
    let nextBatterIdx = 2;
    let bowlerIdx = 0;
    let legalBalls = 0;
    let totalRuns = 0;
    let seq = 1;
    let wicketsCount = 0;

    const runsChoices = [0, 1, 1, 2, 0, 4, 1, 6, 0, 2, 1, 4];
    const shotDirections = [
      "mid_wicket",
      "cover",
      "long_on",
      "square_leg",
      "straight",
      "fine_leg",
      "point",
    ] as const;

    while (legalBalls < limitLegalBalls && totalRuns < targetRunsApprox) {
      const overNum = Math.floor(legalBalls / 6);
      const ballInOver = (legalBalls % 6) + 1;
      const curBowler = bowlers[bowlerIdx % bowlers.length];

      // Occasional wicket
      const shouldWicket =
        wicketsCount < wicketsToFall &&
        legalBalls > 0 &&
        legalBalls % Math.floor(limitLegalBalls / (wicketsToFall + 1)) === 0;

      if (shouldWicket && nextBatterIdx < batters.length) {
        wicketsCount++;
        const outPlayer = curStriker;
        const newBatter = batters[nextBatterIdx++];
        events.push({
          id: `b_${Date.now()}_${seq}`,
          seq,
          inningsIndex: 0,
          overNumber: overNum,
          ballInOver,
          strikerId: curStriker,
          nonStrikerId: curNonStriker,
          bowlerId: curBowler,
          runsBat: 0,
          extraType: "none" as const,
          extraRuns: 0,
          isLegal: true,
          isFreeHit: false,
          timestamp: Date.now() - (limitLegalBalls - legalBalls) * 20000,
          commentaryText: `Wicket falls! Clean bowled by ${curBowler}.`,
          wicket: {
            type: "bowled" as const,
            dismissedPlayerId: outPlayer,
            dismissedEnd: "striker" as const,
            fielderIds: [],
            runsCompleted: 0,
          },
        });
        curStriker = newBatter;
        legalBalls++;
        seq++;
      } else {
        const runs = runsChoices[legalBalls % runsChoices.length];
        totalRuns += runs;
        const shotDir = runs > 0 ? shotDirections[runs % shotDirections.length] : undefined;

        events.push({
          id: `b_${Date.now()}_${seq}`,
          seq,
          inningsIndex: 0,
          overNumber: overNum,
          ballInOver,
          strikerId: curStriker,
          nonStrikerId: curNonStriker,
          bowlerId: curBowler,
          runsBat: runs,
          extraType: "none" as const,
          extraRuns: 0,
          isLegal: true,
          isFreeHit: false,
          shotDirection: shotDir,
          timestamp: Date.now() - (limitLegalBalls - legalBalls) * 20000,
          commentaryText: runs === 4 ? "FOUR! Pierces the gap." : runs === 6 ? "SIX! Over long on!" : `${runs} run(s).`,
        });

        legalBalls++;
        seq++;

        // Strike rotation on odd runs
        if (runs % 2 !== 0) {
          const tmp = curStriker;
          curStriker = curNonStriker;
          curNonStriker = tmp;
        }
      }

      // Over change strike rotation
      if (legalBalls % 6 === 0) {
        const tmp = curStriker;
        curStriker = curNonStriker;
        curNonStriker = tmp;
        bowlerIdx++;
      }
    }

    return events;
  }
}

export const db = new GullyDb();
