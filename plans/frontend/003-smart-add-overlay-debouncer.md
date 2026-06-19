# Frontend 003 — Smart-Add Overlay + Debouncer

> Phase 3 of the Lifelist app. Builds the full-screen animated Smart-Add drawer
> (`app/(protected)/modals/add-item.tsx`), a high-performance 500ms debounced text input, and the
> conditional `DuplicateAlertBanner` that surfaces the `409` semantic-duplicate
> response from `backend/003`/`backend/004`.

---

## 🎯 Objective

1. Build a full-screen translucent drawer overlay that slides up over the Dashboard
   (using the `transparentModal` route from `frontend/001`).
2. Provide a reusable `useDebounce` hook (500ms) and a managed `SmartInput` component
   that drives a **dry-run duplicate pre-check** as the user types — without spamming
   the backend.
3. Render a `DuplicateAlertBanner` conditionally when the pre-check (or the final
   create call) reports a semantic duplicate, offering "View existing" / "Add anyway".

---

## 💻 Code & Configuration Blueprints

### 1. `useDebounce` hook — `hooks/useDebounce.ts`

```ts
// hooks/useDebounce.ts
import { useEffect, useRef, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delay` ms of quiet.
 * The timer is reset on every change, so rapid typing fires the downstream effect
 * only once, 500ms after the user pauses.
 */
export function useDebounce<T>(value: T, delay = 500): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delay]);

  return debounced;
}
```

### 2. Duplicate pre-check endpoint client — `lib/api/items.ts` (excerpt)

> `apiFetch` (integration/001) forwards a standard `RequestInit`, including `signal`, to
> the underlying `fetch`, so passing an `AbortController.signal` cancels the request.

```ts
// lib/api/items.ts (excerpt — full client built in integration/001)
import { apiFetch } from "@/lib/api/client"; // JWT-injecting fetch (integration/001)
import { ItemDtoSchema, type ItemDto } from "@lifelist/shared";

export interface DuplicateMatch {
  id: string;
  title: string;
  similarity: number;
}

export interface PrecheckResult {
  isDuplicate: boolean;
  match?: DuplicateMatch;
}

/**
 * Dry-run duplicate check. Hits a lightweight backend endpoint that embeds + searches
 * but does NOT insert. (Add to backend/004 routes: GET /api/items/precheck?title=...)
 * Returns isDuplicate=false on any network error so typing never blocks the user.
 *
 * Accepts an AbortSignal so a stale in-flight precheck can be cancelled when the user
 * keeps typing (the caller bumps a request generation + aborts the previous request).
 * An aborted fetch rejects with an AbortError, which we RE-THROW so the caller can tell
 * "cancelled" apart from a real failure (and not act on a stale result). Only a genuine
 * non-abort error is swallowed into `isDuplicate: false` so typing never blocks.
 *
 * Only a `409` is treated as a duplicate; EVERY other status (200, 4xx, 5xx) is a
 * non-duplicate so a non-success status can never masquerade as "duplicate".
 */
export async function precheckDuplicate(
  title: string,
  signal?: AbortSignal,
): Promise<PrecheckResult> {
  if (title.trim().length < 3) return { isDuplicate: false };
  try {
    const res = await apiFetch(`/items/precheck?title=${encodeURIComponent(title)}`, { signal });
    if (res.status === 409) {
      const body = await res.json();
      return { isDuplicate: true, match: body.match };
    }
    return { isDuplicate: false }; // any non-409 (incl. errors) → not a duplicate
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return { isDuplicate: false };
  }
}

export async function createItem(
  title: string,
  opts?: { force?: boolean },
): Promise<
  | { ok: true; item: ItemDto }
  | { ok: false; match?: DuplicateMatch } // 409 duplicate
  | { ok: false; error: true } // any other non-success status
> {
  const res = await apiFetch(`/items/create`, {
    method: "POST",
    body: JSON.stringify({ title, force: opts?.force ?? false }),
  });
  if (res.status === 409) {
    const body = await res.json();
    return { ok: false, match: body.match };
  }
  // Only treat a genuine 2xx as success; every other status is a real failure the
  // caller must surface/recover from — never fall through and try to parse an item.
  if (!res.ok) return { ok: false, error: true };
  const body = await res.json();
  return { ok: true, item: ItemDtoSchema.parse(body.item) };
}
```

> **Backend alignment (now real, not assumed):** as of `backend/004` the backend
> **implements both** of these: `GET /api/items/precheck` runs `embed` +
> `findSemanticDuplicate` and returns `409` with the same body shape as create but never
> inserts, and `POST /api/items/create` accepts a `force` flag that skips
> `findSemanticDuplicate` when `force === true`. So the live precheck (debounced typing)
> and the "Add anyway" path below are wired to shipped endpoints — the client code in §2
> already sends `force` and calls `precheck`, and it matches the backend contract.

### 3. `DuplicateAlertBanner` — `components/DuplicateAlertBanner.tsx`

```tsx
// components/DuplicateAlertBanner.tsx
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/lib/useTheme";
import type { DuplicateMatch } from "@/lib/api/items";

interface Props {
  match: DuplicateMatch;
  onViewExisting: (id: string) => void;
  onAddAnyway: () => void;
}

/**
 * Conditionally rendered when a semantic duplicate is detected. Animates in/out with
 * Reanimated layout transitions. Shows the matched title + similarity and two actions.
 */
export function DuplicateAlertBanner({ match, onViewExisting, onAddAnyway }: Props) {
  const { colors, radius } = useTheme();
  return (
    <Animated.View
      entering={FadeInUp.springify()}
      exiting={FadeOutUp}
      style={[styles.banner, { borderRadius: radius.md }]}
    >
      <View style={styles.row}>
        <Ionicons name="alert-circle" size={20} color={colors.danger} />
        <Text style={[styles.text, { color: colors.textPrimary }]}>
          Looks like <Text style={styles.bold}>“{match.title}”</Text> is already on your list
          {"  "}
          <Text style={[styles.sim, { color: colors.danger }]}>{Math.round(match.similarity * 100)}% match</Text>
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          style={[styles.btn, styles.ghost, { borderColor: colors.borderGlass }]}
          onPress={() => onViewExisting(match.id)}
        >
          <Text style={[styles.ghostText, { color: colors.textSecondary }]}>View existing</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.solid, { backgroundColor: colors.danger }]}
          onPress={onAddAnyway}
        >
          <Text style={styles.solidText}>Add anyway</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "rgba(248,113,113,0.12)",
    borderColor: "rgba(248,113,113,0.4)", borderWidth: 1,
    padding: 14, marginTop: 12, gap: 12,
  },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  text: { flex: 1, lineHeight: 20 },
  bold: { fontWeight: "700" },
  sim: { fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  ghost: { borderWidth: 1 },
  ghostText: { fontWeight: "600" },
  solid: {},
  solidText: { color: "#fff", fontWeight: "700" },
});
```

### 4. The Smart-Add overlay — `app/(protected)/modals/add-item.tsx`

```tsx
// app/(protected)/modals/add-item.tsx
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
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDebounce } from "@/hooks/useDebounce";
import { DuplicateAlertBanner } from "@/components/DuplicateAlertBanner";
import { precheckDuplicate, createItem, type DuplicateMatch } from "@/lib/api/items";
import { useItems } from "@/store/items"; // integration/001
import { useTheme } from "@/lib/useTheme";

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

  const debouncedTitle = useDebounce(title, 500); // 500ms quiet-period trigger

  // Stale-precheck guard. Each debounced value starts a new precheck "generation" and
  // aborts the previous in-flight request. We ignore any resolution whose generation is
  // no longer the latest, so an out-of-order/slow earlier response can never clobber the
  // UI with a stale duplicate result.
  const precheckGen = useRef(0);
  const precheckAbort = useRef<AbortController | null>(null);

  // Live duplicate pre-check on the debounced value.
  useEffect(() => {
    const q = debouncedTitle.trim();

    // A new generation supersedes any earlier request; abort the previous one.
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
        if (gen !== precheckGen.current) return; // a newer precheck superseded this one
        if (res.isDuplicate && res.match) {
          setMatch(res.match);
          setStatus("duplicate");
        } else {
          setMatch(null);
          setStatus("idle");
        }
      })
      .catch((err) => {
        // AbortError = we cancelled it on purpose; ignore. Anything else: precheck is
        // best-effort, so fail open to idle (only if still the latest generation).
        if (err instanceof Error && err.name === "AbortError") return;
        if (gen === precheckGen.current) setStatus("idle");
      });

    return () => controller.abort();
  }, [debouncedTitle]);

  const canSubmit = title.trim().length >= 3 && status !== "submitting";

  async function submit(force = false) {
    // Abort any in-flight precheck and invalidate its generation so a late precheck
    // result can't flip us back to "duplicate" mid-submit.
    precheckGen.current++;
    precheckAbort.current?.abort();
    setCreateError(null);
    setStatus("submitting");
    try {
      const result = await createItem(title.trim(), { force });
      if (result.ok) {
        addOptimistic(result.item); // optimistic insert into the dashboard store
        router.back();
        return; // closing the modal; leave status as-is
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
      {/* Tap-to-dismiss backdrop */}
      <Animated.View entering={FadeIn} style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss}>
          <BlurView tint="dark" intensity={Platform.OS === "ios" ? 40 : 0} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
        </Pressable>
      </Animated.View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.kav}>
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
            {status === "checking" ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            {hint ? <Text style={[styles.hint, type.label, { color: colors.textSecondary }]}>{hint}</Text> : null}
          </View>

          {status === "duplicate" && match ? (
            <DuplicateAlertBanner
              match={match}
              onViewExisting={(id) => { router.back(); router.push(`/(protected)/item/${id}`); }}
              onAddAnyway={() => submit(true)}
            />
          ) : null}

          {createError ? (
            <Text accessibilityRole="alert" style={[type.label, { color: colors.danger, marginTop: 10 }]}>
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
  drawer: {
    paddingHorizontal: 20, paddingTop: 12, borderTopWidth: 1,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 16 },
  heading: { fontSize: 20, fontWeight: "800", marginBottom: 14 },
  input: {
    fontSize: 18, minHeight: 56, lineHeight: 24,
    padding: 14, borderWidth: 1,
  },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, minHeight: 18 },
  hint: {},
  cta: { marginTop: 18, paddingVertical: 16, alignItems: "center" },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { fontSize: 16, fontWeight: "800" },
});
```

---

## 🚶 Step-by-Step Execution Guide

1. **Add the debounce hook** `hooks/useDebounce.ts` (§1). It clears the timer on every
   keystroke so the downstream effect fires once, 500ms after the user pauses.

2. **Add the items API client** excerpt `lib/api/items.ts` (§2): `precheckDuplicate`
   (dry-run, swallows errors), `createItem` (with `force`). These depend on the
   JWT-injecting `apiFetch` from integration/001 — stub it locally until then.

3. **Confirm the backend endpoints exist** — `GET /api/items/precheck` (embed +
   `findSemanticDuplicate`, no insert) and the `force` flag on `POST /api/items/create`
   that skips the de-dup gate are **already shipped in `backend/004`**, so no backend
   work is needed here; just point the §2 client at them.

4. **Build `DuplicateAlertBanner`** (§3) with Reanimated `FadeInUp`/`FadeOutUp`.

5. **Build the overlay** `app/(protected)/modals/add-item.tsx` (§4): backdrop blur + tap-to-dismiss,
   `SlideInDown` drawer, autofocused multiline `TextInput`, debounced pre-check effect,
   conditional banner, and the submit CTA (disabled while a duplicate is unresolved).

6. Confirm the route is registered as `transparentModal` in `app/_layout.tsx` (done in
   frontend/001) so the Dashboard shows through the dimmed backdrop.

---

## 🧪 Verification & Test Protocols

### A. Debounce timing (unit)

```ts
// _useDebounce.test.ts (jest + @testing-library/react-hooks or react-test-renderer)
import { renderHook, act } from "@testing-library/react-native";
import { useDebounce } from "@/hooks/useDebounce";

jest.useFakeTimers();
test("updates only after 500ms of quiet", () => {
  const { result, rerender } = renderHook(({ v }) => useDebounce(v, 500), {
    initialProps: { v: "a" },
  });
  rerender({ v: "ab" });
  rerender({ v: "abc" });
  expect(result.current).toBe("a"); // not yet
  act(() => jest.advanceTimersByTime(499));
  expect(result.current).toBe("a"); // still not
  act(() => jest.advanceTimersByTime(1));
  expect(result.current).toBe("abc"); // fired once, latest value
});
```

### B. Network call frequency (manual + network inspector)

Open the modal, type "Visit Machu Picchu" at normal speed while watching the network
log (or a `console.log` in `precheckDuplicate`). Confirm **one** `precheck` request
fires ~500ms after you stop typing — not one per keystroke.

### C. Duplicate banner appears on a known paraphrase

Precondition: you already have "See the Northern Lights". Type "Watch the Aurora
Borealis". After the debounce, the `DuplicateAlertBanner` slides in showing the matched
title and a ~90% match, and the "Add it" CTA is disabled.

### D. "View existing" and "Add anyway"

- Tap **View existing** → modal dismisses and routes to `/(protected)/item/<matchId>`.
- Type the paraphrase again, tap **Add anyway** → `createItem(force:true)` succeeds, the
  item is added optimistically, modal closes.

### D2. Stale precheck is aborted (no out-of-order clobber)

Type a duplicate paraphrase, then **immediately** edit it to a clearly non-duplicate
title before the first precheck resolves (or stub `precheckDuplicate` with staggered
delays). Confirm the banner reflects the **latest** title only — the earlier in-flight
precheck is aborted (network log shows it cancelled) and its late resolution is ignored
via the request-generation guard. It must never flash a stale "duplicate" for text the
user already changed.

### D3. Submit recovers after a failure (no stuck spinner)

Force `createItem` to reject (offline) or return a non-2xx (`{ ok: false, error: true }`).
Do a submit: the CTA shows the spinner, then on failure resets to **idle** (CTA usable
again) — the `try/catch` reset guarantees the button never stays stuck "submitting".
A `409` from the final create still routes to the duplicate banner, not the error reset.

### E. Optimistic insert + enrichment

After a successful add, the Dashboard immediately shows a shimmering
`pending_enrichment` card (optimistic). Seconds later it fills in with category + image
(via the Realtime push from integration/001/003).

### F. Dismissal

Tapping the dimmed backdrop closes the modal (slides down). The Dashboard remains
visible behind the blur throughout.

✅ **Phase complete when:** the debounce unit test passes, exactly one precheck fires
per typing pause, stale prechecks are aborted (no out-of-order clobber), only a `409` is
ever treated as a duplicate, submission recovers to idle after an exception/non-2xx (no
stuck spinner), the banner conditionally appears for paraphrases with working
View/Add-anyway actions, and successful adds insert optimistically then enrich.

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
