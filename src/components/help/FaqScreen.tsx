/**
 * GullyScore FAQ — Frequently Asked Questions
 *
 * Accordion Q&A grouped in three sections (Getting Started, Scoring &
 * Rules, Data / Sync / Backup). Reachable from Settings → Help & Learning
 * and from the Scoring Rules screen, so every "how do I…" has a home.
 *
 * RN notes: web <details>/<summary> accordion → Pressable rows with an
 * expandedId state; the chevron rotates via a style transform.
 */

import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronDown, ChevronLeft } from "lucide-react-native";
import { useTheme, FONTS } from "../../design/theme";

interface FaqItem {
  id: string;
  q: string;
  a: string;
}

const FAQ_SECTIONS: { label: string; items: FaqItem[] }[] = [
  {
    label: "Getting Started",
    items: [
      {
        id: "faq_free",
        q: "Is GullyScore free? Do I need the internet?",
        a: "Yes, and no. GullyScore is fully offline-first: matches, teams, players, tournaments and career stats are stored on your phone itself. Cloud sync with friends is an optional extra — the app never requires an account or a connection to keep scoring.",
      },
      {
        id: "faq_first_match",
        q: "How do I score my first match?",
        a: "Open the Matches tab and tap New Match. Pick the two teams (or create them on the fly), set the toss, adjust rules like overs, wide-run value, Free Hit and Last-Man-Batting, then tap Start Match & Open Live Scorer. Every ball after that is one tap on the scoring pad.",
      },
      {
        id: "faq_demo",
        q: "Why does a fresh install show teams and matches I never made?",
        a: "Those are demo data — 4 local teams, 2 sample matches and a Monsoon League — seeded so you can explore the app immediately. You can edit or delete them like any real data, or wipe everything at once from Settings → Danger Zone → Wipe All Local Data.",
      },
      {
        id: "faq_resume",
        q: "The app closed mid-match — is my scoring lost?",
        a: "Never. Every ball is stored the moment you tap it (event-sourced), and the live match is pinned to the top of the Matches tab. Just tap Resume Live Scoring and continue exactly where you left off — even the pending over's bowler is remembered.",
      },
      {
        id: "faq_new_phone",
        q: "I changed phones. How do I bring my cricket history across?",
        a: "Two ways. Offline: on the old phone use Settings → Export All Data, then paste that JSON into Import on the new phone. Online: join the same Sync Space on the new phone and run Sync Now — matches, teams and players pull down automatically.",
      },
    ],
  },
  {
    label: "Scoring & Rules",
    items: [
      {
        id: "faq_wide_noball",
        q: "How do wides and no-balls work?",
        a: "Neither counts as a legal delivery and both must be re-bowled. Wides add runs to the team total and are charged to the bowler. No-balls give the bat runs to the batter, and when Free-Hit-on-No-Ball is enabled, the next delivery is flagged as a free hit.",
      },
      {
        id: "faq_byes",
        q: "What about byes and leg-byes?",
        a: "Byes and leg-byes count as extras to the batting team, are NOT charged to the bowler, and the batter does face a legal ball. That is also why they do not break a bowler's maiden over.",
      },
      {
        id: "faq_undo",
        q: "I tapped the wrong score. Can I fix it?",
        a: "Yes — tap Undo on the scoring pad to remove the last ball event. Because everything (scorecard, over counts, wagon wheel, MVP) is derived by replaying the ball list, the mistake disappears everywhere at once. Long-press Undo to step back further.",
      },
      {
        id: "faq_mvp",
        q: "How is the Player of the Match decided?",
        a: "A transparent points formula built for gully cricket: 1 pt per run with milestone bonuses (30/50/100), 25 pts per wicket with haul bonuses (3w/5w), 20 pts per maiden over, plus catches (10), run-outs (15) and economy/strike-rate bonuses. The full breakdown is in Scoring Rules & MVP.",
      },
      {
        id: "faq_last_man",
        q: "What is Last-Man-Batting?",
        a: "A common gully rule. Normally an innings ends when the side is all out (players minus one wickets down). With Last-Man-Batting enabled, the last remaining batter keeps batting alone — the innings only ends on overs or retirement.",
      },
    ],
  },
  {
    label: "Data, Sync & Backup",
    items: [
      {
        id: "faq_space",
        q: "What is a Sync Space? Do I need an account?",
        a: "A Sync Space is a lightweight cloud room scoped to an 8-character code — the code IS the account, no email or password. Create one in Settings, share the code, and everyone who joins keeps the same matches and teams in sync. Leave any time; your device data stays yours.",
      },
      {
        id: "faq_wipe",
        q: "What exactly does Wipe All Local Data delete?",
        a: "It permanently erases every match, team, player, tournament and fixture stored on this device — nothing is recovered afterwards, so export a backup first. Your settings (theme, haptics) are kept. If a Sync Space is connected when you wipe, GullyScore automatically leaves it first so the shared cloud copy is not disturbed.",
      },
      {
        id: "faq_offline_badge",
        q: "The home header shows Offline / Synced. What do these mean?",
        a: "That badge is the cloud status: Offline means the Supabase backend is unreachable right now (scoring still works), Cloud Ready means the backend is reachable but you haven't joined a space, and Synced · CODE means you're in a space and the code shown is the one to share.",
      },
      {
        id: "faq_screen_sleep",
        q: "Can the screen stay awake while I score outdoors?",
        a: "Yes — Settings → Keep Screen On While Scoring is on by default. Also check Vibration Haptics for tactile feedback on dots, boundaries and wickets, and Scoring Pad Orientation to mirror the pad for left-handed use.",
      },
    ],
  },
];

export const FaqScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { colors } = useTheme();
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      {/* Header — same pattern as the other help screens */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 10,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          hitSlop={12}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 20,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ChevronLeft size={24} strokeWidth={2} color={colors.ink} />
        </Pressable>
        <Text
          style={{
            fontSize: 18,
            fontFamily: FONTS.serif,
            fontWeight: "700",
            color: colors.ink,
            flex: 1,
          }}
        >
          Frequently Asked Questions
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{
          width: "100%",
          maxWidth: 560,
          alignSelf: "center",
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 64,
          flexDirection: "column",
          gap: 20,
        }}
      >
        {FAQ_SECTIONS.map((section) => (
          <View key={section.label} style={{ flexDirection: "column", gap: 8 }}>
            <Text style={sectionLabel}>{section.label}</Text>
            <View
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: 10,
                overflow: "hidden",
              }}
            >
              {section.items.map((item, idx) => {
                const expanded = expandedId === item.id;
                return (
                  <View
                    key={item.id}
                    style={
                      idx > 0
                        ? { borderTopWidth: 1, borderTopColor: colors.hairline }
                        : undefined
                    }
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Toggle answer: ${item.q}`}
                      onPress={() =>
                        setExpandedId((cur) => (cur === item.id ? null : item.id))
                      }
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        padding: 14,
                        backgroundColor: pressed
                          ? colors.accentSubtle
                          : "transparent",
                      })}
                    >
                      <Text
                        style={{
                          flex: 1,
                          fontSize: 13,
                          fontFamily: FONTS.sansSemiBold,
                          fontWeight: "600",
                          color: colors.ink,
                          lineHeight: 19,
                        }}
                      >
                        {item.q}
                      </Text>
                      <ChevronDown
                        size={18}
                        strokeWidth={2}
                        color={expanded ? colors.accent : colors.ink2}
                        style={{
                          transform: [{ rotate: expanded ? "180deg" : "0deg" }],
                        }}
                      />
                    </Pressable>
                    {expanded ? (
                      <View
                        style={{
                          paddingHorizontal: 14,
                          paddingBottom: 14,
                          flexDirection: "row",
                          gap: 10,
                        }}
                      >
                        <View
                          style={{
                            width: 2,
                            marginTop: 3,
                            borderRadius: 1,
                            backgroundColor: colors.accent,
                            opacity: 0.4,
                          }}
                        />
                        <Text
                          style={{
                            flex: 1,
                            fontSize: 12,
                            lineHeight: 19,
                            fontFamily: FONTS.sans,
                            color: colors.ink2,
                          }}
                        >
                          {item.a}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        {/* Pointer to the full rules guide */}
        <View
          style={{
            padding: 14,
            backgroundColor: colors.accentSubtle,
            borderWidth: 1,
            borderColor: colors.accent,
            borderRadius: 10,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              lineHeight: 19,
              fontFamily: FONTS.sans,
              color: colors.ink,
              textAlign: "center",
            }}
          >
            Looking for the full wides / no-balls / NRR / MVP breakdown? Open{" "}
            <Text style={{ fontWeight: "700", color: colors.accent }}>
              Scoring Rules &amp; MVP
            </Text>{" "}
            from Settings.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};
