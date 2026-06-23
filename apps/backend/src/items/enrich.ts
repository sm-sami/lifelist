import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import { categories, items } from "../../db/schema";
import type { SemanticItem } from "../ai/analyze-item";
import { generateGradient, slugify } from "../services/gradient";
import { broadcastItemEnriched } from "../services/realtime";
import { searchPortraitImage, triggerUnsplashDownload } from "../services/unsplash";
import { toItemDto } from "./dto";

async function resolveCategory(userId: string, analysis: SemanticItem): Promise<string> {
  const existing = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(eq(categories.userId, userId));

  if (
    analysis.matchedCategoryId &&
    existing.some((category) => category.id === analysis.matchedCategoryId)
  ) {
    return analysis.matchedCategoryId;
  }

  const name = analysis.newCategoryName ?? "General";
  const slug = slugify(name) || "general";

  const dup = existing.find((c) => c.slug === slug);
  if (dup) return dup.id;

  const gradient = generateGradient(name);
  const [created] = await db
    .insert(categories)
    .values({ userId, name, slug, ...gradient })
    .onConflictDoUpdate({
      target: [categories.userId, categories.slug],
      set: { name },
    })
    .returning({ id: categories.id });

  return created.id;
}

export async function enrichItem(
  userId: string,
  itemId: string,
  analysis: SemanticItem,
): Promise<void> {
  try {
    const categoryId = await resolveCategory(userId, analysis);

    const pick = await searchPortraitImage(analysis.imageKeywords);
    if (pick) await triggerUnsplashDownload(pick.downloadLocation);

    await db
      .update(items)
      .set({
        categoryId,
        experienceSearchQuery: analysis.experienceSearchQuery,
        experienceLocation: analysis.experienceLocation,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(eq(items.id, itemId), eq(items.userId, userId), eq(items.status, "pending_enrichment")),
      );

    if (pick) {
      await db
        .update(items)
        .set({
          imageUrl: pick.imageUrl,
          imageAttribution: pick.attribution,
          imageAttributionUrl: pick.attributionUrl,
          updatedAt: new Date(),
        })
        .where(and(eq(items.id, itemId), eq(items.userId, userId), isNull(items.imageUrl)));
    }

    const updated = await db.query.items.findFirst({
      where: and(eq(items.id, itemId), eq(items.userId, userId)),
      with: { category: true },
    });
    if (!updated) throw new Error(`item ${itemId} vanished during enrichment`);

    await broadcastItemEnriched(userId, {
      item: await toItemDto(updated, updated.category ?? null),
    });
  } catch (err) {
    console.error(`[enrich] failed for item ${itemId}`, err);
    await db
      .update(items)
      .set({ status: "active", updatedAt: new Date() })
      .where(
        and(eq(items.id, itemId), eq(items.userId, userId), eq(items.status, "pending_enrichment")),
      );
    const fallback = await db.query.items.findFirst({
      where: and(eq(items.id, itemId), eq(items.userId, userId)),
      with: { category: true },
    });
    if (!fallback) return;
    await broadcastItemEnriched(userId, {
      item: await toItemDto(fallback, fallback.category ?? null),
      enrichmentError: true,
    });
  }
}
