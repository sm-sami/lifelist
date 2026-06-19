import { DuplicateAlertBanner } from "@/components/DuplicateAlertBanner";
import { useDebounce } from "@/hooks/useDebounce";
import { type DuplicateMatch, createItem, precheckDuplicate } from "@/lib/api/items";
import { useTheme } from "@/lib/useTheme";
import { useItems } from "@/store/items";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Status = "idle" | "checking" | "duplicate" | "submitting";

export default function AddItemModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, radius, type, palette } = useTheme();
  const addOptimistic = useItems((s) => s.addOptimistic);

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [match, setMatch] = useState<DuplicateMatch | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const debouncedTitle = useDebounce(title, 500);

  const precheckGen = useRef(0);
  const precheckAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = debouncedTitle.trim();
    const gen = ++precheckGen.current;
    precheckAbort.current?.abort();

    if (q.length < 3) {
      setStatus("idle");
      setMatch(null);
      return;
    }

    const controller = new AbortController();
    precheckAbort.current = controller;
    setStatus("checking");

    precheckDuplicate(q, controller.signal)
      .then((res) => {
        if (gen !== precheckGen.current) return;
        if (res.isDuplicate && res.match) {
          setMatch(res.match);
          setStatus("duplicate");
        } else {
          setMatch(null);
          setStatus("idle");
        }
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        if (gen === precheckGen.current) setStatus("idle");
      });

    return () => controller.abort();
  }, [debouncedTitle]);

  const canSubmit = title.trim().length >= 3 && status !== "submitting";

  async function submit(force = false) {
    precheckGen.current++;
    precheckAbort.current?.abort();
    setCreateError(null);
    setStatus("submitting");
    try {
      const result = await createItem(title.trim(), { force });
      if (result.ok) {
        addOptimistic(result.item);
        router.back();
        return;
      }
      if ("match" in result && result.match) {
        setMatch(result.match);
        setStatus("duplicate");
      } else {
        setCreateError("Couldn't add this item. Check your connection and try again.");
        setStatus("idle");
      }
    } catch {
      setCreateError("Couldn't add this item. Check your connection and try again.");
      setStatus("idle");
    }
  }

  const dismiss = () => router.back();

  const hint = useMemo(() => {
    if (status === "checking") return "Checking your list…";
    if (status === "duplicate") return "";
    if (title.trim().length > 0 && title.trim().length < 3) return "Keep typing…";
    return "What do you want to do before you die?";
  }, [status, title]);

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={FadeIn} style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss}>
          <BlurView
            tint="dark"
            intensity={Platform.OS === "ios" ? 40 : 0}
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          />
        </Pressable>
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.kav}
      >
        <Animated.View
          entering={SlideInDown.springify().damping(18)}
          exiting={SlideOutDown}
          style={[
            styles.drawer,
            {
              paddingBottom: insets.bottom + 24,
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              borderColor: colors.borderGlass,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.borderGlass }]} />
          <Text style={[styles.heading, { color: colors.textPrimary }]}>Add to your Lifelist</Text>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. See the Northern Lights"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              {
                color: colors.textPrimary,
                backgroundColor: colors.surfaceTint,
                borderRadius: radius.md,
                borderColor: colors.borderGlass,
              },
            ]}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => canSubmit && submit(false)}
            multiline
          />

          <View style={styles.hintRow}>
            {status === "checking" ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : null}
            {hint ? (
              <Text style={[type.label, { color: colors.textSecondary }]}>{hint}</Text>
            ) : null}
          </View>

          {status === "duplicate" && match ? (
            <DuplicateAlertBanner
              match={match}
              onViewExisting={(id) => {
                router.back();
                router.push(`/(protected)/item/${id}`);
              }}
              onAddAnyway={() => submit(true)}
            />
          ) : null}

          {createError ? (
            <Text
              accessibilityRole="alert"
              style={[type.label, { color: colors.danger, marginTop: 10 }]}
            >
              {createError}
            </Text>
          ) : null}

          <Pressable
            disabled={!canSubmit || status === "duplicate"}
            onPress={() => submit(false)}
            accessibilityRole="button"
            accessibilityLabel="Add item"
            style={[
              styles.cta,
              { backgroundColor: colors.accent, borderRadius: radius.md },
              (!canSubmit || status === "duplicate") && styles.ctaDisabled,
            ]}
          >
            {status === "submitting" ? (
              <ActivityIndicator color={palette.white} />
            ) : (
              <Text style={[styles.ctaText, { color: palette.white }]}>Add it</Text>
            )}
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1, justifyContent: "flex-end" },
  drawer: { paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1 },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: "800", marginBottom: 14 },
  input: { fontSize: 18, minHeight: 56, lineHeight: 24, padding: 14, borderWidth: 1 },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, minHeight: 18 },
  cta: { marginTop: 18, paddingVertical: 16, alignItems: "center" },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontSize: 16, fontWeight: "800" },
});
