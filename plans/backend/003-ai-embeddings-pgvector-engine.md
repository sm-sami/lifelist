# Backend 003 — AI Embeddings + pgvector Semantic De-dup Engine

> Phase 3 of the Lifelist backend. Turns a raw item title into a 1536-dimensional
> embedding (OpenAI `text-embedding-3-small`), stores it in a `vector(1536)` column on
> `items`, and intercepts **semantic** duplicates at creation time using Postgres
> native cosine-distance search — throwing a `409 Conflict` when an existing item is
> too similar.

---

## 🎯 Objective

1. Provide a robust `embed(text)` utility that calls OpenAI's embeddings API and
   returns a `number[1536]`.
2. Extend the Drizzle `items` schema with Drizzle's native `vector(1536)` column type
   and an accompanying migration.
3. Implement the **exact** Drizzle `sql` fragment that runs a **per-user** cosine
   distance query using pgvector's `<=>` operator and blocks creation when a near
   duplicate exists.
4. Get the distance/similarity math right: `<=>` returns **cosine distance**
   (`≈ 1 − cosine_similarity`). A "block above 0.85 similarity" rule is the predicate
   **`embedding <=> $query < 0.15`**. We surface the computed similarity in the 409
   body so the client can show the matched item.

> De-dup scope is **per-user**. A user's vector set is tiny (dozens of rows), so we do
> an exact sequential scan filtered by `user_id`. We deliberately do **not** build an
> HNSW/IVFFlat index — it would add maintenance cost and approximate recall for zero
> benefit at this scale.

---

## 💻 Code & Configuration Blueprints

### 1. Dependencies & env

```bash
pnpm add openai
```

| Variable               | Value                         | Notes                                    |
| ---------------------- | ----------------------------- | ---------------------------------------- |
| `OPENAI_API_KEY`       | `sk-...`                      | Server-side only. Never shipped to Expo. |
| `EMBEDDING_MODEL`      | `text-embedding-3-small`      | 1536-dim native output.                  |
| `DEDUP_DISTANCE_MAX`   | `0.15`                        | Cosine distance threshold (= 0.85 sim).  |

### 2. Drizzle native `vector` column

Drizzle 0.36 already provides pgvector column support. Use the native type rather than
maintaining a custom serializer.

### 3. Extend the `items` table — patch to `db/schema.ts`

Add the import and the column to the `items` definition from `backend/001`:

```ts
// db/schema.ts (additions)
import { check, text, vector } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const items = pgTable(
  "items",
  {
    // ... all existing columns from backend/001 ...

    /**
     * 1536-dim embedding of the (normalized) title, used for semantic de-dup.
     * Nullable: items are inserted optimistically before enrichment; the embedding
     * is written either synchronously during de-dup (we compute it once and reuse it)
     * or during async enrichment. See backend/004.
     */
    embedding: vector("embedding", { dimensions: 1536 }),

    /**
     * The model that produced `embedding`. Embeddings from DIFFERENT models live in
     * DIFFERENT, INCOMPARABLE vector spaces — a cosine distance between an
     * `text-embedding-3-small` vector and (say) a future `text-embedding-3-large`
     * vector is meaningless and would silently corrupt de-dup. Persisting the model id
     * alongside each vector lets us (a) restrict the de-dup scan to same-model rows and
     * (b) detect/rebuild stale vectors after a model change instead of trusting an
     * immutable env var. Nullable: NULL exactly when `embedding` is NULL (not yet
     * embedded). Written together with `embedding` on every insert/enrichment.
     */
    embeddingModel: text("embedding_model"),
  },
  (table) => ({
    // ... existing indexes/constraints ...
    embeddingModelPair: check(
      "items_embedding_model_pair",
      sql`(${table.embedding} is null) = (${table.embeddingModel} is null)`,
    ),
    // NOTE: intentionally NO vector index. Per-user exact scan is optimal at our scale.
  }),
);
```

### 4. Embedding utility — `src/ai/embed.ts`

```ts
// src/ai/embed.ts
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });

/**
 * The active embedding model. EXPORTED so callers can persist it into
 * `items.embedding_model` next to the vector — de-dup only ever compares vectors from
 * the SAME model (different models = incomparable spaces). Changing EMBEDDING_MODEL
 * therefore does not silently corrupt existing rows: new rows are tagged with the new
 * model and old-model rows are excluded from the scan (and can be rebuilt — see §5/§8).
 */
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const MODEL = EMBEDDING_MODEL;
const EXPECTED_DIMS = 1536;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

/**
 * Normalizes a title before embedding so trivial variations (case, whitespace,
 * trailing punctuation) collapse to the same vector neighborhood. We keep this light;
 * the embedding model handles real semantics.
 */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "").toLowerCase();
}

/**
 * Embeds a single piece of text into a 1536-dim vector. Throws on dimension mismatch
 * so a model misconfiguration fails loudly rather than corrupting the column.
 */
export async function embed(text: string): Promise<number[]> {
  const input = normalizeTitle(text);
  const res = await openai.embeddings.create({
    model: MODEL,
    input,
    dimensions: EXPECTED_DIMS, // text-embedding-3-* supports explicit dims
  });
  const vec = res.data[0]?.embedding;
  if (!vec || vec.length !== EXPECTED_DIMS) {
    throw new Error(
      `Embedding dim mismatch: expected ${EXPECTED_DIMS}, got ${vec?.length ?? 0}`,
    );
  }
  return vec;
}
```

### 5. The de-dup query — `src/ai/dedup.ts`

```ts
// src/ai/dedup.ts
import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { EMBEDDING_MODEL } from "./embed";

const DISTANCE_MAX = Number(process.env.DEDUP_DISTANCE_MAX ?? "0.15");
if (!Number.isFinite(DISTANCE_MAX) || DISTANCE_MAX <= 0 || DISTANCE_MAX >= 2) {
  throw new Error("DEDUP_DISTANCE_MAX must be a finite number greater than 0 and less than 2");
}

export interface DuplicateMatch {
  id: string;
  title: string;
  distance: number; // cosine distance (lower = more similar)
  similarity: number; // 1 - distance, for human-friendly display
}

/**
 * Minimal executor type shared by the top-level `db` and a transaction handle `tx`
 * (`Parameters<typeof db.transaction>[0]` extends this). Accepting it lets the de-dup
 * query run INSIDE the advisory-lock transaction below — critical so the read and the
 * subsequent insert see a consistent, serialized view per user.
 */
type Executor = Pick<typeof db, "execute">;

/**
 * Finds the nearest existing item to `queryEmbedding` WITHIN the given user's items,
 * but only returns it if it is closer than DISTANCE_MAX (i.e. similarity > 0.85).
 *
 * THE OPERATOR: pgvector `<=>` computes COSINE DISTANCE. For unit-normalized vectors
 * (OpenAI embeddings are normalized) cosine distance = 1 - cosine similarity.
 * Therefore "block when similarity > 0.85" === "block when distance < 0.15".
 *
 * We bind the query vector as the pgvector literal text form '[...]' and cast it to
 * `vector` so the operator resolves. We compute distance once in the SELECT list and
 * reuse it in ORDER BY for the exact-scan nearest neighbor.
 *
 * MODEL SCOPING: we compare ONLY against rows embedded with the SAME model
 * (`embedding_model = ${EMBEDDING_MODEL}`). Cosine distance across different models is
 * meaningless, so rows from an older model are skipped — they neither match nor block.
 * Rebuild old-model vectors (re-embed) if you want them to participate again.
 *
 * Pass the transaction handle as `exec` when calling from inside the advisory-lock
 * transaction (§7); it defaults to the pooled `db` for standalone use.
 */
export async function findSemanticDuplicate(
  userId: string,
  queryEmbedding: number[],
  exec: Executor = db,
): Promise<DuplicateMatch | null> {
  const literal = `[${queryEmbedding.join(",")}]`;

  const rows = await exec.execute<{
    id: string;
    title: string;
    distance: number;
  }>(sql`
    select
      i.id,
      i.title,
      (i.embedding <=> ${literal}::vector) as distance
    from items i
    where i.user_id = ${userId}
      and i.embedding is not null
      and i.embedding_model = ${EMBEDDING_MODEL}
    order by i.embedding <=> ${literal}::vector asc
    limit 1
  `);

  const top = rows[0];
  if (!top) return null;

  const distance = Number(top.distance);
  if (distance >= DISTANCE_MAX) return null; // not similar enough → not a duplicate

  return {
    id: top.id,
    title: top.title,
    distance,
    similarity: Number((1 - distance).toFixed(4)),
  };
}
```

### 6. Typed conflict error — `src/ai/errors.ts`

```ts
// src/ai/errors.ts
import { HTTPException } from "hono/http-exception";
import type { DuplicateMatch } from "./dedup";

/**
 * Thrown when an incoming title is a semantic duplicate of an existing item.
 * Renders as HTTP 409 with a structured body the client uses to populate the
 * DuplicateAlertBanner (see frontend/003).
 */
export class DuplicateItemError extends HTTPException {
  constructor(match: DuplicateMatch) {
    super(409, {
      res: new Response(
        JSON.stringify({
          error: "duplicate_item",
          message: `This looks like "${match.title}" which is already on your list.`,
          match: {
            id: match.id,
            title: match.title,
            similarity: match.similarity,
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    });
  }
}
```

### 7. How creation uses it — race-safe with a per-user advisory lock (preview; full endpoint in backend/004)

**THE RACE:** `embed → findSemanticDuplicate → insert` is read-then-write. Two rapid
creates of the same title (double-tap, retry, two devices) can BOTH pass the de-dup read
before EITHER inserts, so both rows land and the duplicate gate is defeated. There is no
unique constraint that would catch it (titles aren't unique; similarity isn't a column).

**THE FIX:** run the whole gate-plus-insert inside **one transaction** that first takes a
**per-user transaction-scoped advisory lock**. `pg_advisory_xact_lock` serializes
concurrent transactions that hash to the same key and auto-releases at COMMIT/ROLLBACK —
no manual unlock, no leaked lock if the request dies. We key it on `hashtext(userId)` so
the lock is **per-user**: it serializes only one user's concurrent creates, never blocks
different users.

```ts
// excerpt — the race-safe de-dup gate + insert inside POST /api/items/create.
// backend/004's create endpoint uses exactly this transaction shape.
import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { items } from "../../db/schema";
import { embed, EMBEDDING_MODEL } from "../ai/embed";
import { findSemanticDuplicate } from "../ai/dedup";
import { DuplicateItemError } from "../ai/errors";

async function createItemDeduped(
  userId: string,
  title: string,
  notes: string | null,
  force: boolean, // when true, skip the de-dup gate (see backend/004)
) {
  // Embed ONCE, outside the transaction (network call — keep the lock window short).
  // The same vector is reused on insert, so enrichment never re-embeds.
  const queryEmbedding = await embed(title);

  return db.transaction(async (tx) => {
    // Per-user, transaction-scoped advisory lock. Concurrent creates for the SAME user
    // now run one-at-a-time through this block; the lock releases automatically at
    // COMMIT/ROLLBACK. hashtext() maps the UUID string → the int4 key the lock wants.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    if (!force) {
      // Read INSIDE the lock so no concurrent same-user create can have inserted
      // between our check and our insert.
      const dup = await findSemanticDuplicate(userId, queryEmbedding, tx);
      if (dup) throw new DuplicateItemError(dup); // ROLLBACK → lock released
    }

    const [created] = await tx
      .insert(items)
      .values({
        userId,
        title,
        notes,
        embedding: queryEmbedding,
        // Tag the vector with the model that produced it so de-dup only ever compares
        // same-model vectors. Always written together with `embedding`.
        embeddingModel: EMBEDDING_MODEL,
        status: "pending_enrichment",
      })
      .returning();

    return created;
  });
}
```

> Scope note: the advisory lock serializes **only same-user** creates (it hashes the
> user id). Two different users creating at the same instant never contend, so
> throughput is unaffected at scale. `DuplicateItemError` thrown inside the callback
> rolls the transaction back (releasing the lock) and propagates as the 409 — Drizzle
> re-throws callback errors after rollback.

### 8. Migration for the vector column

```bash
pnpm db:generate   # creates drizzle/0001_add_item_embedding.sql
```

The generated SQL should be (verify it):

```sql
-- drizzle/0001_add_item_embedding.sql
ALTER TABLE "items" ADD COLUMN "embedding" vector(1536);
ALTER TABLE "items" ADD COLUMN "embedding_model" text;
ALTER TABLE "items" ADD CONSTRAINT "items_embedding_model_pair"
  CHECK (("embedding" IS NULL) = ("embedding_model" IS NULL));
```

> Append the pair-consistency check before applying the generated migration, then verify
> all three statements. Do not hand-maintain a custom vector type unless a pinned Drizzle
> regression makes the native type unusable.

### 8b. Wire the structured 409 into the global error handler

backend/002 shipped `src/index.ts` with a generic `onError` that renders
`{ error: err.message }` for every `HTTPException`. That would flatten
`DuplicateItemError` to just its message, dropping the `match` payload and 409 status.
Now that `src/ai/errors.ts` exists, ADD the import and the `DuplicateItemError` branch to
`onError` (this is the convergent shape backend/002 documents):

```ts
// src/index.ts — add the import (top of file)
import { DuplicateItemError } from "./ai/errors";

// src/index.ts — the DuplicateItemError branch must come BEFORE the generic
// HTTPException branch inside app.onError(...):
app.onError((err, c) => {
  if (err instanceof DuplicateItemError) {
    return err.getResponse(); // structured 409 body, verbatim
  }
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("[unhandled]", err);
  return c.json({ error: "Internal Server Error" }, 500);
});
```

---

## 🚶 Step-by-Step Execution Guide

1. **Install `openai`** and add `OPENAI_API_KEY`, `EMBEDDING_MODEL`,
   `DEDUP_DISTANCE_MAX` to `.env.local` and Vercel.

2. **Patch `db/schema.ts`** to import Drizzle's native `vector` and add the nullable `embedding` AND
   `embedding_model` columns to `items` (§3). Do not add a vector index.

3. **Generate & apply the migration** (§8):
   ```bash
   pnpm db:generate && pnpm db:migrate
   ```
   Before applying, append the `items_embedding_model_pair` check from §8. Confirm both
   columns and the constraint now exist.

4. **Add the embedding util** `src/ai/embed.ts` (§4), including `normalizeTitle` and
   the dimension assertion.

5. **Add the de-dup query** `src/ai/dedup.ts` (§5). Re-read the operator comment: the
   threshold is a **distance** of `0.15`, not a similarity of `0.85`.

6. **Add the typed error** `src/ai/errors.ts` (§6). It produces the exact JSON body the
   frontend's `DuplicateAlertBanner` expects. Then **wire it into `onError`** in
   `src/index.ts` (§8b): add the `import { DuplicateItemError }` and the
   `instanceof DuplicateItemError` branch BEFORE the generic `HTTPException` branch, so
   the structured 409 body survives instead of being flattened to `err.message`.

7. **Hold the race-safe `createItemDeduped` pattern** (§7) ready — `backend/004` wires
   it into `POST /api/items/create`. It embeds once (outside the txn), then runs the
   de-dup read + insert **inside one transaction guarded by a per-user
   `pg_advisory_xact_lock`**, so concurrent same-user creates serialize and the gate
   can't be raced. The `force` flag (backend/004) skips only the de-dup read, never the
   lock or the insert.

---

## 🧪 Verification & Test Protocols

### A. Embedding shape

```ts
// _embed_smoke.ts
import { embed } from "./src/ai/embed";
const v = await embed("Visit Machu Picchu at sunrise");
console.log("dims:", v.length, "first:", v[0]);
// Expect: dims: 1536  first: <float>
```

```bash
pnpm tsx _embed_smoke.ts
```

### B. The operator returns DISTANCE, not similarity (SQL proof)

```sql
-- Identical vectors → distance 0. Orthogonal → distance 1.
select '[1,0,0]'::vector <=> '[1,0,0]'::vector as same,      -- 0
       '[1,0,0]'::vector <=> '[0,1,0]'::vector as orthogonal; -- 1
```

This confirms `<=>` is distance: smaller = more similar. Our `< 0.15` predicate is
therefore correct for "block above 0.85 similarity."

### C. De-dup catches a paraphrase (end-to-end)

Seed one item with an embedding, then test a paraphrase:

```ts
// _dedup_smoke.ts
import { db } from "./db/client";
import { items, users } from "./db/schema";
import { embed, EMBEDDING_MODEL } from "./src/ai/embed";
import { findSemanticDuplicate } from "./src/ai/dedup";
import { sql } from "drizzle-orm";

const userId = "00000000-0000-0000-0000-000000000001";
await db.insert(users).values({ id: userId, email: "dedup@test.dev" })
  .onConflictDoNothing();

const e1 = await embed("See the Northern Lights");
await db.insert(items).values({
  userId, title: "See the Northern Lights", embedding: e1,
  embeddingModel: EMBEDDING_MODEL, // must be set or the model-scoped scan skips this row
  status: "active", completedAt: null,
});

// Paraphrase — should be a duplicate (similarity > 0.85).
const e2 = await embed("Watch the Aurora Borealis");
const dup = await findSemanticDuplicate(userId, e2);
console.log("paraphrase match:", dup); // { title:'See the Northern Lights', similarity: ~0.9 }

// Unrelated — should NOT be a duplicate.
const e3 = await embed("Learn to bake sourdough bread");
const none = await findSemanticDuplicate(userId, e3);
console.log("unrelated match:", none); // null

// cleanup
await db.execute(sql`delete from items where user_id = ${userId}`);
await db.execute(sql`delete from users where id = ${userId}`);
process.exit(0);
```

```bash
pnpm tsx _dedup_smoke.ts
# paraphrase match: { id:..., title:'See the Northern Lights', distance:~0.1, similarity:~0.9 }
# unrelated match: null
```

### D. Threshold boundary

Temporarily set `DEDUP_DISTANCE_MAX=0.01` and re-run test C — the paraphrase should now
return `null` (too strict), proving the env-driven threshold is honored. Reset to
`0.15`.

### D2. Advisory lock serializes concurrent same-user creates (race)

Fire two identical creates concurrently (after backend/004 is wired) and confirm exactly
one succeeds (201) and the other is rejected as a duplicate (409) — not two rows:

```bash
TOKEN="<valid supabase jwt>"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/items/create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"See the Northern Lights"}' &
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/items/create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"See the Northern Lights"}' &
wait
# Expect one 201 and one 409 — NEVER two 201s.
```

Then confirm only one row exists:

```sql
select count(*) from items
where user_id = '<uuid>' and lower(title) = 'see the northern lights';
-- Expect: 1
```

Without the `pg_advisory_xact_lock`, both requests can pass the de-dup read before either
inserts, yielding two rows. The lock makes the second transaction wait for the first to
COMMIT, so its de-dup read then sees the freshly-inserted row and 409s.

### E. 409 body shape (after backend/004 wiring)

```bash
TOKEN="<valid supabase jwt>"
# First create succeeds:
curl -s -X POST http://localhost:3000/api/items/create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"See the Northern Lights"}'
# Duplicate paraphrase returns 409:
curl -s -o /tmp/dup.json -w "%{http_code}\n" -X POST http://localhost:3000/api/items/create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Watch the Aurora Borealis"}'
# 409
cat /tmp/dup.json
# {"error":"duplicate_item","message":"This looks like ...","match":{...,"similarity":0.9...}}
```

### F. Model-scoped de-dup (embedding_model)

Insert a near-duplicate row tagged with a DIFFERENT model id and confirm it is NOT
matched (different vector spaces are incomparable):

```sql
-- After seeding the same-model "See the Northern Lights" row, add a paraphrase tagged
-- with a fake old model. The model-scoped scan must ignore it.
update items set embedding_model = 'text-embedding-ada-002'
where user_id = '00000000-0000-0000-0000-000000000001'
  and title = 'See the Northern Lights';
-- Re-running findSemanticDuplicate for a paraphrase now returns null: the only candidate
-- row is on a different model and is excluded by `embedding_model = $EMBEDDING_MODEL`.
```

Also confirm the column exists alongside the vector:

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'items'
  and column_name in ('embedding', 'embedding_model')
order by column_name;
-- Expect: embedding (USER-DEFINED / vector), embedding_model (text)
```

✅ **Phase complete when:** embeddings return 1536 dims, the `embedding_model` column
exists and is written next to every `embedding`, the SQL proof shows `<=>` is a
distance, paraphrases are caught as duplicates **only within the same model** while
unrelated (or different-model) titles pass, the env threshold is respected, creation
returns a structured `409` (rendered verbatim by the `onError` `DuplicateItemError`
branch from §8b), and **concurrent same-user creates serialize via the per-user advisory
lock (one 201, one 409 — never a double insert)**.

---

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
