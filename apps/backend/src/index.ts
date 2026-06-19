import type { Experience, ItemDto } from "@lifelist/shared";

/** Compile-time proof that backend code consumes the canonical shared contracts. */
export function summarizeItem(item: ItemDto): string {
  return `${item.id}:${item.status}:${item.category?.name ?? "uncategorized"}`;
}

/** Referencing a concrete field makes shared DTO renames fail backend typecheck. */
export function experiencePriceToken(experience: Experience): string {
  return experience.priceToken;
}
