#!/usr/bin/env bash
# scaffold-screen.sh — generate a new Expo screen or component pre-wired with the
# Lifelist conventions: useTheme() (light/dark), safe-area insets, Halyard type tokens.
# Agent-agnostic. Usage:
#   scripts/scaffold-screen.sh screen <Name>      -> apps/mobile/app/<name>.tsx (default export)
#   scripts/scaffold-screen.sh component <Name>   -> apps/mobile/components/<Name>.tsx (named export)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"

kind="${1:-}"; name="${2:-}"
[ -n "$kind" ] && [ -n "$name" ] || { echo "usage: scaffold-screen.sh <screen|component> <Name>"; exit 2; }
# Strip any non-alnum, keep as-is for the component identifier (assume PascalCase input).
comp="$(printf '%s' "$name" | tr -cd '[:alnum:]')"
[ -n "$comp" ] || { echo "Invalid name."; exit 2; }

case "$kind" in
  screen)
    fname="$(printf '%s' "$comp" | tr '[:upper:]' '[:lower:]')"
    out="apps/mobile/app/${fname}.tsx"
    mkdir -p "apps/mobile/app"
    [ -f "$out" ] && { echo "Refusing to overwrite $out"; exit 1; }
    cat > "$out" <<EOF
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/useTheme";

export default function ${comp}Screen() {
  const insets = useSafeAreaInsets();
  const { colors, type } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 100, // clears the floating tab bar (AGENTS.md §safe-area)
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[type.displaySmall, { color: colors.textPrimary }]}>${comp}</Text>
      </ScrollView>
    </View>
  );
}
EOF
    ;;
  component)
    out="apps/mobile/components/${comp}.tsx"
    mkdir -p "apps/mobile/components"
    [ -f "$out" ] && { echo "Refusing to overwrite $out"; exit 1; }
    cat > "$out" <<EOF
import { Text, View } from "react-native";
import { useTheme } from "@/lib/useTheme";

export function ${comp}() {
  const { colors, radius, type } = useTheme();
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 16 }}>
      <Text style={[type.headingRegular, { color: colors.textPrimary }]}>${comp}</Text>
    </View>
  );
}
EOF
    ;;
  *) echo "usage: scaffold-screen.sh <screen|component> <Name>"; exit 2 ;;
esac

echo "Created $out — themed (useTheme), safe-area aware, Halyard type tokens."
