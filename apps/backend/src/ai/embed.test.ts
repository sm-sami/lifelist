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

const { normalizeEmbeddingInput, embed } = await import("./embed");

describe("normalizeEmbeddingInput", () => {
  it("only applies mechanical Unicode and whitespace normalization", () => {
    expect(normalizeEmbeddingInput("  action: visit\n subject:  Burj Khalifa  ")).toBe(
      "action: visit subject: Burj Khalifa",
    );
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

  it("mechanically normalizes the semantic input before embedding", async () => {
    await embed("  subject:  Mount Everest  ");
    const callArg = mockCreate.mock.calls.at(-1)?.[0] as { input: string };
    expect(callArg.input).toBe("subject: Mount Everest");
  });
});
