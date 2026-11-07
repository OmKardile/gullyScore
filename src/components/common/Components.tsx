/**
 * GullyScoreRN Custom Design System Components
 *
 * Faithful RN port of the web app's common/Components.tsx.
 * Same exported names and props where RN allows:
 * - GullyButton (primary | quiet | accent | text, sm | md | lg)
 * - GullyTextField (underline style)
 * - GullySegmented
 * - GullyChip (2px radius, no pills)
 * - GullySheet (bottom sheet, 16px top radius)
 * - GullyListRow
 * - OverRibbon
 * - ScoreOdometer
 * - WagonWheel (react-native-svg port of the canvas drawing)
 * - ManhattanChart
 *
 * Design rules kept from the web app:
 * - Radius tokens: 2px chips, 10px controls, 16px sheets
 * - Hairline borders, whitespace over boxes
 * - Subtle scale 0.98 + opacity press states
 * - Tabular figures on numerals (tabular via fontFeatureSettings)
 */

import React, { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Svg, { Circle, Ellipse, Line, Rect, Polyline } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, FONTS } from "../../design/theme";

// --- BUTTONS ---
export interface ButtonProps {
  variant?: "primary" | "quiet" | "accent" | "text";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  fullWidth?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: object | object[];
}

export const GullyButton: React.FC<ButtonProps> = ({
  variant = "quiet",
  size = "md",
  children,
  fullWidth = false,
  disabled,
  onPress,
  style,
}) => {
  const { colors } = useTheme();
  const [pressed, setPressed] = useState(false);

  const sizeStyles = {
    sm: { height: 36, paddingHorizontal: 12, borderRadius: 10 },
    md: { height: 48, paddingHorizontal: 20, borderRadius: 10 },
    lg: { height: 56, paddingHorizontal: 24, borderRadius: 10 },
  }[size];

  const variantStyles = {
    primary: { backgroundColor: colors.ink },
    quiet: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.hairlineStrong,
    },
    accent: { backgroundColor: colors.accent },
    text: { backgroundColor: "transparent" },
  }[variant];

  const textColor =
    variant === "primary"
      ? colors.bg
      : variant === "accent"
      ? "#FFFFFF"
      : pressed && variant === "text"
      ? colors.accent
      : colors.ink;

  const fontSize = size === "sm" ? 12 : size === "lg" ? 16 : 14;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={({ pressed: p }) => [
        {
          opacity: disabled ? 0.4 : p ? 0.9 : 1,
          transform: [{ scale: p && !disabled ? 0.98 : 1 }],
        },
        styles.buttonBase,
        sizeStyles,
        variantStyles,
        fullWidth && { alignSelf: "stretch" },
        style as object,
      ]}
    >
      <Text
        style={{
          color: textColor,
          fontSize,
          fontFamily: FONTS.sans,
          fontWeight: "500",
          letterSpacing: -0.2,
          textAlign: "center",
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
};

// --- TEXT FIELD (UNDERLINE STYLE) ---
export interface TextFieldProps {
  label: string;
  error?: string;
  hint?: string;
  tabular?: boolean;
  value?: string;
  onChangeText?: (t: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "number-pad" | "email-address";
  multiline?: boolean;
  style?: object | object[];
}

export const GullyTextField: React.FC<TextFieldProps> = ({
  label,
  error,
  hint,
  tabular = false,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  style,
}) => {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={[{ alignSelf: "stretch" }, style as object]}>
      <Text
        style={{
          fontSize: 11,
          fontFamily: FONTS.sans,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: colors.ink2,
          fontWeight: "600",
          marginBottom: 4,
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.ink2}
        keyboardType={keyboardType || "default"}
        multiline={multiline}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          borderBottomWidth: 1,
          borderBottomColor: error
            ? colors.accent
            : focused
            ? colors.accent
            : colors.hairlineStrong,
          color: colors.ink,
          paddingVertical: 8,
          fontSize: 16,
          fontFamily: FONTS.sans,
          ...(tabular ? { fontVariant: ["tabular-nums"] as any } : {}),
        }}
      />
      {hint && !error ? (
        <Text style={{ fontSize: 11, color: colors.ink2, marginTop: 4 }}>
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text
          style={{
            fontSize: 11,
            color: colors.accent,
            fontWeight: "500",
            marginTop: 4,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
};

// --- SEGMENTED CONTROL ---
export interface SegmentedControlProps<T extends string> {
  options: { label: string; value: T }[];
  value: T;
  onChange: (val: T) => void;
}

export function GullySegmented<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignSelf: "flex-start",
        padding: 4,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.hairline,
        borderRadius: 10,
      }}
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              {
                paddingHorizontal: 16,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: isActive ? colors.surfaceCard : "transparent",
                borderWidth: isActive ? 1 : 0,
                borderColor: colors.hairlineStrong,
                opacity: pressed ? 0.9 : 1,
              },
            ]}
          >
            <Text
              style={{
                fontSize: 12,
                fontFamily: FONTS.sans,
                fontWeight: isActive ? "600" : "500",
                color: isActive ? colors.ink : colors.ink2,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- CHIP (RADIUS 2PX, NO PILLS) ---
export interface ChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
  colorDot?: string;
}

export const GullyChip: React.FC<ChipProps> = ({
  label,
  active = false,
  onPress,
  colorDot,
}) => {
  const { colors } = useTheme();
  const ChipPress = onPress ? Pressable : View;
  return (
    <ChipPress
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }: any) => [
        {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 2,
          borderWidth: 1,
          backgroundColor: active ? colors.accentSubtle : "transparent",
          borderColor: active ? colors.accent : colors.hairlineStrong,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {colorDot ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 1,
            backgroundColor: colorDot,
          }}
        />
      ) : null}
      <Text
        style={{
          fontSize: 12,
          fontFamily: FONTS.sans,
          fontWeight: active ? "600" : "400",
          color: active ? colors.accent : colors.ink2,
        }}
      >
        {label}
      </Text>
    </ChipPress>
  );
};

// --- BOTTOM SHEET ---
export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export const GullySheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  children,
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.5)" }]}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderTopWidth: 1,
            borderLeftWidth: 1,
            borderRightWidth: 1,
            borderColor: colors.hairlineStrong,
            maxHeight: "85%",
          }}
        >
          {/* Grab handle */}
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.hairlineStrong,
              alignSelf: "center",
              marginTop: 10,
              marginBottom: 4,
            }}
          />
          {title ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 20,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.hairline,
              }}
            >
              <Text
                style={{
                  fontSize: 18,
                  fontFamily: FONTS.serif,
                  fontWeight: "500",
                  color: colors.ink,
                }}
              >
                {title}
              </Text>
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={{ fontSize: 12, color: colors.ink2 }}>Close</Text>
              </Pressable>
            </View>
          ) : null}
          <ScrollView
            style={{ paddingHorizontal: 20, paddingVertical: 20 }}
            contentContainerStyle={{ paddingBottom: Math.max(40, insets.bottom + 24) }}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// --- LIST ROW ---
export interface ListRowProps {
  title: string;
  meta?: string;
  rightMetric?: string | React.ReactNode;
  icon?: React.ReactNode;
  colorBar?: string;
  onPress?: () => void;
}

export const GullyListRow: React.FC<ListRowProps> = ({
  title,
  meta,
  rightMetric,
  icon,
  colorBar,
  onPress,
}) => {
  const { colors } = useTheme();
  const RowPress = onPress ? Pressable : View;
  return (
    <RowPress
      onPress={onPress}
      style={({ pressed }: any) => [
        {
          position: "relative",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 58,
          paddingVertical: 12,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
          opacity: pressed && onPress ? 0.9 : 1,
        },
      ]}
    >
      {colorBar ? (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 2,
            borderRadius: 1,
            backgroundColor: colorBar,
          }}
        />
      ) : null}
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1, paddingRight: 12 }}
      >
        {icon ? <View>{icon}</View> : null}
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              fontSize: 15,
              fontFamily: FONTS.sans,
              fontWeight: "500",
              color: colors.ink,
            }}
          >
            {title}
          </Text>
          {meta ? (
            <Text
              numberOfLines={1}
              style={{ fontSize: 12, color: colors.ink2, marginTop: 2 }}
            >
              {meta}
            </Text>
          ) : null}
        </View>
      </View>
      {rightMetric !== undefined && rightMetric !== null ? (
        typeof rightMetric === "string" ? (
          <Text
            style={{
              fontSize: 14,
              color: colors.ink,
              fontVariant: ["tabular-nums"] as any,
              textAlign: "right",
            }}
          >
            {rightMetric}
          </Text>
        ) : (
          rightMetric
        )
      ) : null}
    </RowPress>
  );
};

// --- OVER RIBBON ---
export interface BallMark {
  runsBat: number;
  extraType: string;
  extraRuns: number;
  isWicket: boolean;
  isLegal: boolean;
}

export const OverRibbon: React.FC<{
  balls: BallMark[];
  activeBallIndex?: number;
  onBallClick?: (index: number) => void;
}> = ({ balls, activeBallIndex, onBallClick }) => {
  const { colors } = useTheme();

  if (balls.length === 0) {
    return (
      <Text style={{ fontSize: 12, color: colors.ink2, fontStyle: "italic" }}>
        Over just begun
      </Text>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 4,
        paddingHorizontal: 4,
      }}
    >
      {balls.map((b, idx) => {
        let text = `${b.runsBat}`;
        const isBoundary = b.runsBat === 4 || b.runsBat === 6;

        if (b.isWicket) {
          text = "W";
        } else if (b.extraType === "wide") {
          text = b.extraRuns > 1 ? `${b.extraRuns}wd` : "wd";
        } else if (b.extraType === "no_ball") {
          text = b.runsBat > 0 ? `${b.runsBat}nb` : "nb";
        } else if (b.extraType === "bye") {
          text = `${b.extraRuns}b`;
        } else if (b.extraType === "leg_bye") {
          text = `${b.extraRuns}lb`;
        } else if (b.runsBat === 0) {
          text = "•";
        }

        const isW = b.isWicket;
        const isSelected = activeBallIndex === idx;

        const bg = isW
          ? colors.accent
          : isBoundary
          ? colors.ink
          : "transparent";
        const fg = isW || isBoundary ? (isW ? "#FFFFFF" : colors.bg) : colors.ink;

        const Ball = onBallClick ? Pressable : View;
        return (
          <Ball
            key={idx}
            onPress={onBallClick ? () => onBallClick(idx) : undefined}
            style={{
              width: 28,
              height: 28,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 2,
              backgroundColor: bg,
              borderWidth: isW || isBoundary ? 0 : 1,
              borderColor: colors.hairlineStrong,
              ...(isSelected
                ? {
                    borderWidth: 2,
                    borderColor: colors.accent,
                  }
                : {}),
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontFamily: FONTS.serif,
                fontWeight: isW || isBoundary ? "700" : "400",
                color: fg,
              }}
            >
              {text}
            </Text>
          </Ball>
        );
      })}
    </ScrollView>
  );
};

// --- SCORE ODOMETER ---
export const ScoreOdometer: React.FC<{
  runs: number;
  wickets: number;
  overs: string;
  crr: number;
  target?: number;
  rrr?: number;
}> = ({ runs, wickets, overs, crr, target, rrr }) => {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center", paddingVertical: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
        <Text
          style={{
            fontSize: 56,
            fontFamily: FONTS.serif,
            fontWeight: "700",
            color: colors.ink,
            fontVariant: ["tabular-nums"] as any,
          }}
        >
          {runs}
        </Text>
        <Text
          style={{
            fontSize: 36,
            fontFamily: FONTS.serif,
            color: colors.ink2,
            marginHorizontal: 2,
          }}
        >
          /
        </Text>
        <Text
          style={{
            fontSize: 44,
            fontFamily: FONTS.serif,
            fontWeight: "700",
            color: colors.ink,
            fontVariant: ["tabular-nums"] as any,
          }}
        >
          {wickets}
        </Text>
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
          style={{
            fontSize: 14,
            color: colors.ink,
            fontWeight: "500",
            fontVariant: ["tabular-nums"] as any,
          }}
        >
          {overs} overs
        </Text>
        <Text style={{ color: colors.ink2 }}>·</Text>
        <Text style={{ fontSize: 14, color: colors.ink2, fontVariant: ["tabular-nums"] as any }}>
          CRR {crr.toFixed(2)}
        </Text>
        {target !== undefined ? (
          <>
            <Text style={{ color: colors.ink2 }}>·</Text>
            <Text
              style={{
                fontSize: 14,
                color: colors.accent,
                fontWeight: "600",
                fontVariant: ["tabular-nums"] as any,
              }}
            >
              Target {target}
            </Text>
            {rrr !== undefined && rrr > 0 ? (
              <>
                <Text style={{ color: colors.ink2 }}>·</Text>
                <Text
                  style={{
                    fontSize: 14,
                    color: colors.ink2,
                    fontVariant: ["tabular-nums"] as any,
                  }}
                >
                  RRR {rrr.toFixed(2)}
                </Text>
              </>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
};

// --- WAGON WHEEL (SVG port of the canvas drawing) ---
export const WagonWheel: React.FC<{
  shots: Array<{ direction: string; runs: number }>;
  width?: number;
  height?: number;
}> = ({ shots, width = 280, height = 280 }) => {
  const { colors } = useTheme();
  const cx = width / 2;
  const cy = height / 2;
  const rBoundary = width * 0.44;
  const rInner = width * 0.26;

  const directionAngles: Record<string, number> = {
    fine_leg: Math.PI * 0.65,
    square_leg: Math.PI * 0.85,
    mid_wicket: Math.PI * 1.15,
    long_on: Math.PI * 1.4,
    straight: Math.PI * 1.5,
    long_off: Math.PI * 1.65,
    cover: Math.PI * 1.85,
    point: Math.PI * 0.15,
    third_man: Math.PI * 0.35,
  };

  return (
    <View style={{ alignItems: "center" }}>
      <View
        style={{
          width,
          height,
          borderRadius: width / 2,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.hairline,
        }}
      >
        <Svg width={width} height={height}>
          {/* Boundary ellipse */}
          <Circle
            cx={cx}
            cy={cy}
            r={rBoundary}
            stroke="rgba(100,100,100,0.25)"
            strokeWidth={1}
            fill="transparent"
          />
          {/* 30-yard circle (dashed via strokeDasharray) */}
          <Circle
            cx={cx}
            cy={cy}
            r={rInner}
            stroke="rgba(100,100,100,0.25)"
            strokeWidth={1}
            strokeDasharray="3 4"
            fill="transparent"
          />
          {/* Pitch */}
          <Rect
            x={cx - 3}
            y={cy - 14}
            width={6}
            height={28}
            stroke="rgba(100,100,100,0.4)"
            strokeWidth={1}
            fill="transparent"
          />
          {shots.map((s, i) => {
            const angle = directionAngles[s.direction] ?? Math.PI * 1.5;
            const lengthFraction =
              s.runs === 6 ? 1.0 : s.runs === 4 ? 0.96 : (s.runs / 4) * 0.7 + 0.2;
            const len = rBoundary * lengthFraction;
            const tx = cx + Math.cos(angle) * len;
            const ty = cy + Math.sin(angle) * len;
            const strokeColor =
              s.runs >= 4
                ? s.runs === 6
                  ? "#B4232A"
                  : "rgba(180,35,42,0.75)"
                : "rgba(30,30,35,0.3)";
            const strokeWidth = s.runs >= 4 ? (s.runs === 6 ? 2 : 1.5) : 1;
            const dotColor =
              s.runs >= 4 ? "#B4232A" : "rgba(30,30,35,0.5)";
            const dotR = s.runs >= 4 ? 2.5 : 1.5;
            return (
              <React.Fragment key={i}>
                <Line
                  x1={cx}
                  y1={cy}
                  x2={tx}
                  y2={ty}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                />
                <Circle cx={tx} cy={ty} r={dotR} fill={dotColor} />
              </React.Fragment>
            );
          })}
        </Svg>
      </View>
      <View
        style={{ flexDirection: "row", gap: 16, marginTop: 8, alignItems: "center" }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 10, height: 2, backgroundColor: colors.accent }} />
          <Text style={{ fontSize: 11, color: colors.ink2 }}>Boundaries (4/6)</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 10, height: 2, backgroundColor: "#9CA3AF" }} />
          <Text style={{ fontSize: 11, color: colors.ink2 }}>Singles & Twos</Text>
        </View>
      </View>
    </View>
  );
};

// --- MANHATTAN CHART ---
export const ManhattanChart: React.FC<{
  overs: Array<{ overNumber: number; runs: number; wickets: number }>;
  height?: number;
}> = ({ overs }) => {
  const { colors } = useTheme();
  if (overs.length === 0) {
    return (
      <Text
        style={{
          fontSize: 12,
          color: colors.ink2,
          paddingVertical: 16,
          textAlign: "center",
        }}
      >
        No overs completed yet
      </Text>
    );
  }

  const maxRuns = Math.max(12, ...overs.map((o) => o.runs));

  return (
    <View style={{ paddingVertical: 8 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 6,
          height: 140,
          paddingTop: 16,
          paddingHorizontal: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairlineStrong,
        }}
      >
        {overs.map((o) => {
          const barHeight = Math.max(4, (o.runs / maxRuns) * 85);
          return (
            <View
              key={o.overNumber}
              style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" }}
            >
              {o.wickets > 0 ? (
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: colors.accent,
                    marginBottom: 4,
                  }}
                />
              ) : null}
              <View
                style={{
                  width: "100%",
                  height: `${barHeight}%`,
                  backgroundColor: colors.ink,
                  opacity: 0.85,
                  borderTopLeftRadius: 1,
                  borderTopRightRadius: 1,
                }}
              />
              <Text
                style={{
                  fontSize: 10,
                  color: colors.ink2,
                  marginTop: 4,
                  fontVariant: ["tabular-nums"] as any,
                }}
              >
                {o.overNumber}
              </Text>
            </View>
          );
        })}
      </View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          paddingTop: 4,
          paddingHorizontal: 8,
        }}
      >
        <Text style={{ fontSize: 11, color: colors.ink2 }}>Over number</Text>
        <Text style={{ fontSize: 11, color: colors.ink2 }}>
          Bar = Runs · Dot = Wicket
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  buttonBase: {
    alignItems: "center",
    justifyContent: "center",
  },
});
