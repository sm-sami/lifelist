import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DuplicateMatch } from "../ai/dedup";
import type { AppEnv } from "../types";

// ── External module mocks (hoisted before any imports) ────────────────────────
vi.mock("../../db/client", () => ({
  db: {
    transaction: vi.fn(),
    query: { items: { findMany: vi.fn(), findFirst: vi.fn() } },
    update: vi.fn(),
    insert: vi.fn(),
    execute: vi.fn(),
  },
}));
vi.mock("../ai/embed", () => ({ embed: vi.fn(), EMBEDDING_MODEL: "text-embedding-3-small" }));
vi.mock("../ai/dedup", () => ({ findSemanticDuplicate: vi.fn(), findTitleDuplicate: vi.fn() }));
vi.mock("../middleware/rate-limit", () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("./dto", () => ({
  toItemDto: vi.fn(),
  deleteStoredImage: vi.fn(),
  storedImageExists: vi.fn(),
}));
vi.mock("./enrich", () => ({ enrichItem: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

// ── Import mocked modules ─────────────────────────────────────────────────────
const { db } = await import("../../db/client");
const { embed } = await import("../ai/embed");
const { findSemanticDuplicate, findTitleDuplicate } = await import("../ai/dedup");
const { toItemDto, storedImageExists, deleteStoredImage } = await import("./dto");
const { enrichItem } = await import("./enrich");
const { itemsRoutes } = await import("./routes");

// Drizzle's types are complex — cast via unknown so we can call vi.fn() methods.
// biome-ignore lint/suspicious/noExplicitAny: test helper cast
const anyDb = db as any;
const mockEmbed = vi.mocked(embed);
const mockDedup = vi.mocked(findSemanticDuplicate);
const mockTitleDedup = vi.mocked(findTitleDuplicate);
const mockToItemDto = vi.mocked(toItemDto);
const mockStoredImageExists = vi.mocked(storedImageExists);
const mockDeleteStoredImage = vi.mocked(deleteStoredImage);
const mockEnrichItem = vi.mocked(enrichItem);

// ── Test app wrapping with auth context ───────────────────────────────────────
function makeApp(userId = "user-001") {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    c.set("userEmail", "test@example.com");
    await next();
  });
  app.route("/api/items", itemsRoutes);
  return app;
}

const FAKE_EMBEDDING = Array(1536).fill(0.1);
const FAKE_ITEM = {
  id: "item-001",
  userId: "user-001",
  title: "Hike the Inca Trail",
  notes: null,
  imageUrl: null,
  imageAttribution: null,
  imageAttributionUrl: null,
  experienceSearchQuery: null,
  experienceLocation: null,
  status: "pending_enrichment" as const,
  categoryId: null,
  embedding: FAKE_EMBEDDING,
  embeddingModel: "text-embedding-3-small",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  completedAt: null,
};
const FAKE_DTO = {
  id: "item-001",
  title: "Hike the Inca Trail",
  notes: null,
  imageUrl: null,
  imageAttribution: null,
  imageAttributionUrl: null,
  experienceSearchQuery: null,
  experienceLocation: null,
  status: "pending_enrichment",
  categoryId: null,
  category: null,
  completedAt: null,
  createdAt: "2025-01-01T00:00:00.000Z",
};
const FAKE_DUP: DuplicateMatch = {
  id: "item-000",
  title: "Trek the Inca Trail",
  distance: 0.08,
  similarity: 0.92,
};

function fakeInsertTx() {
  return {
    execute: vi.fn(),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([FAKE_ITEM]),
      }),
    }),
  };
}

beforeEach(() => {
  // resetAllMocks clears both call history AND one-time return value queues,
  // preventing unconsumed mockResolvedValueOnce responses from bleeding between tests.
  vi.resetAllMocks();
});

// ── POST /api/items/create ─────────────────────────────────────────────────────
describe("POST /api/items/create", () => {
  it("creates an item and returns 201", async () => {
    mockEmbed.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockTitleDedup.mockResolvedValueOnce(null);
    mockDedup.mockResolvedValueOnce(null);
    anyDb.transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<typeof FAKE_ITEM>) => fn(fakeInsertTx()),
    );
    mockEnrichItem.mockResolvedValueOnce(undefined);
    mockToItemDto.mockResolvedValueOnce(FAKE_DTO as never);

    const res = await makeApp().request("/api/items/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hike the Inca Trail" }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.item.id).toBe("item-001");
  });

  it("returns 409 when a semantic duplicate is found", async () => {
    mockEmbed.mockResolvedValueOnce(FAKE_EMBEDDING);
    anyDb.transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<void>) => {
      mockTitleDedup.mockResolvedValueOnce(null);
      mockDedup.mockResolvedValueOnce(FAKE_DUP);
      return fn({ execute: vi.fn(), insert: vi.fn() });
    });

    const res = await makeApp().request("/api/items/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hike the Inca Trail" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("duplicate_item");
    expect(body.match.id).toBe("item-000");
  });

  it("bypasses dedup check when force=true", async () => {
    mockEmbed.mockResolvedValueOnce(FAKE_EMBEDDING);
    anyDb.transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<typeof FAKE_ITEM>) => fn(fakeInsertTx()),
    );
    mockEnrichItem.mockResolvedValueOnce(undefined);
    mockToItemDto.mockResolvedValueOnce(FAKE_DTO as never);

    const res = await makeApp().request("/api/items/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Hike the Inca Trail", force: true }),
    });

    expect(res.status).toBe(201);
    expect(mockDedup).not.toHaveBeenCalled();
  });

  it("returns 409 when a canonical title duplicate is found", async () => {
    mockEmbed.mockResolvedValueOnce(FAKE_EMBEDDING);
    anyDb.transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<void>) => {
      mockTitleDedup.mockResolvedValueOnce({
        ...FAKE_DUP,
        title: "See the Northern Lights",
        distance: 0,
        similarity: 1,
      });
      return fn({ execute: vi.fn(), insert: vi.fn() });
    });

    const res = await makeApp().request("/api/items/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Northern lights" }),
    });

    expect(res.status).toBe(409);
    expect(mockDedup).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.match.title).toBe("See the Northern Lights");
  });

  it("returns 400 for an empty title", async () => {
    const res = await makeApp().request("/api/items/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/items/precheck ────────────────────────────────────────────────────
describe("GET /api/items/precheck", () => {
  it("returns 200 with isDuplicate:false when no match", async () => {
    mockTitleDedup.mockResolvedValueOnce(null);
    mockEmbed.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockDedup.mockResolvedValueOnce(null);

    const res = await makeApp().request("/api/items/precheck?title=Hike+the+Inca+Trail");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isDuplicate).toBe(false);
  });

  it("returns 409 with match when a duplicate exists", async () => {
    mockTitleDedup.mockResolvedValueOnce(null);
    mockEmbed.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockDedup.mockResolvedValueOnce(FAKE_DUP);

    const res = await makeApp().request("/api/items/precheck?title=Hike+Inca+Trail");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.match.id).toBe("item-000");
  });

  it("returns 409 from precheck when a canonical title duplicate exists", async () => {
    mockTitleDedup.mockResolvedValueOnce({
      ...FAKE_DUP,
      title: "See the Northern Lights",
      distance: 0,
      similarity: 1,
    });

    const res = await makeApp().request("/api/items/precheck?title=Northern+lights");
    expect(res.status).toBe(409);
    expect(mockEmbed).not.toHaveBeenCalled();
    expect(mockDedup).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.match.title).toBe("See the Northern Lights");
  });
});

// ── GET /api/items/ ────────────────────────────────────────────────────────────
describe("GET /api/items/", () => {
  it("returns the list of items for the user", async () => {
    anyDb.query.items.findMany.mockResolvedValueOnce([{ ...FAKE_ITEM, category: null }]);
    mockToItemDto.mockResolvedValueOnce(FAKE_DTO as never);

    const res = await makeApp().request("/api/items");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });
});

// ── GET /api/items/:id ─────────────────────────────────────────────────────────
describe("GET /api/items/:id", () => {
  it("returns 200 with the item when found", async () => {
    anyDb.query.items.findFirst.mockResolvedValueOnce({ ...FAKE_ITEM, category: null });
    mockToItemDto.mockResolvedValueOnce(FAKE_DTO as never);

    const res = await makeApp().request("/api/items/item-001");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.id).toBe("item-001");
  });

  it("returns 404 when item not found", async () => {
    anyDb.query.items.findFirst.mockResolvedValueOnce(undefined);

    const res = await makeApp().request("/api/items/does-not-exist");
    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/items/:id/complete ─────────────────────────────────────────────
describe("PATCH /api/items/:id/complete", () => {
  it("marks the item completed and returns it", async () => {
    anyDb.update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    });
    anyDb.query.items.findFirst.mockResolvedValueOnce({
      ...FAKE_ITEM,
      status: "completed",
      category: null,
    });
    mockToItemDto.mockResolvedValueOnce({ ...FAKE_DTO, status: "completed" } as never);

    const res = await makeApp().request("/api/items/item-001/complete", { method: "PATCH" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.status).toBe("completed");
  });
});

// ── DELETE /api/items/:id ─────────────────────────────────────────────────────
describe("DELETE /api/items/:id", () => {
  it("deletes the owned item and removes a stored image path", async () => {
    const storedPath = "user-001/item-001/photo.jpg";
    anyDb.transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<string | null | undefined>) => {
        const fakeTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([{ imageUrl: storedPath }]),
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return fn(fakeTx);
      },
    );
    mockDeleteStoredImage.mockResolvedValueOnce(undefined);

    const res = await makeApp("user-001").request("/api/items/item-001", { method: "DELETE" });

    expect(res.status).toBe(204);
    expect(mockDeleteStoredImage).toHaveBeenCalledWith(storedPath);
  });

  it("returns 404 when the item is not owned or does not exist", async () => {
    anyDb.transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<string | null | undefined>) => {
        const fakeTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };
        return fn(fakeTx);
      },
    );

    const res = await makeApp("user-001").request("/api/items/missing", { method: "DELETE" });

    expect(res.status).toBe(404);
    expect(mockDeleteStoredImage).not.toHaveBeenCalled();
  });
});

// ── PATCH /api/items/:id/image ─────────────────────────────────────────────────
describe("PATCH /api/items/:id/image", () => {
  const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
  const userId = "user-001";
  const itemId = "item-001";
  const validPath = `${userId}/${itemId}/${VALID_UUID}.jpg`;

  it("returns 400 for a path that doesn't start with userId/itemId", async () => {
    const res = await makeApp(userId).request(`/api/items/${itemId}/image`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePath: "other-user/item-001/file.jpg" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_image_path");
  });

  it("returns 400 for a path in the user folder but for a different item id", async () => {
    const res = await makeApp(userId).request(`/api/items/${itemId}/image`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePath: `${userId}/other-item/${VALID_UUID}.jpg` }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_image_path");
  });

  it("returns 400 for an otherwise valid path carrying a query string", async () => {
    const res = await makeApp(userId).request(`/api/items/${itemId}/image`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePath: `${validPath}?v=123` }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_image_path");
  });

  it("returns 400 when the uploaded file doesn't exist in storage", async () => {
    mockStoredImageExists.mockResolvedValueOnce(false);

    const res = await makeApp(userId).request(`/api/items/${itemId}/image`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePath: validPath }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("uploaded_image_not_found");
  });

  it("updates the image and deletes the previous stored path", async () => {
    const oldPath = `${userId}/${itemId}/old-file.jpg`;
    mockStoredImageExists.mockResolvedValueOnce(true);
    anyDb.transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<string | undefined>) => {
        const fakeTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([{ imageUrl: oldPath }]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
          }),
        };
        return fn(fakeTx);
      },
    );
    mockDeleteStoredImage.mockResolvedValueOnce(undefined);
    anyDb.query.items.findFirst.mockResolvedValueOnce({
      ...FAKE_ITEM,
      imageUrl: validPath,
      category: null,
    });
    mockToItemDto.mockResolvedValueOnce({
      ...FAKE_DTO,
      imageUrl: "https://signed.url/image.jpg",
    } as never);

    const res = await makeApp(userId).request(`/api/items/${itemId}/image`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePath: validPath }),
    });

    expect(res.status).toBe(200);
    expect(mockDeleteStoredImage).toHaveBeenCalledWith(oldPath);
  });
});
