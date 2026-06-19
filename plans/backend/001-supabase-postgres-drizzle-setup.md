# Backend 001 — Supabase Postgres + Drizzle Setup

> Phase 1 of the Lifelist backend. Establishes the database foundation: a Supabase
> PostgreSQL instance with the `pgvector` extension enabled, the complete Drizzle
> schema (`users`, `categories`, `items`), the runtime connection client tuned for
> **Vercel Node serverless** (Supavisor transaction pooler), and the migration
> toolchain via `drizzle-kit`.

---

## 🎯 Objective

Stand up the persistence layer for Lifelist:

1. Enable the native `pgvector` extension inside Supabase so item titles can later be
   stored as `vector(1536)` embeddings for semantic de-duplication (see
   `backend/003`).
2. Define the canonical Drizzle schema for `users`, `categories`, and `items` with
   UUID primary keys, foreign-key relations, `CHECK` constraints, and the indexes the
   query patterns require.
3. Provide **two** connection strategies:
   - **Runtime** (`db/client.ts`): Supabase **Supavisor transaction pooler** on port
     `6543` with `prepare: false` — mandatory for Vercel Node serverless where TCP
     connections do not persist across invocations.
   - **Migrations** (`drizzle.config.ts`): the **direct connection** on port `5432`,
     which is required for DDL (`drizzle-kit` cannot run schema changes through the
     transaction pooler reliably).
4. Wire up `drizzle-kit generate` / `migrate` and document the Vercel environment
   variable matrix.

This phase produces no HTTP endpoints. It is the substrate every other backend phase
builds on.

---

## 💻 Code & Configuration Blueprints

### 1. Project layout (backend package)

```
backend/
├── drizzle/                     # generated SQL migrations (committed)
│   └── 0000_init.sql
├── db/
│   ├── schema.ts                # Drizzle schema — single source of truth
│   ├── client.ts                # runtime connection (pooler, prepare:false)
│   └── migrate.ts               # programmatic migrator (CI / one-off)
├── src/
│   ├── index.ts                 # minimal Hono app (export default app) — created HERE, EXTENDED in backend/002
│   └── server.ts                # local dev entrypoint (@hono/node-server)
├── api/
│   └── index.ts                 # Vercel serverless adapter (prod) — added in backend/002
├── drizzle.config.ts            # drizzle-kit config (direct 5432 connection)
├── package.json
├── tsconfig.json
└── .env.local                   # NEVER committed
```

> Two entrypoints, one app: `src/index.ts` exports the Hono `app`. This phase creates a
> **minimal** `src/index.ts` (a bare app with a `/health` route) so 001 is self-contained
> and compiles/serves on its own; **backend/002 EXTENDS the same file** with auth
> middleware, the `/api/*` group, and the `onError` handler. Locally, `src/server.ts`
> serves the app over a real Node HTTP listener (`@hono/node-server`); in production,
> `api/index.ts` wraps the same `app` with the Vercel adapter (backend/002).

### 2. `package.json`

```json
{
  "name": "backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx db/migrate.ts",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "drizzle-orm": "^0.36.0",
    "postgres": "^3.4.5"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0"
  }
}
```

### 2b. `src/server.ts` — local dev entrypoint that actually serves

`tsx watch src/index.ts` only evaluates the module — it does **not** open a socket, so
nothing listens and `curl localhost:3000` refuses the connection. For local dev we add a
tiny Node-server entrypoint. (Production still uses the Vercel adapter in
`api/index.ts`, added in backend/002 — Vercel never runs this file.)

```ts
// src/server.ts
import { serve } from "@hono/node-server";
import app from "./index";

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port });
console.log(`[dev] Lifelist backend listening on http://localhost:${port}`);
```

> `src/index.ts` (the `export default app` Hono app) is created in **this phase** as a
> minimal app (§2c) so 001 compiles and serves standalone; backend/002 EXTENDS it. The
> `dev` script points at `src/server.ts` from the start, so `pnpm dev` serves it
> immediately.
>
> **Prod-parity alternative:** `vercel dev` runs the actual serverless adapter
> (`api/index.ts`) locally, exercising the same code path as production. Use
> `@hono/node-server` for fast iteration and `vercel dev` when you need to verify the
> Vercel runtime/rewrites behave as deployed.

### 2c. `src/index.ts` — minimal Hono app (created here, extended in backend/002)

So this phase is self-contained and passes the gate on its own, create a **bare** Hono
app that exports `app` and exposes a public `/health` route. backend/002 imports nothing
new from this file — it **extends** it in place (adds `cors`/`logger`, the
`authMiddleware` on `/api/*`, the `/api/me` probe, and the `onError` handler).

```ts
// src/index.ts — minimal app for phase 001; backend/002 extends this same file.
import { Hono } from "hono";

const app = new Hono();

// Public health check (no auth). backend/002 layers auth + /api/* routes on top.
app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

export default app;
```

> `server.ts` (§2b) and `api/index.ts` (backend/002) both `import app from "./index"`
> — a default import of this `export default app`. The path is consistent across phases.

### 3. Enable `pgvector` (run once per project)

Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query). `pgvector`
ships pre-installed on Supabase; it only needs enabling. We place it in the dedicated
`extensions` schema, which is the Supabase-recommended location.

```sql
-- enable_pgvector.sql
-- Idempotent: safe to run multiple times.
create extension if not exists vector with schema extensions;

-- Sanity check: confirm the extension is registered and view its version.
select extname, extversion
from pg_extension
where extname = 'vector';
```

> The `vector(1536)` column itself is added in `backend/003`. We enable the extension
> here so the migration that introduces the column does not fail.

### 4. `db/schema.ts` — complete Drizzle schema

```ts
// db/schema.ts
import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";

/* ---------------------------------------------------------------------------
 * users
 *
 * Mirrors a row in Supabase's `auth.users`. We DO NOT manage auth here — Supabase
 * Auth owns identity. This table is our application-side profile/projection so we
 * can attach FKs and app metadata. `id` is set to the Supabase auth user id (a UUID)
 * on first login (see backend/002 — the JWT middleware upserts this row).
 *
 * NOTE: `email` is NULLABLE. Supabase supports phone-only (and anonymous) auth, so an
 * authenticated user may legitimately have no email. backend/002 provisions the row
 * keyed on `id` whether or not an email claim is present.
 * ------------------------------------------------------------------------ */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(), // == auth.users.id (NOT defaultRandom)
    email: text("email"), // NULLABLE — phone-auth/anonymous users have no email
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Partial unique index: emails are unique WHEN present, but many rows may carry a
    // NULL email (phone-auth users). Postgres treats NULLs as distinct, so this keeps
    // uniqueness for real emails without blocking multiple email-less users.
    emailUniqueIdx: uniqueIndex("users_email_unique_idx")
      .on(table.email)
      .where(sql`${table.email} is not null`),
  }),
);

/* ---------------------------------------------------------------------------
 * categories
 *
 * AI-generated buckets ("Travel", "Food & Drink", ...). Each belongs to exactly one
 * user (categories are per-user so the LLM can reuse a user's existing taxonomy —
 * see backend/004). gradientStart/gradientEnd are procedurally generated dark-purple
 * hex pairs used to theme the category's cards.
 * ------------------------------------------------------------------------ */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(), // lowercased, normalized form for reuse matching
    gradientStart: text("gradient_start").notNull(), // e.g. "#2A1A4A"
    gradientEnd: text("gradient_end").notNull(), // e.g. "#0B0F19"
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // A user cannot have two categories with the same normalized slug.
    userSlugUniqueIdx: uniqueIndex("categories_user_slug_unique_idx").on(
      table.userId,
      table.slug,
    ),
    userIdIdx: index("categories_user_id_idx").on(table.userId),
    // Composite UNIQUE on (id, user_id) so `items` can declare a composite FK
    // (category_id, user_id) -> categories(id, user_id). This is the integrity
    // guarantee that an item and its category ALWAYS belong to the same user — a plain
    // FK on category_id alone could not enforce that. id is already the PK (unique on
    // its own); this extra unique key exists solely as the FK target.
    idUserUniqueIdx: uniqueIndex("categories_id_user_unique_idx").on(
      table.id,
      table.userId,
    ),
    // gradient values must be 7-char hex strings (#RRGGBB).
    gradientStartHexCk: check(
      "categories_gradient_start_hex_ck",
      sql`${table.gradientStart} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
    gradientEndHexCk: check(
      "categories_gradient_end_hex_ck",
      sql`${table.gradientEnd} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
  }),
);

/* ---------------------------------------------------------------------------
 * items
 *
 * The core entity: a single bucket-list goal. Created optimistically with just a
 * title (status = 'pending_enrichment'), then asynchronously enriched with a
 * category, image, and embedding (see backend/004). The vector(1536) embedding
 * column is added by the migration in backend/003 — it is intentionally NOT declared
 * here so this phase compiles against a clean pgvector-free schema first.
 * ------------------------------------------------------------------------ */
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // No inline single-column FK here — category_id participates in the COMPOSITE FK
    // (category_id, user_id) -> categories(id, user_id) declared below, which guarantees
    // an item and its category belong to the SAME user. Nullable: items are created
    // before enrichment assigns a category, and the category may later be deleted.
    categoryId: uuid("category_id"),
    title: text("title").notNull(),
    notes: text("notes"),
    imageUrl: text("image_url"), // Unsplash URL OR private Storage object path
    imageAttribution: text("image_attribution"), // Unsplash photographer credit ("Photo by <name> on Unsplash")
    imageAttributionUrl: text("image_attribution_url"), // photographer profile link (+ UTM) per Unsplash ToS
    status: text("status", {
      enum: ["pending_enrichment", "active", "completed"],
    })
      .notNull()
      .default("pending_enrichment"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIdx: index("items_user_id_idx").on(table.userId),
    categoryIdIdx: index("items_category_id_idx").on(table.categoryId),
    // Common dashboard query: a user's items by status, newest first.
    userStatusCreatedIdx: index("items_user_status_created_idx").on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    // SAME-USER INTEGRITY: composite FK ensures the referenced category is owned by the
    // same user as the item. Targets the categories (id, user_id) unique key above, so a
    // category_id can only point at a category with a matching user_id — cross-user
    // category assignment is impossible at the DB level.
    //
    // onDelete:'set null' on a composite FK sets ALL referencing columns to NULL, but
    // user_id is NOT NULL — so a plain ON DELETE SET NULL would error. We scope the
    // null-out to category_id alone via Postgres's column-list form:
    // `ON DELETE SET NULL (category_id)`. drizzle-kit emits the action but not the column
    // list, so we hand-edit the generated migration to add `(category_id)` (see §4c).
    // Result: deleting a category nulls category_id on its items and leaves user_id intact.
    categoryUserFk: foreignKey({
      columns: [table.categoryId, table.userId],
      foreignColumns: [categories.id, categories.userId],
      name: "items_category_user_fk",
    }).onDelete("set null"),
    // A completed item must carry a completion timestamp, and vice versa (the completed
    // invariant). Combined with the column `enum`, status is constrained at the DB level,
    // not only in TypeScript — see the status CHECK appended in the migration (§4c).
    completedConsistencyCk: check(
      "items_completed_consistency_ck",
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`,
    ),
    // DB-level allow-list for status so an out-of-band write can't store a bogus value.
    statusValuesCk: check(
      "items_status_values_ck",
      sql`${table.status} in ('pending_enrichment', 'active', 'completed')`,
    ),
    titleNotEmptyCk: check(
      "items_title_not_empty_ck",
      sql`char_length(trim(${table.title})) > 0`,
    ),
  }),
);

/* ---------------------------------------------------------------------------
 * Relations (Drizzle relational query API)
 * ------------------------------------------------------------------------ */
export const usersRelations = relations(users, ({ many }) => ({
  categories: many(categories),
  items: many(items),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  user: one(users, {
    fields: [categories.userId],
    references: [users.id],
  }),
  items: many(items),
}));

export const itemsRelations = relations(items, ({ one }) => ({
  user: one(users, {
    fields: [items.userId],
    references: [users.id],
  }),
  category: one(categories, {
    fields: [items.categoryId],
    references: [categories.id],
  }),
}));

/* ---------------------------------------------------------------------------
 * Inferred types — import these everywhere instead of hand-writing row shapes.
 * ------------------------------------------------------------------------ */
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
```

> Inferred-type notes: with `email` nullable, `User["email"]` is `string | null`. `Item`
> includes `imageAttributionUrl: string | null` and `categoryId: string | null`. These
> map 1:1 to the canonical `ItemDto` in backend/004 — keep them in sync with
> `packages/shared`.

### 4b. Row-Level Security (RLS) — enabled from the start

RLS is the **security boundary for the client's DIRECT Supabase access** (auth, storage,
realtime, and any direct table reads). We turn it on **now**, with the tables, so no
window exists where the DB is reachable without policies. Run this in the Supabase SQL
Editor **after** `pnpm db:migrate` has created the tables (or append it to the first
migration — see the Execution Guide).

```sql
-- rls.sql — enable RLS + baseline owner SELECT-ONLY policies. Idempotent-ish:
-- DROP POLICY IF EXISTS first so re-running is safe.

-- 1. Enable RLS on every app table. Once enabled, a table denies ALL access unless a
--    policy explicitly allows it (deny-by-default).
alter table public.users      enable row level security;
alter table public.categories enable row level security;
alter table public.items      enable row level security;

-- WHY SELECT-ONLY (no owner FOR ALL): the client never writes to these tables directly.
-- ALL mutations go through Hono (secret key), which runs zod validation, semantic
-- de-dup, and rate-limiting before touching the DB. Granting the client direct
-- INSERT/UPDATE/DELETE would bypass every one of those guards, so we deliberately give
-- the owner SELECT only (its rows, for direct reads + RLS-scoped realtime). There is NO
-- cross-user / shared-read policy — items are strictly private.

-- 2. categories — owner may READ their own categories (direct reads only).
drop policy if exists categories_owner_all on public.categories;
drop policy if exists categories_owner_select on public.categories;
create policy categories_owner_select on public.categories
  for select to authenticated
  using (user_id = auth.uid());

-- 3. items — owner may READ their own items (direct reads + RLS-scoped realtime).
--    Writes happen only via Hono (secret key). No cross-user read policy exists.
drop policy if exists items_owner_all on public.items;
drop policy if exists items_owner_select on public.items;
create policy items_owner_select on public.items
  for select to authenticated
  using (user_id = auth.uid());

-- 4. users — owner may READ only their OWN profile row directly.
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users
  for select to authenticated
  using (id = auth.uid());
```

> **CRITICAL — how this interacts with the backend:** Hono connects with the
> **`SUPABASE_SECRET_KEY`** (or, equivalently, the Postgres superuser via the
> pooled `DATABASE_URL`), which **BYPASSES RLS entirely**. So every server-side write
> and read in backend/002–005 works regardless of these policies — RLS does **not**
> gate the Hono API. RLS exists solely to lock down the paths where the **client talks
> to Supabase directly** (Supabase Auth/Storage/Realtime and any direct PostgREST
> query). Concretely:
> - The owner policies are **SELECT-only by design**: the client may read its own rows
>   but cannot INSERT/UPDATE/DELETE directly — every mutation must pass through Hono so
>   validation, de-dup, and rate-limiting always run. An owner `FOR ALL` policy is
>   intentionally **absent**.
> - Private per-user enrichment sync uses a **broadcast** channel (`user:<userId>`,
>   event `item.enriched`, `private:true` + `setAuth`, gated by `realtime.messages`
>   RLS — see backend/004), NOT `postgres_changes`.

### 4c. Migration hand-edits (composite FK delete action)

`drizzle-kit generate` emits the composite FK and the CHECK constraints, but it cannot
express Postgres's **column-list** form of `ON DELETE SET NULL`. Because `user_id` is
`NOT NULL`, a bare `ON DELETE SET NULL` on the `(category_id, user_id)` FK would try to
null both columns and fail at delete time. Hand-edit the generated FK in
`drizzle/0000_init.sql` so the action scopes to `category_id` only:

```sql
-- In drizzle/0000_init.sql, the items composite FK should read:
ALTER TABLE "items"
  ADD CONSTRAINT "items_category_user_fk"
  FOREIGN KEY ("category_id", "user_id")
  REFERENCES "categories" ("id", "user_id")
  ON DELETE SET NULL ("category_id");   -- column-list form: null ONLY category_id
```

The `status` allow-list (`items_status_values_ck`) and the completed-invariant
(`items_completed_consistency_ck`) CHECKs are generated from the schema as written and
need no hand-edit — verify they appear in the migration.

### 5. `db/client.ts` — runtime connection (Supavisor transaction pooler)

```ts
// db/client.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Runtime DB client for Vercel Node serverless.
 *
 * WHY THESE SETTINGS:
 *  - We connect through Supabase's Supavisor *transaction* pooler (port 6543).
 *    Serverless functions are short-lived and may spin up many concurrent
 *    instances; the transaction pooler hands each a connection only for the life
 *    of a transaction, preventing Postgres from exhausting its connection slots.
 *  - `prepare: false` is REQUIRED. The transaction pooler does not guarantee the
 *    same backend connection across statements, so server-side prepared statements
 *    (postgres.js's default) break. Disabling them is mandatory, not optional.
 *  - `max: 1` keeps each serverless instance to a single connection. The pooler,
 *    not this client, does the real connection multiplexing.
 *  - `idle_timeout` / `max_lifetime` let idle sockets close so a frozen Lambda
 *    does not pin a pooler slot.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Expected the Supavisor transaction pooler URL (port 6543).",
  );
}

// Reuse the client across warm invocations to avoid reconnect churn.
const globalForDb = globalThis as unknown as {
  __lifelistSql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.__lifelistSql ??
  postgres(connectionString, {
    prepare: false, // MANDATORY for the transaction pooler
    max: 1,
    idle_timeout: 20, // seconds
    max_lifetime: 60 * 30, // 30 minutes
    connection: {
      application_name: "lifelist-backend",
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__lifelistSql = sql;
}

export const db = drizzle(sql, { schema, logger: process.env.NODE_ENV !== "production" });
export { schema };
```

### 6. `drizzle.config.ts` — migrations use the DIRECT connection (5432)

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit performs DDL (CREATE TABLE, ALTER, indexes). DDL must NOT go through
 * the transaction pooler — it needs a stable session on the direct connection
 * (port 5432). DIRECT_URL is the unpooled Supabase connection string.
 */
const directUrl = process.env.DIRECT_URL;

if (!directUrl) {
  throw new Error(
    "DIRECT_URL is not set. Expected the Supabase DIRECT connection URL (port 5432).",
  );
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: directUrl,
  },
  // Surface destructive operations explicitly during generate.
  strict: true,
  verbose: true,
});
```

### 7. `db/migrate.ts` — programmatic migrator (CI / one-off)

```ts
// db/migrate.ts
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies committed migrations from ./drizzle. Uses the DIRECT connection (5432)
 * because the migrator opens a session and runs DDL. `max: 1` because migrations
 * must run serially on one connection.
 */
async function main() {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error("DIRECT_URL is not set.");

  const migrationClient = postgres(directUrl, { max: 1 });
  try {
    const db = drizzle(migrationClient);
    console.log("[migrate] applying migrations from ./drizzle ...");
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[migrate] done.");
  } finally {
    await migrationClient.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
```

### 8. Environment variable matrix

`.env.local` (local dev — never committed):

```bash
# Runtime client — Supavisor TRANSACTION pooler (port 6543), prepare:false in db/client.ts.
# Host is the POOLER host; user is the tenant form `postgres.<PROJECT_REF>`.
DATABASE_URL="postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres"

# Migrations — TRUE DIRECT connection (port 5432). NOTE the DIFFERENT host:
# `db.<PROJECT_REF>.supabase.co`, and the plain `postgres` user (NOT the `postgres.<ref>`
# tenant form). This is the unpooled Postgres, which drizzle-kit needs for stable DDL.
# DO NOT use the pooler host on 5432 — that is Supavisor SESSION mode, not a direct
# connection, and drizzle-kit DDL can misbehave through it.
DIRECT_URL="postgresql://postgres:<DB_PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres"
```

> Get both strings from Supabase Dashboard → **Project Settings → Database →
> Connection string**. Use the **Transaction pooler** tab for `DATABASE_URL` (host
> `*.pooler.supabase.com`, port 6543) and the **Direct connection** tab for `DIRECT_URL`
> (host `db.<PROJECT_REF>.supabase.co`, port 5432). URL-encode any special characters in
> the password.
>
> **⚠️ IPv6 caveat:** the true direct connection (`db.<PROJECT_REF>.supabase.co`) is
> **IPv6-only** on most Supabase projects. If your dev network or CI runner lacks IPv6,
> either (a) enable Supabase's **IPv4 add-on** (gives the direct host an IPv4 address),
> or (b) fall back to the **session pooler** for migrations only —
> `postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres`
> (IPv4-reachable; session mode holds a stable connection, which DDL tolerates). The
> runtime `DATABASE_URL` (transaction pooler, 6543) is IPv4 and unaffected either way.

Vercel project settings (**Settings → Environment Variables**):

| Variable        | Value                                  | Environments               | Notes                              |
| --------------- | -------------------------------------- | -------------------------- | ---------------------------------- |
| `DATABASE_URL`  | Transaction pooler URL (6543)          | Production, Preview, Dev   | Used by `db/client.ts` at runtime  |
| `DIRECT_URL`    | Direct URL (5432)                      | Production, Preview, Dev   | Used by `drizzle-kit` & `db/migrate.ts` |
| `NODE_ENV`      | `production`                           | Production                 | Disables query logging & dev cache |

---

## 🚶 Step-by-Step Execution Guide

1. **Create the Supabase project.** In the Supabase dashboard create a new project,
   choosing a region close to your Vercel deployment region. Save the database
   password — you cannot retrieve it later, only reset it.

2. **Enable pgvector.** Open SQL Editor, paste `enable_pgvector.sql` from blueprint §3,
   run it, and confirm the `select extname...` query returns one row (e.g.
   `vector | 0.8.0`).

3. **Scaffold the backend package at its workspace path.**
   ```bash
   mkdir -p apps/backend && cd apps/backend
   pnpm init
   pnpm add hono drizzle-orm postgres
   pnpm add -D drizzle-kit tsx typescript @types/node
   ```
   Replace the generated `package.json` scripts block with blueprint §2, and set
   `"type": "module"`.

4. **Add a minimal `tsconfig.json`** targeting `ESNext`/`NodeNext` module resolution
   (so `.ts` ESM imports work with `tsx`).

5. **Create the schema files.** Add `db/schema.ts` (§4), `db/client.ts` (§5),
   `drizzle.config.ts` (§6), and `db/migrate.ts` (§7) exactly as written.

6. **Set up secrets.** Create `apps/backend/.env.local` from the matrix in §8. Add
   `.env.local` to `.gitignore`. Export the vars into your shell for CLI use:
   ```bash
   set -a && source .env.local && set +a
   ```

7. **Generate the first migration.**
   ```bash
   pnpm db:generate
   ```
   This writes `drizzle/0000_init.sql` plus a `drizzle/meta/` snapshot. Open the SQL
   and verify it creates `users`, `categories`, `items` with the expected indexes and
   `CHECK` constraints.

8. **Before applying it, append the RLS statements from §4b and hand-fix the composite
   FK action from §4c in `drizzle/0000_init.sql`.** The committed migration must be the
   complete source of truth; do not apply a partial migration and then mutate it.

9. **Apply the completed migration** to Supabase via the direct connection:
   ```bash
   pnpm db:migrate
   ```
   Watch for `[migrate] done.`

10. **Configure Vercel.** Add `DATABASE_URL` and `DIRECT_URL` to the Vercel project for
    all environments (§8). Migrations run from CI/locally — not at request time.

11. **Commit** `drizzle/` (migrations + meta, including RLS and the FK hand-edit), `db/`,
    `src/server.ts`, `drizzle.config.ts`, and `package.json`. Never commit `.env.local`.

---

## 🧪 Verification & Test Protocols

### A. Confirm pgvector is enabled

```sql
-- Run in Supabase SQL Editor. Expect exactly one row.
select extname, extversion from pg_extension where extname = 'vector';
```

### B. Confirm tables, constraints, and indexes exist

```sql
-- Tables
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('users', 'categories', 'items')
order by table_name;
-- Expect: categories, items, users

-- Indexes on items
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'items'
order by indexname;
-- Expect: items_category_id_idx, items_pkey, items_user_id_idx,
--         items_user_status_created_idx

-- Confirm item columns + nullability.
select column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'items'
  and column_name in ('image_attribution_url', 'category_id')
order by column_name;
-- Expect EXACTLY: category_id (YES, uuid), image_attribution_url (YES, text).

-- Confirm users.email is NULLABLE.
select is_nullable from information_schema.columns
where table_schema = 'public' and table_name = 'users' and column_name = 'email';
-- Expect: YES

-- CHECK constraints
select conname from pg_constraint
where conrelid = 'public.items'::regclass and contype = 'c';
-- Expect: items_completed_consistency_ck, items_status_values_ck, items_title_not_empty_ck

-- Same-user composite FK exists.
select conname from pg_constraint
where conrelid = 'public.items'::regclass and contype = 'f'
order by conname;
-- Expect: items_category_user_fk (the composite (category_id,user_id) FK) and the
--         items_user_id -> users FK.
```

### C. Constraint enforcement (negative tests)

Run these as one-off SQL statements; each must **fail**:

```sql
-- 1. Empty title must be rejected by items_title_not_empty_ck.
insert into items (user_id, title) values (gen_random_uuid(), '   ');
-- ERROR: new row violates check constraint "items_title_not_empty_ck"

-- 2. completed without completed_at must be rejected.
insert into items (user_id, title, status)
values (gen_random_uuid(), 'Skydive', 'completed');
-- ERROR: ... "items_completed_consistency_ck"

-- 3. Bad gradient hex must be rejected.
insert into categories (user_id, name, slug, gradient_start, gradient_end)
values (gen_random_uuid(), 'Travel', 'travel', 'purple', '#0B0F19');
-- ERROR: ... "categories_gradient_start_hex_ck"

-- 4. Bogus status must be rejected by items_status_values_ck.
insert into items (user_id, title, status)
values (gen_random_uuid(), 'Skydive', 'archived');
-- ERROR: ... "items_status_values_ck"

-- 5. Cross-user category assignment must be rejected by the composite FK. Create two
--    users + a category under user A, then try to attach it to an item owned by user B.
insert into users (id) values ('00000000-0000-0000-0000-00000000000a'),
                              ('00000000-0000-0000-0000-00000000000b');
insert into categories (id, user_id, name, slug, gradient_start, gradient_end)
values ('00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-00000000000a', 'Travel', 'travel',
        '#2A1A4A', '#0B0F19');
insert into items (user_id, title, category_id)
values ('00000000-0000-0000-0000-00000000000b', 'Go to Japan',
        '00000000-0000-0000-0000-0000000000c1');
-- ERROR: insert or update on table "items" violates foreign key constraint
--        "items_category_user_fk"  (category belongs to user A, item to user B)
```

> Note: tests 1–2 reference a non-existent `user_id` and would also fail the FK; run
> them only to confirm the CHECK fires, or insert a real `users` row first to isolate
> the CHECK behavior.

### D. Runtime connection smoke test (transaction pooler)

Create a throwaway `db/_smoke.ts`:

```ts
import { db } from "./client";
import { sql } from "drizzle-orm";

const [{ now }] = await db.execute<{ now: string }>(sql`select now() as now`);
console.log("pooler OK:", now);
process.exit(0);
```

Run with the **pooler** URL loaded (`DATABASE_URL`):

```bash
set -a && source .env.local && set +a
pnpm tsx db/_smoke.ts
# Expect: pooler OK: 2026-06-18T...
```

If you see `prepared statement "..." already exists` or `bind message` errors, your
`prepare: false` setting is missing — re-check `db/client.ts`. Delete `_smoke.ts`
after verifying.

### E. Migration idempotency

Re-run `pnpm db:migrate`. It should report nothing to apply (no errors), proving
the migration journal is intact.

### F. RLS is enabled with the expected policies

```sql
-- RLS must be ON for all three tables.
select relname, relrowsecurity
from pg_class
where relname in ('users', 'categories', 'items') and relnamespace = 'public'::regnamespace
order by relname;
-- Expect relrowsecurity = true for all three.

-- The baseline policies exist — all SELECT-only.
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
-- Expect: categories_owner_select (SELECT), items_owner_select (SELECT),
--         users_self_select (SELECT). NO *_owner_all policy may appear.
```

> Behavioral note: the **secret key** (what Hono uses) bypasses RLS, so the smoke
> tests in §D and every backend endpoint keep working. To prove RLS actually gates a
> direct client, query a table through the Supabase JS client with an `anon` key + a
> user JWT — you should see only your own rows, and a direct INSERT/UPDATE/DELETE must
> be **denied** (no owner write policy exists; all writes go through Hono).

✅ **Phase complete when:** pgvector is enabled, all three tables exist with the
documented indexes/constraints (including `items_status_values_ck`, the
`items_completed_consistency_ck` invariant, the composite same-user
`items_category_user_fk`, and `image_attribution_url`),
`users.email` is nullable, **RLS is ON with the three SELECT-only owner policies (no
`FOR ALL`)**, negative constraint tests (including cross-user category + bogus status)
fail as expected, and the pooler smoke test prints a timestamp without prepared-statement
errors.

---

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
