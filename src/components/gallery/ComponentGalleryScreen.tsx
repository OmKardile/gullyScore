/**
 * GullyScore Component Gallery & Design QA Gate
 *
 * Audits every custom component and token against the design direction:
 * - Anti-default M3 verification
 * - Tabular numbers check
 * - Radius math: 2px, 10px, 16px
 * - Zero pill discipline
 * - Strict accent <= 5% usage
 *
 * RN port notes:
 * - Uses the ported common components (common/Components) and prediction
 *   components 1:1; recharts is swapped for the ported SVG
 *   RunRateProgressionChart behind the same exported name.
 * - Web also imported GullyChip/GullySegmented/GullyTextField and
 *   NrrScenarioWidget without rendering them — imports dropped here.
 */

import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronLeft, CheckSquare, Square } from "lucide-react-native";
import {
  GullyButton,
  OverRibbon,
  ScoreOdometer,
  WagonWheel,
  ManhattanChart,
} from "../common/Components";
import {
  LiveWinProbBar,
  ProjectedScoreStrip,
} from "../prediction/PredictionComponents";
import { RunRateProgressionChart } from "../stats/RunRateProgressionChart";
import { useTheme, FONTS } from "../../design/theme";

export const ComponentGalleryScreen: React.FC<{ onBack: () => void }> = ({
  onBack,
}) => {
  const { colors } = useTheme();
  const [segVal, setSegVal] = useState("bat");
  const [testScore, setTestScore] = useState(148);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({
    no_m3: true,
    no_hardcoded: true,
    accent_under_5: true,
    no_glass_shadows: true,
    tabular_numerals: true,
    single_focal_point: true,
    tap_budget_met: true,
    anti_slop: true,
  });

  const toggleCheck = (k: string) => {
    setChecklist((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const section = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 10,
    padding: 16,
  };
  const sectionLabel = {
    fontSize: 12,
    fontFamily: FONTS.sans as string | undefined,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    color: colors.ink2,
    fontWeight: "600" as const,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
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
            Settings
          </Text>
        </Pressable>
        <Text
          style={{
            fontSize: 14,
            fontFamily: FONTS.serif,
            fontWeight: "600",
            color: colors.ink,
          }}
        >
          Design QA &amp; Component Gallery
        </Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{
          width: "100%",
          maxWidth: 560,
          alignSelf: "center",
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 64,
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Design QA Gate Checklist */}
        <View style={[section, { flexDirection: "column", gap: 10 }]}>
          <Text style={sectionLabel}>
            Design QA Audit Gate (Strict &amp; Non-Negotiable)
          </Text>

          <View style={{ flexDirection: "column", gap: 8 }}>
            {[
              { id: "no_m3", label: "Zero default-M3-looking components visible (all custom)" },
              { id: "no_hardcoded", label: "Zero hardcoded colours/sizes/fonts outside Tokens" },
              { id: "accent_under_5", label: "Accent #B4232A covers <= 5% of screen (wickets/active only)" },
              { id: "no_glass_shadows", label: "No glassmorphism, heavy shadows, pills, or gradients" },
              { id: "tabular_numerals", label: "All numbers use tabular figures (tnum)" },
              { id: "single_focal_point", label: "Every screen has exactly one dominant focal anchor" },
              { id: "tap_budget_met", label: "Tap budget met: normal ball <= 1 tap, extras <= 2 taps" },
              { id: "anti_slop", label: "Zero generic AI sports app templates or floating cards" },
            ].map((item) => (
              <Pressable
                key={item.id}
                onPress={() => toggleCheck(item.id)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 4,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                {checklist[item.id] ? (
                  <CheckSquare size={16} color={colors.accent} />
                ) : (
                  <Square size={16} color={colors.ink2} />
                )}
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    fontFamily: FONTS.sans,
                    fontWeight: checklist[item.id] ? ("500" as const) : ("400" as const),
                    color: checklist[item.id] ? colors.ink : colors.ink2,
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Color Palette Tokens */}
        <View style={[section, { flexDirection: "column", gap: 12 }]}>
          <Text style={sectionLabel}>Color Tokens</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            {[
              { hex: "#F6F3EC", name: "Warm Paper", border: true },
              { hex: "#14161A", name: "Deep Ink", border: false },
              { hex: "#5B5F66", name: "Muted Ink 2", border: false },
              { hex: "#B4232A", name: "Ball Crimson", border: false },
            ].map((token) => (
              <View key={token.hex} style={{ flex: 1, alignItems: "center" }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 4,
                    backgroundColor: token.hex,
                    borderWidth: token.border ? 1 : 0,
                    borderColor: "rgba(0,0,0,0.1)",
                  }}
                />
                <Text
                  style={{
                    marginTop: 4,
                    fontFamily: "monospace",
                    fontSize: 10,
                    color: colors.ink,
                  }}
                >
                  {token.hex}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: FONTS.sans, color: colors.ink2 }}>
                  {token.name}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Score Odometer Preview */}
        <View style={[section, { flexDirection: "column", alignItems: "center" }]}>
          <Text style={[sectionLabel, { marginBottom: 8, textAlign: "center" }]}>
            Score As Typography (Fraunces + Odometer Spring)
          </Text>
          <ScoreOdometer
            runs={testScore}
            wickets={4}
            overs="14.3"
            crr={10.2}
            target={180}
            rrr={9.4}
          />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <GullyButton size="sm" onPress={() => setTestScore((s) => s + 1)}>
              +1 Run
            </GullyButton>
            <GullyButton size="sm" onPress={() => setTestScore((s) => s + 4)}>
              +4 Boundary
            </GullyButton>
            <GullyButton size="sm" onPress={() => setTestScore((s) => s + 6)}>
              +6 Maximum
            </GullyButton>
          </View>
        </View>

        {/* Button Hierarchy */}
        <View style={[section, { flexDirection: "column", gap: 12 }]}>
          <Text style={sectionLabel}>
            Custom Buttons (No M3 Ripples · Scale 0.98 Press)
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <GullyButton variant="primary">Primary (Ink)</GullyButton>
            <GullyButton variant="quiet">Quiet (Hairline)</GullyButton>
            <GullyButton variant="accent">Accent (Wicket)</GullyButton>
            <GullyButton variant="text">Text Only</GullyButton>
          </View>
        </View>

        {/* Over Ribbon */}
        <View style={[section, { flexDirection: "column", gap: 8 }]}>
          <Text style={sectionLabel}>
            Over Ribbon (Hairline Rings, Serif Weights, Solid Wicket)
          </Text>
          <OverRibbon
            balls={[
              { runsBat: 0, extraType: "none", extraRuns: 0, isWicket: false, isLegal: true },
              { runsBat: 1, extraType: "none", extraRuns: 0, isWicket: false, isLegal: true },
              { runsBat: 4, extraType: "none", extraRuns: 0, isWicket: false, isLegal: true },
              { runsBat: 0, extraType: "none", extraRuns: 0, isWicket: true, isLegal: true },
              { runsBat: 0, extraType: "wide", extraRuns: 1, isWicket: false, isLegal: false },
              { runsBat: 6, extraType: "none", extraRuns: 0, isWicket: false, isLegal: true },
            ]}
          />
        </View>

        {/* Wagon Wheel Drawing */}
        <View style={[section, { flexDirection: "column", alignItems: "center" }]}>
          <Text style={[sectionLabel, { marginBottom: 8, textAlign: "center" }]}>
            Wagon Wheel (Single-Stroke Canvas)
          </Text>
          <WagonWheel
            shots={[
              { direction: "cover", runs: 4 },
              { direction: "mid_wicket", runs: 6 },
              { direction: "straight", runs: 1 },
              { direction: "square_leg", runs: 2 },
              { direction: "long_off", runs: 4 },
            ]}
            width={240}
            height={240}
          />
        </View>

        {/* Manhattan Chart */}
        <View style={[section, { flexDirection: "column", gap: 8 }]}>
          <Text style={sectionLabel}>Manhattan Chart (Ink Style)</Text>
          <ManhattanChart
            overs={[
              { overNumber: 1, runs: 6, wickets: 0 },
              { overNumber: 2, runs: 14, wickets: 1 },
              { overNumber: 3, runs: 4, wickets: 0 },
              { overNumber: 4, runs: 18, wickets: 0 },
              { overNumber: 5, runs: 9, wickets: 2 },
            ]}
          />
        </View>

        {/* Prediction System Components */}
        <View style={[section, { flexDirection: "column", gap: 12 }]}>
          <Text style={sectionLabel}>
            Prediction System (Win Probability &amp; Projected Scores)
          </Text>

          <LiveWinProbBar
            prob={{
              teamAWinProb: 68,
              teamBWinProb: 32,
              tieProb: 0,
              favoriteTeamId: "t_spw",
              marginDescription: "68% favored · Need 28 runs in 18 balls (RRR 9.3)",
              keyFactor: "5 wickets in hand provides solid chasing cushion",
            }}
            teamA={{
              id: "t_spw",
              name: "Shivaji Park Warriors",
              shortName: "SPW",
              color: "#0E1B2E",
              monogram: "SPW",
              playerIds: [],
              createdAt: 0,
            }}
            teamB={{
              id: "t_gst",
              name: "Gully Strikers",
              shortName: "GST",
              color: "#B4232A",
              monogram: "GST",
              playerIds: [],
              createdAt: 0,
            }}
          />

          <ProjectedScoreStrip
            model={{
              atCurrentRate: 88,
              atParRate: 84,
              projectedMin: 76,
              projectedMedian: 92,
              projectedMax: 108,
              accelerationFactor: 1.35,
              parScore: 84,
            }}
          />
        </View>

        {/* Recharts Run-Rate Progression Chart */}
        <View style={[section, { flexDirection: "column", gap: 12 }]}>
          <Text style={sectionLabel}>
            Run-Rate Progression (Recharts Analytics)
          </Text>
          <RunRateProgressionChart />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
