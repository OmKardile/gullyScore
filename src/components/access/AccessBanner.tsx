/**
 * AccessBanner (1.4.7) — the persistent, tasteful mode indicator.
 *
 * Shown on Home (and reused inside Settings as the mode card):
 *  - audience: "Audience mode · view only" + an "Enter Umpire Key" CTA
 *  - umpire:   "Umpire: <name> · <tag>" + quiet "Switch" and "Exit" actions.
 *    1.4.7-test-3: Switch opens the handover sheet (new name, no key), and
 *    a 12-hour session keeps the current name on the badge with a visible
 *    "Not you? Switch" affordance — a passed-around phone can never log
 *    edits under the wrong person quietly.
 *  - solo:     renders nothing (own data, no gate — by design)
 */

import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Eye, ShieldCheck } from "lucide-react-native";
import { useTheme, FONTS } from "../../design/theme";
import { getAccessState, subscribeAccess, AccessState } from "../../storage/access";
import { SwitchUmpireSheet } from "./SwitchUmpireSheet";

interface AccessBannerProps {
  /** Called when the user asks to enter/set the umpire key. */
  onEnterKey: () => void;
  /** Called when an umpire asks to exit umpire mode. */
  onExitUmpire: () => void;
}

export const AccessBanner: React.FC<AccessBannerProps> = ({
  onEnterKey,
  onExitUmpire,
}) => {
  const { colors } = useTheme();
  const [access, setAccess] = useState<AccessState>(getAccessState());
  useEffect(() => subscribeAccess(() => setAccess(getAccessState())), []);
  // The handover sheet lives INSIDE the banner (self-contained): every
  // mount point — Home, Settings, scoring — gets Switch umpire for free.
  const [switchOpen, setSwitchOpen] = useState(false);

  if (access.mode === "solo") return null;

  if (access.mode === "umpire" && access.session) {
    return (
      <View style={{ gap: 0 }}>
        <View
          accessibilityLabel={`Umpire mode: ${access.session.name}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            padding: 12,
            borderWidth: 1,
            borderColor: colors.hairlineStrong,
            borderRadius: 10,
            backgroundColor: colors.surface,
          }}
        >
          <ShieldCheck size={18} strokeWidth={1.8} color={colors.success} />
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 13,
                fontFamily: FONTS.sansSemiBold,
                color: colors.ink,
              }}
            >
              Umpire: {access.session.name}
            </Text>
            <Text style={{ fontSize: 11, color: colors.ink2, fontFamily: FONTS.sans, marginTop: 1 }}>
              {access.session.model} · {access.session.tag}
              {access.session.expiresAt !== null ? " · stays on for 12h" : ""}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch umpire"
            onPress={() => setSwitchOpen(true)}
            hitSlop={8}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.hairlineStrong,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sansSemiBold }}>
              Switch
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Exit umpire mode"
            onPress={onExitUmpire}
            hitSlop={8}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.hairlineStrong,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sansSemiBold }}>
              Exit
            </Text>
          </Pressable>
        </View>
        {/* 12-hour sessions keep a visible "Not you? Switch" affordance
            (1.4.7-test-3): a phone that stays umpire across restarts must
            keep telling everyone whose name is on every edit. */}
        {access.session.expiresAt !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Not you? Switch umpire"
            onPress={() => setSwitchOpen(true)}
            hitSlop={4}
            style={({ pressed }) => ({
              alignSelf: "flex-start",
              marginTop: 6,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text
              style={{
                fontSize: 12,
                fontFamily: FONTS.sansSemiBold,
                color: colors.accent,
                textDecorationLine: "underline",
              }}
            >
              Not you? Switch umpire
            </Text>
          </Pressable>
        ) : null}
        <SwitchUmpireSheet isOpen={switchOpen} onClose={() => setSwitchOpen(false)} />
      </View>
    );
  }

  // Audience mode — view only, with the clear path to editing.
  return (
    <View
      accessibilityLabel="Audience mode, view only"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        padding: 12,
        borderWidth: 1,
        borderColor: colors.hairlineStrong,
        borderRadius: 10,
        backgroundColor: colors.surface,
      }}
    >
      <Eye size={18} strokeWidth={1.8} color={colors.ink2} />
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 13,
            fontFamily: FONTS.sansSemiBold,
            color: colors.ink,
          }}
        >
          Audience mode · view only
        </Text>
        <Text style={{ fontSize: 11, color: colors.ink2, fontFamily: FONTS.sans, marginTop: 1 }}>
          {access.spaceHasKey
            ? "Enter the umpire key to score or edit."
            : "This space has no umpire key yet — its creator should set one first, before sharing the app update."}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Enter umpire key"
        onPress={onEnterKey}
        style={({ pressed }) => ({
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 8,
          backgroundColor: colors.accent,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text
          style={{
            fontSize: 12,
            color: "#FFFFFF",
            fontFamily: FONTS.sansSemiBold,
          }}
        >
          {access.spaceHasKey ? "Enter Umpire Key" : "Set Umpire Key"}
        </Text>
      </Pressable>
    </View>
  );
};
