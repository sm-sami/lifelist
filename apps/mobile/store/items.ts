import type { ItemDto } from "@lifelist/shared";

// Re-export ItemDto as Item for use throughout the app.
// integration/001 will replace this stub with a real Zustand store + API wiring.
export type Item = ItemDto;

export type ItemsStatus = "loading" | "error" | "ready";

export type FetchResult = { kind: "ok"; item: Item } | { kind: "not_found" } | { kind: "error" };

export interface ItemsState {
  items: Item[];
  status: ItemsStatus;
  refetch: () => void;
  addOptimistic: (item: Item) => void;
  fetchItemById: (id: string) => Promise<FetchResult>;
}

// Stub hook — returns empty list in loading state until integration/001.
export function useItems<T>(selector: (s: ItemsState) => T): T {
  const stub: ItemsState = {
    items: [],
    status: "loading",
    refetch: () => {},
    addOptimistic: () => {},
    fetchItemById: async () => ({ kind: "error" }),
  };
  return selector(stub);
}

// Stub: reads item from the in-memory store by id. Returns undefined if not found.
// integration/001 will wire this to a real Zustand selector.
export function useItem(_id: string): Item | undefined {
  return undefined;
}

// Stub: exposes store actions for use outside of React hooks.
// integration/001 will replace this with a real Zustand store.
export function useItemsStore<T>(selector: (s: ItemsState) => T): T {
  const stub: ItemsState = {
    items: [],
    status: "loading",
    refetch: () => {},
    addOptimistic: () => {},
    fetchItemById: async () => ({ kind: "error" }),
  };
  return selector(stub);
}
