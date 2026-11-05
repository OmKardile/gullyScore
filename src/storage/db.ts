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
import { generateRoundRobinFixtures } from "../engine/scoringEngine";

export const SCHEMA_VERSION = 1;
const STORAGE_KEY_PLAYERS = "gullyscore_players_v1";
const STORAGE_KEY_TEAMS = "gullyscore_teams_v1";
const STORAGE_KEY_MATCHES = "gullyscore_matches_v1";
const STORAGE_KEY_TOURNAMENTS = "gullyscore_tournaments_v1";
const STORAGE_KEY_FIXTURES = "gullyscore_fixtures_v1";
const STORAGE_KEY_SETTINGS = "gullyscore_settings_v1";
const STORAGE_KEY_ACTIVE_MATCH_ID = "gullyscore_active_match_id";

export interface AppSettings {
  theme: "light" | "dark" | "system";
  padHand: "right" | "left";
  keepScreenOn: boolean;
  haptics: boolean;
  defaultRules: MatchRules;
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
};

class GullyDb {
  private players: Record<string, Player> = {};
  private teams: Record<string, Team> = {};
  private matches: Record<string, Match> = {};
  private tournaments: Record<string, Tournament> = {};
  private fixtures: Record<string, Fixture> = {};
  private settings: AppSettings = DEFAULT_SETTINGS;
  private activeMatchId: string | null = null;
  private listeners: Set<() => void> = new Set();
  private ready = false;
  private readyPromise: Promise<void> | null = null;

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

        if (Object.keys(this.players).length === 0) {
          this.seedInitialData();
        }
      } catch (e) {
        console.error("Failed to load GullyScore database from AsyncStorage:", e);
        if (Object.keys(this.players).length === 0) {
          this.seedInitialData();
        }
      }
      this.ready = true;
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

  private notify() {
    this.listeners.forEach((l) => l());
  }

  private persist(key: string, data: unknown) {
    try {
      AsyncStorage.setItem(key, JSON.stringify(data)).catch(() => {});
    } catch (e) {
      console.error("Failed to persist key:", key, e);
    }
  }

  // --- Players CRUD ---
  public getPlayers(): Player[] {
    return Object.values(this.players);
  }

  public getPlayer(id: string): Player | undefined {
    return this.players[id];
  }

  public getPlayersMap(): Record<string, Player> {
    return { ...this.players };
  }

  public savePlayer(player: Player) {
    player.updatedAt = Date.now();
    this.players[player.id] = player;
    this.persist(STORAGE_KEY_PLAYERS, this.players);
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
    return Object.values(this.teams);
  }

  public getTeam(id: string): Team | undefined {
    return this.teams[id];
  }

  public getTeamsMap(): Record<string, Team> {
    return { ...this.teams };
  }

  public saveTeam(team: Team) {
    team.updatedAt = Date.now();
    this.teams[team.id] = team;
    this.persist(STORAGE_KEY_TEAMS, this.teams);
    this.notify();
  }

  public deleteOrArchiveTeam(id: string): boolean {
    const hasHistory = Object.values(this.matches).some(
      (m) => m.teamAId === id || m.teamBId === id
    );
    if (hasHistory) {
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
    return Object.values(this.matches).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getMatch(id: string): Match | undefined {
    return this.matches[id];
  }

  public saveMatch(match: Match) {
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

  public deleteMatch(id: string) {
    delete this.matches[id];
    if (this.activeMatchId === id) {
      this.setActiveMatchId(null);
    }
    this.persist(STORAGE_KEY_MATCHES, this.matches);
    this.notify();
  }

  public toggleArchiveMatch(id: string): boolean {
    const match = this.matches[id];
    if (!match) return false;
    match.isArchived = !match.isArchived;
    match.updatedAt = Date.now();
    this.persist(STORAGE_KEY_MATCHES, this.matches);
    this.notify();
    return !!match.isArchived;
  }

  public archiveMatch(id: string) {
    const match = this.matches[id];
    if (match) {
      match.isArchived = true;
      match.updatedAt = Date.now();
      this.persist(STORAGE_KEY_MATCHES, this.matches);
      this.notify();
    }
  }

  public unarchiveMatch(id: string) {
    const match = this.matches[id];
    if (match) {
      match.isArchived = false;
      match.updatedAt = Date.now();
      this.persist(STORAGE_KEY_MATCHES, this.matches);
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
    return Object.values(this.tournaments).sort((a, b) => b.createdAt - a.createdAt);
  }

  public getTournament(id: string): Tournament | undefined {
    return this.tournaments[id];
  }

  public saveTournament(tournament: Tournament) {
    tournament.updatedAt = Date.now();
    this.tournaments[tournament.id] = tournament;
    this.persist(STORAGE_KEY_TOURNAMENTS, this.tournaments);
    this.notify();
  }

  public getFixtures(tournamentId?: string): Fixture[] {
    const list = Object.values(this.fixtures);
    if (tournamentId) {
      return list.filter((f) => f.tournamentId === tournamentId);
    }
    return list;
  }

  public saveFixture(fixture: Fixture) {
    fixture.updatedAt = Date.now();
    this.fixtures[fixture.id] = fixture;
    this.persist(STORAGE_KEY_FIXTURES, this.fixtures);
    this.notify();
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

  /** Tombstone application: remove a cloud-deleted entity. */
  public removeSyncedEntity(kind: "player" | "team" | "match" | "tournament" | "fixture", localId: string) {
    if (kind === "player") delete this.players[localId];
    if (kind === "team") delete this.teams[localId];
    if (kind === "match") {
      delete this.matches[localId];
      if (this.activeMatchId === localId) this.setActiveMatchId(null);
    }
    if (kind === "tournament") delete this.tournaments[localId];
    if (kind === "fixture") delete this.fixtures[localId];
    this.persist(STORAGE_KEY_PLAYERS, this.players);
    this.persist(STORAGE_KEY_TEAMS, this.teams);
    this.persist(STORAGE_KEY_MATCHES, this.matches);
    this.persist(STORAGE_KEY_TOURNAMENTS, this.tournaments);
    this.persist(STORAGE_KEY_FIXTURES, this.fixtures);
  }

  /** One re-render after a batch of cloud rows was applied. */
  public notifyDataChanged() {
    this.notify();
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
  public exportAllToJson(): string {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      appName: "GullyScore",
      exportedAt: new Date().toISOString(),
      credit: "Designed & developed by Omkar Kardile (https://omkardile.is-a.dev/)",
      players: this.players,
      teams: this.teams,
      matches: this.matches,
      tournaments: this.tournaments,
      fixtures: this.fixtures,
      settings: this.settings,
    };
    return JSON.stringify(payload, null, 2);
  }

  public importAllFromJson(jsonStr: string): { success: boolean; message: string } {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed.players || !parsed.teams) {
        return { success: false, message: "Invalid backup file format." };
      }

      this.players = { ...this.players, ...parsed.players };
      this.teams = { ...this.teams, ...parsed.teams };
      if (parsed.matches) this.matches = { ...this.matches, ...parsed.matches };
      if (parsed.tournaments) this.tournaments = { ...this.tournaments, ...parsed.tournaments };
      if (parsed.fixtures) this.fixtures = { ...this.fixtures, ...parsed.fixtures };
      if (parsed.settings) this.settings = { ...this.settings, ...parsed.settings };

      this.persist(STORAGE_KEY_PLAYERS, this.players);
      this.persist(STORAGE_KEY_TEAMS, this.teams);
      this.persist(STORAGE_KEY_MATCHES, this.matches);
      this.persist(STORAGE_KEY_TOURNAMENTS, this.tournaments);
      this.persist(STORAGE_KEY_FIXTURES, this.fixtures);
      this.persist(STORAGE_KEY_SETTINGS, this.settings);

      this.notify();
      return { success: true, message: "Backup data successfully restored and merged!" };
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
