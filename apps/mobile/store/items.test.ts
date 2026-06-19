import type { Item } from "./types";

const mockApiJson = jest.fn();

class MockApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    public authInvalid = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

jest.mock("@/lib/api/client", () => ({
  ApiError: MockApiError,
  apiJson: (...args: unknown[]) => mockApiJson(...args),
}));

const { useItemsStore } = jest.requireActual<typeof import("./items")>("./items");

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Visit Machu Picchu",
    notes: null,
    imageUrl: null,
    imageAttribution: null,
    imageAttributionUrl: null,
    status: "pending_enrichment",
    categoryId: null,
    category: null,
    completedAt: null,
    createdAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

function resetStore() {
  useItemsStore.setState({
    items: [],
    status: "idle",
    error: null,
    ownerUserId: null,
    requestGeneration: 0,
  });
}

describe("items store", () => {
  beforeEach(() => {
    mockApiJson.mockReset();
    resetStore();
  });

  it("hydrates valid ItemDto payloads and becomes ready", async () => {
    mockApiJson.mockResolvedValueOnce({ items: [item()] });

    useItemsStore.getState().setUser("user-a");
    await useItemsStore.getState().hydrate("user-a");

    expect(mockApiJson).toHaveBeenCalledWith("/items");
    expect(useItemsStore.getState().status).toBe("ready");
    expect(useItemsStore.getState().items).toHaveLength(1);
  });

  it("prepends optimistic items and upserts enrichment in place", () => {
    const pending = item();
    const older = item({ id: "22222222-2222-4222-8222-222222222222", title: "See Petra" });
    const enriched = item({
      status: "active",
      imageUrl: "https://example.com/machu.jpg",
      category: {
        id: "33333333-3333-4333-8333-333333333333",
        name: "Adventure",
        gradientStart: "#8000ff",
        gradientEnd: "#ff007a",
      },
      categoryId: "33333333-3333-4333-8333-333333333333",
    });

    useItemsStore.getState().addOptimistic(older);
    useItemsStore.getState().addOptimistic(pending);
    useItemsStore.getState().upsert(enriched);

    const state = useItemsStore.getState();
    expect(state.items.map((i) => i.id)).toEqual([pending.id, older.id]);
    expect(state.items[0]).toEqual(enriched);
  });

  it("distinguishes fetchItemById not_found from transport or schema errors", async () => {
    useItemsStore.getState().setUser("user-a");
    mockApiJson.mockRejectedValueOnce(new MockApiError(404, "missing"));
    mockApiJson.mockRejectedValueOnce(new Error("offline"));

    await expect(useItemsStore.getState().fetchItemById("missing")).resolves.toEqual({
      kind: "not_found",
    });
    await expect(useItemsStore.getState().fetchItemById("offline")).resolves.toMatchObject({
      kind: "error",
    });
  });

  it("discards an old hydrate result after the authenticated user changes", async () => {
    let resolveUserA!: (value: unknown) => void;
    mockApiJson.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUserA = resolve;
      }),
    );
    mockApiJson.mockResolvedValueOnce({ items: [item({ title: "User B item" })] });

    useItemsStore.getState().setUser("user-a");
    const userAHydrate = useItemsStore.getState().hydrate("user-a");
    useItemsStore.getState().setUser("user-b");
    await useItemsStore.getState().hydrate("user-b");

    resolveUserA({ items: [item({ title: "Private user A item" })] });
    await userAHydrate;

    const state = useItemsStore.getState();
    expect(state.ownerUserId).toBe("user-b");
    expect(state.items).toHaveLength(1);
    expect(state.items[0].title).toBe("User B item");
  });
});
