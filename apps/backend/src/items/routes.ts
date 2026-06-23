import { createHash } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { waitUntil } from "@vercel/functions";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db/client";
import { categories, itemAnalysisCache, items } from "../../db/schema";
import {
  ITEM_ANALYSIS_MODEL,
  ITEM_ANALYSIS_VERSION,
  type SemanticItem,
  SemanticItemSchema,
  analyzeItem,
  buildEmbeddingInput,
  buildSemanticKey,
} from "../ai/analyze-item";
import { findDuplicateCandidates, findSemanticKeyDuplicate } from "../ai/dedup";
import { verifyDuplicateCandidates } from "../ai/duplicate-verifier";
import { EMBEDDING_MODEL, embed } from "../ai/embed";
import { DuplicateItemError } from "../ai/errors";
import { rateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types";
import { deleteStoredImage, storedImageExists, toItemDto } from "./dto";
import { enrichItem } from "./enrich";

export const itemsRoutes = new Hono<AppEnv>();

// Rate limiter must be registered BEFORE the handlers it wraps.
itemsRoutes.use("/create", rateLimit({ max: 30, windowMs: 60_000 }));
itemsRoutes.use("/precheck", rateLimit({ max: 30, windowMs: 60_000 }));

const createSchema = z.object({
  title: z.string().trim().min(1).max(140),
  notes: z.string().trim().max(2000).optional(),
  force: z.boolean().optional().default(false),
});

const imageSchema = z.object({
  imagePath: z.string().trim().max(512),
});

interface PreparedItem {
  analysis: SemanticItem;
  semanticKey: string | null;
  embedding: number[];
}

async function prepareItem(userId: string, title: string): Promise<PreparedItem> {
  const titleHash = createHash("sha256")
    .update(title.trim().normalize("NFKC").replace(/\s+/g, " ").toLowerCase())
    .digest("hex");
  const cached = await db.query.itemAnalysisCache.findFirst({
    where: and(
      eq(itemAnalysisCache.userId, userId),
      eq(itemAnalysisCache.titleHash, titleHash),
      eq(itemAnalysisCache.analysisModel, ITEM_ANALYSIS_MODEL),
      eq(itemAnalysisCache.analysisVersion, ITEM_ANALYSIS_VERSION),
      eq(itemAnalysisCache.embeddingModel, EMBEDDING_MODEL),
      gt(itemAnalysisCache.expiresAt, new Date()),
    ),
  });
  if (cached) {
    const parsed = SemanticItemSchema.safeParse(cached.semanticData);
    if (parsed.success) {
      return {
        analysis: parsed.data,
        semanticKey: cached.semanticKey,
        embedding: cached.embedding,
      };
    }
  }

  const existingCategories = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.userId, userId));
  const analysis = await analyzeItem({ title, existingCategories });
  const semanticKey = buildSemanticKey(analysis);
  const embedding = await embed(buildEmbeddingInput(analysis));
  await db
    .insert(itemAnalysisCache)
    .values({
      userId,
      titleHash,
      semanticData: analysis,
      semanticKey,
      embedding,
      embeddingModel: EMBEDDING_MODEL,
      analysisModel: ITEM_ANALYSIS_MODEL,
      analysisVersion: ITEM_ANALYSIS_VERSION,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    })
    .onConflictDoUpdate({
      target: [itemAnalysisCache.userId, itemAnalysisCache.titleHash],
      set: {
        semanticData: analysis,
        semanticKey,
        embedding,
        embeddingModel: EMBEDDING_MODEL,
        analysisModel: ITEM_ANALYSIS_MODEL,
        analysisVersion: ITEM_ANALYSIS_VERSION,
        expiresAt: new Date(Date.now() + 15 * 60_000),
      },
    });
  return { analysis, semanticKey, embedding };
}

async function detectDuplicate(
  userId: string,
  prepared: PreparedItem,
): Promise<Awaited<ReturnType<typeof findSemanticKeyDuplicate>>> {
  const exact = await findSemanticKeyDuplicate(userId, prepared.semanticKey);
  if (exact) return exact;

  const candidates = await findDuplicateCandidates(userId, prepared.embedding);
  if (candidates.length === 0) return null;

  const decision = await verifyDuplicateCandidates(prepared.analysis, candidates);
  if (
    decision.relationship !== "same_goal" ||
    decision.confidence < 0.85 ||
    !decision.candidateId
  ) {
    return null;
  }

  const match = candidates.find((candidate) => candidate.id === decision.candidateId);
  if (!match) return null;
  return {
    id: match.id,
    title: match.title,
    distance: match.distance,
    similarity: Math.max(match.similarity, Number(decision.confidence.toFixed(4))),
  };
}

itemsRoutes.post("/create", zValidator("json", createSchema), async (c) => {
  const userId = c.get("userId");
  const { title, notes, force } = c.req.valid("json");

  const prepared = await prepareItem(userId, title);
  if (!force) {
    const duplicate = await detectDuplicate(userId, prepared);
    if (duplicate) throw new DuplicateItemError(duplicate);
  }

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

    if (!force) {
      const exact = await findSemanticKeyDuplicate(userId, prepared.semanticKey, tx);
      if (exact) throw new DuplicateItemError(exact);
    }

    const [row] = await tx
      .insert(items)
      .values({
        userId,
        title,
        notes: notes ?? null,
        canonicalTitle: prepared.analysis.canonicalTitle,
        semanticKey: force ? null : prepared.semanticKey,
        semanticData: prepared.analysis,
        semanticConfidence: prepared.analysis.entityConfidence,
        semanticVersion: ITEM_ANALYSIS_VERSION,
        normalizerModel: ITEM_ANALYSIS_MODEL,
        experienceSearchQuery: prepared.analysis.experienceSearchQuery,
        experienceLocation: prepared.analysis.experienceLocation,
        embedding: prepared.embedding,
        embeddingModel: EMBEDDING_MODEL,
        status: "pending_enrichment",
      })
      .returning();
    return row;
  });

  waitUntil(enrichItem(userId, created.id, prepared.analysis));

  return c.json({ item: await toItemDto(created, null) }, 201);
});

const precheckSchema = z.object({ title: z.string().trim().min(1).max(140) });

itemsRoutes.get("/precheck", zValidator("query", precheckSchema), async (c) => {
  const userId = c.get("userId");
  const { title } = c.req.valid("query");
  const prepared = await prepareItem(userId, title);
  const dup = await detectDuplicate(userId, prepared);
  if (dup) {
    return c.json(
      {
        error: "duplicate_item",
        match: { id: dup.id, title: dup.title, similarity: dup.similarity },
      },
      409,
    );
  }
  return c.json({ isDuplicate: false });
});

itemsRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const rows = await db.query.items.findMany({
    where: eq(items.userId, userId),
    with: { category: true },
    orderBy: desc(items.createdAt),
  });
  return c.json({ items: await Promise.all(rows.map((r) => toItemDto(r, r.category ?? null))) });
});

itemsRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const row = await db.query.items.findFirst({
    where: and(eq(items.id, id), eq(items.userId, userId)),
    with: { category: true },
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: await toItemDto(row, row.category ?? null) });
});

itemsRoutes.patch("/:id/complete", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  await db
    .update(items)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(items.id, id), eq(items.userId, userId)));
  const row = await db.query.items.findFirst({
    where: and(eq(items.id, id), eq(items.userId, userId)),
    with: { category: true },
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: await toItemDto(row, row.category ?? null) });
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_EXT = /\.(?:jpe?g|png|webp)$/i;

itemsRoutes.patch("/:id/image", zValidator("json", imageSchema), async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { imagePath } = c.req.valid("json");

  const expectedPrefix = `${userId}/${id}/`;
  const filename = imagePath.slice(expectedPrefix.length);
  const basename = filename.replace(ALLOWED_EXT, "");
  if (
    !imagePath.startsWith(expectedPrefix) ||
    !UUID_V4.test(basename) ||
    !ALLOWED_EXT.test(filename)
  ) {
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

  if (previousPath !== imagePath) await deleteStoredImage(previousPath);

  const row = await db.query.items.findFirst({
    where: and(eq(items.id, id), eq(items.userId, userId)),
    with: { category: true },
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: await toItemDto(row, row.category ?? null) });
});

itemsRoutes.patch("/:id/souvenir-image", zValidator("json", imageSchema), async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const { imagePath } = c.req.valid("json");

  const expectedPrefix = `${userId}/${id}/`;
  const filename = imagePath.slice(expectedPrefix.length);
  const basename = filename.replace(ALLOWED_EXT, "");
  if (
    !imagePath.startsWith(expectedPrefix) ||
    !UUID_V4.test(basename) ||
    !ALLOWED_EXT.test(filename)
  ) {
    return c.json({ error: "invalid_image_path" }, 400);
  }
  if (!(await storedImageExists(imagePath))) {
    return c.json({ error: "uploaded_image_not_found" }, 400);
  }

  const previousPath = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: items.status, souvenirImageUrl: items.souvenirImageUrl })
      .from(items)
      .where(and(eq(items.id, id), eq(items.userId, userId)))
      .for("update");
    if (!current) return undefined;
    if (current.status !== "completed") return "not_completed" as const;

    await tx
      .update(items)
      .set({
        souvenirImageUrl: imagePath,
        updatedAt: new Date(),
      })
      .where(and(eq(items.id, id), eq(items.userId, userId)));
    return current.souvenirImageUrl;
  });
  if (previousPath === undefined) return c.json({ error: "not_found" }, 404);
  if (previousPath === "not_completed") return c.json({ error: "item_not_completed" }, 409);

  if (previousPath !== imagePath) await deleteStoredImage(previousPath);

  const row = await db.query.items.findFirst({
    where: and(eq(items.id, id), eq(items.userId, userId)),
    with: { category: true },
  });
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json({ item: await toItemDto(row, row.category ?? null) });
});

itemsRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const previousPath = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ imageUrl: items.imageUrl, souvenirImageUrl: items.souvenirImageUrl })
      .from(items)
      .where(and(eq(items.id, id), eq(items.userId, userId)))
      .for("update");
    if (!current) return undefined;

    await tx.delete(items).where(and(eq(items.id, id), eq(items.userId, userId)));
    return [current.imageUrl, current.souvenirImageUrl] as const;
  });

  if (previousPath === undefined) return c.json({ error: "not_found" }, 404);
  await Promise.all(previousPath.map((path) => deleteStoredImage(path)));

  return c.body(null, 204);
});
