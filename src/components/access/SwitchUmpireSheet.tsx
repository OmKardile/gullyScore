/**
 * Switch umpire sheet (1.4.7-test-3) — a new person takes over scoring on
 * the SAME phone without re-entering the umpire key.
 *
 * Asks for the new umpire's name ONLY (the key was already validated when
 * the current session started). The previous umpire's session entry is
 * ended, a fresh one begins under the new name, and the handover lands in
 * the Activity Log + Umpires list as a plain sentence ("Rahul handed over
 * to Amit").
 *
 * The name field starts EMPTY on purpose: a handover is a new person, and
 * prefilling the previous umpire's name would invite logging their edits
 * under the wrong person. Names remain self-reported (see Help/FAQ).
 */

import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { UserRoundCog } from "lucide-react-native";
import { GullyButton, GullySheet, GullyTextField } from "../common/Components";
import { useTheme, FONTS } from "../../design/theme";
import { db } from "../../storage/db";
import { getAccessState, subscribeAccess } from "../../storage/access";

interface SwitchUmpireSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SwitchUmpireSheet: React.FC<SwitchUmpireSheetProps> = ({
  isOpen,
  onClose,
}) => {
  const { colors } = useTheme();
  const [access, setAccess] = useState(getAccessState());
  useEffect(() => subscribeAccess(() => setAccess(getAccessState())), []);

  const [nameInput, setNameInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Fresh, EMPTY name field every time the sheet opens — a handover is a
  // new person; the previous umpire's name must never be pre-filled here.
  useEffect(() => {
    if (isOpen) {
      setNameInput("");
      setError("");
      setBusy(false);
    }
  }, [isOpen]);

  const handleHandOver = () => {
    setError("");
    setBusy(true);
    try {
      const res = db.switchUmpire(nameInput);
      if (res.ok) {
        onClose();
        return;
      }
      setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const current = access.session;

  return (
    <GullySheet isOpen={isOpen} onClose={onClose} title="Switch Umpire">
      <View style={{ gap: 18 }}>
        <Text style={{ fontSize: 14, color: colors.ink2, fontFamily: FONTS.sans, lineHeight: 20 }}>
          {current
            ? `Hand over on this phone: ${current.name} stops being the umpire and the new person takes over — no key needed, and the handover is recorded in the Activity Log and the Umpires list.`
            : "Hand over on this phone — no key needed, and the handover is recorded in the Activity Log and the Umpires list."}
        </Text>

        <GullyTextField
          label="New umpire's name (shows next to every change they make)"
          value={nameInput}
          onChangeText={setNameInput}
          placeholder="e.g. Amit"
        />

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
          <UserRoundCog size={16} strokeWidth={1.8} color={colors.ink2} />
          <Text style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans, flex: 1 }}>
            Names are typed by each person and shown as-typed — accountability,
            not proof of identity. This device: {current ? `${current.model} · ${current.tag}` : ""}
          </Text>
        </View>

        {error ? (
          <Text style={{ fontSize: 13, color: colors.accent, fontFamily: FONTS.sans }}>
            {error}
          </Text>
        ) : null}

        <GullyButton
          variant="primary"
          fullWidth
          disabled={busy || nameInput.trim() === ""}
          onPress={handleHandOver}
        >
          Hand over
        </GullyButton>
      </View>
    </GullySheet>
  );
};
