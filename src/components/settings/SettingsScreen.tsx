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
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
// RN: dropped web-only Moon/Sun/Smartphone/Vibrate imports (unused on web too)
// and Download/Upload/RefreshCw/Palette/HelpCircle button icons (Svg cannot
// nest inside GullyButton's Text children).
import { Check, ChevronLeft, Cloud, CloudOff, HardDrive, RefreshCw, TriangleAlert } from "lucide-react-native";
import { db, AppSettings } from "../../storage/db";
import {
  createNewSpace,
  getBackendStatus,
  getSyncState,
  isSyncing,
  joinSpace,
  leaveSpace,
  refreshBackendStatus,
  subscribeSync,
  syncNow,
} from "../../storage/sync";
import {
  GullyButton,
  GullySheet,
  GullyTextField,
} from "../common/Components";
import { useTheme, FONTS } from "../../design/theme";

interface SettingsScreenProps {
  onBack: () => void;
  onOpenHelp: () => void;
  onOpenFaq: () => void;
  onStartTour: () => void;
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
  onOpenFaq,
  onStartTour,
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
  // Danger Zone: Wipe All Local Data (separate, deliberate two-step confirm).
  const [confirmWipe, setConfirmWipe] = useState(false);

  // --- Cloud Sync (Supabase Sync Spaces v1) ---
  const [syncState, setSyncState] = useState(getSyncState());
  const [backend, setBackend] = useState(getBackendStatus());
  const [syncBusy, setSyncBusy] = useState(false);
  useEffect(() => {
    const reread = () => {
      setSyncState(getSyncState());
      setBackend(getBackendStatus());
      setSyncBusy(isSyncing());
    };
    reread();
    // re-probe the backend every time Settings opens (cheap, no space needed)
    void refreshBackendStatus();
    return subscribeSync(reread);
  }, []);
  const [joinCode, setJoinCode] = useState("");
  const [syncStatus, setSyncStatus] = useState("");
  const [syncStatusKind, setSyncStatusKind] = useState<"error" | "success">("error");

  const flashSyncStatus = (msg: string, ms = 5000, kind: "error" | "success" = "error") => {
    setSyncStatusKind(kind);
    setSyncStatus(msg);
    setTimeout(() => setSyncStatus(""), ms);
  };

  const handleJoinSpace = async () => {
    setSyncBusy(true);
    try {
      const name = await joinSpace(joinCode);
      setJoinCode("");
      flashSyncStatus(
        `Joined "${name}" — your data and the space are now synced.`,
        6000,
        "success"
      );
    } catch (e) {
      flashSyncStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncBusy(false);
    }
  };

  const handleCreateSpace = async () => {
    setSyncBusy(true);
    try {
      const code = await createNewSpace("My GullyScore Space");
      flashSyncStatus(
        `Space created — code ${code}. Share it with friends to sync.`,
        8000,
        "success"
      );
    } catch (e) {
      flashSyncStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setSyncBusy(true);
    try {
      await syncNow();
    } catch (e) {
      flashSyncStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncBusy(false);
    }
  };

  const handleLeaveSpace = () => {
    leaveSpace();
    flashSyncStatus("Left the Sync Space. Your data stays on this device.", 6000);
  };

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
    // reseedDemoData also clears the intentional-wipe marker so a fresh
    // install's demo content comes back (and STAYS back across restarts).
    db.reseedDemoData();
    onThemeChanged();
    setConfirmReset(false);
    setBackupStatus("Demo data reloaded!");
    setTimeout(() => setBackupStatus(""), 3000);
  };

  const handleWipeAll = () => {
    // If a Sync Space is connected, leave it BEFORE wiping: otherwise the
    // next sync would push the vanished rows as deletions (tombstones) and
    // silently erase the shared cloud copy too. Leaving first keeps the
    // wipe strictly local — the friend's data is never disturbed.
    const spaceName = getSyncState().code;
    if (spaceName) leaveSpace();
    db.wipeAllData();
    setConfirmWipe(false);
    setBackupStatus(
      spaceName
        ? "All local data wiped. Sync Space left first, so the shared cloud copy is safe."
        : "All local data wiped."
    );
    setTimeout(() => setBackupStatus(""), 8000);
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
                {dataCounts.matches} {dataCounts.matches === 1 ? "match" : "matches"} ·{" "}
                {dataCounts.teams} {dataCounts.teams === 1 ? "team" : "teams"} ·{" "}
                {dataCounts.players} {dataCounts.players === 1 ? "player" : "players"} ·{" "}
                {dataCounts.tournaments}{" "}
                {dataCounts.tournaments === 1 ? "tournament" : "tournaments"} stored locally
                (offline-first, AsyncStorage)
              </Text>
            </View>
          </View>

          {/* Cloud Sync (Supabase) — functional Sync Spaces v1 client */}
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
              {syncState.code ? (
                <Cloud size={18} strokeWidth={1.8} color={colors.success} />
              ) : (
                <CloudOff size={18} strokeWidth={1.8} color={colors.ink2} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor:
                      backend === "offline" ? colors.warning : backend === "online" ? colors.success : colors.ink2,
                    opacity: backend === "checking" ? 0.5 : 1,
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
                  {backend === "checking"
                    ? "Cloud Sync (Supabase) — Checking Backend…"
                    : backend === "offline"
                      ? "Cloud Sync (Supabase) — Unreachable (Offline)"
                      : syncState.code
                        ? "Cloud Sync (Supabase) — Connected"
                        : "Cloud Sync (Supabase) — Online · No Space Joined"}
                </Text>
              </View>
              {syncState.code ? (
                <>
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: FONTS.sans,
                      color: colors.ink2,
                      marginTop: 2,
                    }}
                    testID="sync-space-line"
                  >
                    {syncState.name} · Space code {syncState.code} — share the code with
                    friends to sync matches together.
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: FONTS.sans,
                      color: syncState.lastResult === "ok" ? colors.ink2 : colors.warning,
                      marginTop: 2,
                    }}
                  >
                    {syncState.lastResult === "ok"
                      ? `Last sync ${new Date(syncState.lastSyncAt).toLocaleTimeString()} · pushed ${syncState.lastSyncedCounts.pushed} · pulled ${syncState.lastSyncedCounts.pulled} rows`
                      : syncState.lastResult
                        ? `Last sync failed: ${syncState.lastResult}`
                        : "Connected — run your first sync."}
                  </Text>
                </>
              ) : (
                <Text style={{ fontSize: 11, fontFamily: FONTS.sans, color: colors.ink2, marginTop: 2 }}>
                  Supabase backend is reachable. Syncing is space-scoped: create a
                  Sync Space below (or join a friend's 8-char code) to turn on
                  cloud sync — the code IS the account, and your data always
                  stays on this device first.
                </Text>
              )}
            </View>
          </View>

          {syncState.code ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <GullyButton
                variant="quiet"
                fullWidth
                disabled={syncBusy}
                onPress={handleSyncNow}
              >
                {syncBusy ? "Syncing…" : "Sync Now"}
              </GullyButton>
              <GullyButton
                variant="quiet"
                fullWidth
                disabled={syncBusy}
                onPress={handleLeaveSpace}
              >
                Leave Space
              </GullyButton>
            </View>
          ) : (
            <View style={{ flexDirection: "column", gap: 8 }}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}>
                  <GullyTextField
                    label="Sync Space code (8 characters)"
                    value={joinCode}
                    onChangeText={(t: string) => setJoinCode(t.toUpperCase().slice(0, 8))}
                  />
                </View>
                <GullyButton
                  variant="primary"
                  disabled={syncBusy || joinCode.length !== 8}
                  onPress={handleJoinSpace}
                >
                  Join
                </GullyButton>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Use the demo Sync Space code"
                onPress={() => setJoinCode("2XMAY93M")}
                style={({ pressed }) => ({
                  alignSelf: "flex-start",
                  opacity: pressed ? 0.6 : 1,
                  paddingVertical: 2,
                })}
              >
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: FONTS.sansSemiBold,
                    color: colors.accent,
                  }}
                >
                  New here? Try the demo space → 2XMAY93M
                </Text>
              </Pressable>
              <GullyButton
                variant="quiet"
                fullWidth
                disabled={syncBusy}
                onPress={handleCreateSpace}
              >
                {syncBusy ? "Creating…" : "Create New Sync Space"}
              </GullyButton>
            </View>
          )}

          {syncStatus ? (
            <Text
              style={{
                fontSize: 11,
                fontFamily: FONTS.sans,
                color:
                  syncStatusKind === "success" ? colors.success : colors.warning,
              }}
            >
              {syncStatus}
            </Text>
          ) : null}
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

        {/* Help & Learning */}
        <View style={[section, { flexDirection: "column", gap: 8 }]}>
          <Text style={sectionLabel}>Help &amp; Learning</Text>
          <GullyButton variant="quiet" fullWidth onPress={onStartTour}>
            Replay Guide Tour (7 Steps)
          </GullyButton>
          <GullyButton variant="quiet" fullWidth onPress={onOpenFaq}>
            Frequently Asked Questions (FAQ)
          </GullyButton>
          <GullyButton variant="quiet" fullWidth onPress={onOpenHelp}>
            Scoring Rules &amp; MVP Guide
          </GullyButton>
        </View>

        {/* Development & Design QA */}
        <View style={[section, { flexDirection: "column", gap: 8 }]}>
          <Text style={sectionLabel}>Design QA &amp; Verification</Text>
          <GullyButton variant="quiet" fullWidth onPress={onOpenGallery}>
            Component Gallery (Design Tokens)
          </GullyButton>
        </View>

        {/* Danger Zone — Wipe All Local Data */}
        <View
          style={[
            section,
            {
              flexDirection: "column",
              gap: 10,
              borderWidth: 1,
              borderColor: colors.warning,
            },
          ]}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TriangleAlert size={16} color={colors.warning} />
            <Text style={sectionLabel}>Danger Zone</Text>
          </View>
          <Text style={{ fontSize: 12, fontFamily: FONTS.sans, color: colors.ink2, lineHeight: 19 }}>
            Permanently erase every match, team, player, tournament and fixture
            stored on this device. This cannot be undone — export a backup first.
            Your settings are kept, and if a Sync Space is connected you are
            taken out of it first so the shared cloud copy stays safe.
          </Text>

          {confirmWipe ? (
            <View style={{ flexDirection: "column", gap: 8 }}>
              <View
                style={{
                  padding: 10,
                  backgroundColor: colors.accentSubtle,
                  borderWidth: 1,
                  borderColor: colors.accent,
                  borderRadius: 8,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: FONTS.sansSemiBold,
                    color: colors.ink,
                    lineHeight: 18,
                  }}
                >
                  Erase {dataCounts.matches} {dataCounts.matches === 1 ? "match" : "matches"} ·{" "}
                  {dataCounts.teams} {dataCounts.teams === 1 ? "team" : "teams"} ·{" "}
                  {dataCounts.players} {dataCounts.players === 1 ? "player" : "players"} ·{" "}
                  {dataCounts.tournaments}{" "}
                  {dataCounts.tournaments === 1 ? "tournament" : "tournaments"} from this
                  device?
                </Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <GullyButton
                  size="sm"
                  variant="accent"
                  fullWidth
                  onPress={handleWipeAll}
                >
                  Yes, Wipe Everything
                </GullyButton>
                <GullyButton
                  size="sm"
                  variant="quiet"
                  fullWidth
                  onPress={() => setConfirmWipe(false)}
                >
                  Cancel
                </GullyButton>
              </View>
            </View>
          ) : (
            <GullyButton
              variant="accent"
              fullWidth
              onPress={() => setConfirmWipe(true)}
            >
              Wipe All Local Data
            </GullyButton>
          )}
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
            GullyScore v1.4.6
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
