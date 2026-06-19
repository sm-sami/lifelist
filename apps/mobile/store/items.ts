import type { ItemDto } from "@lifelist/shared";

// Re-export ItemDto as Item for use throughout the app.
// integration/001 will replace this stub with a real Zustand store + API wiring.
export type Item = ItemDto;

export type ItemsStatus = "loading" | "error" | "ready";

export interface ItemsState {
  items: Item[];
  status: ItemsStatus;
  refetch: () => void;
}

// Stub hook — returns empty list in loading state until integration/001.
export function useItems<T>(selector: (s: ItemsState) => T): T {
  const stub: ItemsState = { items: [], status: "loading", refetch: () => {} };
  return selector(stub);
}
