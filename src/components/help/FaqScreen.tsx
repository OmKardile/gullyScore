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
        a: "A common gully rule. Normally an innings ends when the side is all out (players minus one wickets down). With Last-Man-Batting enabled, the last remaining batter keeps batting alone — the innings only ends on overs or retirement. Short squads are handled honestly too: a side with fewer registered players than the match format is all out the moment it runs out of batters — a 7-player side in an 11-a-side match is all out at 6 wickets.",
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
  {
    label: "Audience & Umpire",
    items: [
      {
        id: "faq_audience_mode",
        q: "Why can't I edit anything? What is Audience mode?",
        a: "If your device is joined to a Sync Space, it starts in view-only Audience mode: scores, stats, teams and the activity log are all readable, but scoring and edits are locked. It's a guard against a friend's phone accidentally rewriting the score. Enter the space's umpire key (Settings → Umpire Access) to unlock editing as the umpire. Devices not in a Sync Space are never gated — it's your own data.",
      },
      {
        id: "faq_umpire_key",
        q: "What is the umpire key and who has it?",
        a: "Each Sync Space has one umpire key — 16 characters, set by the space's creator when the space is made (or the first person to set one, for spaces created before this feature). Only the key's hash is ever stored or synced — salted so it can't be reversed — and it's shown exactly once when set, so save it. An umpire can change it from Settings, which instantly ends every other umpire session. Be honest about what this is: a deterrent against casual or accidental edits, not bank-grade security.",
      },
      {
        id: "faq_old_space_key",
        q: "Our space came from an older app version — who should set the key?",
        a: "The person who created the Sync Space should set the umpire key FIRST, on their own phone, before sharing the new app version with the group — whoever sets it first owns the space's key. If a spectator accidentally sets it, an umpire can't simply take it back: recovery is manual via the developer. So: creator first, then share the update.",
      },
      {
        id: "faq_activity_log",
        q: "What is the Activity Log?",
        a: "A plain-words, append-only history of every change made by umpires — 'Rahul scored FOUR — over 12.3', wickets, corrections, reopened matches, key changes. Entries are grouped by match and day, searchable, and show who made the change on which device. Everyone in the space can read it, including viewers.",
      },
      {
        id: "faq_completed_lock",
        q: "Why is my completed match read-only?",
        a: "Once a match ends it locks — even for umpires — so the recorded result can't drift after the handshake. Genuinely need a correction? Reopen the match from its detail screen; you'll be asked for a short reason, which is written to the Activity Log next to your name.",
      },
      {
        id: "faq_lost_key",
        q: "I lost the umpire key. What now?",
        a: "Recovery is manual by design — there is no backdoor. Contact the developer with proof you own the space (e.g. its creation details); the key hash can be reset from the database side. If another umpire still has an active session, they can also set a fresh key from Settings → Change Umpire Key before everyone is locked out.",
      },
      {
        id: "faq_switch_umpire",
        q: "Several of us score on one phone. How do names work?",
        a: "Every time someone unlocks umpire mode, the app asks for their name — the field is prefilled with the last name used on that phone, but it stays editable, so check it's you before unlocking. To hand the phone to the next scorer mid-session, tap Switch on the umpire badge (Home or Settings): the new person types just their name, no key needed. The handover is written to the Activity Log as a plain sentence ('Rahul handed over to Amit') and both names appear in the Umpires list. If 'stay in umpire mode for 12 hours' is on, the badge keeps showing the current name with a 'Not you? Switch' link, so a passed-around phone can't quietly log edits under the wrong person. Names are self-reported — treat them as accountability, not proof of identity.",
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
