import type { Experience, ItemDto } from "@lifelist/shared";

/** Compile-time proof that mobile code consumes the canonical shared contracts. */
export function itemCardTitle(item: ItemDto): string {
  return item.title;
}

/** Referencing a concrete field makes shared DTO renames fail mobile typecheck. */
export function experiencePriceToken(experience: Experience): string {
  return experience.priceToken;
}
