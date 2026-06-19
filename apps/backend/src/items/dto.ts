import type { CategoryDto, ItemDto } from "@lifelist/shared";
import { makeAdminClient } from "../lib/supabase-admin";
import type { Category, Item } from "../types";

const MEDIA_BUCKET = "item-images";
const SIGNED_URL_TTL = 3600;

const storage = makeAdminClient().storage;

export function toCategoryDto(c: Category): CategoryDto {
  return { id: c.id, name: c.name, gradientStart: c.gradientStart, gradientEnd: c.gradientEnd };
}

async function resolveImageUrl(stored: string | null): Promise<string | null> {
  if (!stored) return null;
  if (/^https?:\/\//.test(stored)) return stored;
  const { data, error } = await storage.from(MEDIA_BUCKET).createSignedUrl(stored, SIGNED_URL_TTL);
  if (error || !data) return null;
  return data.signedUrl;
}

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

export const itemWithCategory = { category: true } as const;
