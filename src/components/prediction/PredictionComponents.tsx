/**
 * GullyScore Prediction UI Components
 *
 * Strict editorial aesthetics: zero AI slop, no purple/blue gradients,
 * high-contrast daylight legibility, and tabular figures.
 *
 * RN port notes:
 * - CSS-var tokens → useTheme() palette (same values).
 * - HTML div/span → View/Text; clickable cards → Pressable (onClick → onPress).
 * - tnum → fontVariant: ["tabular-nums"] (RN 0.88 TextStyle has no
 *   fontFeatureSettings; fontVariant achieves the same tabular figures).
 */

import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  LiveWinProbability,
  NrrScenarioRequirement,
  PreMatchPrediction,
  ProjectedScoreModel,
  TournamentSimulationResult,
  UserPredictionGuess,
} from "../../engine/predictionEngine";
import { Team } from "../../types/cricket";
import { GullyButton, GullySheet, GullyTextField } from "../common/Components";
import {
  TrendingUp,
  Target,
  Sparkles,
  HelpCircle,
  Calculator,
  Award,
  Users,
} from "lucide-react-native";
import { useTheme, FONTS } from "../../design/theme";

// --- LIVE WIN PROBABILITY BAR ---
export const LiveWinProbBar: React.FC<{
  prob: LiveWinProbability;
  teamA: Team | undefined;
  teamB: Team | undefined;
  onPressDetails?: () => void;
}> = ({ prob, teamA, teamB, onPressDetails }) => {
  const { colors } = useTheme();
  const teamAName = teamA?.shortName || "Team A";
  const teamBName = teamB?.shortName || "Team B";

  const colorA = teamA?.color || "#0E1B2E";
  const colorB = teamB?.color || "#B4232A";

  return (
    <Pressable
      onPress={onPressDetails}
      disabled={!onPressDetails}
      style={({ pressed }) => [
        {
          width: "100%",
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor:
            onPressDetails && pressed
              ? colors.hairlineStrong
              : colors.hairline,
          borderRadius: 8,
          padding: 10,
          opacity: onPressDetails && pressed ? 0.9 : 1,
        },
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 1,
              backgroundColor: colorA,
            }}
          />
          <Text
            style={{
              fontSize: 12,
              fontFamily: FONTS.sans,
              fontWeight: "600",
              color: colors.ink,
            }}
          >
            {teamAName}
          </Text>
          <Text
            style={{
              fontSize: 12,
              fontFamily: FONTS.serif,
              fontWeight: "700",
              color: colors.ink,
              fontVariant: ["tabular-nums"],
            }}
          >
            {prob.teamAWinProb}%
          </Text>
        </View>

        <Text
          numberOfLines={1}
          style={{
            fontSize: 10,
            color: colors.ink2,
            fontFamily: FONTS.serif,
            fontStyle: "italic",
            maxWidth: 140,
            flexShrink: 1,
          }}
        >
          Win Predictor
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            style={{
              fontSize: 12,
              fontFamily: FONTS.serif,
              fontWeight: "700",
              color: colors.ink,
              fontVariant: ["tabular-nums"],
            }}
          >
            {prob.teamBWinProb}%
          </Text>
          <Text
            style={{
              fontSize: 12,
              fontFamily: FONTS.sans,
              fontWeight: "600",
              color: colors.ink,
            }}
          >
            {teamBName}
          </Text>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 1,
              backgroundColor: colorB,
            }}
          />
        </View>
      </View>

      {/* Dual Progress Bar */}
      <View
        style={{
          width: "100%",
          height: 6,
          backgroundColor: colors.hairline,
          borderRadius: 2,
          overflow: "hidden",
          flexDirection: "row",
        }}
      >
        <View
          style={{
            width: `${prob.teamAWinProb}%`,
            backgroundColor: colorA,
            height: "100%",
          }}
        />
        <View
          style={{
            width: `${prob.teamBWinProb}%`,
            backgroundColor: colorB,
            height: "100%",
          }}
        />
      </View>

      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 6,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            fontSize: 10,
            color: colors.ink2,
            fontFamily: FONTS.sans,
            paddingRight: 8,
            flexShrink: 1,
          }}
        >
          {prob.marginDescription}
        </Text>
        {onPressDetails ? (
          <Text
            style={{
              fontSize: 10,
              color: colors.ink2,
              fontFamily: FONTS.sans,
              textDecorationLine: "underline",
              flexShrink: 0,
            }}
          >
            Model Details
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
};

// --- PROJECTED SCORE STRIP ---
export const ProjectedScoreStrip: React.FC<{
  model: ProjectedScoreModel;
  onPressDetails?: () => void;
}> = ({ model, onPressDetails }) => {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPressDetails}
      style={({ pressed }) => [
        {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          paddingVertical: 8,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: pressed ? colors.hairlineStrong : colors.hairline,
          borderRadius: 8,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <TrendingUp size={16} color={colors.accent} />
        <View>
          <Text
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: colors.ink2,
              fontFamily: FONTS.sans,
              fontWeight: "600",
            }}
          >
            Projected Total
          </Text>
          <Text
            style={{
              fontFamily: FONTS.serif,
              fontWeight: "700",
              fontSize: 14,
              color: colors.ink,
              fontVariant: ["tabular-nums"],
            }}
          >
            {model.projectedMin} – {model.projectedMax} runs
          </Text>
        </View>
      </View>

      <View style={{ alignItems: "flex-end" }}>
        <Text
          style={{
            fontSize: 10,
            color: colors.ink2,
            fontFamily: FONTS.sans,
            fontVariant: ["tabular-nums"],
          }}
        >
          Par: {model.parScore} · CRR: {model.atCurrentRate}
        </Text>
        <Text
          style={{
            fontSize: 11,
            fontFamily: FONTS.sans,
            fontWeight: "500",
            color: colors.accent,
            fontVariant: ["tabular-nums"],
          }}
        >
          Median {model.projectedMedian}
        </Text>
      </View>
    </Pressable>
  );
};

// --- PRE-MATCH PREDICTION BANNER ---
export const PreMatchPredictionCard: React.FC<{
  pred: PreMatchPrediction;
  teamA: Team | undefined;
  teamB: Team | undefined;
}> = ({ pred, teamA, teamB }) => {
  const { colors } = useTheme();
  return (
    <View
      style={{
        padding: 16,
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
              textTransform: "uppercase",
              letterSpacing: 1,
              fontFamily: FONTS.sans,
              fontWeight: "600",
              color: colors.ink,
            }}
          >
            Pre-Match Win Probability
          </Text>
        </View>
        <Text
          style={{
            fontSize: 12,
            color: colors.ink2,
            fontFamily: FONTS.sans,
            fontVariant: ["tabular-nums"],
          }}
        >
          Par: ~{pred.predictedParScore}
        </Text>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: teamA?.color || "#0E1B2E",
            }}
          />
          <Text
            style={{
              fontFamily: FONTS.serif,
              fontWeight: "700",
              fontSize: 14,
              color: colors.ink,
              fontVariant: ["tabular-nums"],
            }}
          >
            {teamA?.shortName}: {pred.teamAWinProb}%
          </Text>
        </View>

        <Text
          style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans }}
        >
          vs
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              fontFamily: FONTS.serif,
              fontWeight: "700",
              fontSize: 14,
              color: colors.ink,
              fontVariant: ["tabular-nums"],
            }}
          >
            {pred.teamBWinProb}% :{teamB?.shortName}
          </Text>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: teamB?.color || "#B4232A",
            }}
          />
        </View>
      </View>

      {/* Probability Bar */}
      <View
        style={{
          width: "100%",
          height: 6,
          backgroundColor: colors.hairline,
          borderRadius: 2,
          overflow: "hidden",
          flexDirection: "row",
        }}
      >
        <View
          style={{
            width: `${pred.teamAWinProb}%`,
            backgroundColor: teamA?.color || "#0E1B2E",
            height: "100%",
          }}
        />
        <View
          style={{
            width: `${pred.teamBWinProb}%`,
            backgroundColor: teamB?.color || "#B4232A",
            height: "100%",
          }}
        />
      </View>

      <Text
        style={{
          fontSize: 12,
          color: colors.ink2,
          fontFamily: FONTS.sans,
          lineHeight: 20,
        }}
      >
        {pred.predictionRationale}
      </Text>

      {pred.tossAdvantage !== "neutral" && (
        <Text
          style={{
            fontSize: 11,
            color: colors.ink2,
            fontFamily: FONTS.sans,
            paddingTop: 4,
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
          }}
        >
          Toss Trend: Teams choosing to{" "}
          <Text style={{ fontWeight: "700" }}>{pred.tossAdvantage}</Text> win{" "}
          <Text style={{ fontWeight: "700" }}>{pred.tossAdvantagePct}%</Text>{" "}
          of games at this venue.
        </Text>
      )}
    </View>
  );
};

// --- NRR "WHAT DO WE NEED?" SCENARIO SOLVER WIDGET ---
export const NrrScenarioWidget: React.FC<{
  scenario: NrrScenarioRequirement;
  teamName: string;
  targetOpponentName: string;
}> = ({ scenario, teamName, targetOpponentName }) => {
  const { colors } = useTheme();
  return (
    <View
      style={{
        padding: 16,
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
          gap: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
          paddingBottom: 8,
        }}
      >
        <Calculator size={16} color={colors.accent} />
        <Text
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: 1,
            fontFamily: FONTS.sans,
            fontWeight: "600",
            color: colors.ink,
            flex: 1,
          }}
        >
          NRR Qualification Equation ({teamName} vs {targetOpponentName})
        </Text>
      </View>

      {/* RN: web grid (1 col on mobile, 2 cols on sm+) → stacked column */}
      <View style={{ flexDirection: "column", gap: 12 }}>
        {/* Scenario A: Batting First */}
        <View
          style={{
            padding: 12,
            backgroundColor: colors.surfaceCard,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: 8,
            flexDirection: "column",
            gap: 4,
          }}
        >
          <Text
            style={{
              fontFamily: FONTS.sans,
              fontWeight: "600",
              color: colors.ink,
              fontSize: 12,
            }}
          >
            If {teamName} Bats First
          </Text>
          <Text
            style={{
              fontFamily: FONTS.sans,
              color: colors.ink2,
              fontSize: 12,
              lineHeight: 20,
            }}
          >
            Assuming a score of{" "}
            <Text style={{ fontWeight: "700" }}>
              {scenario.battingFirstEquation.assumedTeamScore}
            </Text>
            , {teamName} must restrict {targetOpponentName} to{" "}
            <Text style={{ fontWeight: "700", color: colors.accent }}>
              ≤ {scenario.battingFirstEquation.maxRunsOpponentAllowed} runs
            </Text>
            .
          </Text>
          <Text
            style={{
              fontSize: 11,
              fontFamily: FONTS.sans,
              color: colors.ink,
              fontWeight: "600",
              marginTop: 4,
            }}
          >
            Required Victory Margin: ≥{" "}
            {scenario.battingFirstEquation.marginRunsRequired} runs
          </Text>
        </View>

        {/* Scenario B: Chasing */}
        <View
          style={{
            padding: 12,
            backgroundColor: colors.surfaceCard,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: 8,
            flexDirection: "column",
            gap: 4,
          }}
        >
          <Text
            style={{
              fontFamily: FONTS.sans,
              fontWeight: "600",
              color: colors.ink,
              fontSize: 12,
            }}
          >
            If {teamName} Chases
          </Text>
          <Text
            style={{
              fontFamily: FONTS.sans,
              color: colors.ink2,
              fontSize: 12,
              lineHeight: 20,
            }}
          >
            Chasing a target of{" "}
            <Text style={{ fontWeight: "700" }}>
              {scenario.chasingEquation.targetToChase}
            </Text>
            , {teamName} must reach target in{" "}
            <Text style={{ fontWeight: "700", color: colors.accent }}>
              ≤ {scenario.chasingEquation.maxOversAllowed} overs
            </Text>{" "}
            ({scenario.chasingEquation.maxBallsAllowed} balls).
          </Text>
          <Text
            style={{
              fontSize: 11,
              fontFamily: FONTS.sans,
              color: colors.ink,
              fontWeight: "600",
              marginTop: 4,
            }}
          >
            Required Chasing Pace: &gt;{" "}
            {(
              scenario.chasingEquation.targetToChase /
              (scenario.chasingEquation.maxBallsAllowed / 6)
            ).toFixed(1)}{" "}
            RPO
          </Text>
        </View>
      </View>
    </View>
  );
};

// --- TOURNAMENT MONTE CARLO SIMULATION TABLE ---
export const TournamentSimulationTable: React.FC<{
  results: TournamentSimulationResult[];
  teamsMap: Record<string, Team>;
}> = ({ results, teamsMap }) => {
  const { colors } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.hairline,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          backgroundColor: colors.surfaceCard,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text
          style={{
            fontFamily: FONTS.serif,
            fontWeight: "600",
            fontSize: 12,
            color: colors.ink,
          }}
        >
          Team
        </Text>
        <View
          style={{ flexDirection: "row", gap: 16, alignItems: "center" }}
        >
          <Text
            style={{
              width: 56,
              fontFamily: FONTS.serif,
              fontWeight: "600",
              fontSize: 12,
              color: colors.ink,
              textAlign: "right",
              fontVariant: ["tabular-nums"],
            }}
          >
            Champion
          </Text>
          <Text
            style={{
              width: 56,
              fontFamily: FONTS.serif,
              fontWeight: "600",
              fontSize: 12,
              color: colors.ink,
              textAlign: "right",
              fontVariant: ["tabular-nums"],
            }}
          >
            Top 2 (Final)
          </Text>
          <Text
            style={{
              width: 48,
              fontFamily: FONTS.serif,
              fontWeight: "600",
              fontSize: 12,
              color: colors.ink,
              textAlign: "right",
              fontVariant: ["tabular-nums"],
            }}
          >
            Proj Pts
          </Text>
        </View>
      </View>

      {/* RN: web divide-y → per-row bottom hairline (except last row) */}
      {results.map((r, idx) => {
        const t = teamsMap[r.teamId];
        return (
          <View
            key={r.teamId}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 10,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottomWidth: idx < results.length - 1 ? 1 : 0,
              borderBottomColor: colors.hairline,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                flexShrink: 1,
                paddingRight: 8,
              }}
            >
              <Text
                style={{
                  fontFamily: FONTS.serif,
                  fontWeight: "700",
                  color: colors.ink2,
                  width: 16,
                  fontSize: 12,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {r.projectedRank}.
              </Text>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: FONTS.sans,
                  fontWeight: "600",
                  fontSize: 14,
                  color: colors.ink,
                  flexShrink: 1,
                }}
              >
                {t?.name || r.teamId}
              </Text>
            </View>

            <View
              style={{ flexDirection: "row", gap: 16, alignItems: "center" }}
            >
              <Text
                style={{
                  width: 56,
                  fontFamily: FONTS.sans,
                  fontWeight: "700",
                  fontSize: 12,
                  color: colors.accent,
                  textAlign: "right",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {r.championProbability}%
              </Text>
              <Text
                style={{
                  width: 56,
                  fontFamily: FONTS.sans,
                  fontSize: 12,
                  color: colors.ink,
                  textAlign: "right",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {r.topTwoProbability}%
              </Text>
              <Text
                style={{
                  width: 48,
                  fontFamily: FONTS.sans,
                  fontSize: 12,
                  color: colors.ink2,
                  textAlign: "right",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {r.projectedAveragePoints}
              </Text>
            </View>
          </View>
        );
      })}
      <Text
        style={{
          padding: 10,
          backgroundColor: colors.surfaceCard,
          borderTopWidth: 1,
          borderTopColor: colors.hairline,
          fontSize: 10,
          color: colors.ink2,
          fontFamily: FONTS.sans,
          textAlign: "center",
        }}
      >
        Simulated over 800 Monte Carlo tournament permutations based on form & NRR.
      </Text>
    </View>
  );
};
