# Addendum 001 — User Provisioning: Postgres Trigger

> **Type:** Architecture correction  
> **Affects:** `backend/001` (migration), `backend/002` (middleware)  
> **Why:** The middleware upsert pattern (backend/002 as shipped) hits the DB on every
> authenticated request — almost always a no-op after the first call. The canonical
> Supabase pattern is a Postgres trigger on `auth.users` that provisions the
> `public.users` projection exactly once, at sign-up, with zero per-request overhead.

---

## What changes

### 1. New migration — `drizzle/0002_user_provisioning_trigger.sql`

Two triggers on `auth.users` (managed by Supabase, in the `auth` schema):

**INSERT trigger** — fires on sign-up, creates the `public.users` projection row:

```sql
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      new.raw_user_meta_data->>'picture'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
```

**UPDATE trigger** — fires when email or profile metadata changes, syncs the projection.
`avatar_url` is intentionally NOT updated here — the user may have uploaded a custom
photo via the media pipeline (integration/002):

```sql
create or replace function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.users
  set
    email        = new.email,
    display_name = coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')
    ),
    updated_at   = now()
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user_updated();
```

Both functions use `security definer set search_path = public` — required to write to
`public.users` from a trigger on the `auth` schema without elevating the caller's role.

### 2. Simplified middleware — `src/auth/middleware.ts`

Remove the entire `db.insert(users)...onConflictDoUpdate(...)` block and its imports.
The middleware's only job now is verifying the token and setting context variables:

```ts
// src/auth/middleware.ts — after this addendum
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types";
import { verifySupabaseToken } from "./verify-token";

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = extractBearer(c.req.header("Authorization"));
  if (!token) throw new HTTPException(401, { message: "unauthorized_missing_token" });

  const result = await verifySupabaseToken(token);
  if (!result.ok) {
    throw new HTTPException(
      result.reason === "unavailable" ? 503 : 401,
      { message: result.reason === "unavailable" ? "auth_verifier_unavailable" : "token_invalid" },
    );
  }

  c.set("userId", result.payload.sub);
  c.set("userEmail", result.payload.email ?? "");
  await next();
});
```

Removed imports: `eq` (drizzle-orm), `db` (db/client), `users` (db/schema),
`resolveAvatarUrl`, `resolveDisplayName` (auth/avatar). The `avatar.ts` module is kept
— its logic is what was ported to SQL above; it now serves as documentation and may be
used by future profile endpoints.

---

## What's different from the original plan

| Concern | Before (middleware upsert) | After (trigger) |
|---|---|---|
| Extra DB hit per request | Yes, every `/api/*` call | None |
| Provisioning happens | On first request (race window) | At sign-up (atomic) |
| Email refresh on auth change | Yes (upsert updates it) | Yes (UPDATE trigger) |
| Avatar on first sign-in | DiceBear URL generated in TS | OAuth URL or NULL |
| Avatar preserved after user upload | No (overwritten on upsert) | Yes (trigger skips it) |

**DiceBear fallback:** the middleware previously generated a deterministic DiceBear URL
for email/phone users with no OAuth avatar. The trigger leaves `avatar_url` NULL in
those cases. The frontend (integration/001 or a profile screen) should handle this with
an initials/gradient fallback — no server round-trip needed.

---

## Verification

```sql
-- After applying the migration, confirm both triggers exist on auth.users:
select trigger_name, event_manipulation, action_timing
from information_schema.triggers
where event_object_schema = 'auth'
  and event_object_table  = 'users'
  and trigger_name in ('on_auth_user_created', 'on_auth_user_updated');
-- Expect: 2 rows (INSERT AFTER, UPDATE AFTER)
```

Manual sign-up smoke test:
1. Sign up a new user via Supabase Auth (email or OAuth).
2. Immediately call `GET /api/me` — it must return 200 with the correct `userId`.
3. Query `select * from public.users where id = '<user_id>'` — row must exist with no
   middleware round-trip required.
4. Update the user's display name in Supabase Auth dashboard → confirm `public.users`
   row updates (UPDATE trigger fires).

---

## Gate

```bash
pnpm gate      # tsc + biome
pnpm -r test   # migration.test.ts now asserts 3 migration files + trigger SQL
```
