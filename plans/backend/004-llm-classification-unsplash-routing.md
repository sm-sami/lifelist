# Backend 004 — LLM Classification, Gradient Service, Unsplash Routing & the Item Endpoints

> Phase 4 of the Lifelist backend. Ties together classification, theming, imagery, and
> the asynchronous enrichment pipeline behind the item API. `POST /api/items/create`
> inserts optimistically, runs the advisory-locked de-dup gate from `backend/003`,
> returns immediately as an `ItemDto`, and enriches the item in the background — pushing
> the finished card to the client over a **private** per-user Supabase Realtime broadcast.
> This phase also lands the rest of the canonical item surface
> (`GET /api/items`, `GET /api/items/:id`, `GET /api/items/precheck`,
> `PATCH …/complete|image`), all returning shapes from `packages/shared`.

---

## 🎯 Objective

1. **Classification:** an OpenAI structured-JSON prompt that maps an item title to one
   of the user's **existing** categories, or proposes a new one — with strong reuse
   bias to prevent category sprawl.
2. **Gradient service:** a deterministic procedural generator producing a pleasing,
   safe **dark-purple** `{ gradientStart, gradientEnd }` pair for newly created
   categories (no LLM, fully reproducible from a seed).
3. **Unsplash routing:** a typed fetch wrapper hitting the Unsplash Search API,
   filtered to **portrait** orientation, proxied through Hono so the access key never
   ships to the client. Honors Unsplash's download-trigger + attribution ToS, returning
   BOTH the credit string and the photographer's profile URL (with UTM params).
4. **The item endpoints:** the canonical `ItemDto`-returning surface —
   - `POST /api/items/create` ({ title, notes?, force? }):
     **optimistic insert → advisory-locked sync de-dup → immediate 201 → async enrich →
     private Realtime broadcast** (enrichment preserves any user-uploaded image).
   - `GET /api/items` and `GET /api/items/:id`: category EXPANDED, mapped to `ItemDto`.
   - `GET /api/items/precheck?title=`: embed + de-dup, no insert (200 / 409).
   - `PATCH /api/items/:id/complete` and `/image`.
5. **Hardening:** a lightweight per-user **rate-limit** middleware on the expensive
   write/AI routes, and an `ItemDto` mapper so every surface emits one shared shape.

---

## 💻 Code & Configuration Blueprints

### 1. Env additions

| Variable                    | Value                          | Notes                                            |
| --------------------------- | ------------------------------ | ------------------------------------------------ |
| `OPENAI_CLASSIFY_MODEL`     | `gpt-4o-mini`                  | Cheap, fast, supports JSON schema response.      |
| `UNSPLASH_ACCESS_KEY`       | (Unsplash app access key)      | Server-side only.                                |
| `SUPABASE_SECRET_KEY`       | (Dashboard → API Keys)         | Used by the backend to broadcast Realtime + write. |
| `SUPABASE_URL`              | already set in backend/002     | Reused for the Realtime broadcast client.        |

### 2. Classification — `src/ai/classify.ts`

```ts
// src/ai/classify.ts
import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const MODEL = process.env.OPENAI_CLASSIFY_MODEL ?? "gpt-4o-mini";

export interface ClassifyInput {
  title: string;
  existingCategories: { id: string; name: string }[];
}

export interface ClassifyResult {
  /** id of an existing category to reuse, or null if a new one is needed */
  matchedCategoryId: string | null;
  /** present only when matchedCategoryId is null */
  newCategoryName: string | null;
  /** 2–4 concise search keywords for Unsplash imagery */
  imageKeywords: string[];
}

const SYSTEM_PROMPT = `You are the categorization engine for "Lifelist", a bucket-list app.
Given a single bucket-list item title and the user's EXISTING categories, you must:

1. STRONGLY PREFER reusing an existing category. Only invent a new category if NONE of
   the existing ones is a reasonable fit. Reusing keeps the user's taxonomy clean.
2. If you reuse, return that category's exact id in "matchedCategoryId" and set
   "newCategoryName" to null.
3. If and ONLY IF nothing fits, set "matchedCategoryId" to null and return a SHORT,
   broad, title-cased "newCategoryName" (1-3 words, e.g. "Travel", "Food & Drink",
   "Outdoor Adventure"). Prefer broad buckets over narrow ones to avoid sprawl.
4. Always return "imageKeywords": 2-4 short, concrete, visually evocative search terms
   for a background photo (e.g. ["machu picchu","sunrise","peru"]). No abstract words.

Return ONLY JSON that conforms to the provided schema. No prose.`;

/**
 * OpenAI Structured Outputs schema. With strict:true the model is constrained AT
 * DECODE TIME to emit JSON matching this schema — so we are guaranteed valid,
 * parseable JSON with exactly these keys and types. What strict mode does NOT do:
 *  - JSON-Schema keyword support has EXPANDED over time — `minItems`/`maxItems` and
 *    some string constraints are now accepted by structured outputs in many cases.
 *    We deliberately do NOT rely on that: we keep the schema minimal and enforce the
 *    2–4 keyword count in code + zod (belt-and-suspenders), so behavior is unchanged
 *    regardless of which keywords the API currently honors.
 *  - It does NOT guarantee semantics (e.g. that matchedCategoryId actually exists).
 *  - The model may also return a top-level `refusal` instead of content.
 * => We still validate the parsed object with zod (defense-in-depth + semantics).
 */
const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "classification",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        matchedCategoryId: { type: ["string", "null"] },
        newCategoryName: { type: ["string", "null"] },
        // We omit minItems/maxItems and enforce the 2–4 count in code + zod instead —
        // not because the API can't express them (support has expanded), but so the
        // count rule lives in one place and behaves identically across API versions.
        imageKeywords: { type: "array", items: { type: "string" } },
      },
      required: ["matchedCategoryId", "newCategoryName", "imageKeywords"],
    },
  },
};

// Runtime validation owns semantic invariants that JSON Schema alone does not express.
const ClassifyValidator = z
  .object({
    matchedCategoryId: z.string().min(1).nullable(),
    newCategoryName: z.string().trim().min(1).nullable(),
    imageKeywords: z.array(z.string().trim().min(1)).min(2).max(4),
  })
  .superRefine((value, ctx) => {
    const reusesExisting = value.matchedCategoryId !== null;
    const inventsNew = value.newCategoryName !== null;
    if (reusesExisting === inventsNew) {
      ctx.addIssue({
        code: "custom",
        message: "Exactly one of matchedCategoryId or newCategoryName must be present",
      });
    }
  });

export async function classifyItem(input: ClassifyInput): Promise<ClassifyResult> {
  const userMsg = JSON.stringify({
    title: input.title,
    existingCategories: input.existingCategories,
  });

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: RESPONSE_FORMAT,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
  });

  const message = completion.choices[0]?.message;
  // Structured Outputs can return a refusal instead of content — handle it.
  if (message?.refusal) throw new Error(`Classification refused: ${message.refusal}`);
  const raw = message?.content;
  if (!raw) throw new Error("Classification returned empty content");

  // JSON.parse is safe (schema-constrained), but we still validate semantics + bounds.
  const parsed = ClassifyValidator.parse(JSON.parse(raw)) as ClassifyResult;

  // Defensive guard: the model must not "reuse" an id that isn't in the provided set.
  if (
    parsed.matchedCategoryId &&
    !input.existingCategories.some((c) => c.id === parsed.matchedCategoryId)
  ) {
    parsed.matchedCategoryId = null;
    if (!parsed.newCategoryName) parsed.newCategoryName = "General";
  }
  return parsed;
}
```

### 3. Gradient service — `src/services/gradient.ts`

```ts
// src/services/gradient.ts
/**
 * Deterministic dark-purple gradient generator. Given a seed (the category name),
 * it always returns the same { gradientStart, gradientEnd } pair — so a category's
 * theme is stable across re-creations and devices. No LLM, no randomness.
 *
 * Strategy: hash the seed → derive a hue within the purple band (255°–290°, aligned to
 * Headout's purps #8000ff), then build two HSL stops that are both DARK (low lightness)
 * and saturated enough to read against the #0C0A14 dark canvas. End stop is darker and
 * slightly hue-shifted for a subtle, premium gradient.
 */

function hashSeed(seed: string): number {
  // FNV-1a 32-bit — small, stable, dependency-free.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

export interface GradientPair {
  gradientStart: string; // #RRGGBB
  gradientEnd: string; // #RRGGBB
}

export function generateGradient(seed: string): GradientPair {
  const hash = hashSeed(seed.toLowerCase().trim());

  // Hue confined to the purple/violet band: 255°–290°.
  const baseHue = 255 + (hash % 36);
  // Saturation in a rich-but-not-neon range: 45%–65%.
  const saturation = 45 + ((hash >> 6) % 21);

  // Start: medium-dark. End: deeper + a few degrees cooler, for depth.
  const startL = 24 + ((hash >> 11) % 8); // 24%–31%
  const endHue = (baseHue + 8) % 360;
  const endL = 12 + ((hash >> 16) % 6); // 12%–17%

  return {
    gradientStart: hslToHex(baseHue, saturation, startL),
    gradientEnd: hslToHex(endHue, Math.max(saturation - 8, 35), endL),
  };
}

/** URL/DB-safe slug for category reuse matching. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

### 4. Unsplash wrapper — `src/services/unsplash.ts`

```ts
// src/services/unsplash.ts
const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY!;
const BASE = "https://api.unsplash.com";

export interface UnsplashPick {
  imageUrl: string; // regular-size portrait URL
  attribution: string; // "Photo by <name> on Unsplash"
  attributionUrl: string; // photographer profile link + UTM params (required by ToS)
  downloadLocation: string; // must be triggered per Unsplash ToS
}

interface UnsplashSearchResponse {
  results: Array<{
    urls: { regular: string; raw: string };
    // `links.html` is the photographer's PROFILE page on unsplash.com — the attribution
    // target the Unsplash API Guidelines require (with UTM params).
    user: { name: string; username: string; links: { html: string } };
    links: { download_location: string };
  }>;
}

// Unsplash API Guidelines: attribution links back to the photographer & to Unsplash must
// carry these UTM params. App name must match your registered Unsplash app.
const UTM = "utm_source=lifelist&utm_medium=referral";

/**
 * Searches Unsplash for a PORTRAIT image matching the keywords. Returns the first
 * result, or null if none. Uses the native fetch (Node 18+/Vercel). The access key
 * stays server-side — the client only ever sees the resulting imageUrl.
 */
export async function searchPortraitImage(
  keywords: string[],
): Promise<UnsplashPick | null> {
  const query = keywords.join(" ");
  const url = new URL(`${BASE}/search/photos`);
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait"); // STRICTLY portrait
  url.searchParams.set("per_page", "1");
  url.searchParams.set("content_filter", "high");

  const res = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${ACCESS_KEY}`,
      "Accept-Version": "v1",
    },
  });

  if (!res.ok) {
    // 403 here usually means the hourly rate limit (50/hr demo) was hit.
    console.warn(`[unsplash] search failed: ${res.status}`);
    return null;
  }

  const data = (await res.json()) as UnsplashSearchResponse;
  const first = data.results[0];
  if (!first) return null;

  // Photographer profile link with the required UTM params (Unsplash API Guidelines).
  const profile = first.user.links.html;
  const attributionUrl = `${profile}${profile.includes("?") ? "&" : "?"}${UTM}`;

  return {
    imageUrl: first.urls.regular,
    attribution: `Photo by ${first.user.name} on Unsplash`,
    attributionUrl,
    downloadLocation: first.links.download_location,
  };
}

/**
 * Unsplash ToS REQUIRES hitting the download_location endpoint when an image is
 * "used" (we treat assigning it to a card as use). Fire-and-forget; failure is
 * non-fatal but we log it.
 */
export async function triggerUnsplashDownload(downloadLocation: string): Promise<void> {
  try {
    await fetch(downloadLocation, {
      headers: { Authorization: `Client-ID ${ACCESS_KEY}`, "Accept-Version": "v1" },
    });
  } catch (err) {
    console.warn("[unsplash] download trigger failed", err);
  }
}
```

### 5. Realtime broadcast helper — `src/services/realtime.ts`

```ts
// src/services/realtime.ts
import { createClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client (secret key) used ONLY to broadcast enrichment
 * results back to the user's PRIVATE channel. The client subscribes to
 * `user:<userId>` (see integration/001 & integration/003).
 *
 * PRIVATE channel: `config.private: true` makes Supabase Realtime enforce RLS-style
 * authorization (the `realtime.messages` policy) on who may subscribe — so only the
 * owning user can read their own `user:<userId>` channel, not anyone who guesses the
 * name. The server sends with the secret key, which is authorized to broadcast to any
 * private channel; the CLIENT must present its JWT to subscribe (integration/001 wires
 * the matching `private: true` on the subscriber + the authorization policy).
 */
const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
);

/**
 * Broadcasts an `item.enriched` event carrying the EXPANDED ItemDto:
 *   payload = { item: ItemDto }  (category joined; or { item, enrichmentError } on failure)
 */
export async function broadcastItemEnriched(userId: string, payload: unknown) {
  const channel = admin.channel(`user:${userId}`, {
    config: { private: true, broadcast: { ack: true } },
  });
  await channel.send({
    type: "broadcast",
    event: "item.enriched",
    payload,
  });
  await admin.removeChannel(channel);
}
```

### 5b. DTO mapper — `src/items/dto.ts`

Every item-returning endpoint and the Realtime broadcast must emit the **canonical
`ItemDto`** from `packages/shared` so the frontend/integration phases compile against one
shape. The mapper converts a Drizzle row (+ its joined category) into that DTO: dates →
ISO strings, the category EXPANDED into a `CategoryDto | null`, and every contract field
present.

**Media is PRIVATE.** The media bucket is private, so user-uploaded images are stored as a
**bucket object path** (not a public URL) in `item.imageUrl`. The mapper mints a
**short-lived SIGNED URL** for those before returning. Unsplash images are external CDN
URLs (already absolute `https://…`) and are passed through untouched. Tradeoff: signed URLs
**expire** (here 1 hour) — a long-lived client may need to re-fetch the item (or the list)
to refresh the link; the frontend treats a 403 on an image as "stale, refetch".

```ts
// src/items/dto.ts
import type { ItemDto, CategoryDto } from "@lifelist/shared";
import type { Item, Category } from "../types";
import { createClient } from "@supabase/supabase-js";

const MEDIA_BUCKET = "item-images";
const SIGNED_URL_TTL = 3600; // seconds (1h)

// Service-role client: the media bucket is PRIVATE, so the backend mints signed URLs.
const storage = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { persistSession: false } },
).storage;

export function toCategoryDto(c: Category): CategoryDto {
  return {
    id: c.id,
    name: c.name,
    gradientStart: c.gradientStart,
    gradientEnd: c.gradientEnd,
  };
}

/**
 * Resolve the stored imageUrl to something the client can load.
 *  - null            → null
 *  - absolute http(s) (Unsplash CDN) → returned as-is
 *  - bucket path (user upload, private bucket) → short-lived SIGNED URL
 * On a signing failure we return null rather than a broken/forbidden link.
 */
async function resolveImageUrl(stored: string | null): Promise<string | null> {
  if (!stored) return null;
  if (/^https?:\/\//.test(stored)) return stored; // external (Unsplash) — public CDN
  const { data, error } = await storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(stored, SIGNED_URL_TTL);
  if (error || !data) return null;
  return data.signedUrl;
}

/** Best-effort cleanup for a replaced private object. External URLs are never deleted. */
export async function deleteStoredImage(stored: string | null): Promise<void> {
  if (!stored || /^https?:\/\//.test(stored)) return;
  const { error } = await storage.from(MEDIA_BUCKET).remove([stored]);
  if (error) console.error("[storage] failed to remove replaced image", { stored, error });
}

export async function storedImageExists(path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const directory = path.slice(0, slash);
  const filename = path.slice(slash + 1);
  const { data, error } = await storage
    .from(MEDIA_BUCKET)
    .list(directory, { search: filename, limit: 2 });
  if (error) throw error;
  return data.some((object) => object.name === filename);
}

/**
 * Row → canonical ItemDto. `category` is the joined row (or null). Pass it explicitly so
 * callers control whether the (potentially extra) join happened. Dates are serialized to
 * ISO strings; `embedding` and other internal columns are intentionally dropped. Async
 * because private-bucket images are minted into short-lived signed URLs.
 */
export async function toItemDto(item: Item, category: Category | null): Promise<ItemDto> {
  return {
    id: item.id,
    title: item.title,
    notes: item.notes,
    imageUrl: await resolveImageUrl(item.imageUrl),
    imageAttribution: item.imageAttribution,
    imageAttributionUrl: item.imageAttributionUrl,
    status: item.status,
    categoryId: item.categoryId,
    category: category ? toCategoryDto(category) : null,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
  };
}

/**
 * Convenience for the relational query API: the `with` clause to expand the category on
 * an item query, e.g. `db.query.items.findMany({ where, with: itemWithCategory, ... })`.
 */
export const itemWithCategory = { category: true } as const;
```

> `CategoryDto`/`ItemDto` are defined ONCE in `packages/shared`. This mapper is the only
> place the DB row → wire shape conversion lives; keep it the single source of truth so a
> contract change is a one-file edit.

### 6. Enrichment pipeline — `src/items/enrich.ts`

```ts
// src/items/enrich.ts
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import { categories, items } from "../../db/schema";
import { classifyItem } from "../ai/classify";
import { generateGradient, slugify } from "../services/gradient";
import { searchPortraitImage, triggerUnsplashDownload } from "../services/unsplash";
import { broadcastItemEnriched } from "../services/realtime";
import { toItemDto } from "./dto";

/**
 * Resolves a category for the item: reuse an existing one (by id from the LLM, or by
 * slug as a fallback), else create a new one with a procedural gradient. Returns the
 * category id.
 */
async function resolveCategory(
  userId: string,
  title: string,
): Promise<{ categoryId: string; keywords: string[] }> {
  const existing = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(eq(categories.userId, userId));

  const result = await classifyItem({
    title,
    existingCategories: existing.map((c) => ({ id: c.id, name: c.name })),
  });

  if (result.matchedCategoryId) {
    return { categoryId: result.matchedCategoryId, keywords: result.imageKeywords };
  }

  const name = result.newCategoryName ?? "General";
  const slug = slugify(name) || "general";

  // Race-safe: another concurrent create may have made the same category.
  const dup = existing.find((c) => c.slug === slug);
  if (dup) return { categoryId: dup.id, keywords: result.imageKeywords };

  const gradient = generateGradient(name);
  const [created] = await db
    .insert(categories)
    .values({ userId, name, slug, ...gradient })
    .onConflictDoUpdate({
      target: [categories.userId, categories.slug],
      set: { name },
    })
    .returning({ id: categories.id });

  return { categoryId: created.id, keywords: result.imageKeywords };
}

/**
 * Full async enrichment for one item. Runs AFTER the 201 response. On any failure it
 * leaves the item usable (status flips to 'active' even without an image) and never
 * throws to the caller — it logs and best-effort broadcasts what it has.
 *
 * Two data-integrity invariants drive the UPDATEs below:
 *  1. STATUS is flipped CONDITIONALLY — only `pending_enrichment` → `active`. If the user
 *     completed the item WHILE enrichment ran, the row is already `status='completed'`
 *     with `completedAt` set; blindly writing `status='active'` would leave an active row
 *     with a completedAt, violating the DB check. The `status='pending_enrichment'`
 *     predicate makes enrichment never touch a completed (or otherwise-advanced) row's
 *     status.
 *  2. IMAGE is written CONDITIONALLY in a SINGLE atomic UPDATE — only when `image_url IS
 *     NULL` at write time. A read-then-write would let a user upload landing during the
 *     Unsplash fetch get clobbered; the `image_url IS NULL` predicate closes that race.
 */
export async function enrichItem(userId: string, itemId: string, title: string) {
  try {
    const { categoryId, keywords } = await resolveCategory(userId, title);

    // We always fetch a candidate image; the WRITE decides (atomically) whether to keep
    // it. A user upload during this fetch wins because the image-write is guarded by
    // `image_url IS NULL` — so a clobber is impossible regardless of timing.
    const pick = await searchPortraitImage(keywords);
    if (pick) {
      // AWAIT the download trigger: we're inside enrichItem, which is tracked by
      // waitUntil, so awaiting keeps the serverless fn alive until Unsplash registers the
      // download (required by their ToS). Fire-and-forget would risk the fn freezing
      // before the request lands.
      await triggerUnsplashDownload(pick.downloadLocation);
    }

    // UPDATE #1 — category + status, CONDITIONAL on status. Never disturbs a completed
    // row: the `status='pending_enrichment'` predicate scopes the write. categoryId is
    // safe to set regardless, but we gate the whole write on the same predicate so a
    // completed row is left entirely untouched by enrichment.
    await db
      .update(items)
      .set({ categoryId, status: "active", updatedAt: new Date() })
      .where(
        and(
          eq(items.id, itemId),
          eq(items.userId, userId),
          eq(items.status, "pending_enrichment"),
        ),
      );

    // UPDATE #2 — image, CONDITIONAL on image_url IS NULL (single atomic UPDATE, no
    // read-then-write). Only runs when we actually found an image. If a user upload
    // already populated image_url, this matches zero rows and the upload is preserved.
    if (pick) {
      await db
        .update(items)
        .set({
          imageUrl: pick.imageUrl,
          imageAttribution: pick.attribution,
          imageAttributionUrl: pick.attributionUrl,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(items.id, itemId),
            eq(items.userId, userId),
            isNull(items.imageUrl),
          ),
        );
    }

    // Re-read the (possibly user-advanced) row + expanded category so the broadcast
    // reflects whatever actually persisted.
    const updated = await db.query.items.findFirst({
      where: and(eq(items.id, itemId), eq(items.userId, userId)),
      with: { category: true },
    });
    if (!updated) throw new Error(`item ${itemId} vanished during enrichment`);

    // Broadcast the EXPANDED ItemDto (category joined) so the client can render the final
    // card without an extra fetch.
    await broadcastItemEnriched(userId, {
      item: await toItemDto(updated, updated.category ?? null),
    });
  } catch (err) {
    console.error(`[enrich] failed for item ${itemId}`, err);
    // Best effort: flip to active so the user isn't stuck on a spinner forever — but ONLY
    // if still pending. Same invariant as the happy path: never touch a completed row.
    await db
      .update(items)
      .set({ status: "active", updatedAt: new Date() })
      .where(
        and(
          eq(items.id, itemId),
          eq(items.userId, userId),
          eq(items.status, "pending_enrichment"),
        ),
      );
    const fallback = await db.query.items.findFirst({
      where: and(eq(items.id, itemId), eq(items.userId, userId)),
      with: { category: true },
    });
    if (!fallback) return; // row genuinely gone — nothing to broadcast.
    await broadcastItemEnriched(userId, {
      item: await toItemDto(fallback, fallback.category ?? null),
      enrichmentError: true,
    });
  }
}
```

### 7. The endpoint — `src/items/routes.ts`

```ts
// src/items/routes.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { sql, eq, and, desc } from "drizzle-orm";
import { waitUntil } from "@vercel/functions";
import type { AppEnv } from "../types";
import { db } from "../../db/client";
import { items } from "../../db/schema";
import { embed, EMBEDDING_MODEL } from "../ai/embed";
import { findSemanticDuplicate } from "../ai/dedup";
import { DuplicateItemError } from "../ai/errors";
import { enrichItem } from "./enrich";
import { deleteStoredImage, storedImageExists, toItemDto, itemWithCategory } from "./dto";
import { rateLimit } from "../middleware/rate-limit";

export const itemsRoutes = new Hono<AppEnv>();

// Rate limiter registration order is LOAD-BEARING. In Hono, middleware only applies to
// routes registered AFTER the `app.use(...)` that adds it (or, for `app.use(path, mw)`,
// the path-scoped registration must come BEFORE the matching route). We therefore mount
// the limiter on the expensive write/AI sub-paths HERE, ahead of every handler below, so
// it actually wraps create + precheck. (Putting `.use()` after the routes would silently
// no-op for those routes.)
itemsRoutes.use("/create", rateLimit({ max: 30, windowMs: 60_000 }));
itemsRoutes.use("/precheck", rateLimit({ max: 30, windowMs: 60_000 }));

const createSchema = z.object({
  title: z.string().trim().min(1).max(140),
  notes: z.string().trim().max(2000).optional(),
  // When true, SKIP the de-dup gate (user explicitly confirmed "add anyway" after a
  // 409/precheck). The advisory lock + insert still run; only findSemanticDuplicate is
  // skipped. See backend/003 §7.
  force: z.boolean().optional().default(false),
});

const imageSchema = z.object({
  // Object PATH inside the PRIVATE media bucket (client uploads directly to Supabase
  // Storage via a signed upload, then PATCHes the path here). NOT a public URL — the DTO
  // mapper mints a short-lived signed URL on read.
  imagePath: z.string().trim().max(512),
});

/**
 * POST /api/items/create   { title, notes?, force? }
 *
 * Flow:
 *  1. Embed the title ONCE (outside the txn — it's a network call).
 *  2. In ONE transaction guarded by a per-user advisory lock (backend/003 §7):
 *     SYNC de-dup gate (throws 409 if a near-duplicate exists) UNLESS force===true,
 *     then optimistic insert with the embedding + status 'pending_enrichment'.
 *  3. Return 201 IMMEDIATELY with the bare item as an ItemDto (category null for now —
 *     the client shows a shimmering card).
 *  4. Kick off async enrichment (category + image) — pushed back over the private
 *     Realtime broadcast channel. We do NOT await it; `waitUntil` (from
 *     @vercel/functions) keeps the serverless fn alive until it finishes.
 */
itemsRoutes.post("/create", zValidator("json", createSchema), async (c) => {
  const userId = c.get("userId");
  const { title, notes, force } = c.req.valid("json");

  // 1: embed once, outside the lock window (reused on insert — enrichment never re-embeds).
  const queryEmbedding = await embed(title);

  // 2: race-safe gate + insert. Per-user pg_advisory_xact_lock serializes same-user
  // concurrent creates so the de-dup read can't be raced (backend/003 §7).
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    if (!force) {
      const dup = await findSemanticDuplicate(userId, queryEmbedding, tx);
      if (dup) throw new DuplicateItemError(dup); // ROLLBACK → 409
    }

    const [row] = await tx
      .insert(items)
      .values({
        userId,
        title,
        notes: notes ?? null,
        embedding: queryEmbedding,
        embeddingModel: EMBEDDING_MODEL,
        status: "pending_enrichment",
      })
      .returning();
    return row;
  });

  // 4: async enrichment. waitUntil prevents the serverless fn from freezing before the
  // background work + Realtime broadcast complete. On Vercel Node this is the supported
  // API (no executionCtx); it's a no-op-safe await elsewhere.
  waitUntil(enrichItem(userId, created.id, title));

  // 3: immediate response. No category yet → category:null in the DTO.
  return c.json({ item: await toItemDto(created, null) }, 201);
});

/**
 * GET /api/items/precheck?title=...   → 200 {isDuplicate:false} | 409 {error,match}
 *
 * Embeds + runs the de-dup query but DOES NOT insert. The client calls this before
 * showing the create sheet's confirm so it can warn "already on your list" without
 * committing. No advisory lock needed — this is a pure read.
 */
const precheckSchema = z.object({ title: z.string().trim().min(1).max(140) });
itemsRoutes.get("/precheck", zValidator("query", precheckSchema), async (c) => {
  const userId = c.get("userId");
  const { title } = c.req.valid("query");
  const queryEmbedding = await embed(title);
  const dup = await findSemanticDuplicate(userId, queryEmbedding);
  if (dup) {
    return c.json(
      { error: "duplicate_item", match: { id: dup.id, title: dup.title, similarity: dup.similarity } },
      409,
    );
  }
  return c.json({ isDuplicate: false });
});

/**
 * GET /api/items — dashboard hydration (newest first), category EXPANDED.
 * Uses the Drizzle relational query API so each row carries its joined category, then
 * maps to ItemDto (the canonical shape in packages/shared).
 */
itemsRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const rows = await db.query.items.findMany({
    where: eq(items.userId, userId),
    with: { category: true },
    orderBy: desc(items.createdAt),
  });
  return c.json({
    items: await Promise.all(rows.map((r) => toItemDto(r, r.category))),
  });
});

/**
 * GET /api/items/:id — single item, category EXPANDED, owner-scoped. 404 if not found
 * (or not owned). Needed for deep-linked detail screens (frontend/004).
 */
itemsRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const row = await db.query.items.findFirst({
    where: and(eq(items.id, id), eq(items.userId, userId)),
    with: { category: true },
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: await toItemDto(row, row.category) });
});

/** PATCH /api/items/:id/complete — used by the hold-to-stamp button (frontend/005). */
itemsRoutes.patch("/:id/complete", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  await db
    .update(items)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(items.id, id), eq(items.userId, userId)));
  // Re-read with the category expanded so the response is a full ItemDto.
  const row = await db.query.items.findFirst({
    where: and(eq(items.id, id), eq(items.userId, userId)),
    with: { category: true },
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: await toItemDto(row, row.category) });
});

/**
 * PATCH /api/items/:id/image   { imagePath }  — owner-scoped.
 * Sets the item's image to a user-uploaded object in the PRIVATE media bucket. We store
 * the bucket PATH (not a URL); the DTO mapper mints a short-lived signed URL on read.
 * This is the user-upload path the enrichment image-write deliberately yields to (it only
 * sets an Unsplash image when image_url IS NULL).
 */
itemsRoutes.patch("/:id/image", zValidator("json", imageSchema), async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { imagePath } = c.req.valid("json");
  const expectedPrefix = `${userId}/${id}/`;
  const versionedObject = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/i;
  const filename = imagePath.slice(expectedPrefix.length);
  if (!imagePath.startsWith(expectedPrefix) || !versionedObject.test(filename)) {
    return c.json({ error: "invalid_image_path" }, 400);
  }
  if (!(await storedImageExists(imagePath))) {
    return c.json({ error: "uploaded_image_not_found" }, 400);
  }

  const previousPath = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ imageUrl: items.imageUrl })
      .from(items)
      .where(and(eq(items.id, id), eq(items.userId, userId)))
      .for("update");
    if (!current) return undefined;

    await tx
      .update(items)
      .set({
        imageUrl: imagePath,
        imageAttribution: null,
        imageAttributionUrl: null,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, id), eq(items.userId, userId)));
    return current.imageUrl;
  });
  if (previousPath === undefined) return c.json({ error: "not_found" }, 404);

  // The DB is authoritative. Cleanup happens after commit and cannot roll the update back.
  // A cleanup failure is logged and can be swept later; it does not return a false failure
  // that would tempt the client to delete the newly-active object.
  if (previousPath !== imagePath) await deleteStoredImage(previousPath);

  const row = await db.query.items.findFirst({
    where: and(eq(items.id, id), eq(items.userId, userId)),
    with: { category: true },
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: await toItemDto(row, row.category) });
});
```

> Mounting note: `app.route("/api/items", itemsRoutes)` already sits behind the
> `/api/*` `authMiddleware` (backend/002), so `c.get("userId")` is always populated and
> the `:id` routes are owner-scoped via the `userId` filter. The rate limiter is mounted
> via `itemsRoutes.use("/create", …)` / `.use("/precheck", …)` at the TOP of the file,
> **before** the handlers — in Hono path-scoped middleware must be registered ahead of the
> route it should wrap, or it silently never runs for that route.

Mount it in `src/index.ts`:

```ts
import { itemsRoutes } from "./items/routes";
// after authMiddleware mount:
app.route("/api/items", itemsRoutes);
```

Install validators + the Vercel helpers:
`pnpm add @hono/zod-validator zod @supabase/supabase-js @vercel/functions`.

### 8. Rate-limit middleware — `src/middleware/rate-limit.ts`

The create/precheck routes each fan out to OpenAI (embeddings) and Unsplash. A
runaway client (retry storm, bug) could rack up cost fast. A lightweight per-user token
bucket caps the damage. This is an **in-memory** bucket — per warm serverless instance,
so it's best-effort, not a global guarantee. **In production, swap for Upstash Ratelimit**
(Redis-backed, shared across instances).

```ts
// src/middleware/rate-limit.ts
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types";

interface Bucket {
  tokens: number;
  resetAt: number;
}

// Per-instance store. NOTE: not shared across Vercel instances — best-effort only.
// PROD: replace this whole module with @upstash/ratelimit (Redis) for a global limit.
//
// BOUNDED: a long-lived warm instance would otherwise accumulate one bucket per distinct
// user forever. Buckets are self-expiring (each is dead once `now >= resetAt`), so we
// sweep expired ones and additionally enforce a hard cap (evict oldest) as a backstop —
// the map can't grow without bound.
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function sweepAndCap(now: number) {
  for (const [k, v] of buckets) {
    if (now >= v.resetAt) buckets.delete(k);
  }
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

export function rateLimit(opts: { max: number; windowMs: number }) {
  const { max, windowMs } = opts;
  return createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.get("userId"); // set by authMiddleware (backend/002)
    const now = Date.now();
    const key = `${userId}`;
    let b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      sweepAndCap(now); // reclaim expired/overflow buckets before inserting a fresh one
      b = { tokens: max, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    if (b.tokens <= 0) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      throw new HTTPException(429, { message: "rate_limited" });
    }
    b.tokens -= 1;
    await next();
  });
}
```

Applied in `src/items/routes.ts` (§7) to `/create` and `/precheck` at
**30 req/min per user**. Apply the same middleware to `/api/experiences` in backend/005.

## 🚶 Step-by-Step Execution Guide

1. **Add env vars** from §1 to `.env.local` and Vercel. The
   `SUPABASE_SECRET_KEY` is sensitive — server-only, never in the Expo bundle.

2. **Install deps:** `pnpm add openai @hono/zod-validator zod @supabase/supabase-js @vercel/functions`.
   Ensure `@lifelist/shared` is already a workspace dependency (conventions doc) — the
   DTO mapper imports `ItemDto`/`CategoryDto` from it.

3. **Classification** — add `src/ai/classify.ts` (§2). The `response_format` JSON schema
   with `strict: true` guarantees a parseable object; the post-parse guard rejects
   hallucinated category ids.

4. **Gradient + slug** — add `src/services/gradient.ts` (§3). Verify it's deterministic
   (same name → same hex pair) and produces dark, purple-band colors.

5. **Unsplash** — add `src/services/unsplash.ts` (§4). Note the `orientation=portrait`
   param, the mandatory `triggerUnsplashDownload`, and that the wrapper now returns
   `attributionUrl` (photographer profile + UTM) alongside the credit string.

6. **Realtime broadcaster** — add `src/services/realtime.ts` (§5). Channel name
   `user:<userId>` must match what the client subscribes to (integration/001); the
   channel is **`private: true`** and the payload is the EXPANDED `ItemDto`.

7. **DTO mapper** — add `src/items/dto.ts` (§5b). Every item-returning surface and the
   broadcast go through `toItemDto` (now **async** — it mints signed URLs for private-bucket
   images) so the wire shape matches `packages/shared`.

8. **Enrichment pipeline** — add `src/items/enrich.ts` (§6). Confirm the category race
   handling (`onConflictDoUpdate` on the `(userId, slug)` unique index from
   backend/001), that the **status flip is CONDITIONAL** (`status='pending_enrichment'`
   only — never disturbs a completed row), that the **image write is a single CONDITIONAL
   atomic UPDATE** (`image_url IS NULL` only — never clobbers a user upload), and that it
   **awaits** `triggerUnsplashDownload` inside the waitUntil-tracked work.

9. **Rate-limit middleware** — add `src/middleware/rate-limit.ts` (§8).

10. **Routes** — add `src/items/routes.ts` (§7); mount under `/api/items`. The create
    handler embeds once, runs the advisory-locked de-dup+insert transaction, kicks off
    enrichment via `waitUntil` (from `@vercel/functions` — NOT `c.executionCtx`), and the
    rate limiter is mounted at the TOP of the file (ahead of the handlers) on `/create`
    and `/precheck`.

11. **Run** `pnpm dev` and exercise the verification protocols.

---

## 🧪 Verification & Test Protocols

### A. Gradient determinism & range (unit)

```ts
// _gradient_smoke.ts
import { generateGradient } from "./src/services/gradient";
const a = generateGradient("Travel");
const b = generateGradient("Travel");
console.log(a, a.gradientStart === b.gradientStart && a.gradientEnd === b.gradientEnd);
// Same pair both times → true. Both should be dark purple hexes like #2E1C52 / #160C2E.
```

### B. Classification returns valid schema & reuses categories

```ts
// _classify_smoke.ts
import { classifyItem } from "./src/ai/classify";
const r1 = await classifyItem({ title: "Hike the Inca Trail", existingCategories: [] });
console.log(r1); // matchedCategoryId:null, newCategoryName:"Travel"|"Outdoor...", keywords:[...]

const r2 = await classifyItem({
  title: "Visit the Eiffel Tower",
  existingCategories: [{ id: "cat-travel", name: "Travel" }],
});
console.log(r2.matchedCategoryId); // "cat-travel" (reused, not a new category)
```

### C. Create endpoint — optimistic 201 (ItemDto) then Realtime enrichment

```bash
TOKEN="<valid supabase jwt>"
time curl -s -X POST http://localhost:3000/api/items/create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Visit Machu Picchu"}'
# Expect a FAST response (<1s typical) — a full ItemDto with category EXPANDED (null here):
# {"item":{"id":...,"title":"Visit Machu Picchu","status":"pending_enrichment",
#   "categoryId":null,"category":null,"imageUrl":null,"imageAttribution":null,
#   "imageAttributionUrl":null,"completedAt":null,"createdAt":"..."}}
```

Confirm the DTO has EXACTLY the contract keys (no `embedding` or DB internals):

```bash
curl -s -X POST http://localhost:3000/api/items/create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Learn to surf"}' | jq '.item | keys'
# ["category","categoryId","completedAt","createdAt","id","imageAttribution",
#  "imageAttributionUrl","imageUrl","notes","status","title"]
```

Then poll `GET /api/items` a few seconds later (or watch the Realtime channel in the
app) and confirm the same item now has `status:"active"`, a non-null **expanded**
`category` object, and an `imageUrl`:

```bash
curl -s http://localhost:3000/api/items -H "Authorization: Bearer $TOKEN" | jq '.items[0]'
# .category is the expanded {id,name,gradientStart,gradientEnd}, not just an id.
```

### D. Duplicate gate fires (depends on backend/003)

```bash
curl -s -o /tmp/r.json -w "%{http_code}\n" -X POST http://localhost:3000/api/items/create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Travel to Machu Picchu, Peru"}'
# 409 ; cat /tmp/r.json shows {"error":"duplicate_item", "match":{...}}
```

### E. Unsplash portrait constraint

Inspect an enriched item's `imageUrl` in the browser — the asset should be portrait
(taller than wide). In the Unsplash app dashboard, confirm the request count is
incrementing and that download triggers are registered (Unsplash → your app →
statistics).

### F. Category sprawl guard

Create three semantically-travel items ("See the pyramids", "Visit Tokyo", "Road trip
Iceland"). Verify in SQL that they share **one** "Travel"-ish category, not three:

```sql
select c.name, count(*) from items i
join categories c on c.id = i.category_id
where i.user_id = '<uuid>' group by c.name;
```

### G. precheck (no insert) + force (skip de-dup)

```bash
# precheck on an existing title → 409 with match, and creates NOTHING.
curl -s -o /tmp/p.json -w "%{http_code}\n" \
  "http://localhost:3000/api/items/precheck?title=Visit%20Machu%20Picchu" \
  -H "Authorization: Bearer $TOKEN"
# 409 ; cat /tmp/p.json → {"error":"duplicate_item","match":{"id":...,"title":...,"similarity":...}}

# precheck on a novel title → 200 {"isDuplicate":false}
curl -s "http://localhost:3000/api/items/precheck?title=Run%20a%20marathon%20in%20Tokyo" \
  -H "Authorization: Bearer $TOKEN"

# force:true creates even when a duplicate exists (de-dup gate skipped, 201).
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/items/create \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Travel to Machu Picchu","force":true}'
# 201
```

### H. GET /api/items/:id — expanded or 404

```bash
ID="<an existing item id>"
curl -s "http://localhost:3000/api/items/$ID" -H "Authorization: Bearer $TOKEN" | jq '.item.category'
# expanded category object (or null if not yet enriched)
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://localhost:3000/api/items/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN"
# 404
```

### I. Image preservation on enrichment (user upload wins the race)

Set an item's `image_url` (a user-upload path) manually BEFORE enrichment finishes, then
let enrichment run. The enrich image-write is a single atomic UPDATE gated on
`image_url IS NULL`, so the upload survives:

```sql
-- The image_url present before enrichment must survive (the image UPDATE is gated on
-- image_url IS NULL, so it matches zero rows and the user upload is preserved).
select id, image_url, status from items where id = '<itemId>';
```

### J. Complete-during-enrichment data integrity (CONDITIONAL status flip)

Complete an item WHILE its enrichment is still in flight (status `pending_enrichment`).
The enrich status UPDATE is gated on `status='pending_enrichment'`, so it must NOT revert
a completed row to `active` — confirm the row stays `completed` with `completedAt` set
(never `active` + `completedAt`, which the DB check forbids):

```sql
select id, status, completed_at from items where id = '<itemId>';
-- Expect status='completed' with a non-null completed_at — enrichment left it untouched.
```

### K. PATCH /api/items/:id/image (user upload to the private bucket)

```bash
# imagePath is an object path in the PRIVATE media bucket; the response imageUrl is a
# freshly-minted short-lived SIGNED URL (not the raw path, not a public URL).
curl -s -X PATCH "http://localhost:3000/api/items/$ID/image" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"imagePath":"<userId>/<itemId>/550e8400-e29b-41d4-a716-446655440000.jpg"}' \
  | jq '.item.imageUrl'
# "https://<project>.supabase.co/storage/v1/object/sign/media/...?token=..."  (signed, expires)
```

### L. Rate limit (429 after the bucket drains)

With a 30/min bucket, fire 31 rapid creates and confirm the 31st is rejected:

```bash
for i in $(seq 1 31); do
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/api/items/create \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"title\":\"rl-test-$i\",\"force\":true}"
done; echo
# The last code should be 429 (with a Retry-After header).
```

✅ **Phase complete when:** create returns a fast optimistic 201 **as an `ItemDto` with
category expanded**, the item enriches to `active` with a portrait image (credit + profile
URL) + reused/created category via a **CONDITIONAL status flip** (never disturbing a
completed row) and a **CONDITIONAL atomic image write** (never clobbering a user upload),
private-bucket images are returned as **short-lived signed URLs**, duplicates still 409
while `force:true` bypasses the gate, `precheck`/`:id`/`complete`/`image` behave per
contract, enrichment broadcasts the expanded DTO on the **private** `user:<id>` channel,
the rate limiter (mounted ahead of the handlers) returns 429 past the bucket, the gradient
is deterministic dark-purple, and category sprawl is contained.

---

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
