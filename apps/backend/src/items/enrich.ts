import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import { categories, items } from "../../db/schema";
import { classifyItem } from "../ai/classify";
import { generateGradient, slugify } from "../services/gradient";
import { broadcastItemEnriched } from "../services/realtime";
import { searchPortraitImage, triggerUnsplashDownload } from "../services/unsplash";
import { toItemDto } from "./dto";

async function resolveCategory(
  userId: string,
  title: string,
): Promise<{
  categoryId: string;
  keywords: string[];
  experienceSearchQuery: string | null;
  experienceLocation: string | null;
}> {
  const existing = await db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .where(eq(categories.userId, userId));

  const result = await classifyItem({
    title,
    existingCategories: existing.map((c) => ({ id: c.id, name: c.name })),
  });
  const metadata = {
    keywords: result.imageKeywords,
    experienceSearchQuery: result.experienceSearchQuery,
    experienceLocation: result.experienceLocation,
  };

  if (result.matchedCategoryId) {
    return { categoryId: result.matchedCategoryId, ...metadata };
  }

  const name = result.newCategoryName ?? "General";
  const slug = slugify(name) || "general";

  const dup = existing.find((c) => c.slug === slug);
  if (dup) return { categoryId: dup.id, ...metadata };

  const gradient = generateGradient(name);
  const [created] = await db
    .insert(categories)
    .values({ userId, name, slug, ...gradient })
    .onConflictDoUpdate({
      target: [categories.userId, categories.slug],
      set: { name },
    })
    .returning({ id: categories.id });

  return { categoryId: created.id, ...metadata };
}

export async function enrichItem(userId: string, itemId: string, title: string): Promise<void> {
  try {
    const { categoryId, keywords, experienceSearchQuery, experienceLocation } =
      await resolveCategory(userId, title);

    const pick = await searchPortraitImage(keywords);
    if (pick) await triggerUnsplashDownload(pick.downloadLocation);

    await db
      .update(items)
      .set({
        categoryId,
        experienceSearchQuery,
        experienceLocation,
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
