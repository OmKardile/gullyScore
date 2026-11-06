/**
 * GullyScore Dynamic Tournament Points Table Visualization (RN port)
 *
 * Accurately calculates standings based on tournament match results:
 * - Official ICC Net Run Rate (NRR) with all-out quota normalization
 * - Qualification zone indicators (Top 2 Finals)
 * - Form guide (last 5 matches: W, L, T, NR)
 * - Interactive expandable rows with match logs and NRR equation breakdown
 * - Visual standings bar chart with NRR differential (recharts → react-native-svg)
 * - Head-to-head cross-matrix visualization
 */

import React, { useState, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Svg, {
  Circle,
  Line,
  Path,
  Polyline,
  Text as SvgText,
} from "react-native-svg";
import { Tournament, Match, Fixture, Team, InningsScorecard } from "../../types/cricket";
import { db } from "../../storage/db";
import { replayInnings } from "../../engine/scoringEngine";
// RN: unused web lucide imports (Shield, Sparkles, BarChart2, Table, Grid,
// CheckCircle2, Layers) dropped; used glyphs kept from lucide-react-native
import {
  Trophy,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Calendar,
  Clock,
} from "lucide-react-native";
// RN: web imported GullyButton but never used it — dropped
import { GullySegmented, GullyChip } from "../common/Components";
import { useTheme, FONTS } from "../../design/theme";

interface TournamentPointsTableVisualizationProps {
  tournament: Tournament;
  onOpenMatchDetail?: (matchId: string) => void;
  onOpenMatchSetup?: (params: {
    tournamentId: string;
    fixtureId: string;
    teamAId: string;
    teamBId: string;
  }) => void;
}

export interface EnrichedPointsTableRow {
  rank: number;
  teamId: string;
  team: Team;
  played: number;
  won: number;
  lost: number;
  tied: number;
  noResult: number;
  points: number;
  nrr: number;
  nrrFormatted: string;
  runsScored: number;
  oversFacedFraction: number;
  oversFacedFormatted: string;
  runsConceded: number;
  oversBowledFraction: number;
  oversBowledFormatted: string;
  teamRunRate: number;
  opponentRunRate: number;
  form: ("W" | "L" | "T" | "NR")[];
  remainingFixturesCount: number;
  maxPoints: number;
  isQualified: boolean;
  isInContention: boolean;
  isEliminated: boolean;
  tournamentMatches: Array<{
    matchId: string;
    date: string;
    opponentTeamId: string;
    opponentName: string;
    opponentShort: string;
    opponentColor: string;
    result: "W" | "L" | "T" | "NR";
    marginText: string;
    teamScore: string;
    opponentScore: string;
  }>;
  upcomingFixtures: Fixture[];
}

// --- RN: recharts ComposedChart rebuilt with react-native-svg ---
// Web h-64 (256px) chart area
const CHART_HEIGHT = 256;
// recharts margin {top:20, right:20, bottom:20, left:-10} + default YAxis widths
const PLOT_LEFT = 40;
const PLOT_TOP = 20;
const PLOT_RIGHT = 44;
const PLOT_BOTTOM = 26;

// RN: recharts YAxis domain={[0, "auto"]} — "nice" integer steps covering max points
function niceLeftTicks(maxValue: number): number[] {
  const max = Math.max(maxValue, 2);
  const step = Math.max(1, Math.ceil(max / 4));
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) {
    ticks.push(v);
  }
  if (ticks[ticks.length - 1] < max) {
    ticks.push(ticks[ticks.length - 1] + step);
  }
  return ticks;
}

// RN: recharts Bar radius={[4, 4, 0, 0]} — bar rect with rounded top corners
function roundedTopBarPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + rr}`,
    `Q ${x} ${y} ${x + rr} ${y}`,
    `L ${x + w - rr} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + rr}`,
    `L ${x + w} ${y + h}`,
    "Z",
  ].join(" ");
}

// RN: web <table> → View rows; fixed mini column widths fit narrow screens
const COL_STAT = 18; // P / W / L / T
const COL_PTS = 26;
const COL_NRR = 44;
const COL_FORM = 70;
const COL_CHEV = 16;
const FORM_CHIP = 13;

export const TournamentPointsTableVisualization: React.FC<
  TournamentPointsTableVisualizationProps
> = ({ tournament, onOpenMatchDetail, onOpenMatchSetup }) => {
  const { colors } = useTheme();
  const [viewMode, setViewMode] = useState<"table" | "chart" | "matrix">("table");
  const [sortField, setSortField] = useState<"rank" | "points" | "nrr" | "won" | "runs">("rank");
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  // RN: measure available width (recharts ResponsiveContainer)
  const [chartWidth, setChartWidth] = useState(0);
  // RN: tap-to-inspect replaces the recharts hover tooltip
  const [selectedChartIndex, setSelectedChartIndex] = useState<number | null>(null);

  const allMatches = db.getMatches();
  const allFixtures = db.getFixtures(tournament.id);
  const teamsMap = db.getTeamsMap();
  const playersMap = db.getPlayersMap();

  // Dynamically compute tournament standings based on completed matches
  const { standings, leaderTeam, highestNrrTeam, completedCount, totalFixturesCount } = useMemo(() => {
    const tournamentMatches = allMatches.filter((m) => m.tournamentId === tournament.id);
    const completedMatches = tournamentMatches.filter((m) => m.status === "completed");

    // Initialize map for each participating team
    const teamStats: Record<
      string,
      {
        teamId: string;
        played: number;
        won: number;
        lost: number;
        tied: number;
        noResult: number;
        points: number;
        runsScored: number;
        oversFacedFraction: number;
        runsConceded: number;
        oversBowledFraction: number;
        form: ("W" | "L" | "T" | "NR")[];
        tournamentMatches: EnrichedPointsTableRow["tournamentMatches"];
      }
    > = {};

    tournament.teamIds.forEach((tId) => {
      teamStats[tId] = {
        teamId: tId,
        played: 0,
        won: 0,
        lost: 0,
        tied: 0,
        noResult: 0,
        points: 0,
        runsScored: 0,
        oversFacedFraction: 0,
        runsConceded: 0,
        oversBowledFraction: 0,
        form: [],
        tournamentMatches: [],
      };
    });

    // Replay each completed match to derive runs, overs, and NRR
    completedMatches.forEach((m) => {
      if (!m.innings || m.innings.length < 2) return;

      const inn1 = m.innings[0];
      const inn2 = m.innings[1];
      const sc1 = replayInnings(inn1.ballEvents, m.rules, [], [], playersMap);
      const sc2 = replayInnings(inn2.ballEvents, m.rules, [], [], playersMap, sc1.totalRuns + 1);

      const team1Id = inn1.battingTeamId;
      const team2Id = inn2.battingTeamId;

      if (!teamStats[team1Id] || !teamStats[team2Id]) return;

      teamStats[team1Id].played++;
      teamStats[team2Id].played++;

      // Result
      let t1Result: "W" | "L" | "T" | "NR" = "NR";
      let t2Result: "W" | "L" | "T" | "NR" = "NR";

      if (m.winnerTeamId === team1Id) {
        teamStats[team1Id].won++;
        teamStats[team1Id].points += tournament.winPoints;
        teamStats[team2Id].lost++;
        t1Result = "W";
        t2Result = "L";
      } else if (m.winnerTeamId === team2Id) {
        teamStats[team2Id].won++;
        teamStats[team2Id].points += tournament.winPoints;
        teamStats[team1Id].lost++;
        t1Result = "L";
        t2Result = "W";
      } else if (sc1.totalRuns === sc2.totalRuns) {
        teamStats[team1Id].tied++;
        teamStats[team2Id].tied++;
        teamStats[team1Id].points += tournament.tiePoints;
        teamStats[team2Id].points += tournament.tiePoints;
        t1Result = "T";
        t2Result = "T";
      } else {
        teamStats[team1Id].noResult++;
        teamStats[team2Id].noResult++;
        teamStats[team1Id].points += tournament.nrPoints;
        teamStats[team2Id].points += tournament.nrPoints;
      }

      teamStats[team1Id].form.push(t1Result);
      teamStats[team2Id].form.push(t2Result);

      // ICC Net Run Rate (all-out counts as full overs quota)
      const t1OversFaced =
        sc1.completionReason === "all_out"
          ? m.rules.overs
          : sc1.legalBallsCount / 6;

      const t2OversFaced =
        sc2.completionReason === "all_out"
          ? m.rules.overs
          : sc2.legalBallsCount / 6;

      teamStats[team1Id].runsScored += sc1.totalRuns;
      teamStats[team1Id].oversFacedFraction += t1OversFaced;
      teamStats[team1Id].runsConceded += sc2.totalRuns;
      teamStats[team1Id].oversBowledFraction += t2OversFaced;

      teamStats[team2Id].runsScored += sc2.totalRuns;
      teamStats[team2Id].oversFacedFraction += t2OversFaced;
      teamStats[team2Id].runsConceded += sc1.totalRuns;
      teamStats[team2Id].oversBowledFraction += t1OversFaced;

      const t1Name = teamsMap[team1Id]?.name || "Team A";
      const t2Name = teamsMap[team2Id]?.name || "Team B";

      teamStats[team1Id].tournamentMatches.push({
        matchId: m.id,
        date: m.date || new Date(m.updatedAt).toLocaleDateString(),
        opponentTeamId: team2Id,
        opponentName: t2Name,
        opponentShort: teamsMap[team2Id]?.shortName || "T2",
        opponentColor: teamsMap[team2Id]?.color || "#5B5F66",
        result: t1Result,
        marginText: m.resultText || "",
        teamScore: `${sc1.totalRuns}/${sc1.totalWickets} (${sc1.oversFormatted} ov)`,
        opponentScore: `${sc2.totalRuns}/${sc2.totalWickets} (${sc2.oversFormatted} ov)`,
      });

      teamStats[team2Id].tournamentMatches.push({
        matchId: m.id,
        date: m.date || new Date(m.updatedAt).toLocaleDateString(),
        opponentTeamId: team1Id,
        opponentName: t1Name,
        opponentShort: teamsMap[team1Id]?.shortName || "T1",
        opponentColor: teamsMap[team1Id]?.color || "#5B5F66",
        result: t2Result,
        marginText: m.resultText || "",
        teamScore: `${sc2.totalRuns}/${sc2.totalWickets} (${sc2.oversFormatted} ov)`,
        opponentScore: `${sc1.totalRuns}/${sc1.totalWickets} (${sc1.oversFormatted} ov)`,
      });
    });

    // Compute NRR and standings
    const enrichedList: EnrichedPointsTableRow[] = Object.values(teamStats).map((st) => {
      const team = teamsMap[st.teamId] || {
        id: st.teamId,
        name: "Team",
        shortName: "TM",
        color: "#5B5F66",
        monogram: "TM",
        playerIds: [],
        createdAt: 0,
      };

      const teamRunRate =
        st.oversFacedFraction > 0 ? st.runsScored / st.oversFacedFraction : 0;
      const opponentRunRate =
        st.oversBowledFraction > 0 ? st.runsConceded / st.oversBowledFraction : 0;
      const nrr = Number((teamRunRate - opponentRunRate).toFixed(3));
      const nrrFormatted = nrr > 0 ? `+${nrr.toFixed(3)}` : nrr.toFixed(3);

      const pendingFixtures = allFixtures.filter(
        (f) =>
          f.status === "pending" &&
          (f.teamAId === st.teamId || f.teamBId === st.teamId)
      );
      const remainingFixturesCount = pendingFixtures.length;
      const maxPoints = st.points + remainingFixturesCount * tournament.winPoints;

      const oversFacedBalls = Math.round(st.oversFacedFraction * 6);
      const oversFacedFormatted = `${Math.floor(oversFacedBalls / 6)}.${oversFacedBalls % 6}`;
      const oversBowledBalls = Math.round(st.oversBowledFraction * 6);
      const oversBowledFormatted = `${Math.floor(oversBowledBalls / 6)}.${oversBowledBalls % 6}`;

      return {
        rank: 1,
        teamId: st.teamId,
        team,
        played: st.played,
        won: st.won,
        lost: st.lost,
        tied: st.tied,
        noResult: st.noResult,
        points: st.points,
        nrr,
        nrrFormatted,
        runsScored: st.runsScored,
        oversFacedFraction: st.oversFacedFraction,
        oversFacedFormatted,
        runsConceded: st.runsConceded,
        oversBowledFraction: st.oversBowledFraction,
        oversBowledFormatted,
        teamRunRate: Number(teamRunRate.toFixed(2)),
        opponentRunRate: Number(opponentRunRate.toFixed(2)),
        form: st.form.slice(0, 5).reverse(), // 5 most recent, oldest→newest
        remainingFixturesCount,
        maxPoints,
        isQualified: false,
        isInContention: true,
        isEliminated: false,
        tournamentMatches: st.tournamentMatches.reverse(),
        upcomingFixtures: pendingFixtures,
      };
    });

    // Official Sorting: Points desc -> NRR desc -> Wins desc -> Runs scored desc
    enrichedList.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.nrr !== a.nrr) return b.nrr - a.nrr;
      if (b.won !== a.won) return b.won - a.won;
      return b.runsScored - a.runsScored;
    });

    // Assign rank and qualification status
    const secondPlacePoints = enrichedList[1]?.points || 0;
    const thirdPlaceMaxPoints = enrichedList[2]?.maxPoints || 0;

    enrichedList.forEach((row, idx) => {
      row.rank = idx + 1;
      // Clinched if current points exceed 3rd place's max attainable points
      if (idx < 2 && row.points > thirdPlaceMaxPoints && enrichedList.length > 2) {
        row.isQualified = true;
      }
      // Eliminated if max attainable points is less than 2nd place current points
      if (idx >= 2 && row.maxPoints < secondPlacePoints) {
        row.isEliminated = true;
        row.isInContention = false;
      }
    });

    const leader = enrichedList[0] || null;
    let bestNrr = enrichedList[0] || null;
    enrichedList.forEach((r) => {
      if (r.nrr > (bestNrr?.nrr || -999)) {
        bestNrr = r;
      }
    });

    return {
      standings: enrichedList,
      leaderTeam: leader,
      highestNrrTeam: bestNrr,
      completedCount: completedMatches.length,
      totalFixturesCount: allFixtures.length,
    };
  }, [tournament, allMatches, allFixtures, teamsMap, playersMap]);

  // Handle dynamic table sorting
  const sortedStandings = useMemo(() => {
    const list = [...standings];
    if (sortField === "points") {
      return list.sort((a, b) => b.points - a.points || b.nrr - a.nrr);
    }
    if (sortField === "nrr") {
      return list.sort((a, b) => b.nrr - a.nrr);
    }
    if (sortField === "won") {
      return list.sort((a, b) => b.won - a.won || b.points - a.points);
    }
    if (sortField === "runs") {
      return list.sort((a, b) => b.runsScored - a.runsScored);
    }
    return list; // default rank
  }, [standings, sortField]);

  // Chart data formatting (was for Recharts)
  const chartData = useMemo(() => {
    return standings.map((s) => ({
      name: s.team.shortName,
      fullName: s.team.name,
      points: s.points,
      nrr: s.nrr,
      color: s.team.color,
      played: s.played,
      won: s.won,
    }));
  }, [standings]);

  // RN: recharts YAxis scales, computed for the SVG chart
  const leftTicks = useMemo(() => {
    const maxPts = chartData.reduce((m, d) => Math.max(m, d.points), 0);
    return niceLeftTicks(maxPts);
  }, [chartData]);
  // NRR right axis: data-derived symmetric domain. The old hard-coded
  // [-4, 4] silently clipped any |NRR| > 4 — common in gully cricket (bowl a
  // side out for 10 in 8 overs and your NRR is +8.75) — so those teams' dots
  // vanished from the chart while the table showed them.
  const rightTicks = useMemo(() => {
    const maxAbs = chartData.reduce((m, d) => Math.max(m, Math.abs(d.nrr)), 0);
    const bound = Math.max(2, Math.ceil(maxAbs * 2) / 2);
    return [-bound, -bound / 2, 0, bound / 2, bound].map((v) => Number(v.toFixed(2)));
  }, [chartData]);
  const tooltipDatum =
    selectedChartIndex !== null && chartData[selectedChartIndex]
      ? chartData[selectedChartIndex]
      : null;

  return (
    <View style={{ flexDirection: "column", gap: 16 }}>
      {/* --- STANDINGS SUMMARY CARDS --- */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View
          style={{
            flex: 1,
            padding: 12,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: 10,
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Trophy size={12} color={colors.accent} />
            <Text
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                fontWeight: "600",
                color: colors.ink2,
                letterSpacing: 1,
                fontFamily: FONTS.sans,
              }}
            >
              Table Leader
            </Text>
          </View>
          <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: leaderTeam?.team.color || colors.accent,
              }}
            />
            <Text
              numberOfLines={1}
              style={{
                fontFamily: FONTS.serif,
                fontWeight: "700",
                fontSize: 14,
                color: colors.ink,
              }}
            >
              {leaderTeam?.team.name || "—"}
            </Text>
          </View>
          <Text
            style={{
              fontSize: 11,
              color: colors.ink2,
              marginTop: 2,
              fontVariant: ["tabular-nums"],
              fontFamily: FONTS.sans,
            }}
          >
            {leaderTeam?.points || 0} pts · NRR {leaderTeam?.nrrFormatted || "0.000"}
          </Text>
        </View>

        <View
          style={{
            flex: 1,
            padding: 12,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: 10,
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <TrendingUp size={12} color={colors.accent} />
            <Text
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                fontWeight: "600",
                color: colors.ink2,
                letterSpacing: 1,
                fontFamily: FONTS.sans,
              }}
            >
              Top Run Rate
            </Text>
          </View>
          <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: highestNrrTeam?.team.color || colors.accent,
              }}
            />
            <Text
              numberOfLines={1}
              style={{
                fontFamily: FONTS.serif,
                fontWeight: "700",
                fontSize: 14,
                color: colors.ink,
              }}
            >
              {highestNrrTeam?.team.shortName || "—"}
            </Text>
          </View>
          <Text
            style={{
              fontSize: 11,
              fontWeight: "700",
              color: colors.accent,
              marginTop: 2,
              fontVariant: ["tabular-nums"],
              fontFamily: FONTS.sans,
            }}
          >
            NRR {highestNrrTeam?.nrrFormatted || "0.000"}
          </Text>
        </View>

        <View
          style={{
            flex: 1,
            padding: 12,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: 10,
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Calendar size={12} color={colors.ink2} />
            <Text
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                fontWeight: "600",
                color: colors.ink2,
                letterSpacing: 1,
                fontFamily: FONTS.sans,
              }}
            >
              Progress
            </Text>
          </View>
          <View style={{ marginTop: 6, flexDirection: "row", alignItems: "baseline", gap: 4 }}>
            <Text
              style={{
                fontFamily: FONTS.serif,
                fontWeight: "700",
                fontSize: 16,
                color: colors.ink,
                fontVariant: ["tabular-nums"],
              }}
            >
              {completedCount}
            </Text>
            <Text
              style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans }}
            >
              / {totalFixturesCount} matches
            </Text>
          </View>
          <Text
            style={{
              fontSize: 11,
              color: colors.ink2,
              marginTop: 2,
              fontVariant: ["tabular-nums"],
              fontFamily: FONTS.sans,
            }}
          >
            {Math.max(0, totalFixturesCount - completedCount)} remaining
          </Text>
        </View>
      </View>

      {/* --- VIEW MODE SWITCHER & SORT FILTER --- */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <GullySegmented
          options={[
            { label: "Standings Table", value: "table" },
            { label: "Points Chart", value: "chart" },
            { label: "H2H Matrix", value: "matrix" },
          ]}
          value={viewMode}
          onChange={(v) => setViewMode(v)}
        />

        {viewMode === "table" && (
          // RN: web <select> sort picker → horizontal chip scroller
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Text
              style={{ fontSize: 11, color: colors.ink2, fontFamily: FONTS.sans }}
            >
              Sort:
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerStyle={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              }}
            >
              {(
                [
                  { value: "rank", label: "Official Rank (Pts & NRR)" },
                  { value: "points", label: "Points Only" },
                  { value: "nrr", label: "Net Run Rate (NRR)" },
                  { value: "won", label: "Most Wins" },
                  { value: "runs", label: "Most Runs Scored" },
                ] as const
              ).map((opt) => (
                <GullyChip
                  key={opt.value}
                  label={opt.label}
                  active={sortField === opt.value}
                  onPress={() => setSortField(opt.value)}
                />
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {/* ========================================================= */}
      {/* VIEW 1: DYNAMIC STANDINGS TABLE WITH DRILLDOWNS          */}
      {/* ========================================================= */}
      {viewMode === "table" && (
        <View style={{ flexDirection: "column", gap: 8 }}>
          {/* Table Container */}
          <View
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {/* RN: web <table> → View rows */}
            <View>
              {/* Header Row */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  borderBottomWidth: 1,
                  borderBottomColor: colors.hairline,
                  backgroundColor: colors.surfaceCard,
                  paddingVertical: 10,
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    paddingLeft: 12,
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    color: colors.ink2,
                    fontWeight: "600",
                    fontFamily: FONTS.sans,
                  }}
                >
                  Team
                </Text>
                <Text
                  style={{
                    width: COL_STAT,
                    textAlign: "center",
                    fontSize: 10,
                    color: colors.ink2,
                    fontWeight: "600",
                    fontFamily: FONTS.sans,
                  }}
                >
                  P
                </Text>
                <Text
                  style={{
                    width: COL_STAT,
                    textAlign: "center",
                    fontSize: 10,
                    color: colors.ink2,
                    fontWeight: "600",
                    fontFamily: FONTS.sans,
                  }}
                >
                  W
                </Text>
                <Text
                  style={{
                    width: COL_STAT,
                    textAlign: "center",
                    fontSize: 10,
                    color: colors.ink2,
                    fontWeight: "600",
                    fontFamily: FONTS.sans,
                  }}
                >
                  L
                </Text>
                <Text
                  style={{
                    width: COL_STAT,
                    textAlign: "center",
                    fontSize: 10,
                    color: colors.ink2,
                    fontWeight: "600",
                    fontFamily: FONTS.sans,
                  }}
                >
                  T
                </Text>
                <Text
                  style={{
                    width: COL_PTS,
                    textAlign: "center",
                    fontSize: 10,
                    color: colors.ink,
                    fontWeight: "700",
                    fontFamily: FONTS.sans,
                  }}
                >
                  PTS
                </Text>
                <Text
                  style={{
                    width: COL_NRR,
                    textAlign: "right",
                    paddingRight: 4,
                    fontSize: 10,
                    color: colors.ink2,
                    fontWeight: "600",
                    fontFamily: FONTS.sans,
                  }}
                >
                  NRR
                </Text>
                <Text
                  style={{
                    width: COL_FORM,
                    textAlign: "center",
                    fontSize: 10,
                    color: colors.ink2,
                    fontWeight: "600",
                    fontFamily: FONTS.sans,
                  }}
                >
                  Form
                </Text>
                <View style={{ width: COL_CHEV }} />
              </View>

              {/* Body Rows */}
              {sortedStandings.map((row) => {
                const isExpanded = expandedTeamId === row.teamId;
                const isTopTwo = row.rank <= 2;

                return (
                  <React.Fragment key={row.teamId}>
                    <Pressable
                      onPress={() =>
                        setExpandedTeamId(isExpanded ? null : row.teamId)
                      }
                      style={({ pressed }) => [
                        {
                          flexDirection: "row",
                          alignItems: "center",
                          paddingVertical: 10,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.hairline,
                          opacity: pressed ? 0.9 : 1,
                          backgroundColor: isExpanded
                            ? colors.surfaceCard
                            : "transparent",
                        },
                      ]}
                    >
                      {/* Team Name & Monogram */}
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 5,
                          flex: 1,
                          paddingLeft: 12,
                          minWidth: 0,
                        }}
                      >
                        {/* Qualification indicator stripe */}
                        <View
                          style={{
                            width: 3,
                            height: 26,
                            borderRadius: 2,
                            backgroundColor: isTopTwo
                              ? colors.accent
                              : "transparent",
                          }}
                        />

                        <View
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 4,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: row.team.color,
                          }}
                        >
                          <Text
                            style={{
                              fontFamily: FONTS.serif,
                              fontWeight: "700",
                              color: "#FFFFFF",
                              fontSize: 9,
                            }}
                          >
                            {row.team.shortName.slice(0, 3)}
                          </Text>
                        </View>

                        <View style={{ flex: 1, minWidth: 0 }}>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 5,
                            }}
                          >
                            <Text
                              numberOfLines={1}
                              style={{
                                fontWeight: "600",
                                fontSize: 13,
                                color: colors.ink,
                                fontFamily: FONTS.sans,
                              }}
                            >
                              {row.rank}. {row.team.shortName}
                            </Text>
                            {row.isQualified && (
                              <Text
                                style={{
                                  fontSize: 9,
                                  fontWeight: "700",
                                  paddingHorizontal: 4,
                                  borderRadius: 2,
                                  overflow: "hidden",
                                  backgroundColor: colors.accent,
                                  color: "#FFFFFF",
                                  textTransform: "uppercase",
                                  fontFamily: FONTS.sans,
                                }}
                              >
                                Q
                              </Text>
                            )}
                          </View>
                          <Text
                            numberOfLines={1}
                            style={{
                              fontSize: 10,
                              color: colors.ink2,
                              fontFamily: FONTS.sans,
                            }}
                          >
                            {row.team.name}
                          </Text>
                        </View>
                      </View>

                      <Text
                        style={{
                          width: COL_STAT,
                          textAlign: "center",
                          fontSize: 11,
                          color: colors.ink,
                          fontVariant: ["tabular-nums"],
                          fontFamily: FONTS.sans,
                        }}
                      >
                        {row.played}
                      </Text>
                      <Text
                        style={{
                          width: COL_STAT,
                          textAlign: "center",
                          fontSize: 11,
                          fontWeight: "600",
                          color: colors.ink,
                          fontVariant: ["tabular-nums"],
                          fontFamily: FONTS.sans,
                        }}
                      >
                        {row.won}
                      </Text>
                      <Text
                        style={{
                          width: COL_STAT,
                          textAlign: "center",
                          fontSize: 11,
                          color: colors.ink2,
                          fontVariant: ["tabular-nums"],
                          fontFamily: FONTS.sans,
                        }}
                      >
                        {row.lost}
                      </Text>
                      <Text
                        style={{
                          width: COL_STAT,
                          textAlign: "center",
                          fontSize: 11,
                          color: colors.ink2,
                          fontVariant: ["tabular-nums"],
                          fontFamily: FONTS.sans,
                        }}
                      >
                        {row.tied}
                      </Text>

                      {/* PTS */}
                      <Text
                        style={{
                          width: COL_PTS,
                          textAlign: "center",
                          fontWeight: "700",
                          fontFamily: FONTS.serif,
                          fontSize: 13,
                          color: colors.ink,
                          fontVariant: ["tabular-nums"],
                        }}
                      >
                        {row.points}
                      </Text>

                      {/* NRR */}
                      <Text
                        style={{
                          width: COL_NRR,
                          textAlign: "right",
                          paddingRight: 4,
                          fontSize: 10,
                          fontWeight: "500",
                          color:
                            row.nrr > 0
                              ? colors.ink
                              : row.nrr < 0
                              ? colors.ink2
                              : colors.ink2,
                          fontVariant: ["tabular-nums"],
                          fontFamily: FONTS.sans,
                        }}
                      >
                        {row.nrrFormatted}
                      </Text>

                      {/* Form Chips (Last 5) */}
                      <View
                        style={{
                          width: COL_FORM,
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 1,
                        }}
                      >
                        {row.form.length === 0 ? (
                          <Text
                            style={{
                              fontSize: 10,
                              color: colors.ink2,
                              fontFamily: FONTS.sans,
                            }}
                          >
                            —
                          </Text>
                        ) : (
                          row.form.map((res, i) => (
                            <View
                              key={i}
                              style={{
                                width: FORM_CHIP,
                                height: FORM_CHIP,
                                borderRadius: FORM_CHIP / 2,
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor:
                                  res === "W"
                                    ? colors.success
                                    : res === "L"
                                    ? colors.hairlineStrong
                                    : colors.accent,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 9,
                                  fontWeight: "700",
                                  color:
                                    res === "L" ? colors.ink2 : "#FFFFFF",
                                  fontFamily: FONTS.sans,
                                }}
                              >
                                {res}
                              </Text>
                            </View>
                          ))
                        )}
                      </View>

                      {/* Expand trigger chevron */}
                      <View
                        style={{
                          width: COL_CHEV,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {isExpanded ? (
                          <ChevronUp size={14} color={colors.ink2} />
                        ) : (
                          <ChevronDown size={14} color={colors.ink2} />
                        )}
                      </View>
                    </Pressable>

                    {/* --- INLINE EXPANDED ROW DRILLDOWN --- */}
                    {isExpanded && (
                      <View
                        style={{
                          padding: 12,
                          backgroundColor: colors.surfaceCard,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.hairline,
                        }}
                      >
                        <View style={{ flexDirection: "column", gap: 12 }}>
                          {/* NRR Equation Breakdown */}
                          <View
                            style={{
                              padding: 12,
                              backgroundColor: colors.surface,
                              borderWidth: 1,
                              borderColor: colors.hairline,
                              borderRadius: 8,
                              flexDirection: "column",
                              gap: 6,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 10,
                                textTransform: "uppercase",
                                fontWeight: "600",
                                color: colors.ink2,
                                letterSpacing: 1,
                                fontFamily: FONTS.sans,
                              }}
                            >
                              Official ICC Net Run Rate Breakdown
                            </Text>

                            {/* RN: web grid-cols-3 → three equal cells */}
                            <View
                              style={{
                                flexDirection: "row",
                                gap: 8,
                                paddingTop: 4,
                              }}
                            >
                              <View
                                style={{
                                  flex: 1,
                                  padding: 6,
                                  backgroundColor: colors.surfaceCard,
                                  borderRadius: 6,
                                  alignItems: "center",
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: colors.ink2,
                                    fontFamily: FONTS.sans,
                                  }}
                                >
                                  Runs For / Overs
                                </Text>
                                <Text
                                  style={{
                                    fontWeight: "600",
                                    color: colors.ink,
                                    fontSize: 12,
                                    fontVariant: ["tabular-nums"],
                                    fontFamily: FONTS.sans,
                                  }}
                                >
                                  {row.runsScored} / {row.oversFacedFormatted}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: colors.ink2,
                                    fontFamily: FONTS.sans,
                                    fontVariant: ["tabular-nums"],
                                  }}
                                >
                                  RR: {row.teamRunRate}
                                </Text>
                              </View>

                              <View
                                style={{
                                  flex: 1,
                                  padding: 6,
                                  backgroundColor: colors.surfaceCard,
                                  borderRadius: 6,
                                  alignItems: "center",
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: colors.ink2,
                                    fontFamily: FONTS.sans,
                                  }}
                                >
                                  Against / Overs
                                </Text>
                                <Text
                                  style={{
                                    fontWeight: "600",
                                    color: colors.ink,
                                    fontSize: 12,
                                    fontVariant: ["tabular-nums"],
                                    fontFamily: FONTS.sans,
                                  }}
                                >
                                  {row.runsConceded} / {row.oversBowledFormatted}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: colors.ink2,
                                    fontFamily: FONTS.sans,
                                    fontVariant: ["tabular-nums"],
                                  }}
                                >
                                  RR: {row.opponentRunRate}
                                </Text>
                              </View>

                              <View
                                style={{
                                  flex: 1,
                                  padding: 6,
                                  backgroundColor: colors.surfaceCard,
                                  borderRadius: 6,
                                  borderWidth: 1,
                                  borderColor: colors.accentSubtle,
                                  alignItems: "center",
                                }}
                              >
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: colors.accent,
                                    fontWeight: "600",
                                    fontFamily: FONTS.sans,
                                  }}
                                >
                                  Net Run Rate
                                </Text>
                                <Text
                                  style={{
                                    fontWeight: "700",
                                    fontFamily: FONTS.serif,
                                    fontSize: 14,
                                    color: colors.ink,
                                    fontVariant: ["tabular-nums"],
                                  }}
                                >
                                  {row.nrrFormatted}
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 9,
                                    color: colors.ink2,
                                    fontFamily: FONTS.sans,
                                    fontVariant: ["tabular-nums"],
                                  }}
                                >
                                  {row.teamRunRate} - {row.opponentRunRate}
                                </Text>
                              </View>
                            </View>

                            <Text
                              style={{
                                fontSize: 10,
                                color: colors.ink2,
                                fontStyle: "italic",
                                fontFamily: FONTS.sans,
                              }}
                            >
                              *Note: Under standard ICC rules, teams dismissed
                              all-out are assigned their full quota of{" "}
                              {tournament.rules.overs}.0 overs.
                            </Text>
                          </View>

                          {/* Tournament Match Results */}
                          <View>
                            <Text
                              style={{
                                fontSize: 11,
                                textTransform: "uppercase",
                                fontWeight: "600",
                                color: colors.ink2,
                                letterSpacing: 1,
                                marginBottom: 6,
                                fontFamily: FONTS.sans,
                              }}
                            >
                              Tournament Results ({row.tournamentMatches.length})
                            </Text>

                            {row.tournamentMatches.length === 0 ? (
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: colors.ink2,
                                  fontStyle: "italic",
                                  fontFamily: FONTS.sans,
                                }}
                              >
                                No tournament matches played yet.
                              </Text>
                            ) : (
                              <View style={{ flexDirection: "column", gap: 6 }}>
                                {row.tournamentMatches.map((tm) => (
                                  <Pressable
                                    key={tm.matchId}
                                    onPress={() => onOpenMatchDetail?.(tm.matchId)}
                                    style={({ pressed }) => ({
                                      padding: 8,
                                      backgroundColor: colors.surface,
                                      borderWidth: 1,
                                      borderColor: pressed
                                        ? colors.ink
                                        : colors.hairline,
                                      borderRadius: 6,
                                      flexDirection: "row",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      opacity: pressed ? 0.85 : 1,
                                    })}
                                  >
                                    <View
                                      style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 8,
                                        flex: 1,
                                        paddingRight: 8,
                                      }}
                                    >
                                      <View
                                        style={{
                                          width: 20,
                                          height: 20,
                                          borderRadius: 10,
                                          alignItems: "center",
                                          justifyContent: "center",
                                          backgroundColor:
                                            tm.result === "W"
                                              ? colors.success
                                              : tm.result === "L"
                                              ? colors.hairlineStrong
                                              : colors.accent,
                                        }}
                                      >
                                        <Text
                                          style={{
                                            fontWeight: "700",
                                            fontSize: 10,
                                            color:
                                              tm.result === "L"
                                                ? colors.ink2
                                                : "#FFFFFF",
                                            fontFamily: FONTS.sans,
                                          }}
                                        >
                                          {tm.result}
                                        </Text>
                                      </View>
                                      <View style={{ flex: 1, minWidth: 0 }}>
                                        <Text
                                          numberOfLines={1}
                                          style={{
                                            fontWeight: "600",
                                            color: colors.ink,
                                            fontSize: 12,
                                            fontFamily: FONTS.sans,
                                          }}
                                        >
                                          vs {tm.opponentName}
                                        </Text>
                                        <Text
                                          numberOfLines={1}
                                          style={{
                                            fontSize: 10,
                                            color: colors.ink2,
                                            fontFamily: FONTS.sans,
                                          }}
                                        >
                                          {tm.date} · {tm.marginText}
                                        </Text>
                                      </View>
                                    </View>

                                    {/* Web: text-right tnum block */}
                                    <View style={{ alignItems: "flex-end" }}>
                                      <Text
                                        style={{
                                          fontFamily: FONTS.serif,
                                          fontWeight: "700",
                                          color: colors.ink,
                                          fontSize: 12,
                                          fontVariant: ["tabular-nums"],
                                        }}
                                      >
                                        {tm.teamScore}
                                      </Text>
                                      <Text
                                        style={{
                                          fontSize: 10,
                                          color: colors.ink2,
                                          fontVariant: ["tabular-nums"],
                                          fontFamily: FONTS.sans,
                                        }}
                                      >
                                        Opp: {tm.opponentScore}
                                      </Text>
                                    </View>
                                  </Pressable>
                                ))}
                              </View>
                            )}
                          </View>

                          {/* Upcoming Fixtures for this team */}
                          {row.upcomingFixtures.length > 0 && (
                            <View>
                              <Text
                                style={{
                                  fontSize: 11,
                                  textTransform: "uppercase",
                                  fontWeight: "600",
                                  color: colors.ink2,
                                  letterSpacing: 1,
                                  marginBottom: 6,
                                  fontFamily: FONTS.sans,
                                }}
                              >
                                Next Scheduled Match
                              </Text>
                              {row.upcomingFixtures.slice(0, 1).map((fix) => {
                                const oppId =
                                  fix.teamAId === row.teamId ? fix.teamBId : fix.teamAId;
                                const oppTeam = teamsMap[oppId];
                                return (
                                  <Pressable
                                    key={fix.id}
                                    onPress={() =>
                                      onOpenMatchSetup?.({
                                        tournamentId: tournament.id,
                                        fixtureId: fix.id,
                                        teamAId: fix.teamAId,
                                        teamBId: fix.teamBId,
                                      })
                                    }
                                    style={({ pressed }) => ({
                                      padding: 8,
                                      backgroundColor: colors.surface,
                                      borderWidth: 1,
                                      borderColor: pressed
                                        ? colors.accent
                                        : colors.hairline,
                                      borderRadius: 6,
                                      flexDirection: "row",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      opacity: pressed ? 0.85 : 1,
                                    })}
                                  >
                                    <View
                                      style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 8,
                                        flex: 1,
                                        paddingRight: 8,
                                      }}
                                    >
                                      <Clock size={14} color={colors.accent} />
                                      <Text
                                        numberOfLines={1}
                                        style={{
                                          fontWeight: "500",
                                          color: colors.ink,
                                          fontSize: 12,
                                          fontFamily: FONTS.sans,
                                        }}
                                      >
                                        vs {oppTeam?.name || "Opponent"} (
                                        {fix.roundName})
                                      </Text>
                                    </View>
                                    <View
                                      style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 4,
                                      }}
                                    >
                                      <Text
                                        style={{
                                          fontSize: 12,
                                          fontWeight: "600",
                                          color: colors.accent,
                                          fontFamily: FONTS.sans,
                                        }}
                                      >
                                        Score Match
                                      </Text>
                                      <ArrowRight size={12} color={colors.accent} />
                                    </View>
                                  </Pressable>
                                );
                              })}
                            </View>
                          )}
                        </View>
                      </View>
                    )}
                  </React.Fragment>
                );
              })}
            </View>

            {/* Table Footer Legend */}
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                backgroundColor: colors.surfaceCard,
                borderTopWidth: 1,
                borderTopColor: colors.hairline,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: colors.accent,
                  }}
                />
                <Text
                  style={{ fontSize: 11, color: colors.ink2, fontFamily: FONTS.sans }}
                >
                  Ranks 1 & 2 qualify for the Tournament Final
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 11,
                  color: colors.ink2,
                  fontVariant: ["tabular-nums"],
                  fontFamily: FONTS.sans,
                }}
              >
                Win: 2 pts · Tie: 1 pt · Loss: 0 pts
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* ========================================================= */}
      {/* VIEW 2: POINTS & NRR VISUAL CHART (recharts → SVG)        */}
      {/* ========================================================= */}
      {viewMode === "chart" && (
        <View
          style={{
            padding: 16,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: 12,
            flexDirection: "column",
            gap: 12,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  fontWeight: "600",
                  color: colors.ink2,
                  letterSpacing: 1,
                  fontFamily: FONTS.sans,
                }}
              >
                Points & Run Rate Progression
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  color: colors.ink2,
                  fontFamily: FONTS.sans,
                }}
              >
                Comparing total league points alongside Net Run Rate (NRR)
                differential.
              </Text>
            </View>
            <View style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    backgroundColor: colors.ink,
                  }}
                />
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink,
                    fontWeight: "500",
                    fontFamily: FONTS.sans,
                  }}
                >
                  Points
                </Text>
              </View>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: colors.accent,
                  }}
                />
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.accent,
                    fontWeight: "500",
                    fontFamily: FONTS.sans,
                  }}
                >
                  NRR
                </Text>
              </View>
            </View>
          </View>

          {/* RN: recharts ResponsiveContainer → measured-width SVG canvas */}
          <View
            style={{ width: "100%", height: CHART_HEIGHT }}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              if (w > 0 && Math.abs(w - chartWidth) > 1) setChartWidth(w);
            }}
          >
            {chartWidth > 0 && chartData.length > 0 && (() => {
              const plotW = chartWidth - PLOT_LEFT - PLOT_RIGHT;
              const plotH = CHART_HEIGHT - PLOT_TOP - PLOT_BOTTOM;
              const leftMax = leftTicks[leftTicks.length - 1] || 1;
              const slotW = plotW / chartData.length;
              const barW = Math.min(32, slotW * 0.55);
              const yLeft = (v: number) =>
                PLOT_TOP + plotH * (1 - v / leftMax);
              const rightBound = rightTicks[rightTicks.length - 1] || 2;
              const yRight = (v: number) =>
                PLOT_TOP + plotH * ((rightBound - v) / (2 * rightBound));
              const xCenter = (i: number) => PLOT_LEFT + slotW * i + slotW / 2;

              return (
                <View style={{ flex: 1 }}>
                  <Svg width={chartWidth} height={CHART_HEIGHT}>
                    {/* CartesianGrid: horizontal dashed hairlines (vertical={false}) */}
                    {leftTicks.map((t) => (
                      <Line
                        key={`grid-${t}`}
                        x1={PLOT_LEFT}
                        y1={yLeft(t)}
                        x2={PLOT_LEFT + plotW}
                        y2={yLeft(t)}
                        stroke={colors.hairline}
                        strokeWidth={1}
                        strokeDasharray="3 3"
                      />
                    ))}

                    {/* ReferenceLine: NRR = 0 on the right axis */}
                    <Line
                      x1={PLOT_LEFT}
                      y1={yRight(0)}
                      x2={PLOT_LEFT + plotW}
                      y2={yRight(0)}
                      stroke={colors.hairlineStrong}
                      strokeWidth={1}
                      strokeDasharray="2 2"
                    />

                    {/* Axes: XAxis (ink-2) + left YAxis (ink-2) + right YAxis (accent) */}
                    <Line
                      x1={PLOT_LEFT}
                      y1={PLOT_TOP}
                      x2={PLOT_LEFT}
                      y2={PLOT_TOP + plotH}
                      stroke={colors.ink2}
                      strokeWidth={1}
                    />
                    <Line
                      x1={PLOT_LEFT + plotW}
                      y1={PLOT_TOP}
                      x2={PLOT_LEFT + plotW}
                      y2={PLOT_TOP + plotH}
                      stroke={colors.accent}
                      strokeWidth={1}
                    />
                    <Line
                      x1={PLOT_LEFT}
                      y1={PLOT_TOP + plotH}
                      x2={PLOT_LEFT + plotW}
                      y2={PLOT_TOP + plotH}
                      stroke={colors.ink2}
                      strokeWidth={1}
                    />

                    {/* Bar: points per team (Cell fill = team color) */}
                    {chartData.map((entry, i) =>
                      entry.points > 0 ? (
                        <Path
                          key={`bar-${i}`}
                          d={roundedTopBarPath(
                            xCenter(i) - barW / 2,
                            yLeft(entry.points),
                            barW,
                            yLeft(0) - yLeft(entry.points),
                            4
                          )}
                          fill={entry.color || colors.ink}
                        />
                      ) : null
                    )}

                    {/* Line: NRR differential (right axis), dot r=4 */}
                    <Polyline
                      points={chartData
                        .map((d, i) => `${xCenter(i)},${yRight(d.nrr)}`)
                        .join(" ")}
                      fill="none"
                      stroke={colors.accent}
                      strokeWidth={2.5}
                    />
                    {chartData.map((d, i) => (
                      <Circle
                        key={`dot-${i}`}
                        cx={xCenter(i)}
                        cy={yRight(d.nrr)}
                        r={selectedChartIndex === i ? 5 : 4}
                        fill={colors.accent}
                        stroke="#FFFFFF"
                        strokeWidth={1.5}
                      />
                    ))}

                    {/* YAxis (left): points ticks */}
                    {leftTicks.map((t) => (
                      <SvgText
                        key={`y-left-${t}`}
                        x={PLOT_LEFT - 6}
                        y={yLeft(t) + 3.5}
                        textAnchor="end"
                        fontSize={11}
                        fill={colors.ink2}
                        fontFamily={FONTS.sans}
                      >
                        {t}
                      </SvgText>
                    ))}

                    {/* YAxis (right): NRR ticks, data-derived symmetric domain */}
                    {rightTicks.map((t) => (
                      <SvgText
                        key={`y-right-${t}`}
                        x={PLOT_LEFT + plotW + 6}
                        y={yRight(t) + 3.5}
                        textAnchor="start"
                        fontSize={11}
                        fill={colors.accent}
                        fontFamily={FONTS.sans}
                      >
                        {t}
                      </SvgText>
                    ))}

                    {/* XAxis: team short names */}
                    {chartData.map((d, i) => (
                      <SvgText
                        key={`x-${i}`}
                        x={xCenter(i)}
                        y={PLOT_TOP + plotH + 16}
                        textAnchor="middle"
                        fontSize={11}
                        fill={colors.ink2}
                        fontFamily={FONTS.sans}
                      >
                        {d.name}
                      </SvgText>
                    ))}
                  </Svg>

                  {/* Tap zones — recharts hover tooltip → tap-to-inspect */}
                  <View
                    style={{
                      position: "absolute",
                      left: PLOT_LEFT,
                      top: 0,
                      width: plotW,
                      height: CHART_HEIGHT,
                      flexDirection: "row",
                    }}
                  >
                    {chartData.map((d, i) => (
                      <Pressable
                        key={`tap-${i}`}
                        style={{ flex: 1, height: "100%" }}
                        onPress={() =>
                          setSelectedChartIndex((prev) =>
                            prev === i ? null : i
                          )
                        }
                      >
                        <View />
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })()}
          </View>

          {/* Tap tooltip (recharts Tooltip content) */}
          {tooltipDatum && (
            <View
              style={{
                padding: 10,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                borderRadius: 8,
                alignSelf: "flex-start",
                minWidth: 170,
                shadowColor: "#000",
                shadowOpacity: 0.12,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 3,
              }}
            >
              <Text
                style={{
                  fontFamily: FONTS.serif,
                  fontWeight: "700",
                  fontSize: 14,
                  color: colors.ink,
                }}
              >
                {tooltipDatum.fullName}
              </Text>
              <View style={{ marginTop: 4, flexDirection: "column", gap: 2 }}>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  Points:{" "}
                  <Text
                    style={{
                      color: colors.ink,
                      fontWeight: "700",
                      fontFamily: FONTS.sans,
                    }}
                  >
                    {tooltipDatum.points}
                  </Text>
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  Won:{" "}
                  <Text
                    style={{
                      color: colors.ink,
                      fontWeight: "700",
                      fontFamily: FONTS.sans,
                    }}
                  >
                    {tooltipDatum.won}
                  </Text>{" "}
                  of {tooltipDatum.played}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    color: colors.ink2,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  NRR:{" "}
                  <Text
                    style={{
                      color: colors.accent,
                      fontWeight: "700",
                      fontFamily: FONTS.sans,
                    }}
                  >
                    {tooltipDatum.nrr > 0
                      ? `+${tooltipDatum.nrr}`
                      : tooltipDatum.nrr}
                  </Text>
                </Text>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ========================================================= */}
      {/* VIEW 3: HEAD-TO-HEAD CROSS MATRIX                         */}
      {/* ========================================================= */}
      {viewMode === "matrix" && (
        <View
          style={{
            padding: 16,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: 12,
            flexDirection: "column",
            gap: 12,
          }}
        >
          <View>
            <Text
              style={{
                fontSize: 12,
                textTransform: "uppercase",
                fontWeight: "600",
                color: colors.ink2,
                letterSpacing: 1,
                fontFamily: FONTS.sans,
              }}
            >
              Head-to-Head Cross Grid
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              Row team vs Column team head-to-head match outcomes.
            </Text>
          </View>

          {/* RN: web <table border-collapse> → bordered View rows */}
          <View
            style={{
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {/* Header Row */}
            <View
              style={{
                flexDirection: "row",
                borderBottomWidth: 1,
                borderBottomColor: colors.hairline,
                backgroundColor: colors.surfaceCard,
              }}
            >
              <Text
                style={{
                  width: 64,
                  padding: 8,
                  fontSize: 10,
                  color: colors.ink2,
                  textTransform: "uppercase",
                  fontFamily: FONTS.sans,
                }}
              >
                Team
              </Text>
              {standings.map((col) => (
                <Text
                  key={col.teamId}
                  style={{
                    flex: 1,
                    padding: 8,
                    borderLeftWidth: 1,
                    borderLeftColor: colors.hairline,
                    fontWeight: "700",
                    fontSize: 11,
                    color: colors.ink,
                    textAlign: "center",
                    fontFamily: FONTS.sans,
                  }}
                >
                  {col.team.shortName}
                </Text>
              ))}
            </View>

            {/* Body Rows */}
            {standings.map((row, rowIdx) => (
              <View
                key={row.teamId}
                style={{
                  flexDirection: "row",
                  borderBottomWidth:
                    rowIdx < standings.length - 1 ? 1 : 0,
                  borderBottomColor: colors.hairline,
                }}
              >
                <Text
                  style={{
                    width: 64,
                    padding: 8,
                    fontWeight: "600",
                    fontSize: 11,
                    color: colors.ink,
                    backgroundColor: colors.surfaceCard,
                    fontFamily: FONTS.sans,
                  }}
                >
                  {row.team.shortName}
                </Text>
                {standings.map((col) => {
                  if (row.teamId === col.teamId) {
                    return (
                      <View
                        key={col.teamId}
                        style={{
                          flex: 1,
                          padding: 8,
                          borderLeftWidth: 1,
                          borderLeftColor: colors.hairline,
                          backgroundColor: colors.surfaceCard,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 10,
                            color: colors.ink2,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          —
                        </Text>
                      </View>
                    );
                  }

                  // Find matches between row and col
                  const matchBetween = row.tournamentMatches.find(
                    (m) => m.opponentTeamId === col.teamId
                  );

                  if (matchBetween) {
                    return (
                      <Pressable
                        key={col.teamId}
                        onPress={() => onOpenMatchDetail?.(matchBetween.matchId)}
                        style={({ pressed }) => ({
                          flex: 1,
                          padding: 8,
                          borderLeftWidth: 1,
                          borderLeftColor: colors.hairline,
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: pressed ? 0.85 : 1,
                          backgroundColor: pressed
                            ? colors.surfaceCard
                            : "transparent",
                        })}
                      >
                        <Text
                          style={{
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 2,
                            overflow: "hidden",
                            fontSize: 10,
                            fontWeight: "700",
                            color:
                              matchBetween.result === "L"
                                ? colors.ink2
                                : "#FFFFFF",
                            backgroundColor:
                              matchBetween.result === "W"
                                ? colors.success
                                : matchBetween.result === "L"
                                ? colors.hairlineStrong
                                : colors.accent,
                            fontFamily: FONTS.sans,
                          }}
                        >
                          {matchBetween.result}
                        </Text>
                      </Pressable>
                    );
                  }

                  return (
                    <View
                      key={col.teamId}
                      style={{
                        flex: 1,
                        padding: 8,
                        borderLeftWidth: 1,
                        borderLeftColor: colors.hairline,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          color: colors.ink2,
                          fontFamily: FONTS.sans,
                        }}
                      >
                        Pending
                      </Text>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
};
