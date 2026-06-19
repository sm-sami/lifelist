import { ItemDtoSchema } from "@lifelist/shared";
import type { ItemDto } from "@lifelist/shared";
import { apiFetch } from "./client";

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
