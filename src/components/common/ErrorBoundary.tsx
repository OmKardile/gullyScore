/**
 * App-wide React error boundary (production readiness).
 *
 * Catches any render crash in the tree and shows a friendly recovery
 * screen instead of a white screen / native crash dialog.
 */

import React from "react";
import { View, Text, Pressable } from "react-native";
import { useTheme, FONTS } from "../../design/theme";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

const CrashFallback: React.FC<{ message: string; onRetry: () => void }> = ({
  message,
  onRetry,
}) => {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <Text
        style={{
          fontSize: 20,
          fontFamily: FONTS.serifBold,
          fontWeight: "700",
          color: colors.ink,
          textAlign: "center",
        }}
      >
        Something went wrong
      </Text>
      <Text
        style={{
          fontSize: 13,
          fontFamily: FONTS.sans,
          color: colors.ink2,
          textAlign: "center",
          marginTop: 8,
          lineHeight: 20,
        }}
      >
        GullyScore hit an unexpected error. Your data is safe — nothing was
        lost.
      </Text>
      {message ? (
        <Text
          style={{
            fontSize: 11,
            fontFamily: FONTS.sans,
            color: colors.ink2,
            textAlign: "center",
            marginTop: 12,
            opacity: 0.8,
          }}
          numberOfLines={3}
        >
          {message}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Reload app"
        onPress={onRetry}
        style={({ pressed }) => [
          {
            marginTop: 24,
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 10,
            backgroundColor: pressed ? colors.accentSubtle : colors.accent,
            borderWidth: 1,
            borderColor: colors.accent,
          },
        ]}
      >
        <Text
          style={{
            fontSize: 14,
            fontFamily: FONTS.sansSemiBold,
            fontWeight: "600",
            color: "#FFFFFF",
          }}
        >
          Try Again
        </Text>
      </Pressable>
    </View>
  );
};

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: String(error?.message || error || "").slice(0, 240),
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep a breadcrumb for release diagnostics (no PII).
    console.error("[GullyScore] UI crash:", error?.message, info?.componentStack);
  }

  handleRetry = () => this.setState({ hasError: false, message: "" });

  render() {
    if (this.state.hasError) {
      return (
        <CrashFallback message={this.state.message} onRetry={this.handleRetry} />
      );
    }
    return this.props.children;
  }
}
