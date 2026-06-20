import type { Item } from "@/store/types";
import { ItemDtoSchema } from "@lifelist/shared";
import type { ItemDto } from "@lifelist/shared";
import { z } from "zod";
import { apiFetch, apiJson } from "./client";

const CompleteResponseSchema = z.object({ item: ItemDtoSchema });

export async function completeItem(itemId: string): Promise<ItemDto> {
  const body = await apiJson<unknown>(`/items/${itemId}/complete`, { method: "PATCH" });
  return CompleteResponseSchema.parse(body).item;
}

export async function deleteItem(itemId: string): Promise<void> {
  const res = await apiFetch(`/items/${itemId}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete item failed: ${res.status}`);
  }
}

export interface DuplicateMatch {
  id: string;
  title: string;
  similarity: number;
}

export interface PrecheckResult {
  isDuplicate: boolean;
  match?: DuplicateMatch;
}

export async function precheckDuplicate(
  title: string,
  signal?: AbortSignal,
): Promise<PrecheckResult> {
  if (title.trim().length < 3) return { isDuplicate: false };
  try {
    const res = await apiFetch(`/items/precheck?title=${encodeURIComponent(title)}`, { signal });
    if (res.status === 409) {
      const body = await res.json();
      return { isDuplicate: true, match: body.match };
    }
    return { isDuplicate: false };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    return { isDuplicate: false };
  }
}

export async function createItem(
  title: string,
  opts?: { force?: boolean },
): Promise<
  { ok: true; item: ItemDto } | { ok: false; match?: DuplicateMatch } | { ok: false; error: true }
> {
  const res = await apiFetch("/items/create", {
    method: "POST",
    body: JSON.stringify({ title, force: opts?.force ?? false }),
  });
  if (res.status === 409) {
    const body = await res.json();
    return { ok: false, match: body.match };
  }
  if (!res.ok) return { ok: false, error: true };
  const body = await res.json();
  return { ok: true, item: ItemDtoSchema.parse(body.item) };
}

export async function setItemImage(itemId: string, imagePath: string): Promise<Item> {
  const { item } = await apiJson<{ item: unknown }>(`/items/${itemId}/image`, {
    method: "PATCH",
    body: JSON.stringify({ imagePath }),
  });
  return ItemDtoSchema.parse(item);
}

export async function setItemSouvenirImage(itemId: string, imagePath: string): Promise<Item> {
  const { item } = await apiJson<{ item: unknown }>(`/items/${itemId}/souvenir-image`, {
    method: "PATCH",
    body: JSON.stringify({ imagePath }),
  });
  return ItemDtoSchema.parse(item);
}
