/**
 * GullyScore Run-Rate Progression Chart (recharts → react-native-svg)
 *
 * Visualizes a team's over-by-over run rate progression throughout match innings.
 * Allows comparative analysis between 1st innings and 2nd innings chase tempo.
 */

import React, { useState, useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Polyline,
  Text as SvgText,
} from "react-native-svg";
import { Match, InningsScorecard } from "../../types/cricket";
import { db } from "../../storage/db";
import { replayInnings } from "../../engine/scoringEngine";
import { GullyChip, GullySegmented } from "../common/Components";
import { useTheme, FONTS } from "../../design/theme";
// RN: lucide-react-native 1.68 renamed BarChart2 → ChartColumn (same glyph)
import { TrendingUp, ChartColumn } from "lucide-react-native";

interface RunRateProgressionChartProps {
  matches?: Match[];
}

// Web series colors, kept identical
const INN1_COLOR = "#B4232A";
const INN2_COLOR = "#1E293B";
const INN2_BAR_FILL = "#475569";
const PAR_LINE = "#94A3B8";
const PAR_LABEL = "#64748B";
const GRID_STROKE = "rgba(20, 22, 26, 0.08)";

// Web: h-64 (256px) chart area with pt-2 inner padding
const CHART_HEIGHT = 248;
// Chart paddings (recharts margin {top:10, right:10, left:-20, bottom:0} + tick label bands)
const PAD_LEFT = 34;
const PAD_TOP = 10;
const PAD_RIGHT = 10;
const PAD_BOTTOM = 16;

// RN: recharts' automatic Y-axis ticks — pick "nice" steps covering the max value.
function niceTicks(maxValue: number, allowDecimals: boolean): number[] {
  const max = Math.max(maxValue, 1);
  const roughStep = max / 4;
  const pow = Math.pow(10, Math.floor(Math.log10(roughStep)));
  let step = pow;
  let bestErr = Infinity;
  for (const m of [1, 2, 2.5, 5, 10]) {
    const err = Math.abs(roughStep - m * pow);
    if (err < bestErr) {
      bestErr = err;
      step = m * pow;
    }
  }
  if (!allowDecimals) step = Math.max(1, Math.round(step));
  const ticks: number[] = [];
  for (let v = 0; v < max + step / 2; v += step) {
    ticks.push(Number(v.toFixed(2)));
  }
  if (ticks[ticks.length - 1] < max) {
    ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(2)));
  }
  return ticks;
}

// RN: recharts Bar radius={[3, 3, 0, 0]} — a bar rect with rounded top corners.
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

export const RunRateProgressionChart: React.FC<RunRateProgressionChartProps> = ({
  matches: propMatches,
}) => {
  const { colors } = useTheme();
  const allMatches = propMatches || db.getMatches();
  const eligibleMatches = useMemo(() => {
    return allMatches.filter(
      (m) =>
        m.innings.some((inn) => inn.ballEvents.length > 0)
    );
  }, [allMatches]);

  const [selectedMatchId, setSelectedMatchId] = useState<string>(() => {
    return eligibleMatches[0]?.id || "";
  });

  const [metricMode, setMetricMode] = useState<"crr" | "runsPerOver">("crr");
  const [inningsFilter, setInningsFilter] = useState<
    "both" | "inn1" | "inn2"
  >("both");

  // RN: tap-to-inspect replaces the recharts hover tooltip
  const [selectedOver, setSelectedOver] = useState<number | null>(null);
  // RN: measure available width (recharts ResponsiveContainer)
  const [chartWidth, setChartWidth] = useState(0);

  const selectedMatch = useMemo(() => {
    return (
      allMatches.find((m) => m.id === selectedMatchId) ||
      eligibleMatches[0] ||
      null
    );
  }, [allMatches, eligibleMatches, selectedMatchId]);

  const playersMap = db.getPlayersMap();

  // Replay innings scorecards for the selected match
  const { sc1, sc2, teamAName, teamBName, teamAShort, teamBShort } = useMemo(() => {
    if (!selectedMatch) {
      return { sc1: null, sc2: null, teamAName: "Team A", teamBName: "Team B", teamAShort: "T1", teamBShort: "T2" };
    }

    const tA = db.getTeam(selectedMatch.teamAId);
    const tB = db.getTeam(selectedMatch.teamBId);

    const inn1 = selectedMatch.innings[0];
    const inn2 = selectedMatch.innings[1];

    const scorecard1 = inn1 && inn1.ballEvents.length > 0
      ? replayInnings(inn1.ballEvents, selectedMatch.rules, [], [], playersMap)
      : null;

    const scorecard2 = inn2 && inn2.ballEvents.length > 0
      ? replayInnings(inn2.ballEvents, selectedMatch.rules, [], [], playersMap)
      : null;

    const batTeam1 = inn1 ? db.getTeam(inn1.battingTeamId) : tA;
    const batTeam2 = inn2 ? db.getTeam(inn2.battingTeamId) : tB;

    return {
      sc1: scorecard1,
      sc2: scorecard2,
      teamAName: batTeam1?.name || "1st Innings",
      teamBName: batTeam2?.name || "2nd Innings",
      teamAShort: batTeam1?.shortName || "Inn 1",
      teamBShort: batTeam2?.shortName || "Inn 2",
    };
  }, [selectedMatch, playersMap]);

  // Transform over summaries into chart data points
  const chartData = useMemo(() => {
    if (!selectedMatch) return [];

    const oversCount = selectedMatch.rules.overs || 10;
    const data: Array<{
      over: number;
      overLabel: string;
      inn1Crr?: number;
      inn1Runs?: number;
      inn1Wickets?: number;
      inn1TotalRuns?: number;
      inn1TotalWickets?: number;
      inn2Crr?: number;
      inn2Runs?: number;
      inn2Wickets?: number;
      inn2TotalRuns?: number;
      inn2TotalWickets?: number;
    }> = [];

    const inn1Overs = sc1?.overSummaries || [];
    const inn2Overs = sc2?.overSummaries || [];

    const maxOversTracked = Math.max(
      inn1Overs.length,
      inn2Overs.length,
      oversCount
    );

    for (let ov = 1; ov <= maxOversTracked; ov++) {
      const o1 = inn1Overs.find((item) => item.overNumber === ov);
      const o2 = inn2Overs.find((item) => item.overNumber === ov);

      if (!o1 && !o2 && ov > Math.max(inn1Overs.length, inn2Overs.length)) {
        continue;
      }

      const item: (typeof data)[0] = {
        over: ov,
        overLabel: `Over ${ov}`,
      };

      if (o1) {
        item.inn1Runs = o1.runs;
        item.inn1Wickets = o1.wickets;
        item.inn1TotalRuns = o1.cumulativeScore;
        item.inn1TotalWickets = o1.cumulativeWickets;
        item.inn1Crr = Number((o1.cumulativeScore / ov).toFixed(2));
      }

      if (o2) {
        item.inn2Runs = o2.runs;
        item.inn2Wickets = o2.wickets;
        item.inn2TotalRuns = o2.cumulativeScore;
        item.inn2TotalWickets = o2.cumulativeWickets;
        item.inn2Crr = Number((o2.cumulativeScore / ov).toFixed(2));
      }

      data.push(item);
    }

    return data;
  }, [selectedMatch, sc1, sc2]);

  // Phase analysis metrics
  const phaseMetrics = useMemo(() => {
    if (!selectedMatch || !sc1) return null;

    const totalOvers = selectedMatch.rules.overs;
    const ppEnd = Math.max(2, Math.floor(totalOvers * 0.3));
    const midEnd = Math.floor(totalOvers * 0.7);

    const calcPhase = (sc: InningsScorecard | null, startOv: number, endOv: number) => {
      if (!sc) return { runs: 0, overs: 0, runRate: 0, wickets: 0 };
      const oversInPhase = sc.overSummaries.filter(
        (o) => o.overNumber >= startOv && o.overNumber <= endOv
      );
      const runs = oversInPhase.reduce((a, b) => a + b.runs, 0);
      const wickets = oversInPhase.reduce((a, b) => a + b.wickets, 0);
      const actualOvers = oversInPhase.length;
      return {
        runs,
        overs: actualOvers,
        runRate: actualOvers > 0 ? Number((runs / actualOvers).toFixed(2)) : 0,
        wickets,
      };
    };

    return {
      pp: {
        range: `Overs 1-${ppEnd}`,
        inn1: calcPhase(sc1, 1, ppEnd),
        inn2: calcPhase(sc2, 1, ppEnd),
      },
      mid: {
        range: `Overs ${ppEnd + 1}-${midEnd}`,
        inn1: calcPhase(sc1, ppEnd + 1, midEnd),
        inn2: calcPhase(sc2, ppEnd + 1, midEnd),
      },
      death: {
        range: `Overs ${midEnd + 1}-${totalOvers}`,
        inn1: calcPhase(sc1, midEnd + 1, totalOvers),
        inn2: calcPhase(sc2, midEnd + 1, totalOvers),
      },
    };
  }, [selectedMatch, sc1, sc2]);

  if (eligibleMatches.length === 0) {
    return (
      <View
        style={{
          padding: 32,
          alignItems: "center",
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.hairline,
          borderRadius: 10,
        }}
      >
        <View style={{ opacity: 0.5, marginBottom: 8 }}>
          <ChartColumn size={32} color={colors.ink2} />
        </View>
        <Text
          style={{
            fontSize: 14,
            fontFamily: FONTS.serif,
            fontWeight: "700",
            color: colors.ink,
            textAlign: "center",
          }}
        >
          No Match Progression Data Yet
        </Text>
        <Text
          style={{
            fontSize: 12,
            color: colors.ink2,
            marginTop: 4,
            textAlign: "center",
            fontFamily: FONTS.sans,
          }}
        >
          Score matches to unlock over-by-over run-rate progression charts and
          phase analytics.
        </Text>
      </View>
    );
  }

  const parRunRate = selectedMatch?.rules.ballType === "tennis" ? 8.2 : 7.5;

  // --- Chart geometry (recharts ResponsiveContainer → measured width) ---
  const plotLeft = PAD_LEFT;
  const plotTop = PAD_TOP;
  const plotW = Math.max(10, chartWidth - PAD_LEFT - PAD_RIGHT);
  const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxOver =
    chartData.length > 0 ? chartData[chartData.length - 1].over : 1;
  const xFor = (over: number) =>
    plotLeft + ((over - 1) / Math.max(1, maxOver - 1)) * plotW;

  const showInn1 = inningsFilter === "both" || inningsFilter === "inn1";
  const showInn2 = !!sc2 && (inningsFilter === "both" || inningsFilter === "inn2");

  // Y domain [0, auto] like recharts
  const maxVal = (() => {
    let m = 0;
    chartData.forEach((d) => {
      if (showInn1) {
        if (metricMode === "crr" && d.inn1Crr !== undefined) {
          m = Math.max(m, d.inn1Crr);
        }
        if (metricMode === "runsPerOver" && d.inn1Runs !== undefined) {
          m = Math.max(m, d.inn1Runs);
        }
      }
      if (showInn2) {
        if (metricMode === "crr" && d.inn2Crr !== undefined) {
          m = Math.max(m, d.inn2Crr);
        }
        if (metricMode === "runsPerOver" && d.inn2Runs !== undefined) {
          m = Math.max(m, d.inn2Runs);
        }
      }
    });
    if (metricMode === "crr") m = Math.max(m, parRunRate);
    return m;
  })();

  const yTicks = niceTicks(maxVal, metricMode === "crr");
  const yMax = yTicks.length > 0 ? yTicks[yTicks.length - 1] : 1;
  const yFor = (v: number) => plotTop + plotH - (v / yMax) * plotH;
  const formatTick = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  const inn1Pts = chartData.flatMap((d) =>
    d.inn1Crr !== undefined ? [{ x: xFor(d.over), y: yFor(d.inn1Crr) }] : []
  );
  const inn2Pts = chartData.flatMap((d) =>
    d.inn2Crr !== undefined ? [{ x: xFor(d.over), y: yFor(d.inn2Crr) }] : []
  );
  const toPoints = (pts: Array<{ x: number; y: number }>) =>
    pts.map((p) => `${p.x},${p.y}`).join(" ");
  // Soft area wash under a line series
  const areaPathFor = (pts: Array<{ x: number; y: number }>) => {
    if (pts.length < 2) return "";
    const baseline = plotTop + plotH;
    return (
      `M ${pts[0].x} ${baseline} ` +
      pts.map((p) => `L ${p.x} ${p.y}`).join(" ") +
      ` L ${pts[pts.length - 1].x} ${baseline} Z`
    );
  };

  // Runs-per-over grouped bars (recharts Bar maxBarSize={16})
  const slot = plotW / Math.max(1, chartData.length);
  const barW =
    showInn1 && showInn2
      ? Math.min(16, (slot - 2) / 2)
      : Math.min(16, slot * 0.7);
  const inn1BarX = (over: number) =>
    xFor(over) - (showInn2 ? barW + 1 : barW / 2);
  const inn2BarX = (over: number) =>
    xFor(over) + (showInn2 ? 1 : -barW / 2);

  // Thin x labels like recharts' auto interval
  const xLabelStep = Math.ceil(chartData.length / 10);

  const selectedDatum =
    selectedOver !== null
      ? chartData.find((d) => d.over === selectedOver)
      : undefined;

  return (
    <View style={{ flexDirection: "column", gap: 16 }}>
      {/* Top Controls: Match Picker & Mode Toggle */}
      <View
        style={{
          padding: 12,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.hairline,
          borderRadius: 10,
          flexDirection: "column",
          gap: 12,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            }}
          >
            <TrendingUp size={14} color={colors.accent} />
            <Text
              style={{
                fontSize: 12,
                fontWeight: "600",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                color: colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              Select Match:
            </Text>
          </View>
          {/* RN: web <select> match picker → horizontal chip scroller */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flex: 1, maxWidth: 260 }}
            contentContainerStyle={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
            }}
          >
            {eligibleMatches.map((m) => {
              const tA = db.getTeam(m.teamAId);
              const tB = db.getTeam(m.teamBId);
              return (
                <GullyChip
                  key={m.id}
                  label={`${tA?.shortName || "T1"} vs ${
                    tB?.shortName || "T2"
                  } (${m.rules.overs}ov) · ${m.date}`}
                  active={m.id === selectedMatchId}
                  onPress={() => setSelectedMatchId(m.id)}
                />
              );
            })}
          </ScrollView>
        </View>

        {/* View Mode & Filter Toggles */}
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
          }}
        >
          {/* Metric Selector */}
          <GullySegmented
            options={[
              { label: "Cumulative RR (CRR)", value: "crr" },
              { label: "Runs / Over", value: "runsPerOver" },
            ]}
            value={metricMode}
            onChange={(v) => setMetricMode(v)}
          />

          {/* Innings Selector */}
          <GullySegmented
            options={[
              { label: "Both", value: "both" },
              { label: teamAShort, value: "inn1" },
              ...(sc2 ? [{ label: teamBShort, value: "inn2" as const }] : []),
            ]}
            value={inningsFilter}
            onChange={(v) => setInningsFilter(v)}
          />
        </View>
      </View>

      {/* VISUALIZATION CONTAINER (recharts ComposedChart → react-native-svg) */}
      <View
        style={{
          padding: 16,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.hairline,
          borderRadius: 12,
          flexDirection: "column",
          gap: 8,
          elevation: 1,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
            gap: 8,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: FONTS.serif,
                fontWeight: "700",
                fontSize: 14,
                color: colors.ink,
              }}
            >
              {metricMode === "crr"
                ? "Run-Rate Progression (RPO)"
                : "Runs Scored Per Over"}
            </Text>
            <Text
              style={{
                fontSize: 11,
                color: colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              {metricMode === "crr"
                ? "Cumulative run rate over-by-over with par benchmark"
                : "Boundary impact and scoring volume per 6-ball over"}
            </Text>
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {showInn1 && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: INN1_COLOR,
                  }}
                />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "500",
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  {teamAShort}{" "}
                  {sc1 ? `(${sc1.totalRuns}/${sc1.totalWickets})` : ""}
                </Text>
              </View>
            )}
            {showInn2 && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: INN2_COLOR,
                  }}
                />
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "500",
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  {teamBShort} {`(${sc2.totalRuns}/${sc2.totalWickets})`}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* The chart canvas (tap an over column to inspect) */}
        <View
          style={{ width: "100%", height: 256, paddingTop: 8 }}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0 && Math.abs(w - chartWidth) > 1) setChartWidth(w);
          }}
        >
          {chartWidth > 0 && chartData.length > 0 && (
            <View style={{ flex: 1 }}>
              <Svg width={chartWidth} height={CHART_HEIGHT}>
                {/* CartesianGrid: horizontal dashed hairlines */}
                {yTicks.map((t) =>
                  t === 0 ? null : (
                    <Line
                      key={`grid-${t}`}
                      x1={plotLeft}
                      y1={yFor(t)}
                      x2={plotLeft + plotW}
                      y2={yFor(t)}
                      stroke={GRID_STROKE}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                  )
                )}

                {/* Axes */}
                <Line
                  x1={plotLeft}
                  y1={plotTop}
                  x2={plotLeft}
                  y2={plotTop + plotH}
                  stroke={colors.ink2}
                  strokeWidth={1}
                />
                <Line
                  x1={plotLeft}
                  y1={plotTop + plotH}
                  x2={plotLeft + plotW}
                  y2={plotTop + plotH}
                  stroke={colors.ink2}
                  strokeWidth={1}
                />

                {/* Y-axis tick labels */}
                {yTicks.map((t) => (
                  <SvgText
                    key={`y-${t}`}
                    x={plotLeft - 6}
                    y={yFor(t) + 3.5}
                    textAnchor="end"
                    fontSize={11}
                    fill={colors.ink2}
                    fontFamily={FONTS.sans}
                  >
                    {formatTick(t)}
                  </SvgText>
                ))}

                {/* X-axis tick labels */}
                {chartData.map((d) =>
                  (d.over - 1) % xLabelStep === 0 || d.over === maxOver ? (
                    <SvgText
                      key={`x-${d.over}`}
                      x={xFor(d.over)}
                      y={plotTop + plotH + 14}
                      textAnchor="middle"
                      fontSize={11}
                      fill={colors.ink2}
                      fontFamily={FONTS.sans}
                    >
                      {`Ov ${d.over}`}
                    </SvgText>
                  ) : null
                )}

                {/* Par reference line (ReferenceLine) */}
                {metricMode === "crr" && (
                  <G>
                    <Line
                      x1={plotLeft}
                      y1={yFor(parRunRate)}
                      x2={plotLeft + plotW}
                      y2={yFor(parRunRate)}
                      stroke={PAR_LINE}
                      strokeWidth={1}
                      strokeDasharray="4 4"
                    />
                    <SvgText
                      x={plotLeft + plotW}
                      y={yFor(parRunRate) - 4}
                      textAnchor="end"
                      fontSize={10}
                      fill={PAR_LABEL}
                      fontFamily={FONTS.sans}
                    >
                      {`Par ${parRunRate} rpo`}
                    </SvgText>
                  </G>
                )}

                {/* Tooltip cursor for the tapped over */}
                {selectedDatum && (
                  <Line
                    x1={xFor(selectedDatum.over)}
                    y1={plotTop}
                    x2={xFor(selectedDatum.over)}
                    y2={plotTop + plotH}
                    stroke={colors.hairlineStrong}
                    strokeWidth={1}
                  />
                )}

                {/* Innings 1 Series */}
                {showInn1 && metricMode === "crr" && (
                  <G>
                    <Path
                      d={areaPathFor(inn1Pts)}
                      fill={INN1_COLOR}
                      fillOpacity={0.06}
                    />
                    <Polyline
                      points={toPoints(inn1Pts)}
                      fill="none"
                      stroke={INN1_COLOR}
                      strokeWidth={2.5}
                    />
                    {chartData.map((d) =>
                      d.inn1Crr !== undefined ? (
                        <Circle
                          key={`l1-${d.over}`}
                          cx={xFor(d.over)}
                          cy={yFor(d.inn1Crr)}
                          r={selectedOver === d.over ? 5 : 3.5}
                          fill={INN1_COLOR}
                          stroke="#FFFFFF"
                          strokeWidth={1.5}
                        />
                      ) : null
                    )}
                    {/* Wicket markers: ring on overs where a wicket fell */}
                    {chartData.map((d) =>
                      d.inn1Wickets && d.inn1Crr !== undefined ? (
                        <Circle
                          key={`w1-${d.over}`}
                          cx={xFor(d.over)}
                          cy={yFor(d.inn1Crr)}
                          r={6.5}
                          fill="none"
                          stroke={INN1_COLOR}
                          strokeWidth={1}
                        />
                      ) : null
                    )}
                  </G>
                )}
                {showInn1 &&
                  metricMode === "runsPerOver" &&
                  chartData.map((d) => {
                    if (d.inn1Runs === undefined) return null;
                    const x = inn1BarX(d.over);
                    const y = yFor(d.inn1Runs);
                    return (
                      <G key={`b1-${d.over}`}>
                        {d.inn1Runs > 0 && (
                          <Path
                            d={roundedTopBarPath(
                              x,
                              y,
                              barW,
                              plotTop + plotH - y,
                              3
                            )}
                            fill={INN1_COLOR}
                          />
                        )}
                        {d.inn1Wickets ? (
                          <Circle
                            cx={x + barW / 2}
                            cy={y - 8}
                            r={3}
                            fill="none"
                            stroke={INN1_COLOR}
                            strokeWidth={1.2}
                          />
                        ) : null}
                      </G>
                    );
                  })}

                {/* Innings 2 Series */}
                {showInn2 && metricMode === "crr" && (
                  <G>
                    <Path
                      d={areaPathFor(inn2Pts)}
                      fill={INN2_COLOR}
                      fillOpacity={0.06}
                    />
                    <Polyline
                      points={toPoints(inn2Pts)}
                      fill="none"
                      stroke={INN2_COLOR}
                      strokeWidth={2.5}
                      strokeDasharray={inningsFilter === "both" ? "4 2" : undefined}
                    />
                    {chartData.map((d) =>
                      d.inn2Crr !== undefined ? (
                        <Circle
                          key={`l2-${d.over}`}
                          cx={xFor(d.over)}
                          cy={yFor(d.inn2Crr)}
                          r={selectedOver === d.over ? 5 : 3.5}
                          fill={INN2_COLOR}
                          stroke="#FFFFFF"
                          strokeWidth={1.5}
                        />
                      ) : null
                    )}
                    {/* Wicket markers: ring on overs where a wicket fell */}
                    {chartData.map((d) =>
                      d.inn2Wickets && d.inn2Crr !== undefined ? (
                        <Circle
                          key={`w2-${d.over}`}
                          cx={xFor(d.over)}
                          cy={yFor(d.inn2Crr)}
                          r={6.5}
                          fill="none"
                          stroke={INN2_COLOR}
                          strokeWidth={1}
                        />
                      ) : null
                    )}
                  </G>
                )}
                {showInn2 &&
                  metricMode === "runsPerOver" &&
                  chartData.map((d) => {
                    if (d.inn2Runs === undefined) return null;
                    const x = inn2BarX(d.over);
                    const y = yFor(d.inn2Runs);
                    return (
                      <G key={`b2-${d.over}`}>
                        {d.inn2Runs > 0 && (
                          <Path
                            d={roundedTopBarPath(
                              x,
                              y,
                              barW,
                              plotTop + plotH - y,
                              3
                            )}
                            fill={INN2_BAR_FILL}
                          />
                        )}
                        {d.inn2Wickets ? (
                          <Circle
                            cx={x + barW / 2}
                            cy={y - 8}
                            r={3}
                            fill="none"
                            stroke={INN2_BAR_FILL}
                            strokeWidth={1.2}
                          />
                        ) : null}
                      </G>
                    );
                  })}
              </Svg>

              {/* Tap zones — recharts hover tooltip → tap-to-inspect */}
              <View
                style={{
                  position: "absolute",
                  left: plotLeft,
                  top: 0,
                  width: plotW,
                  height: CHART_HEIGHT,
                  flexDirection: "row",
                }}
              >
                {chartData.map((d) => (
                  <Pressable
                    key={`tap-${d.over}`}
                    style={{ flex: 1, height: "100%" }}
                    onPress={() =>
                      setSelectedOver((prev) =>
                        prev === d.over ? null : d.over
                      )
                    }
                  />
                ))}
              </View>
            </View>
          )}
        </View>

        {/* Tap tooltip (recharts Tooltip content) */}
        {selectedDatum && (
          <View
            style={{
              padding: 10,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairlineStrong,
              borderRadius: 8,
              minWidth: 170,
              alignSelf: "flex-start",
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
                fontSize: 12,
                color: colors.ink,
                borderBottomWidth: 1,
                borderBottomColor: colors.hairline,
                paddingBottom: 4,
                marginBottom: 6,
              }}
            >
              End of Over {selectedDatum.over}
            </Text>

            {showInn1 && selectedDatum.inn1TotalRuns !== undefined && (
              <View style={{ flexDirection: "column", gap: 2, marginBottom: 4 }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: INN1_COLOR,
                    fontFamily: FONTS.sans,
                  }}
                >
                  {teamAName}
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    color: colors.ink,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  Score: {selectedDatum.inn1TotalRuns}/
                  {selectedDatum.inn1TotalWickets} ({selectedDatum.inn1Runs}{" "}
                  off over)
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "700",
                    color: colors.ink,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  Run Rate: {selectedDatum.inn1Crr?.toFixed(2)} rpo
                </Text>
              </View>
            )}

            {showInn2 && selectedDatum.inn2TotalRuns !== undefined && (
              <View
                style={{
                  flexDirection: "column",
                  gap: 2,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                  paddingTop: 4,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: INN2_COLOR,
                    fontFamily: FONTS.sans,
                  }}
                >
                  {teamBName}
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    color: colors.ink,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  Score: {selectedDatum.inn2TotalRuns}/
                  {selectedDatum.inn2TotalWickets} ({selectedDatum.inn2Runs}{" "}
                  off over)
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: "700",
                    color: colors.ink,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  Run Rate: {selectedDatum.inn2Crr?.toFixed(2)} rpo
                </Text>
              </View>
            )}
          </View>
        )}
      </View>

      {/* PHASE RUN-RATE ANALYTICS CARDS */}
      {phaseMetrics && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {/* Powerplay */}
          <View
            style={{
              flex: 1,
              padding: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              flexDirection: "column",
              gap: 4,
            }}
          >
            <Text
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                fontWeight: "600",
                letterSpacing: 0.6,
                color: colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              Powerplay
            </Text>
            <Text
              style={{
                fontSize: 11,
                color: colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              {phaseMetrics.pp.range}
            </Text>
            <View
              style={{
                marginTop: 4,
                flexDirection: "column",
                gap: 2,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <Text
                  style={{
                    color: INN1_COLOR,
                    fontWeight: "600",
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                  }}
                >
                  {teamAShort}
                </Text>
                <Text
                  style={{
                    fontWeight: "700",
                    color: colors.ink,
                    fontSize: 12,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  {phaseMetrics.pp.inn1.runRate}{" "}
                  <Text style={{ fontSize: 10, fontWeight: "400" }}>rpo</Text>
                </Text>
              </View>
              {sc2 && (
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  }}
                >
                  <Text
                    style={{
                      color: INN2_COLOR,
                      fontWeight: "600",
                      fontSize: 12,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    {teamBShort}
                  </Text>
                  <Text
                    style={{
                      fontWeight: "700",
                      color: colors.ink,
                      fontSize: 12,
                      fontVariant: ["tabular-nums"],
                      fontFamily: FONTS.sans,
                    }}
                  >
                    {phaseMetrics.pp.inn2.runRate}{" "}
                    <Text style={{ fontSize: 10, fontWeight: "400" }}>rpo</Text>
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Middle Overs */}
          <View
            style={{
              flex: 1,
              padding: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              flexDirection: "column",
              gap: 4,
            }}
          >
            <Text
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                fontWeight: "600",
                letterSpacing: 0.6,
                color: colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              Middle Overs
            </Text>
            <Text
              style={{
                fontSize: 11,
                color: colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              {phaseMetrics.mid.range}
            </Text>
            <View
              style={{
                marginTop: 4,
                flexDirection: "column",
                gap: 2,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <Text
                  style={{
                    color: INN1_COLOR,
                    fontWeight: "600",
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                  }}
                >
                  {teamAShort}
                </Text>
                <Text
                  style={{
                    fontWeight: "700",
                    color: colors.ink,
                    fontSize: 12,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  {phaseMetrics.mid.inn1.runRate}{" "}
                  <Text style={{ fontSize: 10, fontWeight: "400" }}>rpo</Text>
                </Text>
              </View>
              {sc2 && (
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  }}
                >
                  <Text
                    style={{
                      color: INN2_COLOR,
                      fontWeight: "600",
                      fontSize: 12,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    {teamBShort}
                  </Text>
                  <Text
                    style={{
                      fontWeight: "700",
                      color: colors.ink,
                      fontSize: 12,
                      fontVariant: ["tabular-nums"],
                      fontFamily: FONTS.sans,
                    }}
                  >
                    {phaseMetrics.mid.inn2.runRate}{" "}
                    <Text style={{ fontSize: 10, fontWeight: "400" }}>rpo</Text>
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Death Overs */}
          <View
            style={{
              flex: 1,
              padding: 12,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              flexDirection: "column",
              gap: 4,
            }}
          >
            <Text
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                fontWeight: "600",
                letterSpacing: 0.6,
                color: colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              Death Overs
            </Text>
            <Text
              style={{
                fontSize: 11,
                color: colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              {phaseMetrics.death.range}
            </Text>
            <View
              style={{
                marginTop: 4,
                flexDirection: "column",
                gap: 2,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <Text
                  style={{
                    color: INN1_COLOR,
                    fontWeight: "600",
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                  }}
                >
                  {teamAShort}
                </Text>
                <Text
                  style={{
                    fontWeight: "700",
                    color: colors.ink,
                    fontSize: 12,
                    fontVariant: ["tabular-nums"],
                    fontFamily: FONTS.sans,
                  }}
                >
                  {phaseMetrics.death.inn1.runRate}{" "}
                  <Text style={{ fontSize: 10, fontWeight: "400" }}>rpo</Text>
                </Text>
              </View>
              {sc2 && (
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  }}
                >
                  <Text
                    style={{
                      color: INN2_COLOR,
                      fontWeight: "600",
                      fontSize: 12,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    {teamBShort}
                  </Text>
                  <Text
                    style={{
                      fontWeight: "700",
                      color: colors.ink,
                      fontSize: 12,
                      fontVariant: ["tabular-nums"],
                      fontFamily: FONTS.sans,
                    }}
                  >
                    {phaseMetrics.death.inn2.runRate}{" "}
                    <Text style={{ fontSize: 10, fontWeight: "400" }}>rpo</Text>
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  );
};
