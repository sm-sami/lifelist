# Integration 001 — Data Layer Plumbing

> Integration phase 1. Connects the Expo frontend to the Hono backend: a single
> `apiFetch` client that auto-injects the active Supabase JWT into every outbound call,
> plus the Zustand state stores that ingest Hono response payloads and feed the
> Dashboard and Smart-Add UI live.

---

## 🎯 Objective

1. Build a typed API client (`apiFetch`) with a request interceptor that fetches the
   current Supabase access token (always fresh) and attaches it as
   `Authorization: Bearer …`, plus base-URL resolution, JSON handling, a request
   timeout + cancellation (AbortSignal), a retry policy for idempotent GETs, and unified
   error mapping that distinguishes a genuine auth-invalid 401 (force re-auth) from a
   transient/ambiguous failure (preserve the session).
2. Build the Zustand `items` store: hydrate from `GET /api/items`, support optimistic
   inserts from Smart-Add, and merge Realtime enrichment pushes (`item.enriched`).
3. Provide the selector hooks (`useItems`, `useItem`) consumed by `frontend/002`,
   `frontend/003`, and `frontend/004`.

---

## 💻 Code & Configuration Blueprints

### 1. The API client — `lib/api/client.ts`

```ts
// lib/api/client.ts
import Constants from "expo-constants";
import { supabase } from "@/lib/supabase";

const configuredBase = (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)
  ?.apiBaseUrl;
if (!configuredBase) throw new Error("Missing Expo extra.apiBaseUrl");
const API_BASE = configuredBase.replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    /**
     * `authInvalid` is set ONLY when the backend gives a genuine auth-invalid signal
     * (see classifier below). It is the single source of truth callers/interceptors use
     * to decide whether to force sign-out. A transient/ambiguous 401 leaves it `false`.
     */
    public authInvalid = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Thrown for network/timeout failures (no HTTP status). Retryable for idempotent GETs. */
export class NetworkError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

/** Per-request timeout for backend calls. */
const DEFAULT_TIMEOUT_MS = 15_000;
/** Idempotent GETs are retried this many times on a network/timeout error (never POST/PATCH). */
const GET_RETRIES = 2;
const RETRY_BACKOFF_MS = 400;

export interface ApiFetchInit extends RequestInit {
  /** Override the default timeout (ms). */
  timeoutMs?: number;
  /**
   * Caller-supplied AbortSignal (e.g. a component unmount). It is composed with the
   * internal timeout signal — whichever aborts first cancels the request.
   */
  signal?: AbortSignal | null;
}

/**
 * Returns the freshest access token. supabase.auth.getSession() returns the cached
 * session and transparently refreshes it if near expiry (autoRefreshToken from
 * frontend/001), so we never ship a stale/expired bearer.
 */
async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Decides whether a 401 is a GENUINE auth-invalid signal (force sign-out) vs. an
 * ambiguous/transient failure (preserve the session, let the caller retry). Signing out
 * on EVERY 401 is wrong: a JWKS hiccup or a flaky edge can 401 a perfectly valid
 * session and would needlessly destroy local state. We force sign-out ONLY when the
 * backend explicitly says the token/identity is bad.
 */
function isAuthInvalid(status: number, body: unknown): boolean {
  if (status !== 401) return false;
  const code = (body as { error?: string; code?: string } | null)?.error
    ?? (body as { code?: string } | null)?.code;
  return code === "token_invalid" || code === "token_expired";
}

/** Composes the caller's signal (if any) with an internal timeout signal. */
function withTimeout(
  external: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort((external as AbortSignal)?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (external) external.removeEventListener("abort", onExternalAbort);
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The single fetch wrapper for ALL backend calls. Behaviors:
 *  - Resolves the path against API_BASE.
 *  - INTERCEPTOR: injects the current JWT into Authorization on every request.
 *  - Sets JSON content-type for bodies.
 *  - TIMEOUT + CANCELLATION: every request has a timeout, and a caller AbortSignal is
 *    honored (composed with the timeout). Aborts/timeouts surface as NetworkError.
 *  - RETRY: idempotent GETs are retried on a network/timeout error (never POST/PATCH/
 *    DELETE — those may not be safe to repeat).
 *  - 401: signs out locally only when the backend returns a definitive token-invalid
 *    code. A verifier outage is a 503 and preserves the session.
 *  - Returns the raw Response so callers can branch on status (e.g. 409 dedup) —
 *    use apiJson() below when you just want parsed JSON.
 */
export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD";
  const maxAttempts = isIdempotent ? GET_RETRIES + 1 : 1;
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await getAccessToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const { signal, cleanup } = withTimeout(init.signal, timeoutMs);
    try {
      const res = await fetch(`${API_BASE}${path}`, { ...init, headers, signal });

      if (res.status === 401) {
        const body = await res.clone().json().catch(() => null);
        const authInvalid = isAuthInvalid(res.status, body);
        if (authInvalid) await supabase.auth.signOut({ scope: "local" });
        throw new ApiError(
          401,
          (body as { error?: string } | null)?.error ?? "Unauthorized",
          body,
          authInvalid,
        );
      }
      return res;
    } catch (err) {
      cleanup();
      // ApiError (e.g. the 401 above) is not a network failure — never retry it.
      if (err instanceof ApiError) throw err;
      // The caller explicitly aborted (not our timeout) — surface immediately.
      if (init.signal?.aborted) throw new NetworkError("Request cancelled", err);
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await sleep(RETRY_BACKOFF_MS * (attempt + 1));
        continue;
      }
      throw new NetworkError(
        method === "GET" ? "Network request failed" : "Request failed",
        err,
      );
    } finally {
      cleanup();
    }
  }
  // Unreachable, but satisfies the type-checker.
  throw new NetworkError("Network request failed", lastErr);
}

/** Convenience: apiFetch + JSON parse + non-2xx → ApiError. */
export async function apiJson<T>(path: string, init?: ApiFetchInit): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body as { error?: string })?.error ?? res.statusText,
      body,
      isAuthInvalid(res.status, body),
    );
  }
  return body as T;
}
```

### 2. Client-side domain types — `store/types.ts` (re-export shared, do NOT redefine)

The DTO shapes live ONCE, in `@lifelist/shared` (`000-conventions §7`). The client just
aliases them so UI code can keep saying `Item`/`Category`. **Do not** hand-copy the
fields here — that's exactly the drift `packages/shared` exists to prevent.

```ts
// store/types.ts
import type { ItemDto, CategoryDto } from "@lifelist/shared";

// Client-facing aliases for the canonical shared DTOs. The API returns ItemDto with
// `category` EXPANDED (CategoryDto | null), so the UI can render the gradient directly.
// ItemDto is private/per-user: { id, title, notes, imageUrl, imageAttribution,
// imageAttributionUrl, status, categoryId, category, completedAt, createdAt }.
export type Item = ItemDto;
export type Category = CategoryDto;
```

### 3. The items store — `store/items.ts`

```ts
// store/items.ts
import { create } from "zustand";
import { z } from "zod";
import { ItemDtoSchema } from "@lifelist/shared";
import { apiJson, ApiError } from "@/lib/api/client";
import type { Item } from "./types";

const ItemsResponseSchema = z.object({ items: z.array(ItemDtoSchema) });
const ItemResponseSchema = z.object({ item: ItemDtoSchema });
export type FetchItemResult =
  | { kind: "ok"; item: Item }
  | { kind: "not_found" }
  | { kind: "error"; error: unknown };

interface ItemsState {
  items: Item[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  ownerUserId: string | null;
  requestGeneration: number;
  setUser: (userId: string | null) => void;
  hydrate: (userId: string) => Promise<void>;
  refetch: () => Promise<void>;
  fetchItemById: (id: string) => Promise<FetchItemResult>;
  addOptimistic: (item: Item) => void;
  upsert: (item: Item) => void;
  remove: (id: string) => void;
}

export const useItemsStore = create<ItemsState>((set, get) => ({
  items: [],
  status: "idle",
  error: null,
  ownerUserId: null,
  requestGeneration: 0,

  setUser: (userId) =>
    set((state) =>
      state.ownerUserId === userId
        ? state
        : {
            items: [],
            status: "idle",
            error: null,
            ownerUserId: userId,
            requestGeneration: state.requestGeneration + 1,
          },
    ),

  hydrate: async (userId) => {
    if (get().ownerUserId !== userId) get().setUser(userId);
    const generation = get().requestGeneration;
    set({ status: "loading", error: null });
    try {
      const raw = await apiJson<unknown>("/items");
      const { items } = ItemsResponseSchema.parse(raw);
      if (get().ownerUserId === userId && get().requestGeneration === generation) {
        set({ items, status: "ready" });
      }
    } catch {
      if (get().ownerUserId === userId && get().requestGeneration === generation) {
        set({ status: "error", error: "Could not load your items." });
      }
    }
  },

  refetch: async () => {
    const userId = get().ownerUserId;
    if (userId) await get().hydrate(userId);
  },

  fetchItemById: async (id) => {
    const ownerUserId = get().ownerUserId;
    const generation = get().requestGeneration;
    if (!ownerUserId) return { kind: "error", error: new Error("No active user") };
    try {
      const raw = await apiJson<unknown>(`/items/${id}`);
      const { item } = ItemResponseSchema.parse(raw);
      if (
        get().ownerUserId !== ownerUserId ||
        get().requestGeneration !== generation
      ) {
        return { kind: "error", error: new Error("Authenticated user changed") };
      }
      get().upsert(item);
      return { kind: "ok", item };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return { kind: "not_found" };
      return { kind: "error", error: e };
    }
  },

  addOptimistic: (item) =>
    set((state) => ({ items: [item, ...state.items.filter((i) => i.id !== item.id)] })),

  upsert: (item) =>
    set((state) => {
      const idx = state.items.findIndex((i) => i.id === item.id);
      if (idx === -1) return { items: [item, ...state.items] };
      const next = state.items.slice();
      next[idx] = item;
      return { items: next };
    }),

  remove: (id) => set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
}));

/* ---- selector hooks consumed by the UI ---- */
export const useItems = <T>(selector: (s: ItemsState) => T) => useItemsStore(selector);
export const useItem = (id: string) =>
  useItemsStore((s) => s.items.find((i) => i.id === id));
export type { Item } from "./types";
```

### 4. Hydration + account-switch reset — `hooks/useHydrateItems.ts`

```ts
// hooks/useHydrateItems.ts
import { useLayoutEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useItemsStore } from "@/store/items";

/**
 * Hydrates the items store once the user is authenticated, and CLEARS it whenever the
 * authenticated user changes or signs out. Mount this near the tabs root (e.g. in
 * app/(protected)/(tabs)/_layout.tsx) so the dashboard has data on first paint.
 *
 * ACCOUNT-SWITCH LEAK FIX (§7): the items store is a module-level singleton. Without an
 * identity reset, signing out of account A and into account B on the same device would
 * leave A's cached items in the store, and B would briefly (or permanently, until a
 * refresh) see A's private bucket list. We key off the auth user id: any change — login,
 * logout, or A→B switch — resets the store BEFORE the new user hydrates.
 */
export function useHydrateItems() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const setUser = useItemsStore((s) => s.setUser);
  const hydrate = useItemsStore((s) => s.hydrate);

  useLayoutEffect(() => {
    setUser(userId);
    if (userId) void hydrate(userId);
  }, [userId, setUser, hydrate]);
}
```

> The generation check is load-bearing: if account A's request resolves after switching
> to account B, its result is discarded. Clearing the array alone would not stop that
> older request from repopulating the store.

### 5. Wiring map — who consumes what

| Producer (backend)                 | Client ingestion                                  | UI consumer                          |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------ |
| `GET /api/items`                   | `useItemsStore.hydrate()`                         | Dashboard masonry (`frontend/002`)   |
| `GET /api/items/:id`               | `fetchItemById()`                                 | Detail deep-link cold start (`frontend/004`) |
| `POST /api/items/create` (201)     | `addOptimistic(fullItemDto)`                      | Dashboard shimmer card               |
| Realtime `item.enriched`           | `upsert()` (integration/003)                      | Card fills in (image + category)     |
| `GET /api/items/precheck` (409)    | `precheckDuplicate()` (`frontend/003`)            | `DuplicateAlertBanner`               |
| `PATCH /api/items/:id/complete`    | `upsert(returnedItemDto)`                         | Hold-to-stamp button (`frontend/005`)|
| `GET /api/experiences`             | `useExperiences()` (`frontend/004`)               | Bottom-sheet experience cards        |

### 6. Update the Smart-Add overlay to use the store

`frontend/003`'s `add-item.tsx` already calls `useItems((s) => s.addOptimistic)` and
`createItem`. With this store in place, a successful create immediately pushes a
`pending_enrichment` card to the Dashboard; the Realtime `upsert` (integration/003)
then swaps in the enriched version.

---

## 🚶 Step-by-Step Execution Guide

1. **Build `lib/api/client.ts`** (§1): `apiFetch` (interceptor injects the JWT, applies a
   timeout + AbortSignal cancellation, retries idempotent GETs on network error, and signs
   out locally only for the backend's explicit invalid/expired token codes) and
   `apiJson` (parse + error mapping). This is the only place tokens are attached — every
   feature client (`items`, `experiences`) goes through it.

2. **Re-export shared domain types** `store/types.ts` (§2) — alias `ItemDto`→`Item` and
   `CategoryDto`→`Category` from `@lifelist/shared`. Do NOT redefine the fields locally.

3. **Build the items store** `store/items.ts` (§3): `setUser`, generation-safe `hydrate`,
   `refetch`, discriminated `fetchItemById`, full-DTO `addOptimistic`/`upsert`, `remove`,
   plus `useItems`/`useItem` selectors. These are
   the exact hooks referenced by frontend/002–005 (and `fetchItemById` by 004's deep link).

4. **Add hydration + identity-reset hook** `hooks/useHydrateItems.ts` (§4) and call it from
   `app/(protected)/(tabs)/_layout.tsx` so the Dashboard loads on first authenticated paint and the
   cache is purged on sign-out / account switch.

5. **Verify the wiring map** (§5) — confirm each backend producer has a client
   ingestion path and a UI consumer. Anything unmapped is a gap.

6. **Confirm Smart-Add** (frontend/003) and the hold-to-stamp button (frontend/005) now
   resolve their store imports against this store.

---

## 🧪 Verification & Test Protocols

### A. JWT injection (network inspector)

With a signed-in session, trigger any `apiFetch` call (e.g. dashboard hydrate). In the
network inspector confirm the request carries `Authorization: Bearer eyJ…`. Sign out,
then trigger a call → no Authorization header (and the backend returns 401).

### B. 401 handling — invalid vs. transient (manual)

Two cases:
- **Genuine invalid token:** corrupt or expire the token so the backend returns a 401 with
  an auth-invalid code (e.g. `token_invalid`). `apiFetch` throws `ApiError(401,
  authInvalid: true)` after a local `signOut()`; the session listener updates auth state,
  the store clears for `userId=null`, and the gate (`app/index.tsx`) redirects to sign-in.
- **Verifier outage:** simulate a JWKS/network failure. The backend returns
  `503 auth_verifier_unavailable`; the session is PRESERVED and the call can be retried.

### B2. Timeout, cancellation & GET retry

- Point `API_BASE` at an unresponsive host (or add latency) → the call rejects with
  `NetworkError("…failed")` after `timeoutMs`, and an idempotent GET is retried
  `GET_RETRIES` times with backoff before failing; a POST/PATCH is NOT retried.
- Pass an `AbortSignal` and abort it mid-flight → the call rejects promptly with a
  `NetworkError("Request cancelled")` and no further retries.

### C. Store hydration

```ts
// _store.test.ts
import { useItemsStore } from "@/store/items";
// mock apiJson to return two valid ItemDto objects, call hydrate(), assert state.
test("hydrate populates items and becomes ready", async () => {
  // jest.mock("@/lib/api/client", () => ({ apiJson: async () => ({ items: [{ id:"1", title:"x", status:"active", ... }] }) }));
  useItemsStore.getState().setUser("user-a");
  await useItemsStore.getState().hydrate("user-a");
  const s = useItemsStore.getState();
  expect(s.status).toBe("ready");
  expect(s.items.length).toBe(1);
});
```

### D. Optimistic insert ordering

Call `addOptimistic(createdItemDto)` → the new item is **prepended** (top of dashboard)
with a shimmer state. Then call `upsert(enrichedItemDto)` → the SAME card updates in place
(no duplicate), now showing image + category. Verifies id-keyed merge.

### E. End-to-end: add → enrich (device)

Sign in, open Smart-Add, add "Visit Machu Picchu". The Dashboard immediately shows a
shimmer card (optimistic). Within a few seconds it fills with a portrait image +
category gradient (Realtime `upsert` from integration/003). No full refresh required.

### F. Selector reactivity

`useItem(id)` in the detail screen reflects store changes live — completing an item via
the hold-to-stamp button (`upsert` with the PATCH response) updates both the detail screen and the
dashboard card's "DONE" stamp without remount.

### G. Account-switch isolation (the leak test)

Sign in as user A, hydrate the dashboard (note A's items). Sign out, then sign in as
user B on the same device. **B must see ZERO of A's items** — the store should reset on
the user-id change before B hydrates. Inspect `useItemsStore.getState().items` right
after the switch: it should be `[]` until B's `hydrate()` resolves. Resolve A's old
request after B is active and confirm its generation is discarded. On sign-out, `items`
empties and status returns to `idle`.

### H. `fetchItemById` deep-link path

Cold-start the app via a deep link to an item not yet in the store (clear state first).
`fetchItemById(id)` should `GET /api/items/:id`, validate and upsert the returned
`ItemDto`, and return `{kind:"ok", item}`. A missing id returns `{kind:"not_found"}`;
transport or schema failures return `{kind:"error", error}` so the screen does not confuse
an outage with a missing item.

✅ **Phase complete when:** every backend call carries a fresh JWT, explicit invalid-token
401s force re-auth while verifier outages preserve the session, the store validates and
hydrates from `/api/items`, full DTO inserts merge cleanly with enrichment upserts by id,
`fetchItemById` distinguishes found/not-found/error, the cache resets on account switch
so no user sees another's items, and the Dashboard +
detail screens react live to store changes.

---

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
