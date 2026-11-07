/**
 * GullyScore Guide Tour — first-launch interactive walkthrough
 *
 * A calm, card-based tour shown once on first launch (auto-navigated from
 * Root when settings.tourCompleted is false) and replayable from
 * Settings → Help & Learning.
 *
 * Design notes:
 * - Rendered as a full-screen stack route (fade animation) with a dark
 *   scrim + centered card — works identically on Android/iOS/web and is
 *   fully reachable by the headless E2E suite (plain text + roles).
 * - 8 steps, one idea each: welcome, matches, scoring pad, teams,
 *   stats, sync spaces, audience/umpire, help/FAQ/wipe.
 * - tourCompleted is persisted no matter HOW the screen is left
 *   (Finish, Skip, Android hardware back, iOS swipe) via a beforeRemove
 *   listener — the tour can never nag a user twice.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import {
  BookOpen,
  Calendar,
  ChartColumn,
  Cloud,
  ShieldCheck,
  Target,
  Trophy,
  Users,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { db } from "../../storage/db";
import { useTheme, FONTS } from "../../design/theme";
import type { RootStackParamList } from "../../../App";

interface TourStep {
  icon: LucideIcon;
  title: string;
  body: string;
}

const STEPS: TourStep[] = [
  {
    icon: Trophy,
    title: "Welcome to GullyScore",
    body: "Your offline-first gully cricket scorer. Matches, teams and stats all live on your phone — the app works fully without the internet.",
  },
  {
    icon: Calendar,
    title: "Score a match in seconds",
    body: "On the Matches tab, tap New Match. Pick your two teams, the toss, and house rules like overs, wide-run value and Last-Man-Batting — then you're scoring live.",
  },
  {
    icon: Target,
    title: "One tap per ball",
    body: "The scoring pad records runs, wides, no-balls, byes and wickets with a single tap. Undo fixes any mistake, and the next bowler is prompted at the end of every over — so the game never stalls.",
  },
  {
    icon: Users,
    title: "Teams & tournaments",
    body: "Build your squads in the Teams tab. Create a round-robin tournament and fixtures, a live points table and Net Run Rate are generated automatically.",
  },
  {
    icon: ChartColumn,
    title: "Career stats build themselves",
    body: "Every ball is stored forever. Batting cards, bowling figures, wagon wheels, MVP points and live win predictions are all derived from your ball-by-ball history.",
  },
  {
    icon: Cloud,
    title: "Sync with friends (optional)",
    body: "In Settings, create a Sync Space and share its 8-character code. Friends who join sync the same matches. The code IS the account — and your data always stays on this device first.",
  },
  {
    icon: ShieldCheck,
    title: "Audience & umpire",
    body: "Inside a Sync Space, everyone starts in view-only Audience mode. The space's umpire key unlocks scoring and edits — and every change lands in a readable Activity Log. Solo? You never see a key.",
  },
  {
    icon: BookOpen,
    title: "Help is always close",
    body: "Scoring rules, the MVP formula, an FAQ and a wipe-local-data option live under Settings → Help & Learning. That's it — let's play!",
  },
];

type Props = NativeStackScreenProps<RootStackParamList, "Guide">;

export const GuideTourScreen: React.FC<Props> = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<Props["navigation"]>();
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;
  const StepIcon = step.icon;

  // Persist tourCompleted exactly once, no matter how the screen is left:
  // Finish / Skip buttons, Android hardware back, iOS swipe-back, or a
  // browser back press on web.
  const markedRef = useRef(false);
  const markCompleted = useCallback(() => {
    if (markedRef.current) return;
    markedRef.current = true;
    if (!db.getSettings().tourCompleted) {
      db.saveSettings({ tourCompleted: true });
    }
  }, []);

  useEffect(() => {
    // beforeRemove covers every navigation-away path (incl. hardware back).
    return navigation.addListener("beforeRemove", () => markCompleted());
  }, [navigation, markCompleted]);

  // Gentle entrance for each card.
  const cardAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    cardAnim.setValue(0);
    Animated.timing(cardAnim, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [stepIndex, cardAnim]);

  const finish = () => {
    markCompleted();
    navigation.goBack();
  };

  const next = () => {
    if (isLast) finish();
    else setStepIndex((i) => i + 1);
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "rgba(14, 27, 46, 0.82)",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Animated.View
        style={{
          width: "100%",
          maxWidth: 400,
          backgroundColor: colors.surface,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.hairline,
          padding: 24,
          flexDirection: "column",
          gap: 14,
          opacity: cardAnim,
          transform: [
            {
              translateY: cardAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
          ],
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 12 },
          elevation: 12,
        }}
      >
        {/* Icon + step counter */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: colors.accentSubtle,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <StepIcon size={22} strokeWidth={1.8} color={colors.accent} />
          </View>
          <Text
            style={{
              fontSize: 11,
              fontFamily: FONTS.sansSemiBold,
              color: colors.ink2,
              letterSpacing: 0.5,
            }}
          >
            Step {stepIndex + 1} of {STEPS.length}
          </Text>
        </View>

        <View style={{ flexDirection: "column", gap: 6 }}>
          <Text
            style={{
              fontSize: 20,
              fontFamily: FONTS.serif,
              fontWeight: "700",
              color: colors.ink,
              letterSpacing: -0.3,
            }}
          >
            {step.title}
          </Text>
          <Text
            style={{
              fontSize: 13,
              lineHeight: 20,
              fontFamily: FONTS.sans,
              color: colors.ink2,
            }}
          >
            {step.body}
          </Text>
        </View>

        {/* Progress dots */}
        <View
          style={{
            flexDirection: "row",
            gap: 6,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {STEPS.map((s, i) => (
            <View
              key={s.title}
              style={{
                width: i === stepIndex ? 18 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor:
                  i === stepIndex ? colors.accent : colors.hairlineStrong,
              }}
            />
          ))}
        </View>

        {/* Actions */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 6,
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
          }}
        >
          <Pressable
            onPress={finish}
            accessibilityRole="button"
            accessibilityLabel="Skip tour"
            hitSlop={8}
            style={({ pressed }) => ({
              paddingVertical: 10,
              paddingHorizontal: 6,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text
              style={{
                fontSize: 13,
                fontFamily: FONTS.sansSemiBold,
                color: colors.ink2,
              }}
            >
              Skip Tour
            </Text>
          </Pressable>

          <Pressable
            onPress={next}
            accessibilityRole="button"
            accessibilityLabel={isLast ? "Finish tour" : "Next tour step"}
            style={({ pressed }) => ({
              paddingVertical: 10,
              paddingHorizontal: 22,
              borderRadius: 12,
              backgroundColor: colors.accent,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Text
              style={{
                fontSize: 13,
                fontFamily: FONTS.sansSemiBold,
                fontWeight: "700",
                color: "#FFFFFF",
              }}
            >
              {isLast ? "Start Scoring" : "Next"}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
};
