/**
 * Umpires screen (1.4.7) — the public, synced list of who has held the
 * umpire key in this Sync Space: name, device tag, device model, since
 * when, active/ended. Everyone (including audience) can read it.
 *
 * Same-name-different-tag entries get a subtle warning flag — the list is
 * accountability, not proof of identity.
 */

import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BadgeCheck, ChevronLeft, TriangleAlert } from "lucide-react-native";
import { useTheme, FONTS } from "../../design/theme";
import { db } from "../../storage/db";
import { getAccessState, subscribeAccess } from "../../storage/access";
import { UmpireEntry } from "../../types/access";

function fmtSince(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export const UmpiresScreen: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { colors } = useTheme();
  const [umpires, setUmpires] = useState<UmpireEntry[]>(() => db.getUmpires());
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsubDb = db.subscribe(() => setUmpires(db.getUmpires()));
    const unsubAccess = subscribeAccess(() => setTick((t) => t + 1));
    return () => {
      unsubDb();
      unsubAccess();
    };
  }, []);

  const access = getAccessState();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header (same anatomy as Settings/Faq screens) */}
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
          Umpires
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          width: "100%",
          maxWidth: 560,
          alignSelf: "center",
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 32,
        }}
      >
        <Text style={{ fontSize: 13, color: colors.ink2, fontFamily: FONTS.sans, marginBottom: 12 }}>
          Everyone who unlocked scoring in this Sync Space. Names are typed by each person —
          treat this list as accountability, not proof of identity.
        </Text>

        {umpires.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 48, gap: 8 }}>
            <BadgeCheck size={28} strokeWidth={1.5} color={colors.ink2} />
            <Text style={{ fontSize: 15, fontFamily: FONTS.serif, color: colors.ink }}>
              No umpires yet
            </Text>
            <Text style={{ fontSize: 13, color: colors.ink2, fontFamily: FONTS.sans, textAlign: "center" }}>
              When someone enters the umpire key, they'll appear here.
            </Text>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            {umpires.map((u, i) => {
              const duplicate = db.hasDuplicateUmpireName(u);
              const isActive = u.endedAt === undefined;
              const isYou =
                access.session !== null &&
                access.session.tag === u.tag &&
                access.session.startedAt === u.startedAt;
              return (
                <View
                  key={u.id}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderBottomWidth: i < umpires.length - 1 ? 1 : 0,
                    borderBottomColor: colors.hairline,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text
                        numberOfLines={1}
                        style={{ fontSize: 15, fontFamily: FONTS.sansSemiBold, color: colors.ink }}
                      >
                        {u.name}
                      </Text>
                      {isYou ? (
                        <Text style={{ fontSize: 11, color: colors.accent, fontFamily: FONTS.sansSemiBold }}>
                          (you)
                        </Text>
                      ) : null}
                      {duplicate ? (
                        <TriangleAlert
                          size={13}
                          strokeWidth={2}
                          color={colors.warning}
                          accessibilityLabel="Same name on another device"
                        />
                      ) : null}
                    </View>
                    <Text style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans, marginTop: 2 }}>
                      {u.model} · {u.tag} · since {fmtSince(u.startedAt)}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: FONTS.sansSemiBold,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      color: isActive ? colors.success : colors.ink2,
                    }}
                  >
                    {isActive ? "Active" : "Ended"}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};
