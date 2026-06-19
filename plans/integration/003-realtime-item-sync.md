# Integration 003 — Realtime Item Sync

> Integration phase 3 (final). Keeps each user's OWN items synchronized in real time
> across their connected screens/devices: a Supabase Realtime wrapper subscribes to the
> user's PRIVATE enrichment broadcast (so an optimistic shimmer card swaps to its enriched
> form) and to Postgres Changes on the user's own `items` rows (so completions, check-offs,
> and edits propagate instantly). Includes the Realtime channel-authorization / RLS model
> that makes the direct-from-client subscription safe (Realtime bypasses Hono).

---

## 🎯 Objective

1. Build a Realtime wrapper that:
   - subscribes the client to its **private** channel `user:<userId>` for enrichment
     pushes (the `item.enriched` event from `backend/004`), and
   - subscribes to **Postgres Changes** on the user's OWN `items` rows so completion /
     check-off / edit updates sync live across that user's devices.
2. Define the **RLS + channel-auth** model that makes the direct-from-client Realtime
   subscription safe (Realtime bypasses Hono).
3. Make setup leak-safe (a channel created after unmount is torn down) and validate every
   inbound payload at runtime before it touches the store.

---

## 💻 Code & Configuration Blueprints

### 1. Realtime RLS + publication (Supabase SQL)

```sql
-- realtime_setup.sql  (idempotent / migration-safe — safe to re-run)
-- NOTE: `enable row level security` on items and the owner-only policies are defined in
-- db/schema.ts (backend/001) and applied by drizzle-kit — do NOT re-add them here (that
-- caused drift between the migration and this doc). This file ONLY adds the Realtime
-- wiring: the items publication entry + the realtime.messages broadcast policies.

-- 1. Realtime: publish items changes so Postgres Changes subscriptions fire.
--    Guard against re-adding if a prior migration already published the table.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'items'
  ) then
    alter publication supabase_realtime add table items;
  end if;
end $$;

-- 2. PRIVATE broadcast authorization on realtime.messages (see §3). Enrichment is
--    delivered on a PRIVATE channel `user:<uuid>`; without these policies the topic was
--    guessable/public and any client could subscribe to (or spoof) another user's
--    enrichment events. Authenticated users may read/write ONLY their own topic — the
--    topic's 2nd segment (`split_part(topic, ':', 2)`) must equal their own auth.uid().
alter table realtime.messages enable row level security;

drop policy if exists "users read own broadcast topic" on realtime.messages;
create policy "users read own broadcast topic"
  on realtime.messages for select to authenticated
  using (
    (select auth.uid())::text = split_part(realtime.topic(), ':', 2)
    and realtime.messages.extension = 'broadcast'
  );

drop policy if exists "users write own broadcast topic" on realtime.messages;
create policy "users write own broadcast topic"
  on realtime.messages for insert to authenticated
  with check (
    (select auth.uid())::text = split_part(realtime.topic(), ':', 2)
    and realtime.messages.extension = 'broadcast'
  );
```

> **Why RLS matters here (two distinct paths):**
> 1. **Postgres Changes on `items`:** the Expo client subscribes to Realtime **directly**
>    with its publishable key + JWT — Hono is not involved. Realtime enforces the item `select`
>    policies (owner-only, from backend/001) on change events, so a client only receives
>    changes for ITS OWN rows. Without RLS, every client would receive every user's changes.
> 2. **Private broadcast `user:<uuid>`:** broadcast channels are NOT scoped by table RLS;
>    they're authorized by policies on `realtime.messages`. A channel named after a user
>    UUID is guessable, so without the `realtime.messages` policies above, channel
>    privacy is illusory — any authenticated client could join `user:<someone-else>` and
>    read their enrichment payloads. The `split_part(topic, ':', 2) = auth.uid()` check is
>    what actually makes the channel private. The client must also opt in with
>    `{ config: { private: true } }` (§2).

### 2. Realtime sync wrapper — `lib/realtime/useItemsRealtime.ts`

```ts
// lib/realtime/useItemsRealtime.ts
import { useEffect } from "react";
import { z } from "zod";
import { ItemDtoSchema } from "@lifelist/shared";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useItemsStore } from "@/store/items";
const ItemIdSchema = z.string().uuid();

/**
 * Subscribes the signed-in user to two realtime sources and merges them into the store:
 *
 *  1. BROADCAST on `user:<userId>` — receives the `item.enriched` event the backend
 *     sends after async enrichment (backend/004). This is how an optimistic shimmer
 *     card swaps to its enriched form.
 *
 *  2. POSTGRES CHANGES on `items` (filtered to this user's own rows by RLS) — receives
 *     INSERT/UPDATE/DELETE so completions, check-offs, and edits made on ANY of the
 *     user's devices sync instantly.
 *
 * Mount once near the tabs root.
 *
 * CLEANUP-LEAK FIX: `setAuth` + `subscribe` are async, so the effect's cleanup can run
 * BEFORE the channels are created (fast unmount / token change). A `cancelled` flag plus
 * a `created` list ensure any channel created AFTER cleanup is removed immediately, and
 * the normal path removes both channels on unmount. Without this, an unmount that races
 * the async setup leaks a live subscription that keeps applying updates.
 */
export function useItemsRealtime() {
  const { session } = useAuth();
  const upsert = useItemsStore((s) => s.upsert);
  const remove = useItemsStore((s) => s.remove);
  const fetchItemById = useItemsStore((s) => s.fetchItemById);

  useEffect(() => {
    const userId = session?.user.id;
    const accessToken = session?.access_token;
    if (!userId || !accessToken) return;

    let cancelled = false;
    const created: ReturnType<typeof supabase.channel>[] = [];

    // Track a channel and, if cleanup already ran, immediately tear it down.
    const track = (ch: ReturnType<typeof supabase.channel>) => {
      if (cancelled) {
        void supabase.removeChannel(ch);
      } else {
        created.push(ch);
      }
      return ch;
    };

    (async () => {
      // PRIVATE channels are authorized by the realtime.messages RLS policies (§1).
      // setAuth() hands Realtime the user's JWT so those policies can read auth.uid();
      // without it a `private: true` join is rejected.
      await supabase.realtime.setAuth(accessToken);
      if (cancelled) return; // unmounted during setAuth — create nothing

      // 1. PRIVATE broadcast channel for enrichment pushes (`user:<uuid>`). The
      //    `private: true` flag makes Realtime enforce the realtime.messages policies,
      //    so only THIS user can subscribe to / receive their own enrichment events.
      const broadcast = track(
        supabase
          .channel(`user:${userId}`, {
            config: { private: true, broadcast: { self: false } },
          })
          .on("broadcast", { event: "item.enriched" }, ({ payload }) => {
            // RUNTIME-VALIDATE the broadcast payload before merging — never cast. The
            // payload carries the FULL ItemDto WITH expanded category.
            const parsed = ItemDtoSchema.safeParse((payload as { item?: unknown })?.item);
            if (
              parsed.success &&
              useItemsStore.getState().ownerUserId === userId
            ) {
              upsert(parsed.data);
            }
          }),
      );
      broadcast.subscribe((status, error) => {
        if (status === "CHANNEL_ERROR") console.error("[realtime] broadcast", error);
      });

      // 2. Postgres Changes on the user's own items (RLS scopes what we receive).
      const dbChanges = track(
        supabase
          .channel(`items-changes:${userId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "items", filter: `user_id=eq.${userId}` },
            (change) => {
              const changedRow = (change.eventType === "DELETE"
                ? change.old
                : change.new) as Record<string, unknown>;
              const id = ItemIdSchema.safeParse(changedRow.id);
              if (!id.success) return;
              if (change.eventType === "DELETE") {
                remove(id.data);
              } else {
                // DB rows contain raw private paths and no expanded category. Re-fetch
                // through Hono so the store receives a fully validated canonical ItemDto
                // with a fresh signed URL.
                void fetchItemById(id.data).then((result) => {
                  if (result.kind === "not_found") remove(id.data);
                  if (result.kind === "error") {
                    console.error("[realtime] item refresh failed", result.error);
                  }
                });
              }
            },
          ),
      );
      dbChanges.subscribe((status, error) => {
        if (status === "CHANNEL_ERROR") console.error("[realtime] postgres changes", error);
      });
    })().catch((error) => console.error("[realtime] setup failed", error));

    return () => {
      cancelled = true;
      for (const ch of created) void supabase.removeChannel(ch);
    };
  }, [session?.user.id, session?.access_token, upsert, remove, fetchItemById]);
}
```

### 3. Channel-auth + RLS model (why the direct subscription is safe)

The Expo client opens BOTH realtime channels itself, with its publishable key + the user's JWT —
Hono is not in the path. Two independent guards keep this safe:

- **Postgres Changes** ride the items table's owner-only `select` RLS (backend/001). The
  `filter: user_id=eq.<userId>` is a convenience; RLS is the actual boundary, so a client
  can never receive another user's row changes even by changing the filter.
- **Private broadcast** is gated by the `realtime.messages` policies in §1 plus the
  client opting in with `{ config: { private: true } }` and calling
  `supabase.realtime.setAuth(token)`. Together these make `user:<uuid>` joinable ONLY by
  the user whose uid is the topic's 2nd segment — a guessable UUID is not enough.

### 4. Mount the realtime + hydration hooks — `app/(protected)/(tabs)/_layout.tsx` (addition)

```tsx
// app/(protected)/(tabs)/_layout.tsx (within the component, before returning <Tabs>)
import { useHydrateItems } from "@/hooks/useHydrateItems";
import { useItemsRealtime } from "@/lib/realtime/useItemsRealtime";

export default function TabsLayout() {
  useHydrateItems();   // integration/001 — initial load
  useItemsRealtime();  // integration/003 — live sync + enrichment pushes
  // ... existing <Tabs> ...
}
```

---

## 🚶 Step-by-Step Execution Guide

1. **Run `realtime_setup.sql`** (§1): the items RLS + owner policies are ALREADY in
   `db/schema.ts` (backend/001) — do not re-add them. This script only adds: the
   `supabase_realtime` publication entry for items (guarded), and the `realtime.messages`
   RLS policies that make the private broadcast channel actually private. Without the
   publication, Postgres Changes never fire; without the `realtime.messages` policies, the
   `user:<uuid>` channel is not private. Policy creation is idempotent (`drop policy if
   exists`), so the script is safe to re-run.

2. **Build the realtime wrapper** `lib/realtime/useItemsRealtime.ts` (§2): call
   `supabase.realtime.setAuth(accessToken)`, open the PRIVATE broadcast channel
   (`{ config: { private: true } }`) for `item.enriched`, plus one Postgres Changes
   channel for live item sync. Broadcasts are validated and upserted directly; database
   changes validate only the id, then call `fetchItemById` so raw storage paths never
   enter the UI store. Use the
   `cancelled` flag + `created` list so a channel created after unmount is removed
   immediately (no leak). Log setup/subscription errors without crashing the app.

3. **Mount the hooks** in `app/(protected)/(tabs)/_layout.tsx` (§4) so hydration + realtime run for
   the whole authenticated session.

4. **Confirm the backend Realtime broadcaster** (`backend/004`) sends to the exact same
   PRIVATE channel `user:<userId>`, event `item.enriched`, payload `{ item: ItemDto }`
   (expanded category) that the client subscribes to.

> **Dependency installs** anywhere in this phase must be SCOPED to the mobile workspace
> (`pnpm --filter mobile add …`), never the repo root — the same rule applies to the media
> installs in integration/002.

---

## 🧪 Verification & Test Protocols

### A. RLS scoping on Postgres Changes (the security test)

Open two clients: user A and user B.
- Complete an item on **user A** device 1 → it flips to "DONE" on **user A** device 2
  within ~1s (Postgres Changes).
- Confirm **user B** does **not** receive A's item change — log received events on B. This
  proves RLS confines the Postgres Changes stream to each client's own rows (changing the
  client-side `filter` cannot widen it).

### B. Private broadcast is actually private

From user B's client, attempt to join `user:<userA-uuid>` with `{ config: { private:
true } }` (after `setAuth` with B's token). The subscribe should be REJECTED (no
`item.enriched` events for A ever reach B). This proves the `realtime.messages` policies
(§1) make the channel private — a guessable UUID topic is not enough to join.

### C. Enrichment broadcast path (private)

Create an item normally (integration/001) and watch the PRIVATE `user:<userId>` channel:
after `setAuth`, the `item.enriched` broadcast arrives and the shimmer card swaps to its
enriched form WITH the category gradient (the broadcast payload carries the full ItemDto
with expanded `category`, validated by `ItemDtoSchema` before merge). Proves the backend
broadcaster and client subscriber agree on the channel name + event, and that `private:
true` + `realtime.messages` policies let the owner receive their own events.

### D. Canonical DTO survives a Postgres-Changes update

After an item is enriched, complete it or replace its image from another device. Confirm
the receiving device re-fetches through Hono and keeps the expanded category while the
new private image arrives as a signed URL, never as a raw bucket path.

### E. Runtime validation rejects malformed payloads

Send a broadcast with a missing/garbled `item` (or simulate a malformed database-change
id). Confirm the store is NOT mutated — `ItemDtoSchema.safeParse` / `ItemIdSchema`
guard return without merging, so bad wire data never poisons the store (no cast).

### F. Channel teardown + no leak on fast unmount

Background then foreground the app, or sign out → confirm channels are removed
(`removeChannel` in cleanup) and no duplicate subscriptions accumulate (no double-applied
updates after several navigations). Specifically force a FAST unmount (mount then unmount
the tabs layout before `setAuth`/`subscribe` resolve): confirm the `cancelled` flag tears
down any channel created after cleanup, so no orphaned subscription survives.

✅ **Phase complete when:** RLS confines each client's Postgres Changes stream to its own
rows, the `user:<uuid>` broadcast is PRIVATE (B cannot join A's), enrichment pushes swap
shimmer cards live, completions sync across a user's devices in ~1s WITHOUT wiping the
category gradient, every inbound payload is runtime-validated before it enters the store,
and a fast unmount during async setup leaks no channel.

---

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
