/**
 * GullyScore Match Detail & Scorecard Screen
 *
 * 4 Tabs: Summary | Scorecard | Commentary | Analysis
 * Player of the Match MVP calculation + Branded Match Result Card generator.
 *
 * RN port notes:
 * - HTML tables → View rows (flexDirection row, fixed column widths).
 * - Web canvas poster + "Save Image" download dropped (no DOM canvas / file
 *   download): the share sheet shows the WhatsApp share text and the
 *   db.exportMatchToJson() payload as selectable TextInput content.
 * - navigator.clipboard copy dropped (no Clipboard module in deps): the
 *   "Copy for WhatsApp" button opens the share sheet with selectable text.
 */

import React, { useState, useMemo, useEffect } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Match, Player } from "../../types/cricket";
import { db } from "../../storage/db";
import {
  replayInnings,
  calculateMatchMVPPoints,
} from "../../engine/scoringEngine";
import {
  GullyButton,
  GullySegmented,
  GullySheet,
  ManhattanChart,
  WagonWheel,
} from "../common/Components";
import { calculatePreMatchPrediction } from "../../engine/predictionEngine";
// RN: dropped lucide Download/Copy/Check/TrendingUp icons (web-only download,
// clipboard & poster features; TrendingUp was imported but unused on web).
import { ChevronLeft, Share2, Award, Sparkles } from "lucide-react-native";
import { useTheme, FONTS } from "../../design/theme";

interface MatchDetailScreenProps {
  matchId: string;
  onBack: () => void;
  onResumeScoring?: (matchId: string) => void;
}

type ShareMode = "whatsapp" | "json";

export const MatchDetailScreen: React.FC<MatchDetailScreenProps> = ({
  matchId,
  onBack,
  onResumeScoring,
}) => {
  const { colors } = useTheme();
  const [match, setMatch] = useState<Match | undefined>(() => db.getMatch(matchId));
  const [playersMap, setPlayersMap] = useState<Record<string, Player>>(() => db.getPlayersMap());
  const [activeTab, setActiveTab] = useState<"summary" | "scorecard" | "commentary" | "analysis">("summary");
  const [scorecardInningsIdx, setScorecardInningsIdx] = useState<number>(0);
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  // RN: replaces the web canvas poster — sheet shows share text / match JSON.
  const [shareMode, setShareMode] = useState<ShareMode>("json");
  const [shareJson, setShareJson] = useState<string>("");

  // Stale-snapshot fix: this screen used to capture the match ONCE on mount.
  // Resuming scoring from detail (Scoring pushes ON TOP of this screen),
  // scoring balls and coming Back kept showing the PRE-scoring score, and a
  // match finished in the scorer still showed "Match in Progress" with a
  // live "Resume Live" link (which reopened a completed match). Re-read on
  // every data change, exactly like ScoringScreen and HomeScreen do.
  // NOTE: if the row vanishes mid-view (deleted / cloud tombstone) we KEEP
  // the last snapshot — switching match to undefined here would take the
  // early-return path below and skip the hooks after it (React "rendered
  // fewer hooks" crash → ErrorBoundary soft-lock).
  useEffect(() => {
    const unsub = db.subscribe(() => {
      const m = db.getMatch(matchId);
      if (m) {
        setMatch(m);
        setPlayersMap(db.getPlayersMap());
      }
    });
    return unsub;
  }, [matchId]);

  if (!match) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 32 }}
      >
        <Text style={{ color: colors.ink2, fontFamily: FONTS.sans }}>
          Match not found.
        </Text>
        <GullyButton onPress={onBack} style={{ marginTop: 16 }}>
          Back
        </GullyButton>
      </SafeAreaView>
    );
  }

  const teamA = db.getTeam(match.teamAId);
  const teamB = db.getTeam(match.teamBId);

  // Compute scorecards for both innings
  const inningsScorecards = useMemo(() => {
    return match.innings.map((inn, idx) => {
      // Target = the STORED innings.targetRuns (set by the scorer when the
      // 1st innings ended; includes extras). Recomputing from runsBat only
      // understated it by the whole extras tally (wides/no-balls/byes...),
      // marking chases complete before they actually were.
      const target =
        idx > 0
          ? inn.targetRuns ??
            (match.innings[0]?.ballEvents.reduce((acc, b) => acc + b.runsBat, 0) ?? 0) + 1
          : undefined;
      return replayInnings(
        inn.ballEvents,
        match.rules,
        inn.battingTeamId === match.teamAId ? match.teamAPlayerIds : match.teamBPlayerIds,
        inn.bowlingTeamId === match.teamAId ? match.teamAPlayerIds : match.teamBPlayerIds,
        playersMap,
        target,
        inn.isSuperOver
      );
    });
  }, [match, playersMap]);

  // Player of the Match MVP calculation
  const mvpPointsMap = useMemo(() => {
    return calculateMatchMVPPoints(inningsScorecards);
  }, [inningsScorecards]);

  const topMvpPlayerId = useMemo(() => {
    if (match.playerOfTheMatchId) return match.playerOfTheMatchId;
    let bestId = "";
    let maxPts = -1;
    Object.entries(mvpPointsMap).forEach(([id, stats]) => {
      if (stats.total > maxPts) {
        maxPts = stats.total;
        bestId = id;
      }
    });
    return bestId;
  }, [match.playerOfTheMatchId, mvpPointsMap]);

  const potmPlayer = playersMap[topMvpPlayerId];

  // Shot directions for wagon wheel
  const allShots = useMemo(() => {
    const shots: Array<{ direction: string; runs: number }> = [];
    match.innings.forEach((inn) => {
      inn.ballEvents.forEach((b) => {
        if (b.shotDirection) {
          shots.push({ direction: b.shotDirection, runs: b.runsBat });
        }
      });
    });
    return shots;
  }, [match]);

  // Pre-match prediction comparison
  const preMatchPred = useMemo(() => {
    if (!teamA || !teamB) return null;
    return calculatePreMatchPrediction(
      teamA,
      teamB,
      db.getMatches(),
      match.rules,
      match.venue
    );
  }, [teamA, teamB, match]);

  // Generate plain-text summary for WhatsApp sharing
  const generateWhatsAppShareText = () => {
    const inn1 = inningsScorecards[0];
    const inn2 = inningsScorecards[1];
    const t1Name = db.getTeam(match.innings[0]?.battingTeamId)?.shortName || "Team 1";
    const t2Name = db.getTeam(match.innings[1]?.battingTeamId)?.shortName || "Team 2";

    let text = `🏏 *${match.venue || "Gully Match"}*\n`;
    text += `${t1Name}: ${inn1?.totalRuns}/${inn1?.totalWickets} (${inn1?.oversFormatted} ov)\n`;
    if (inn2) {
      text += `${t2Name}: ${inn2?.totalRuns}/${inn2?.totalWickets} (${inn2?.oversFormatted} ov)\n`;
    }
    if (match.resultText) {
      text += `🏆 *${match.resultText}*\n`;
    }
    if (potmPlayer) {
      text += `⭐ POTM: ${potmPlayer.name} (${mvpPointsMap[topMvpPlayerId]?.total || 0} pts)\n`;
    }
    text += `\n_Scored on GullyScore (Private & Offline)_`;
    return text;
  };

  // RN: dropped navigator.clipboard copy (handleCopyWhatsApp on web) — no
  // Clipboard module; the sheet exposes the same text as selectable content.

  // RN: dropped drawResultCardPoster + handleDownloadImage (web drew a branded
  // poster onto an HTMLCanvasElement and triggered a .png download — no DOM
  // canvas or download API exists in React Native).

  const openShareSheet = (mode: ShareMode) => {
    if (mode === "json") {
      // The match can be deleted (cloud tombstone) between mount and this
      // tap — exportMatchToJson throws on a missing id and would hit the
      // ErrorBoundary. Share the object we already hold instead.
      try {
        setShareJson(db.exportMatchToJson(match.id));
      } catch {
        setShareJson(JSON.stringify({ type: "gullyscore_single_match", match }, null, 2));
      }
    }
    setShareMode(mode);
    setShowShareModal(true);
  };

  // Shared table cell styles (web table → View rows)
  const thStyle = {
    fontSize: 10,
    fontFamily: FONTS.sans as string | undefined,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    color: colors.ink2,
    fontWeight: "600" as const,
  };
  const tnum = { fontVariant: ["tabular-nums"] as const };

  const card = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 10,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Top App Bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
        }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <ChevronLeft size={20} strokeWidth={1.5} color={colors.ink} />
          <Text style={{ fontSize: 14, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink }}>
            Matches
          </Text>
        </Pressable>

        <Text
          numberOfLines={1}
          style={{
            fontSize: 14,
            fontFamily: FONTS.serif,
            fontWeight: "600",
            color: colors.ink,
            maxWidth: 180,
          }}
        >
          {teamA?.shortName} vs {teamB?.shortName}
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {match.status === "live" && onResumeScoring ? (
            <Pressable onPress={() => onResumeScoring(match.id)} hitSlop={8}>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: FONTS.sans,
                  fontWeight: "600",
                  color: colors.accent,
                  textDecorationLine: "underline",
                }}
              >
                Resume Live
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => openShareSheet("json")} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
            <Share2 size={20} strokeWidth={1.5} color={colors.ink2} />
          </Pressable>
        </View>
      </View>

      {/* Tabs */}
      <View
        style={{
          justifyContent: "center",
          alignItems: "center",
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
          backgroundColor: colors.surface,
          paddingVertical: 8,
        }}
      >
        <GullySegmented
          options={[
            { label: "Summary", value: "summary" },
            { label: "Scorecard", value: "scorecard" },
            { label: "Commentary", value: "commentary" },
            { label: "Analysis", value: "analysis" },
          ]}
          value={activeTab}
          onChange={(tab) => setActiveTab(tab)}
        />
      </View>

      {/* Tab Content */}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{
          width: "100%",
          maxWidth: 672,
          alignSelf: "center",
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 48,
        }}
      >
        {activeTab === "summary" && (
          <View style={{ flexDirection: "column", gap: 16 }}>
            {/* Result Banner */}
            <View style={[card, { padding: 16, alignItems: "center" }]}>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: FONTS.sans,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: colors.ink2,
                  fontWeight: "600",
                }}
              >
                {match.venue} · {match.date}
              </Text>
              <Text
                style={{
                  fontSize: 20,
                  fontFamily: FONTS.serif,
                  fontWeight: "700",
                  color: colors.ink,
                  marginTop: 4,
                  marginBottom: 8,
                  textAlign: "center",
                }}
              >
                {match.resultText || (match.status === "live" ? "Match in Progress" : "Match Abandoned")}
              </Text>

              {/* Innings Scores Comparison */}
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: 32,
                  paddingVertical: 12,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                  alignSelf: "stretch",
                }}
              >
                {inningsScorecards.map((sc, i) => {
                  const t = db.getTeam(match.innings[i]?.battingTeamId);
                  return (
                    <View key={i} style={{ alignItems: "center" }}>
                      <Text
                        style={{
                          fontSize: 12,
                          fontFamily: FONTS.sans,
                          textTransform: "uppercase",
                          fontWeight: "600",
                          color: colors.ink2,
                        }}
                      >
                        {t?.name}
                      </Text>
                      <Text
                        style={[
                          {
                            fontSize: 30,
                            fontFamily: FONTS.serif,
                            fontWeight: "700",
                            color: colors.ink,
                          },
                          tnum,
                        ]}
                      >
                        {sc.totalRuns}/{sc.totalWickets}
                      </Text>
                      <Text style={[{ fontSize: 12, color: colors.ink2 }, tnum]}>
                        ({sc.oversFormatted} ov)
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Player of the Match Banner */}
            {potmPlayer && (
              <View
                style={[
                  card,
                  {
                    padding: 16,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  },
                ]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: colors.accentSubtle,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Award size={20} strokeWidth={1.5} color={colors.accent} />
                  </View>
                  <View style={{ flexShrink: 1 }}>
                    <Text
                      style={{
                        fontSize: 11,
                        fontFamily: FONTS.sans,
                        textTransform: "uppercase",
                        letterSpacing: 1,
                        color: colors.ink2,
                        fontWeight: "600",
                      }}
                    >
                      Player of the Match (MVP)
                    </Text>
                    <Text
                      style={{
                        fontSize: 16,
                        fontFamily: FONTS.serif,
                        fontWeight: "700",
                        color: colors.ink,
                      }}
                    >
                      {potmPlayer.name}
                    </Text>
                  </View>
                </View>

                <View style={{ alignItems: "flex-end" }}>
                  <Text
                    style={[
                      {
                        fontSize: 18,
                        fontFamily: FONTS.serif,
                        fontWeight: "700",
                        color: colors.ink,
                      },
                      tnum,
                    ]}
                  >
                    {mvpPointsMap[topMvpPlayerId]?.total || 0}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.ink2 }}>pts</Text>
                </View>
              </View>
            )}

            {/* Top Performers Section */}
            <View style={[card, { padding: 16 }]}>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: FONTS.sans,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: colors.ink2,
                  fontWeight: "600",
                  marginBottom: 12,
                }}
              >
                Top Performers
              </Text>

              <View style={{ flexDirection: "column" }}>
                {inningsScorecards.flatMap((sc) => sc.batters).sort((a, b) => b.runs - a.runs).slice(0, 3).map((b, idx, arr) => (
                  <View
                    key={b.playerId}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      paddingVertical: 8,
                      borderBottomWidth: idx < arr.length - 1 ? 1 : 0,
                      borderBottomColor: colors.hairline,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontFamily: FONTS.sans, color: colors.ink }}>
                      {playersMap[b.playerId]?.name}
                    </Text>
                    <Text
                      style={[
                        { fontSize: 14, fontFamily: FONTS.sans, fontWeight: "600", color: colors.ink },
                        tnum,
                      ]}
                    >
                      {b.runs} ({b.ballsFaced}b, {b.fours}x4, {b.sixes}x6)
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Pre-Match Prediction Review */}
            {preMatchPred && (
              <View style={[card, { padding: 16, flexDirection: "column", gap: 8 }]}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottomWidth: 1,
                    borderBottomColor: colors.hairline,
                    paddingBottom: 8,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Sparkles size={16} color={colors.accent} />
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: FONTS.sans,
                        textTransform: "uppercase",
                        letterSpacing: 1,
                        color: colors.ink2,
                        fontWeight: "600",
                      }}
                    >
                      Statistical Prediction Review
                    </Text>
                  </View>
                  <Text style={[{ fontSize: 11, color: colors.ink2 }, tnum]}>
                    Pre-match Par: {preMatchPred.predictedParScore}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
                  <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink }}>
                    Pre-Match Forecast:
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: FONTS.sans,
                      fontWeight: "600",
                      color: colors.ink,
                      flexShrink: 1,
                      paddingLeft: 8,
                      textAlign: "right",
                    }}
                  >
                    {teamA?.shortName} ({preMatchPred.teamAWinProb}%) vs {teamB?.shortName} ({preMatchPred.teamBWinProb}%)
                  </Text>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink }}>
                    Venue Par Accuracy:
                  </Text>
                  <Text style={[{ fontSize: 12, fontFamily: FONTS.sans, fontWeight: "600", color: colors.ink }, tnum]}>
                    Predicted {preMatchPred.predictedParScore} vs Actual {inningsScorecards[0]?.totalRuns || "-"}
                  </Text>
                </View>

                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: FONTS.sans,
                    color: colors.ink2,
                    fontStyle: "italic",
                    marginTop: 4,
                  }}
                >
                  {preMatchPred.predictionRationale}
                </Text>
              </View>
            )}

            {/* Share Quick Buttons */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <GullyButton
                variant="quiet"
                fullWidth
                onPress={() => openShareSheet("whatsapp")}
              >
                Copy for WhatsApp
              </GullyButton>
              <GullyButton
                variant="primary"
                fullWidth
                onPress={() => openShareSheet("json")}
              >
                Export JSON
              </GullyButton>
            </View>
          </View>
        )}

        {activeTab === "scorecard" && (
          <View style={{ flexDirection: "column", gap: 16 }}>
            {/* Innings selector tabs if 2 innings */}
            {match.innings.length > 1 && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                {match.innings.map((inn, i) => {
                  const t = db.getTeam(inn.battingTeamId);
                  const active = scorecardInningsIdx === i;
                  return (
                    <Pressable
                      key={i}
                      onPress={() => setScorecardInningsIdx(i)}
                      style={{
                        flex: 1,
                        paddingVertical: 8,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: active ? colors.accent : colors.hairline,
                        backgroundColor: active ? colors.accentSubtle : "transparent",
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontFamily: FONTS.sans,
                          fontWeight: active ? "600" : "500",
                          color: active ? colors.accent : colors.ink2,
                        }}
                      >
                        {t?.shortName} Innings ({inningsScorecards[i]?.totalRuns}/{inningsScorecards[i]?.totalWickets})
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            {(() => {
              const sc = inningsScorecards[scorecardInningsIdx];
              if (!sc) return null;
              const batTeam = db.getTeam(match.innings[scorecardInningsIdx]?.battingTeamId);

              return (
                <View style={{ flexDirection: "column", gap: 16 }}>
                  {/* Batting Table */}
                  <View style={[card, { overflow: "hidden" }]}>
                    <View
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        backgroundColor: colors.surfaceCard,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.hairline,
                      }}
                    >
                      <Text style={{ fontFamily: FONTS.serif, fontWeight: "600", fontSize: 14, color: colors.ink }}>
                        {batTeam?.name} — Batting
                      </Text>
                    </View>
                    <View>
                      {/* table head */}
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          borderBottomWidth: 1,
                          borderBottomColor: colors.hairline,
                          paddingVertical: 8,
                          paddingLeft: 16,
                          paddingRight: 16,
                        }}
                      >
                        <Text style={[thStyle, { flex: 1 }]}>Batter</Text>
                        <Text style={[thStyle, { width: 34, textAlign: "right" }]}>R</Text>
                        <Text style={[thStyle, { width: 34, textAlign: "right" }]}>B</Text>
                        <Text style={[thStyle, { width: 34, textAlign: "right" }]}>4s</Text>
                        <Text style={[thStyle, { width: 34, textAlign: "right" }]}>6s</Text>
                        <Text style={[thStyle, { width: 52, textAlign: "right" }]}>SR</Text>
                      </View>
                      {/* table body (web divide-y → per-row bottom hairline) */}
                      {sc.batters.map((b, idx) => (
                        <View
                          key={b.playerId}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            paddingVertical: 10,
                            paddingLeft: 16,
                            paddingRight: 16,
                            borderBottomWidth: idx < sc.batters.length - 1 ? 1 : 0,
                            borderBottomColor: colors.hairline,
                          }}
                        >
                          <View style={{ flex: 1, paddingRight: 8 }}>
                            <Text style={{ fontSize: 14, fontFamily: FONTS.sans, fontWeight: "600", color: colors.ink }}>
                              {playersMap[b.playerId]?.name} {!b.isOut && "*"}
                            </Text>
                            <Text style={{ fontSize: 11, fontFamily: FONTS.sans, color: colors.ink2 }}>
                              {b.isOut ? b.dismissalText : "not out"}
                            </Text>
                          </View>
                          <Text style={[{ width: 34, textAlign: "right", fontSize: 14, fontFamily: FONTS.sans, fontWeight: "700", color: colors.ink }, tnum]}>
                            {b.runs}
                          </Text>
                          <Text style={[{ width: 34, textAlign: "right", fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }, tnum]}>
                            {b.ballsFaced}
                          </Text>
                          <Text style={[{ width: 34, textAlign: "right", fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }, tnum]}>
                            {b.fours}
                          </Text>
                          <Text style={[{ width: 34, textAlign: "right", fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }, tnum]}>
                            {b.sixes}
                          </Text>
                          <Text style={[{ width: 52, textAlign: "right", fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }, tnum]}>
                            {b.strikeRate.toFixed(1)}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {/* Extras & Total */}
                    <View
                      style={{
                        padding: 12,
                        borderTopWidth: 1,
                        borderTopColor: colors.hairline,
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        backgroundColor: colors.surfaceCard,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2, flexShrink: 1 }}>
                        Extras: {sc.extras.total} (wd {sc.extras.wides}, nb {sc.extras.noBalls}, b {sc.extras.byes}, lb {sc.extras.legByes})
                      </Text>
                      <Text style={[{ fontSize: 14, fontFamily: FONTS.serif, fontWeight: "700", color: colors.ink }, tnum]}>
                        Total: {sc.totalRuns}/{sc.totalWickets} ({sc.oversFormatted} ov)
                      </Text>
                    </View>

                    {/* Did not bat */}
                    {sc.didNotBatPlayerIds.length > 0 && (
                      <View
                        style={{
                          padding: 12,
                          borderTopWidth: 1,
                          borderTopColor: colors.hairline,
                        }}
                      >
                        <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }}>
                          Did not bat:{" "}
                          {sc.didNotBatPlayerIds.map((id) => playersMap[id]?.name).join(", ")}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Bowling Table */}
                  <View style={[card, { overflow: "hidden" }]}>
                    <View
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 10,
                        backgroundColor: colors.surfaceCard,
                        borderBottomWidth: 1,
                        borderBottomColor: colors.hairline,
                      }}
                    >
                      <Text style={{ fontFamily: FONTS.serif, fontWeight: "600", fontSize: 14, color: colors.ink }}>
                        Bowling
                      </Text>
                    </View>
                    <View>
                      {/* table head */}
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          borderBottomWidth: 1,
                          borderBottomColor: colors.hairline,
                          paddingVertical: 8,
                          paddingLeft: 16,
                          paddingRight: 16,
                        }}
                      >
                        <Text style={[thStyle, { flex: 1 }]}>Bowler</Text>
                        <Text style={[thStyle, { width: 34, textAlign: "right" }]}>O</Text>
                        <Text style={[thStyle, { width: 34, textAlign: "right" }]}>M</Text>
                        <Text style={[thStyle, { width: 34, textAlign: "right" }]}>R</Text>
                        <Text style={[thStyle, { width: 34, textAlign: "right" }]}>W</Text>
                        <Text style={[thStyle, { width: 52, textAlign: "right" }]}>Econ</Text>
                      </View>
                      {/* table body */}
                      {sc.bowlers.map((bw, idx) => (
                        <View
                          key={bw.playerId}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            paddingVertical: 10,
                            paddingLeft: 16,
                            paddingRight: 16,
                            borderBottomWidth: idx < sc.bowlers.length - 1 ? 1 : 0,
                            borderBottomColor: colors.hairline,
                          }}
                        >
                          <Text style={{ flex: 1, fontSize: 14, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink, paddingRight: 8 }}>
                            {playersMap[bw.playerId]?.name}
                          </Text>
                          <Text style={[{ width: 34, textAlign: "right", fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }, tnum]}>
                            {bw.overs.toFixed(1)}
                          </Text>
                          <Text style={[{ width: 34, textAlign: "right", fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }, tnum]}>
                            {bw.maidens}
                          </Text>
                          <Text style={[{ width: 34, textAlign: "right", fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }, tnum]}>
                            {bw.runsConceded}
                          </Text>
                          <Text style={[{ width: 34, textAlign: "right", fontSize: 14, fontFamily: FONTS.sans, fontWeight: "700", color: colors.ink }, tnum]}>
                            {bw.wickets}
                          </Text>
                          <Text style={[{ width: 52, textAlign: "right", fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }, tnum]}>
                            {bw.economy.toFixed(2)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Fall of Wickets */}
                  {sc.fallOfWickets.length > 0 && (
                    <View style={[card, { padding: 12 }]}>
                      <Text
                        style={{
                          fontFamily: FONTS.sans,
                          fontWeight: "600",
                          textTransform: "uppercase",
                          letterSpacing: 1,
                          color: colors.ink2,
                          fontSize: 10,
                          marginBottom: 4,
                        }}
                      >
                        Fall of Wickets
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 16, rowGap: 4 }}>
                        {sc.fallOfWickets.map((fow) => (
                          <Text key={fow.wicketNumber} style={[{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink }, tnum]}>
                            <Text style={{ fontWeight: "700" }}>{fow.score}/{fow.wicketNumber}</Text> ({playersMap[fow.playerId]?.name}, {fow.overs} ov)
                          </Text>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              );
            })()}
          </View>
        )}

        {activeTab === "commentary" && (
          <View style={{ flexDirection: "column", gap: 12 }}>
            <Text
              style={{
                fontSize: 12,
                fontFamily: FONTS.sans,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: colors.ink2,
                fontWeight: "600",
              }}
            >
              Ball-by-Ball Commentary
            </Text>
            <View style={{ flexDirection: "column", gap: 8 }}>
              {match.innings[scorecardInningsIdx]?.ballEvents.slice().reverse().map((b) => (
                <View
                  key={b.id}
                  style={[card, { padding: 12, borderRadius: 8 }]}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4,
                      gap: 8,
                    }}
                  >
                    <Text style={{ fontFamily: FONTS.serif, fontWeight: "700", fontSize: 12, color: colors.ink }}>
                      {b.overNumber}.{b.ballInOver}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 11, fontFamily: FONTS.sans, color: colors.ink2, flexShrink: 1, textAlign: "right" }}
                    >
                      {playersMap[b.bowlerId]?.name} to {playersMap[b.strikerId]?.name}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink, lineHeight: 20 }}>
                    {b.commentaryText}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {activeTab === "analysis" && (
          <View style={{ flexDirection: "column", gap: 16 }}>
            {/* Manhattan Chart */}
            <View style={[card, { padding: 16 }]}>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: FONTS.sans,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: colors.ink2,
                  fontWeight: "600",
                  marginBottom: 8,
                }}
              >
                Manhattan (Runs & Wickets Per Over)
              </Text>
              <ManhattanChart
                overs={inningsScorecards[scorecardInningsIdx]?.overSummaries || []}
              />
            </View>

            {/* Wagon Wheel */}
            <View style={[card, { padding: 16, flexDirection: "column", alignItems: "center" }]}>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: FONTS.sans,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  color: colors.ink2,
                  fontWeight: "600",
                  marginBottom: 12,
                  textAlign: "center",
                }}
              >
                Wagon Wheel (Shot Directions)
              </Text>
              <WagonWheel shots={allShots} width={280} height={280} />
            </View>
          </View>
        )}
      </ScrollView>

      {/* --- SHARE SHEET (web poster modal → selectable text sheet) --- */}
      <GullySheet
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        title="Share Match"
      >
        <GullySegmented
          options={[
            { label: "WhatsApp Text", value: "whatsapp" },
            { label: "Export JSON", value: "json" },
          ]}
          value={shareMode}
          onChange={(m) => setShareMode(m)}
        />
        {/* RN: selectable read-only text — long-press to copy (no clipboard API). */}
        <TextInput
          multiline
          editable={false}
          value={shareMode === "json" ? shareJson : generateWhatsAppShareText()}
          style={{
            marginTop: 16,
            minHeight: 180,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            fontFamily: FONTS.sans,
            color: colors.ink,
            textAlignVertical: "top",
            backgroundColor: colors.surfaceCard,
          }}
        />
        <GullyButton
          variant="quiet"
          fullWidth
          style={{ marginTop: 12 }}
          onPress={() => setShowShareModal(false)}
        >
          Close
        </GullyButton>
      </GullySheet>
    </SafeAreaView>
  );
};
