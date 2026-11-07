/**
 * Umpire key sheet (1.4.7) — the single entry point for the access layer.
 *
 * Three modes:
 *  - "enter":  the space HAS a key; type it + your name to unlock editing.
 *  - "set":    the space has NO key yet (pre-1.4.7 space) — the creator sets
 *              one; the generated key is shown ONCE with a "save this" nudge.
 *  - "rotate": an active umpire changes the key (ends every other umpire
 *              session); the new key is shown ONCE.
 *
 * Wrong keys count up to 5, then the input locks for 30s and doubles on
 * every further miss (capped at 15 minutes) — access.ts owns that state.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { ClipboardCopy, KeyRound, ShieldCheck, TriangleAlert } from "lucide-react-native";
import { GullyButton, GullySheet, GullyTextField } from "../common/Components";
import { useTheme, FONTS } from "../../design/theme";
import { db } from "../../storage/db";
import {
  generateUmpireKey,
  getAccessState,
  getLastUmpireName,
  subscribeAccess,
} from "../../storage/access";

export type UmpireSheetMode = "enter" | "set" | "rotate";

interface UmpireKeySheetProps {
  isOpen: boolean;
  mode: UmpireSheetMode;
  onClose: () => void;
}

export const UmpireKeySheet: React.FC<UmpireKeySheetProps> = ({
  isOpen,
  mode,
  onClose,
}) => {
  const { colors } = useTheme();
  const [access, setAccess] = useState(getAccessState());
  useEffect(() => subscribeAccess(() => setAccess(getAccessState())), []);

  const [keyInput, setKeyInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [stay12h, setStay12h] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Shown-once result after set/rotate: the plain key never leaves this sheet.
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [lockLeftMs, setLockLeftMs] = useState(0);
  const lockTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset when the sheet reopens / switches mode.
  useEffect(() => {
    if (isOpen) {
      // CSPRNG key (throws only when no secure random source exists — e.g.
      // an exotic debug runtime; the user can still TYPE a key in that case).
      let pregenerated = "";
      if (mode === "set" || mode === "rotate") {
        try {
          pregenerated = generateUmpireKey();
        } catch {
          pregenerated = "";
        }
      }
      setKeyInput(pregenerated);
      // Prefill with the last name typed on THIS device (1.4.7-test-3) —
      // the field stays required, editable and visible every time; the
      // name is never reused without the person seeing it in the sheet.
      setNameInput(getLastUmpireName() || "");
      setStay12h(access.stayFor12h);
      setError("");
      setRevealedKey(null);
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode]);

  // Live lockout countdown.
  useEffect(() => {
    if (lockTimer.current) clearInterval(lockTimer.current);
    lockTimer.current = setInterval(() => {
      setLockLeftMs(Math.max(0, getAccessState().lockedUntil - Date.now()));
    }, 500);
    return () => {
      if (lockTimer.current) clearInterval(lockTimer.current);
    };
  }, []);
  const locked = lockLeftMs > 0;
  const lockSeconds = Math.ceil(lockLeftMs / 1000);

  const identityLine = useMemo(
    () =>
      access.identity
        ? `${access.identity.model} · ${access.identity.tag}`
        : "This device",
    [access.identity],
  );

  const handleCopy = async () => {
    if (!revealedKey) return;
    if (Platform.OS === "web") {
      try {
        await navigator.clipboard.writeText(revealedKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch {
        setCopied(false);
      }
    }
  };

  const handlePrimary = () => {
    setError("");
    setBusy(true);
    try {
      if (mode === "enter") {
        const res = db.enterUmpireMode(keyInput, nameInput, stay12h);
        if (res.ok) {
          onClose();
          return;
        }
        setError(res.error);
        if (res.lockedForMs) setLockLeftMs(res.lockedForMs);
      } else if (mode === "set") {
        const res = db.setUmpireKey(keyInput, nameInput);
        setRevealedKey(res.key); // shown ONCE — then only the hash persists
      } else {
        const newKey = db.rotateUmpireKey(keyInput);
        setRevealedKey(newKey);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === "enter" ? "Enter Umpire Key" : mode === "set" ? "Set Umpire Key" : "Change Umpire Key";

  return (
    <GullySheet isOpen={isOpen} onClose={onClose} title={title}>
      {revealedKey ? (
        <View style={{ gap: 16 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              padding: 14,
              borderWidth: 1,
              borderColor: colors.accent,
              borderRadius: 10,
              backgroundColor: colors.accentSubtle,
            }}
          >
            <ShieldCheck size={22} strokeWidth={1.8} color={colors.accent} />
            <Text
              style={{
                flex: 1,
                fontSize: 14,
                fontFamily: FONTS.sans,
                color: colors.ink,
                fontWeight: "600",
              }}
            >
              {mode === "set" ? "Key set — you're the umpire now" : "Key changed"}
            </Text>
          </View>

          <Text style={{ fontSize: 14, color: colors.ink2, fontFamily: FONTS.sans }}>
            Save this key somewhere safe — it is shown only this once, and it's
            what other scorers will type to become umpires.
          </Text>

          {/* Selectable monospace key — long-press to copy on Android,
              button copy on web (no clipboard dep on native). */}
          <TextInput
            value={revealedKey}
            editable={false}
            selectTextOnFocus
            accessibilityLabel="Umpire key, shown once"
            style={{
              fontFamily: "monospace",
              fontSize: 24,
              letterSpacing: 3,
              color: colors.ink,
              textAlign: "center",
              paddingVertical: 14,
              borderWidth: 1,
              borderColor: colors.hairlineStrong,
              borderRadius: 10,
              backgroundColor: colors.surfaceCard,
            }}
          />

          {Platform.OS === "web" ? (
            <GullyButton variant="quiet" onPress={handleCopy}>
              {copied ? "Copied!" : "Copy key"}
            </GullyButton>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ClipboardCopy size={16} strokeWidth={1.8} color={colors.ink2} />
              <Text style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans, flex: 1 }}>
                Long-press the key to select and copy it.
              </Text>
            </View>
          )}

          <GullyButton variant="primary" fullWidth onPress={onClose}>
            Done — I've saved it
          </GullyButton>
        </View>
      ) : (
        <View style={{ gap: 18 }}>
          <Text style={{ fontSize: 14, color: colors.ink2, fontFamily: FONTS.sans }}>
            {mode === "enter"
              ? "The umpire key unlocks scoring and every edit for this Sync Space. Everyone else stays in view-only Audience mode."
              : mode === "set"
                ? "This Sync Space has no umpire key yet. If you created this space, set the key now — do it before sharing the app update with others, because whoever sets the key first owns it. Devices that join later will need the key to edit."
                : "A new key ends every other umpire session. Share the new key with your co-scorers after this."}
          </Text>

          <GullyTextField
            label="Umpire key (16 characters, 0-9 / a-f)"
            value={keyInput}
            onChangeText={(t) => setKeyInput(t.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 16))}
            placeholder="e.g. 4f9a2b7c1d3e5f60"
            error={
              keyInput.length > 0 && keyInput.length !== 16
                ? `16 characters needed — you've typed ${keyInput.length}`
                : undefined
            }
            keyboardType="default"
          />

          <GullyTextField
            label="Your name (shows next to every change you make)"
            value={nameInput}
            onChangeText={setNameInput}
            placeholder="e.g. Rahul"
          />

          {/* Auto-filled, read-only identity — accountability, not proof. */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: 10,
            }}
          >
            <KeyRound size={16} strokeWidth={1.8} color={colors.ink2} />
            <Text style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans, flex: 1 }}>
              This device: {identityLine}
            </Text>
          </View>

          {/* Stay-in-umpire-mode toggle (default off). */}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: stay12h }}
            onPress={() => setStay12h((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 2,
                borderWidth: 1,
                borderColor: stay12h ? colors.accent : colors.hairlineStrong,
                backgroundColor: stay12h ? colors.accent : "transparent",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {stay12h ? <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "700" }}>✓</Text> : null}
            </View>
            <Text style={{ fontSize: 13, color: colors.ink, fontFamily: FONTS.sans, flex: 1 }}>
              Stay in umpire mode for 12 hours (otherwise you re-enter the key after every restart)
            </Text>
          </Pressable>

          {locked ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TriangleAlert size={16} strokeWidth={1.8} color={colors.warning} />
              <Text style={{ fontSize: 13, color: colors.warning, fontFamily: FONTS.sans, flex: 1 }}>
                Too many wrong keys — try again in {lockSeconds}s.
              </Text>
            </View>
          ) : error ? (
            <Text style={{ fontSize: 13, color: colors.accent, fontFamily: FONTS.sans }}>
              {error}
            </Text>
          ) : null}

          <GullyButton
            variant="primary"
            fullWidth
            disabled={
              busy ||
              locked ||
              keyInput.length !== 16 ||
              nameInput.trim() === "" ||
              (mode === "rotate" && !access.session)
            }
            onPress={handlePrimary}
          >
            {mode === "enter"
              ? "Unlock umpire mode"
              : mode === "set"
                ? "Set key & become umpire"
                : "Change key"}
          </GullyButton>
        </View>
      )}
    </GullySheet>
  );
};
