import { ApiError, apiJson } from "@/lib/api/client";
import { ItemDtoSchema } from "@lifelist/shared";
import { z } from "zod";
import { create } from "zustand";
import type { Item } from "./types";

const ItemsResponseSchema = z.object({ items: z.array(ItemDtoSchema) });
const ItemResponseSchema = z.object({ item: ItemDtoSchema });

export type FetchItemResult =
  | { kind: "ok"; item: Item }
  | { kind: "not_found" }
  | { kind: "error"; error: unknown };

export interface ItemsState {
  items: Item[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  ownerUserId: string | null;
  requestGeneration: number;
  setUser: (userId: string | null) => void;
  hydrate: (userId: string) => Promise<void>;
  refetch: () => Promise<void>;
  fetchItemById: (id: string) => Promise<FetchItemResult>;
  addOptimistic: (item: Item) => void;
  upsert: (item: Item) => void;
  remove: (id: string) => void;
}

export const useItemsStore = create<ItemsState>((set, get) => ({
  items: [],
  status: "idle",
  error: null,
  ownerUserId: null,
  requestGeneration: 0,

  setUser: (userId) =>
    set((state) =>
      state.ownerUserId === userId
        ? state
        : {
            items: [],
            status: "idle",
            error: null,
            ownerUserId: userId,
            requestGeneration: state.requestGeneration + 1,
          },
    ),

  hydrate: async (userId) => {
    if (get().ownerUserId !== userId) get().setUser(userId);
    const generation = get().requestGeneration;
    set({ status: "loading", error: null });

    try {
      const raw = await apiJson<unknown>("/items");
      const { items } = ItemsResponseSchema.parse(raw);

      if (get().ownerUserId === userId && get().requestGeneration === generation) {
        set({ items, status: "ready", error: null });
      }
    } catch {
      if (get().ownerUserId === userId && get().requestGeneration === generation) {
        set({ status: "error", error: "Could not load your items." });
      }
    }
  },

  refetch: async () => {
    const userId = get().ownerUserId;
    if (userId) await get().hydrate(userId);
  },

  fetchItemById: async (id) => {
    const ownerUserId = get().ownerUserId;
    const generation = get().requestGeneration;

    if (!ownerUserId) return { kind: "error", error: new Error("No active user") };

    try {
      const raw = await apiJson<unknown>(`/items/${id}`);
      const { item } = ItemResponseSchema.parse(raw);

      if (get().ownerUserId !== ownerUserId || get().requestGeneration !== generation) {
        return { kind: "error", error: new Error("Authenticated user changed") };
      }

      get().upsert(item);
      return { kind: "ok", item };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return { kind: "not_found" };
      return { kind: "error", error };
    }
  },

  addOptimistic: (item) =>
    set((state) => ({
      items: [item, ...state.items.filter((existing) => existing.id !== item.id)],
    })),

  upsert: (item) =>
    set((state) => {
      const idx = state.items.findIndex((existing) => existing.id === item.id);
      if (idx === -1) return { items: [item, ...state.items] };

      const next = state.items.slice();
      next[idx] = item;
      return { items: next };
    }),

  remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}));

export const useItems = <T>(selector: (state: ItemsState) => T): T => useItemsStore(selector);

export const useItem = (id: string): Item | undefined =>
  useItemsStore((state) => state.items.find((item) => item.id === id));

export type { Item } from "./types";
