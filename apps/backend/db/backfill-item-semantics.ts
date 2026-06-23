import { and, eq, isNull, lt, or } from "drizzle-orm";
import {
  ITEM_ANALYSIS_MODEL,
  ITEM_ANALYSIS_VERSION,
  analyzeItem,
  buildEmbeddingInput,
  buildSemanticKey,
} from "../src/ai/analyze-item";
import { EMBEDDING_MODEL, embed } from "../src/ai/embed";
import { db } from "./client";
import { categories, items } from "./schema";

const limit = Number(process.env.SEMANTIC_BACKFILL_LIMIT ?? "100");
if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
  throw new Error("SEMANTIC_BACKFILL_LIMIT must be an integer between 1 and 10000");
}

const pending = await db.query.items.findMany({
  where: or(
    isNull(items.semanticVersion),
    lt(items.semanticVersion, ITEM_ANALYSIS_VERSION),
    isNull(items.semanticData),
  ),
  limit,
});

let updated = 0;
let duplicateKeys = 0;
let failed = 0;

function postgresErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current !== "object" || current === null) return null;
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

for (const item of pending) {
  try {
    const existingCategories = await db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(eq(categories.userId, item.userId));
    const analysis = await analyzeItem({ title: item.title, existingCategories });
    const embedding = await embed(buildEmbeddingInput(analysis));
    const semanticKey = buildSemanticKey(analysis);

    const values = {
      canonicalTitle: analysis.canonicalTitle,
      semanticKey,
      semanticData: analysis,
      semanticConfidence: analysis.entityConfidence,
      semanticVersion: ITEM_ANALYSIS_VERSION,
      normalizerModel: ITEM_ANALYSIS_MODEL,
      experienceSearchQuery: analysis.experienceSearchQuery,
      experienceLocation: analysis.experienceLocation,
      embedding,
      embeddingModel: EMBEDDING_MODEL,
      updatedAt: new Date(),
    };

    try {
      await db
        .update(items)
        .set(values)
        .where(and(eq(items.id, item.id), eq(items.userId, item.userId)));
    } catch (error) {
      if (postgresErrorCode(error) !== "23505") throw error;

      duplicateKeys++;
      await db
        .update(items)
        .set({ ...values, semanticKey: null })
        .where(and(eq(items.id, item.id), eq(items.userId, item.userId)));
    }
    updated++;
    console.log(`[semantic-backfill] ${updated}/${pending.length} ${item.id}`);
  } catch (error) {
    failed++;
    console.error(`[semantic-backfill] failed ${item.id}`, error);
  }
}

console.log(
  `[semantic-backfill] done: updated=${updated}, failed=${failed}, duplicate_keys_left_nullable=${duplicateKeys}`,
);

if (failed > 0) process.exitCode = 1;
