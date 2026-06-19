import { useMeData } from "@/hooks/useMeData";
import { useAuth } from "@/lib/auth";
import { useTheme, useThemeMode } from "@/lib/useTheme";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Check, ChevronLeft, LogOut, Moon, Smartphone, Sun } from "lucide-react-native";
import type React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ThemeOption = "system" | "light" | "dark";

const THEME_OPTIONS: {
  value: ThemeOption;
  label: string;
  Icon: React.FC<{ color: string; size: number }>;
}[] = [
  { value: "system", label: "System", Icon: Smartphone },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

function dicebearUrl(userId: string) {
  return `https://api.dicebear.com/9.x/thumbs/png?seed=${encodeURIComponent(userId)}&backgroundType=gradientLinear`;
}

export default function Profile() {
  const { colors, type, radius, space } = useTheme();
  const { mode, setMode } = useThemeMode();
  const { session, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const meData = useMeData();

  const email = session?.user?.email ?? "";
  const userId = session?.user?.id ?? "";
  const displayName = meData?.displayName ?? email.split("@")[0];
  const avatarSrc = meData?.avatarUrl ?? dicebearUrl(userId);

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.canvas,
          paddingTop: insets.top + space[6],
          paddingBottom: insets.bottom + 72,
        },
      ]}
    >
      <View style={styles.top}>
        <View style={styles.profileHeader}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel="Back to Lifelist"
            hitSlop={8}
            style={[
              styles.backButton,
              {
                backgroundColor: colors.surface,
                borderColor: colors.borderGlass,
              },
            ]}
          >
            <ChevronLeft size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={[type.headingRegular, { color: colors.textPrimary }]}>Profile</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.avatarWrap}>
          <Image
            source={{ uri: avatarSrc }}
            style={styles.avatar}
            contentFit="cover"
            transition={200}
            accessibilityLabel="Your avatar"
          />
        </View>
        <Text style={[type.headingRegular, { color: colors.textPrimary, marginTop: space[4] }]}>
          {displayName}
        </Text>
        {meData?.displayName ? (
          <Text style={[type.paraRegular, { color: colors.textSecondary, marginTop: space[1] }]}>
            {email}
          </Text>
        ) : null}

        <Text
          style={[
            type.label,
            {
              color: colors.textSecondary,
              marginTop: space[8],
              marginBottom: space[3],
              alignSelf: "flex-start",
            },
          ]}
        >
          APPEARANCE
        </Text>
        <View
          style={[
            styles.section,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderGlass,
              borderRadius: radius.lg,
            },
          ]}
        >
          {THEME_OPTIONS.map((opt, i) => {
            const active = mode === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setMode(opt.value)}
                accessibilityRole="radio"
                accessibilityLabel={opt.label}
                accessibilityState={{ checked: active }}
                style={[
                  styles.row,
                  i < THEME_OPTIONS.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: colors.borderGlass,
                  },
                ]}
              >
                <opt.Icon size={20} color={active ? colors.accent : colors.textSecondary} />
                <Text
                  style={[
                    type.paraRegular,
                    {
                      flex: 1,
                      marginLeft: space[3],
                      color: active ? colors.textPrimary : colors.textSecondary,
                    },
                  ]}
                >
                  {opt.label}
                </Text>
                {active && <Check size={18} color={colors.accent} />}
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.bottom}>
        <Text style={[type.label, { color: colors.textSecondary, marginBottom: space[3] }]}>
          ACCOUNT
        </Text>
        <View
          style={[
            styles.section,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderGlass,
              borderRadius: radius.lg,
            },
          ]}
        >
          <Pressable
            onPress={signOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            style={styles.row}
          >
            <LogOut size={20} color={colors.danger} />
            <Text
              style={[type.paraRegular, { flex: 1, marginLeft: space[3], color: colors.danger }]}
            >
              Sign out
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20, justifyContent: "space-between" },
  top: { alignItems: "center" },
  profileHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerSpacer: { width: 40 },
  bottom: {},
  avatarWrap: { width: 80, height: 80, borderRadius: 40, overflow: "hidden" },
  avatar: { width: 80, height: 80 },
  section: { width: "100%", borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14 },
});
