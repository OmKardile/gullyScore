/**
 * GullyScore SwipeableMatchItem Component
 *
 * Implements native-style swipe-to-action on match list items:
 * - Swipe right: Quick Resume / Score match
 * - Swipe left: Quick Archive / Unarchive match
 * Built with motion/react for 60fps gesture handling with spring snapping.
 *
 * RN port notes:
 * - motion/react drag gestures dropped (no RN equivalent per CONVENTIONS).
 *   The swipe actions are replaced with an explicit Resume / Archive
 *   (Restore) action row rendered inside the item; tapping the card opens
 *   match detail, exactly like the web's non-drag tap path.
 */

import React from "react";
import { Pressable, Text, View } from "react-native";
import { Match } from "../../types/cricket";
import { db } from "../../storage/db";
import { replayInnings } from "../../engine/scoringEngine";
import { Play, Archive, ArchiveRestore, ChevronRight } from "lucide-react-native";
import { useTheme, FONTS } from "../../design/theme";

interface SwipeableMatchItemProps {
  match: Match;
  onOpenMatchDetail: (matchId: string) => void;
  onResumeMatch: (matchId: string) => void;
  onToggleArchive: (matchId: string) => void;
}

export const SwipeableMatchItem: React.FC<SwipeableMatchItemProps> = ({
  match,
  onOpenMatchDetail,
  onResumeMatch,
  onToggleArchive,
}) => {
  const { colors } = useTheme();

  const tA = db.getTeam(match.teamAId);
  const tB = db.getTeam(match.teamBId);
  const inn1 = match.innings[0];
  const inn2 = match.innings[1];
  const sc1 = inn1
    ? replayInnings(inn1.ballEvents, match.rules, [], [], db.getPlayersMap())
    : null;
  const sc2 = inn2
    ? replayInnings(inn2.ballEvents, match.rules, [], [], db.getPlayersMap())
    : null;

  const isArchived = !!match.isArchived;

  // Small action button styling (web: swipe-revealed background buttons).
  const actionShadow = {
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  };

  return (
    <View
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 10,
        backgroundColor: colors.surfaceCard,
      }}
    >
      {/* Foreground Card — RN: Pressable replaces the motion-drag card.
          No drag gesture, so a plain tap opens match detail. */}
      <Pressable
        onPress={() => onOpenMatchDetail(match.id)}
        style={({ pressed }) => ({
          padding: 14,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: pressed ? colors.hairlineStrong : colors.hairline,
          borderRadius: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: isArchived ? 0.75 : pressed ? 0.9 : 1,
        })}
      >
        <View
          style={{
            flexDirection: "column",
            minWidth: 0,
            flexShrink: 1,
            paddingRight: 12,
          }}
        >
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
          >
            <Text
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: colors.ink2,
                fontWeight: "600",
                fontFamily: FONTS.sans,
              }}
            >
              {match.venue} · {match.date}
            </Text>
            {isArchived && (
              <Text
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  fontSize: 10,
                  textTransform: "uppercase",
                  fontFamily: "monospace",
                  letterSpacing: 1,
                  backgroundColor: colors.surfaceCard,
                  borderWidth: 1,
                  borderColor: colors.hairline,
                  borderRadius: 2,
                  color: colors.ink2,
                  overflow: "hidden",
                }}
              >
                Archived
              </Text>
            )}
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                fontFamily: FONTS.serif,
                fontWeight: "700",
                fontSize: 14,
                color: colors.ink,
                flexShrink: 1,
              }}
            >
              {tA?.shortName || "Team A"}
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: colors.ink2,
                fontFamily: FONTS.sans,
              }}
            >
              vs
            </Text>
            <Text
              numberOfLines={1}
              style={{
                fontFamily: FONTS.serif,
                fontWeight: "700",
                fontSize: 14,
                color: colors.ink,
                flexShrink: 1,
              }}
            >
              {tB?.shortName || "Team B"}
            </Text>
          </View>

          <Text
            numberOfLines={1}
            style={{
              fontSize: 12,
              color: colors.accent,
              fontWeight: "500",
              marginTop: 4,
              fontFamily: FONTS.sans,
            }}
          >
            {match.resultText ||
              (match.status === "live"
                ? "Match in Progress"
                : "Match Finished")}
          </Text>
        </View>

        <View
          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
        >
          <View
            style={{ alignItems: "flex-end", flexShrink: 0 }}
          >
            <Text
              style={{
                fontSize: 12,
                color: colors.ink,
                fontWeight: "700",
                fontFamily: FONTS.sans,
                fontVariant: ["tabular-nums"],
              }}
            >
              {sc1 ? `${sc1.totalRuns}/${sc1.totalWickets}` : "-"}
            </Text>
            {sc2 && (
              <Text
                style={{
                  fontSize: 12,
                  color: colors.ink2,
                  fontFamily: FONTS.sans,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {sc2.totalRuns}/{sc2.totalWickets}
              </Text>
            )}
          </View>
          <ChevronRight size={16} color={colors.ink2} opacity={0.4} />
        </View>
      </Pressable>

      {/* RN: web swipe gestures replaced with this explicit action row
          (Resume on the left like the right-swipe action, Archive/Restore
          on the right like the left-swipe action). */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderTopWidth: 1,
          borderTopColor: colors.hairline,
          backgroundColor: colors.surfaceCard,
        }}
      >
        {/* Left Action (web: right swipe): Resume */}
        <Pressable
          onPress={() => onResumeMatch(match.id)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: colors.accent,
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.95 : 1 }],
            ...actionShadow,
          })}
        >
          <Play size={16} color="#FFFFFF" fill="#FFFFFF" />
          <Text
            style={{
              fontSize: 12,
              color: "#FFFFFF",
              fontFamily: FONTS.sans,
              fontWeight: "600",
            }}
          >
            Resume
          </Text>
        </Pressable>

        {/* Right Action (web: left swipe): Archive / Restore */}
        <Pressable
          onPress={() => onToggleArchive(match.id)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: isArchived ? colors.ink : "#D97706",
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.95 : 1 }],
            ...actionShadow,
          })}
        >
          {isArchived ? (
            <>
              <ArchiveRestore size={16} color={colors.bg} />
              <Text
                style={{
                  fontSize: 12,
                  color: colors.bg,
                  fontFamily: FONTS.sans,
                  fontWeight: "600",
                }}
              >
                Restore
              </Text>
            </>
          ) : (
            <>
              <Archive size={16} color="#FFFFFF" />
              <Text
                style={{
                  fontSize: 12,
                  color: "#FFFFFF",
                  fontFamily: FONTS.sans,
                  fontWeight: "600",
                }}
              >
                Archive
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
};
