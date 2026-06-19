import type { Item } from "@/store/items";

export function estimateItemHeight(item: Item, columnWidth: number): number {
  if (item.status === "pending_enrichment") return columnWidth * 1.1;
  const imageHeight = item.imageUrl ? columnWidth * (4 / 3) : columnWidth * 0.6;
  const titleLines = Math.max(1, Math.ceil(item.title.length / 22));
  const titleHeight = 22 + titleLines * 20;
  return Math.round(imageHeight + titleHeight + 16);
}
