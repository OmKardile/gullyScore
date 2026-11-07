/**
 * Activity log screen (1.4.7) — a human-friendly, synced audit trail.
 *
 * "Rahul scored 4 — over 12.3 · 7:42 PM" — plain sentences, an icon per
 * action type, subtle highlight for corrections. Grouped by match, then by
 * day; search across person / match / team / player / action; filter chips
 * for Today, This match, Corrections and Umpire changes. Tapping an entry
 * opens a before → after detail with device info.
 *
 * Entry points: Settings (whole space) and Match detail (single match).
 * Visible to everyone, including audience devices.
 */

import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Archive,
  ArrowLeftRight,
  BadgeCheck,
  Calendar,
  ChevronLeft,
  CircleDot,
  Database,
  Download,
  HardDriveDownload,
  History,
  KeyRound,
  LogIn,
  LogOut,
  PenLine,
  Plus,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Trash,
  Trophy,
  Undo2,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react-native";
import { GullyChip, GullySheet } from "../common/Components";
import { useTheme, FONTS } from "../../design/theme";
import { db } from "../../storage/db";
import { ActivityAction, ActivityLogEntry } from "../../types/access";

interface ActivityLogScreenProps {
  /** Only show one match's history (Match detail entry point). */
  matchId?: string;
  onBack: () => void;
}

const ACTION_ICON: Record<ActivityAction, React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>> = {
  ball_scored: CircleDot,
  ball_edited: PenLine,
  ball_removed: Undo2,
  striker_swapped: ArrowLeftRight,
  match_created: Plus,
  match_completed: BadgeCheck,
  match_reopened: RotateCcw,
  match_archived: Archive,
  match_deleted: Trash,
  team_saved: Users,
  team_deleted: Trash,
  player_saved: UserPlus,
  player_deleted: UserMinus,
  tournament_saved: Trophy,
  tournament_deleted: Trash,
  fixture_saved: Calendar,
  key_set: KeyRound,
  key_rotated: KeyRound,
  key_upgraded: ShieldCheck,
  umpire_entered: LogIn,
  umpire_exited: LogOut,
  data_wiped: Trash,
  demo_reseeded: Database,
  backup_imported: HardDriveDownload,
  match_imported: Download,
};

function isCorrection(a: ActivityAction): boolean {
  return (
    a === "ball_edited" ||
    a === "ball_removed" ||
    a === "match_reopened" ||
    a === "match_deleted" ||
    a === "team_deleted" ||
    a === "player_deleted" ||
    a === "tournament_deleted" ||
    a === "data_wiped" ||
    a === "key_rotated"
  );
}

function isUmpireChange(a: ActivityAction): boolean {
  return (
    a === "umpire_entered" ||
    a === "umpire_exited" ||
    a === "key_set" ||
    a === "key_rotated" ||
    a === "key_upgraded"
  );
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function fmtDay(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const sameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  try {
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

type Row =
  | { type: "group"; key: string; label: string; sub?: boolean }
  | { type: "entry"; key: string; entry: ActivityLogEntry };

export const ActivityLogScreen: React.FC<ActivityLogScreenProps> = ({
  matchId,
  onBack,
}) => {
  const { colors } = useTheme();
  const [all, setAll] = useState<ActivityLogEntry[]>(() => db.getActivityLog());
  const [query, setQuery] = useState("");
  const [onlyToday, setOnlyToday] = useState(false);
  const [onlyCorrections, setOnlyCorrections] = useState(false);
  const [onlyUmpireChanges, setOnlyUmpireChanges] = useState(false);
  const [onlyThisMatch, setOnlyThisMatch] = useState(!!matchId);
  const [selected, setSelected] = useState<ActivityLogEntry | null>(null);

  useEffect(() => db.subscribe(() => setAll(db.getActivityLog())), []);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();

    const filtered = all.filter((e) => {
      if (onlyThisMatch && matchId && e.matchId !== matchId) return false;
      if (onlyToday && e.ts < todayMs) return false;
      if (onlyCorrections && !(e.correction || isCorrection(e.action))) return false;
      if (onlyUmpireChanges && !isUmpireChange(e.action)) return false;
      if (q) {
        const hay = `${e.actorName} ${e.detail} ${e.matchLabel || ""} ${e.action.replace(/_/g, " ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // Group by match, then by day; matches with no label land under
    // "Space & app changes" (key/umpire/wipe/import events).
    const byMatch = new Map<string, ActivityLogEntry[]>();
    for (const e of filtered) {
      const key = e.matchLabel || e.matchId || "__space__";
      const list = byMatch.get(key);
      if (list) list.push(e);
      else byMatch.set(key, [e]);
    }
    const out: Row[] = [];
    for (const [matchKey, entries] of byMatch) {
      out.push({
        type: "group",
        key: `g-${matchKey}`,
        label: matchKey === "__space__" ? "Space & app changes" : matchKey,
      });
      const byDay = new Map<string, ActivityLogEntry[]>();
      for (const e of entries) {
        const day = fmtDay(e.ts);
        const list = byDay.get(day);
        if (list) list.push(e);
        else byDay.set(day, [e]);
      }
      for (const [day, dayEntries] of byDay) {
        if (dayEntries.length > 0 && byDay.size > 1) {
          out.push({ type: "group", key: `d-${matchKey}-${day}`, label: day, sub: true });
        }
        for (const e of dayEntries) {
          out.push({ type: "entry", key: e.id, entry: e });
        }
      }
    }
    return out;
  }, [all, query, onlyToday, onlyCorrections, onlyUmpireChanges, onlyThisMatch, matchId]);

  const hasAnyFilters =
    query.trim() !== "" || onlyToday || onlyCorrections || onlyUmpireChanges || onlyThisMatch;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Header */}
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
          Activity Log
        </Text>
        <History size={20} strokeWidth={1.8} color={colors.ink2} style={{ marginRight: 12 }} />
      </View>

      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        {/* Search + filters */}
        <View style={{ paddingTop: 14, gap: 10 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderWidth: 1,
              borderColor: colors.hairlineStrong,
              borderRadius: 10,
              paddingHorizontal: 12,
              backgroundColor: colors.surface,
            }}
          >
            <Search size={16} strokeWidth={1.8} color={colors.ink2} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search person, match, team or action"
              placeholderTextColor={colors.ink2}
              accessibilityLabel="Search the activity log"
              style={{
                flex: 1,
                paddingVertical: 10,
                fontSize: 14,
                fontFamily: FONTS.sans,
                color: colors.ink,
              }}
            />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <GullyChip label="Today" active={onlyToday} onPress={() => setOnlyToday((v) => !v)} />
            {matchId ? (
              <GullyChip label="This match" active={onlyThisMatch} onPress={() => setOnlyThisMatch((v) => !v)} />
            ) : null}
            <GullyChip
              label="Corrections"
              active={onlyCorrections}
              onPress={() => setOnlyCorrections((v) => !v)}
            />
            <GullyChip
              label="Umpire changes"
              active={onlyUmpireChanges}
              onPress={() => setOnlyUmpireChanges((v) => !v)}
            />
          </View>
        </View>

        {/* The list */}
        {rows.length === 0 ? (
          <View style={{ alignItems: "center", paddingVertical: 56, gap: 8 }}>
            <ScrollText size={28} strokeWidth={1.5} color={colors.ink2} />
            <Text style={{ fontSize: 15, fontFamily: FONTS.serif, color: colors.ink }}>
              {hasAnyFilters ? "Nothing matches" : "No activity yet"}
            </Text>
            <Text
              style={{
                fontSize: 13,
                color: colors.ink2,
                fontFamily: FONTS.sans,
                textAlign: "center",
                maxWidth: 280,
              }}
            >
              {hasAnyFilters
                ? "Try a different search or clear the filters."
                : "Every change an umpire makes — scoring, edits, corrections — will show up here in plain words."}
            </Text>
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(r) => r.key}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={24}
            windowSize={9}
            contentContainerStyle={{ paddingBottom: 32, paddingTop: 6 }}
            renderItem={({ item }) => {
              if (item.type === "group") {
                const sub = item.sub;
                return (
                  <View style={{ paddingTop: sub ? 8 : 18, paddingBottom: 6 }}>
                    <Text
                      style={{
                        fontSize: sub ? 11 : 13,
                        fontFamily: FONTS.sansSemiBold,
                        textTransform: sub ? "none" : "uppercase",
                        letterSpacing: sub ? 0 : 1,
                        color: sub ? colors.ink2 : colors.ink,
                      }}
                    >
                      {item.label}
                    </Text>
                    <View
                      style={{
                        height: 1,
                        backgroundColor: colors.hairline,
                        marginTop: 6,
                      }}
                    />
                  </View>
                );
              }
              const e = item.entry;
              const Icon = ACTION_ICON[e.action] || CircleDot;
              const correction = e.correction || isCorrection(e.action);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Activity: ${e.actorName} ${e.detail}`}
                  onPress={() => setSelected(e)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 10,
                    paddingVertical: 10,
                    paddingLeft: 8,
                    borderRadius: 6,
                    backgroundColor: pressed ? colors.surfaceCard : "transparent",
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  {/* Corrections carry the subtle 2dp accent bar. */}
                  {correction ? (
                    <View
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 8,
                        bottom: 8,
                        width: 2,
                        borderRadius: 1,
                        backgroundColor: colors.accent,
                      }}
                    />
                  ) : null}
                  <View style={{ marginTop: 2 }}>
                    <Icon size={16} strokeWidth={1.8} color={correction ? colors.accent : colors.ink2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 14,
                        fontFamily: FONTS.sans,
                        color: colors.ink,
                        lineHeight: 19,
                      }}
                    >
                      <Text style={{ fontFamily: FONTS.sansSemiBold }}>{e.actorName}</Text> {e.detail}
                    </Text>
                    <Text
                      style={{
                        fontSize: 11,
                        color: colors.ink2,
                        fontFamily: FONTS.sans,
                        marginTop: 2,
                      }}
                    >
                      {e.actorTag} · {fmtTime(e.ts)}
                      {e.matchLabel && !matchId ? ` · ${e.matchLabel}` : ""}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>

      {/* Entry detail: before → after with device info */}
      <GullySheet
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        title="What changed"
      >
        {selected ? (
          <View style={{ gap: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {(() => {
                const Icon = ACTION_ICON[selected.action] || CircleDot;
                return <Icon size={20} strokeWidth={1.8} color={colors.ink} />;
              })()}
              <Text style={{ fontSize: 15, fontFamily: FONTS.sansSemiBold, color: colors.ink, flex: 1 }}>
                {selected.actorName} · {selected.actorTag}
              </Text>
            </View>
            <Text style={{ fontSize: 14, color: colors.ink, fontFamily: FONTS.sans, lineHeight: 20 }}>
              {selected.detail}
            </Text>
            {selected.before !== undefined || selected.after !== undefined ? (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.hairlineStrong,
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {[
                  { k: "Before", v: selected.before },
                  { k: "After", v: selected.after },
                ].map(
                  (r, i) =>
                    r.v !== undefined && (
                      <View
                        key={r.k}
                        style={{
                          flexDirection: "row",
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                          borderBottomWidth: i === 0 ? 1 : 0,
                          borderBottomColor: colors.hairline,
                          backgroundColor: i === 1 ? colors.surfaceCard : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            width: 64,
                            fontSize: 11,
                            fontFamily: FONTS.sansSemiBold,
                            textTransform: "uppercase",
                            letterSpacing: 1,
                            color: colors.ink2,
                            marginTop: 2,
                          }}
                        >
                          {r.k}
                        </Text>
                        <Text
                          style={{
                            flex: 1,
                            fontSize: 14,
                            fontFamily: FONTS.sans,
                            color: colors.ink,
                          }}
                        >
                          {r.v}
                        </Text>
                      </View>
                    ),
                )}
              </View>
            ) : null}
            <View style={{ gap: 4 }}>
              <Text style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans }}>
                Device: {selected.actorModel} · {selected.actorTag}
              </Text>
              {selected.matchLabel ? (
                <Text style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans }}>
                  Match: {selected.matchLabel}
                </Text>
              ) : null}
              <Text style={{ fontSize: 12, color: colors.ink2, fontFamily: FONTS.sans }}>
                {new Date(selected.ts).toLocaleString()}
                {selected.correction || isCorrection(selected.action) ? " · correction" : ""}
              </Text>
            </View>
          </View>
        ) : null}
      </GullySheet>
    </SafeAreaView>
  );
};
