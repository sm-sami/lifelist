import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: new Array(1536).fill(0.1) }],
        }),
      },
    })),
  };
});

// Set the env var before the dynamic import so requireEnv() doesn't throw.
vi.stubEnv("OPENAI_API_KEY", "test-key");

const { normalizeTitle, embed } = await import("./embed");

describe("normalizeTitle", () => {
  it("lowercases, trims, and removes leading bucket-list intent", () => {
    expect(normalizeTitle("  Visit PARIS  ")).toBe("paris");
  });

  it("collapses known aliases before embedding", () => {
    expect(normalizeTitle("see  the   northern   lights")).toBe("northern lights");
    expect(normalizeTitle("Experience aurora borealis")).toBe("northern lights");
    expect(normalizeTitle("Visit the tallest building")).toBe("burj khalifa");
  });

  it("strips trailing punctuation", () => {
    expect(normalizeTitle("Climb Everest!")).toBe("everest");
    expect(normalizeTitle("Travel to Japan.")).toBe("japan");
    expect(normalizeTitle("Run a marathon?")).toBe("run a marathon");
  });

  it("removes punctuation for embedding stability", () => {
    expect(normalizeTitle("St. Moritz")).toBe("st moritz");
  });
});

describe("embed", () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const OpenAI = (await import("openai")).default;
    const instance = vi.mocked(OpenAI).mock.results[0]?.value as {
      embeddings: { create: ReturnType<typeof vi.fn> };
    };
    mockCreate = instance.embeddings.create;
  });

  it("returns a 1536-dim vector", async () => {
    const vec = await embed("Visit Machu Picchu");
    expect(vec).toHaveLength(1536);
  });

  it("normalizes the input before embedding", async () => {
    await embed("  CLIMB Everest!  ");
    const callArg = mockCreate.mock.calls.at(-1)?.[0] as { input: string };
    expect(callArg.input).toBe("everest");
  });
});
