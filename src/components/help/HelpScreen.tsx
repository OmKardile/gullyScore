/**
 * GullyScore Help & Scoring Rules Documentation Screen
 *
 * Explains event-sourced scoring, local cricket variations, MVP points formula,
 * and credits Omkar Kardile.
 *
 * RN port notes:
 * - Web sticky header → fixed header above the ScrollView (SafeAreaView top).
 * - Back rendered with GullyButton (its children are text-only, so the web's
 *   inline ChevronLeft icon is dropped).
 * - The credits <a href> link is web-only — rendered as styled static text.
 */

import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Award, BookOpen, ChevronRight, CircleHelp, ShieldCheck } from "lucide-react-native";
import { GullyButton } from "../common/Components";
import { useTheme, FONTS } from "../../design/theme";

export const HelpScreen: React.FC<{
  onBack: () => void;
  onOpenFaq: () => void;
}> = ({ onBack, onOpenFaq }) => {
  const { colors } = useTheme();
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
        <GullyButton variant="text" size="sm" onPress={onBack}>
          Back
        </GullyButton>
        <Text
          style={{
            fontSize: 14,
            fontFamily: FONTS.serif,
            fontWeight: "600",
            color: colors.ink,
          }}
        >
          Scoring Rules & MVP
        </Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingBottom: 64 }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 560,
            alignSelf: "center",
            paddingHorizontal: 16,
            paddingTop: 16,
            flexDirection: "column",
            gap: 24,
          }}
        >
          {/* FAQ quick link — the rules below are reference material; the
              FAQ answers the day-to-day "how do I…" questions first. */}
          <Pressable
            onPress={onOpenFaq}
            accessibilityRole="button"
            accessibilityLabel="Open frequently asked questions"
            style={({ pressed }) => [
              {
                backgroundColor: colors.surfaceCard,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                padding: 14,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.accentSubtle,
              }}
            >
              <CircleHelp size={18} strokeWidth={1.8} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontFamily: FONTS.serif,
                  fontWeight: "700",
                  fontSize: 15,
                  color: colors.ink,
                }}
              >
                Frequently Asked Questions
              </Text>
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: FONTS.sans,
                  color: colors.ink2,
                  marginTop: 2,
                }}
              >
                Getting started, mistakes &amp; undo, backup, wipe — quick answers.
              </Text>
            </View>
            <ChevronRight size={18} strokeWidth={2} color={colors.ink2} />
          </Pressable>

          {/* Core Engine Rules */}
          <View
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              padding: 16,
              flexDirection: "column",
              gap: 10,
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <BookOpen size={16} color={colors.accent} />
              <Text
                style={{
                  fontFamily: FONTS.serif,
                  fontWeight: "700",
                  fontSize: 16,
                  color: colors.ink,
                }}
              >
                Scoring Engine Rules
              </Text>
            </View>

            {/* RN: web ul/list-disc → bulleted rows */}
            <View style={{ paddingLeft: 20, gap: 6 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  •
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  <Text style={{ fontWeight: "700" }}>Event-Sourced:</Text> Every ball event is immutably stored. All scorecards, career averages, wagon wheels, and points tables are deterministically derived by replay.
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  •
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  <Text style={{ fontWeight: "700" }}>Wides & No-Balls:</Text> Not legal deliveries and must be re-bowled. Wides add extra runs charged to the bowler. No-balls grant bat runs to the batter, with the next delivery flagged as a Free Hit.
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  •
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  <Text style={{ fontWeight: "700" }}>Byes & Leg-Byes:</Text> Added to team total extras, not charged to the bowler. The batter faces a ball.
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  •
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  <Text style={{ fontWeight: "700" }}>Strike Rotation:</Text> Swaps automatically on odd completed runs (1, 3, 5) and at the end of each legal 6-ball over.
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  •
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  <Text style={{ fontWeight: "700" }}>Maiden Over:</Text> A full 6-ball legal over with 0 runs charged to the bowler (byes/leg-byes do not break a maiden).
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  •
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  <Text style={{ fontWeight: "700" }}>All-Out Condition:</Text> An innings ends at (players - 1) wickets, unless "Last-Man-Batting" is enabled where the solo batter continues.
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <Text
                  style={{
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  •
                </Text>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 12,
                    lineHeight: 20,
                    color: colors.ink,
                    fontFamily: FONTS.sans,
                  }}
                >
                  <Text style={{ fontWeight: "700" }}>Chase Completion:</Text> Match ends instantly when the chasing team surpasses the 1st innings target.
                </Text>
              </View>
            </View>
          </View>

          {/* Player of the Match MVP Formula */}
          <View
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              padding: 16,
              flexDirection: "column",
              gap: 10,
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <Award size={16} color={colors.accent} />
              <Text
                style={{
                  fontFamily: FONTS.serif,
                  fontWeight: "700",
                  fontSize: 16,
                  color: colors.ink,
                }}
              >
                Player of the Match (MVP) Formula
              </Text>
            </View>
            <Text
              style={{
                fontSize: 12,
                color: colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              A transparent, balanced metric designed for gully and local club cricket:
            </Text>

            {/* RN: web divide-y blocks → border-top on 2nd/3rd blocks */}
            <View style={{ flexDirection: "column", gap: 8 }}>
              <View style={{ paddingTop: 6 }}>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: colors.accent,
                    fontFamily: FONTS.sans,
                    marginBottom: 2,
                  }}
                >
                  Batting Points
                </Text>
                <View style={{ gap: 2 }}>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • 1 pt per run scored
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • +10 milestone bonus for 30+ runs
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • +20 milestone bonus for 50+ runs
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • +50 milestone bonus for 100+ runs
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • +10 tempo bonus if strike rate &gt; 150 (min 15 runs)
                  </Text>
                </View>
              </View>

              <View
                style={{
                  paddingTop: 8,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: colors.accent,
                    fontFamily: FONTS.sans,
                    marginBottom: 2,
                  }}
                >
                  Bowling Points
                </Text>
                <View style={{ gap: 2 }}>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • 25 pts per wicket taken
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • +20 haul bonus for 3 wickets
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • +50 haul bonus for 5 wickets
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • +20 pts per maiden over
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • +15 economy bonus if economy &lt; 6.00 (min 2 overs)
                  </Text>
                </View>
              </View>

              <View
                style={{
                  paddingTop: 8,
                  borderTopWidth: 1,
                  borderTopColor: colors.hairline,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: colors.accent,
                    fontFamily: FONTS.sans,
                    marginBottom: 2,
                  }}
                >
                  Fielding Points
                </Text>
                <View style={{ gap: 2 }}>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • 10 pts per catch or stumping
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    • 15 pts per run out dismissal
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* ICC Net Run Rate */}
          <View
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              padding: 16,
              flexDirection: "column",
              gap: 8,
            }}
          >
            <Text
              style={{
                fontFamily: FONTS.serif,
                fontWeight: "700",
                fontSize: 16,
                color: colors.ink,
              }}
            >
              Net Run Rate (NRR) Formula
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: colors.ink2,
                lineHeight: 20,
                fontFamily: FONTS.sans,
              }}
            >
              NRR = (Total Runs Scored / Total Overs Faced) - (Total Runs Conceded / Total Overs Bowled). Per official ICC standards, if a team is bowled all-out before completing their quota, their overs faced are counted as the full innings quota (e.g. 10.0 overs).
            </Text>
          </View>

          {/* Audience & Umpire (1.4.7) */}
          <View style={{ flexDirection: "column", gap: 10 }}>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
            >
              <ShieldCheck size={16} color={colors.accent} />
              <Text
                style={{
                  fontFamily: FONTS.serif,
                  fontWeight: "700",
                  fontSize: 16,
                  color: colors.ink,
                }}
              >
                Audience & Umpire Mode
              </Text>
            </View>
            <View style={{ paddingLeft: 20, gap: 6 }}>
              {[
                "Solo devices (no Sync Space) are never gated — the data is yours.",
                "Inside a Sync Space, every device starts in view-only Audience mode: scores, stats and logs are readable, edits are locked.",
                "The space's umpire key (Settings → Umpire Access) unlocks scoring and all edits as the umpire; five wrong entries pause the input briefly.",
                "Only the key's SHA-256 hash is stored or synced — the key itself is shown once and never leaves the device that typed it.",
                "Every umpire change lands in the Activity Log: plain sentences, grouped by match and day, searchable, with before → after details.",
                "Unlocking always asks for your name — prefilled with the last name used on this phone, but editable. Scoring on a shared phone? Tap Switch on the umpire badge to hand over: the new person types just their name (no key), and the handover ('Rahul handed over to Amit') is logged and listed in the Umpires list.",
                "With 'stay in umpire mode for 12 hours' on, the badge keeps showing the current name with a 'Not you? Switch' link — names are self-reported, so keep them honest.",
                "Completed matches lock read-only; reopening asks for a reason, which is logged.",
                "Honest scope: the key is a deterrent against casual or accidental edits, not bank-grade security. A lost key is recovered manually by the developer.",
              ].map((line) => (
                <View key={line} style={{ flexDirection: "row", gap: 8 }}>
                  <Text
                    style={{
                      fontSize: 12,
                      lineHeight: 20,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                    }}
                  >
                    •
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
                      lineHeight: 20,
                      color: colors.ink,
                      fontFamily: FONTS.sans,
                      flex: 1,
                    }}
                  >
                    {line}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
