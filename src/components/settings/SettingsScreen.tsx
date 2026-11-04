/**
 * GullyScore Settings Screen
 *
 * Theme, default match rules, keep screen on, haptics, pad hand, backup/restore,
 * and About credits for Omkar Kardile.
 *
 * RN port notes:
 * - Theme picker routes through useTheme().setMode (persists via
 *   db.saveSettings and re-themes the whole app).
 * - Web backup download / file-picker import replaced: export shows the JSON
 *   in a sheet (selectable text), import takes a pasted JSON field (no file
 *   system / picker in deps).
 * - window.confirm for demo-data reset → inline confirm row with buttons.
 */

import React, { useEffect, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
// RN: dropped web-only Moon/Sun/Smartphone/Vibrate imports (unused on web too)
// and Download/Upload/RefreshCw/Palette/HelpCircle button icons (Svg cannot
// nest inside GullyButton's Text children).
import { Check, ChevronLeft, CloudOff, HardDrive } from "lucide-react-native";
import { db, AppSettings } from "../../storage/db";
import {
  GullyButton,
  GullySheet,
  GullyTextField,
} from "../common/Components";
import { useTheme, FONTS } from "../../design/theme";

interface SettingsScreenProps {
  onBack: () => void;
  onOpenHelp: () => void;
  onOpenGallery: () => void;
  onThemeChanged: () => void;
}

/** RN replacement for the web's <input type="checkbox"> (styled square box). */
const CheckBox: React.FC<{ checked: boolean; onPress: () => void }> = ({
  checked,
  onPress,
}) => {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 20,
        height: 20,
        borderRadius: 2,
        borderWidth: 1,
        borderColor: checked ? colors.accent : colors.hairlineStrong,
        backgroundColor: checked ? colors.accent : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {checked ? <Check size={14} strokeWidth={3} color="#FFFFFF" /> : null}
    </Pressable>
  );
};

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  onBack,
  onOpenHelp,
  onOpenGallery,
  onThemeChanged,
}) => {
  const { colors, setMode } = useTheme();
  const [settings, setSettings] = useState(() => db.getSettings());
  // Data & Sync snapshot (sync API — computed once per mount / data change)
  const [dataCounts, setDataCounts] = useState(() => ({
    matches: db.getMatches().length,
    teams: db.getTeams().length,
    players: db.getPlayers().length,
    tournaments: db.getTournaments().length,
  }));
  useEffect(() => {
    return db.subscribe(() =>
      setDataCounts({
        matches: db.getMatches().length,
        teams: db.getTeams().length,
        players: db.getPlayers().length,
        tournaments: db.getTournaments().length,
      })
    );
  }, []);
  const [backupStatus, setBackupStatus] = useState<string>("");
  // RN: web exported via Blob download / imported via file input — sheets here.
  const [exportSheetOpen, setExportSheetOpen] = useState(false);
  const [exportJson, setExportJson] = useState("");
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  const [importText, setImportText] = useState("");
  // RN: window.confirm → inline confirm row state.
  const [confirmReset, setConfirmReset] = useState(false);

  const handleUpdate = (patch: Partial<AppSettings>) => {
    db.saveSettings(patch);
    setSettings(db.getSettings());
    onThemeChanged();
  };

  const handleThemeMode = (mode: AppSettings["theme"]) => {
    // RN: useTheme().setMode persists the theme AND re-themes the provider
    // tree (web wrote db.saveSettings + re-read CSS vars).
    setMode(mode);
    setSettings(db.getSettings());
    onThemeChanged();
  };

  const handleExportBackup = () => {
    // RN: web created a Blob + <a download> — no file system in deps; the
    // JSON backup is shown in a sheet as selectable text instead.
    setExportJson(db.exportAllToJson());
    setExportSheetOpen(true);
    setBackupStatus("Backup exported successfully!");
    setTimeout(() => setBackupStatus(""), 3000);
  };

  const handleImportBackup = () => {
    // RN: web read the chosen .json file with a FileReader — no file picker;
    // the pasted JSON text is restored instead.
    const res = db.importAllFromJson(importText);
    setBackupStatus(res.message);
    onThemeChanged();
    setImportSheetOpen(false);
    setImportText("");
    setTimeout(() => setBackupStatus(""), 4000);
  };

  const handleResetSeedData = () => {
    // RN: window.confirm → inline confirm row (confirmReset state above).
    db.seedInitialData();
    onThemeChanged();
    setConfirmReset(false);
    setBackupStatus("Demo data reloaded!");
    setTimeout(() => setBackupStatus(""), 3000);
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
  const smallModeButton = (active: boolean) => ({
    borderWidth: 1,
    borderRadius: 6,
    borderColor: active ? colors.accent : colors.hairline,
    backgroundColor: active ? colors.accentSubtle : "transparent",
    paddingHorizontal: 12,
    paddingVertical: 6,
  });
  const smallModeText = (active: boolean) => ({
    fontSize: 12,
    fontFamily: FONTS.sans as string | undefined,
    fontWeight: active ? ("700" as const) : ("400" as const),
    color: active ? colors.accent : colors.ink,
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
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
          Settings
        </Text>
        <View style={{ width: 40 }} />
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
        {/* Data & Sync Status */}
        <View style={[section, { flexDirection: "column", gap: 12 }]}>
          <Text style={sectionLabel}>Data &amp; Sync Status</Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
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
              <HardDrive size={18} strokeWidth={1.8} color={colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: colors.success,
                  }}
                />
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.sansSemiBold,
                    fontWeight: "600",
                    color: colors.ink,
                  }}
                >
                  On-Device Storage — Active
                </Text>
              </View>
              <Text style={{ fontSize: 11, fontFamily: FONTS.sans, color: colors.ink2, marginTop: 2 }}>
                {dataCounts.matches} matches · {dataCounts.teams} teams ·{" "}
                {dataCounts.players} players · {dataCounts.tournaments} tournaments
                stored locally (offline-first, AsyncStorage)
              </Text>
            </View>
          </View>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: colors.hairline,
            }}
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
              <CloudOff size={18} strokeWidth={1.8} color={colors.ink2} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: colors.ink2,
                    opacity: 0.5,
                  }}
                />
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.sansSemiBold,
                    fontWeight: "600",
                    color: colors.ink,
                  }}
                >
                  Cloud Sync (Supabase) — Not Connected
                </Text>
              </View>
              <Text style={{ fontSize: 11, fontFamily: FONTS.sans, color: colors.ink2, marginTop: 2 }}>
                Your cricket data never leaves this device. Use Export / Import
                below to move it between phones.
              </Text>
            </View>
          </View>
        </View>

        {/* Appearance & Hardware */}
        <View style={[section, { flexDirection: "column", gap: 12 }]}>
          <Text style={sectionLabel}>Appearance &amp; Ergonomics</Text>

          <View style={{ flexDirection: "column", gap: 12 }}>
            {/* Theme Toggle */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
              <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink }}>
                Theme Mode
              </Text>
              <View style={{ flexDirection: "row", gap: 4 }}>
                {(["light", "dark", "system"] as const).map((mode) => (
                  <Pressable
                    key={mode}
                    onPress={() => handleThemeMode(mode)}
                    style={smallModeButton(settings.theme === mode)}
                  >
                    <Text style={[smallModeText(settings.theme === mode), { textTransform: "capitalize" }]}>
                      {mode}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Pad Hand Layout */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: colors.hairline,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink }}>
                  Scoring Pad Orientation
                </Text>
                <Text style={{ fontSize: 11, fontFamily: FONTS.sans, color: colors.ink2 }}>
                  Mirror controls for left-handed thumb use
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 4 }}>
                <Pressable
                  onPress={() => handleUpdate({ padHand: "right" })}
                  style={smallModeButton(settings.padHand === "right")}
                >
                  <Text style={smallModeText(settings.padHand === "right")}>Right</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleUpdate({ padHand: "left" })}
                  style={smallModeButton(settings.padHand === "left")}
                >
                  <Text style={smallModeText(settings.padHand === "left")}>Left</Text>
                </Pressable>
              </View>
            </View>

            {/* Keep Screen On */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: colors.hairline,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink }}>
                  Keep Screen On While Scoring
                </Text>
                <Text style={{ fontSize: 11, fontFamily: FONTS.sans, color: colors.ink2 }}>
                  Prevents phone display from sleeping outdoors
                </Text>
              </View>
              <CheckBox
                checked={settings.keepScreenOn}
                onPress={() => handleUpdate({ keepScreenOn: !settings.keepScreenOn })}
              />
            </View>

            {/* Tactile Haptics */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: colors.hairline,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontFamily: FONTS.sans, fontWeight: "500", color: colors.ink }}>
                  Vibration Haptics
                </Text>
                <Text style={{ fontSize: 11, fontFamily: FONTS.sans, color: colors.ink2 }}>
                  Tactile feedback for dots, boundaries, wickets, and undo
                </Text>
              </View>
              <CheckBox
                checked={settings.haptics}
                onPress={() => handleUpdate({ haptics: !settings.haptics })}
              />
            </View>
          </View>
        </View>

        {/* Backup & Restore */}
        <View style={[section, { flexDirection: "column", gap: 12 }]}>
          <Text style={sectionLabel}>Data Backup &amp; Migration (Offline)</Text>
          <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2, lineHeight: 20 }}>
            Your entire cricket history stays on your device. Export to a versioned JSON file to transfer between phones or keep a safe backup.
          </Text>

          {backupStatus ? (
            <View
              style={{
                padding: 8,
                backgroundColor: colors.accentSubtle,
                borderWidth: 1,
                borderColor: colors.accent,
                borderRadius: 8,
              }}
            >
              <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.accent, fontWeight: "500" }}>
                {backupStatus}
              </Text>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", gap: 8 }}>
            <GullyButton variant="quiet" fullWidth onPress={handleExportBackup}>
              Export All Data (.json)
            </GullyButton>

            <GullyButton variant="quiet" fullWidth onPress={() => setImportSheetOpen(true)}>
              Import JSON
            </GullyButton>
          </View>

          <View style={{ paddingTop: 8 }}>
            {confirmReset ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }}>
                  Reset and reload initial demo teams, players, and matches?
                </Text>
                <GullyButton size="sm" variant="primary" onPress={handleResetSeedData}>
                  Confirm
                </GullyButton>
                <GullyButton size="sm" onPress={() => setConfirmReset(false)}>
                  Cancel
                </GullyButton>
              </View>
            ) : (
              <GullyButton
                variant="text"
                size="sm"
                onPress={() => setConfirmReset(true)}
              >
                Reset &amp; Reload Demo Data
              </GullyButton>
            )}
          </View>
        </View>

        {/* Development & Design QA */}
        <View style={[section, { flexDirection: "column", gap: 8 }]}>
          <Text style={sectionLabel}>Design QA &amp; Verification</Text>
          <GullyButton variant="quiet" fullWidth onPress={onOpenGallery}>
            Component Gallery (Design Tokens)
          </GullyButton>
          <GullyButton variant="quiet" fullWidth onPress={onOpenHelp}>
            Scoring Rules &amp; MVP Guide
          </GullyButton>
        </View>

        {/* About & Mandatory Credits */}
        <View
          style={[
            section,
            {
              flexDirection: "column",
              alignItems: "center",
            },
          ]}
        >
          <Text style={{ fontSize: 16, fontFamily: FONTS.serif, fontWeight: "700", color: colors.ink }}>
            GullyScore v1.3.0
          </Text>
          <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2, marginTop: 2, textAlign: "center" }}>
            Offline-first cricket scoring &amp; stats for local teams.
          </Text>

          <View
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: colors.hairline,
              alignSelf: "stretch",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2 }}>
              Designed &amp; developed by{" "}
              {/* RN: web <a href> link → static styled text (no browser links). */}
              <Text style={{ fontWeight: "500", color: colors.ink }}>
                Omkar Kardile
              </Text>
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* --- Export sheet: selectable backup JSON (RN replaces file download) --- */}
      <GullySheet
        isOpen={exportSheetOpen}
        onClose={() => setExportSheetOpen(false)}
        title="Export All Data (.json)"
      >
        <TextInput
          multiline
          editable={false}
          value={exportJson}
          style={{
            minHeight: 240,
            borderWidth: 1,
            borderColor: colors.hairline,
            borderRadius: 8,
            padding: 12,
            fontSize: 11,
            fontFamily: FONTS.sans,
            color: colors.ink,
            textAlignVertical: "top",
            backgroundColor: colors.surfaceCard,
          }}
        />
        <GullyButton
          variant="quiet"
          fullWidth
          style={{ marginTop: 12 }}
          onPress={() => setExportSheetOpen(false)}
        >
          Close
        </GullyButton>
      </GullySheet>

      {/* --- Import sheet: pasted backup JSON (RN replaces file input) --- */}
      <GullySheet
        isOpen={importSheetOpen}
        onClose={() => setImportSheetOpen(false)}
        title="Import JSON"
      >
        <GullyTextField
          label="Paste backup JSON"
          value={importText}
          onChangeText={setImportText}
          multiline
        />
        <GullyButton
          variant="primary"
          fullWidth
          style={{ marginTop: 16 }}
          onPress={handleImportBackup}
        >
          Restore Backup
        </GullyButton>
      </GullySheet>
    </SafeAreaView>
  );
};
