import { describe, expect, it, vi } from "vitest";
import type { SemanticItem } from "./analyze-item";

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

const { analyzeItem, buildEmbeddingInput, buildSemanticKey } = await import("./analyze-item");

const ANALYSIS = {
  canonicalTitle: "Visit Burj Khalifa",
  action: "visit",
  subject: "Burj Khalifa",
  subjectType: "landmark",
  location: "Dubai, United Arab Emirates",
  concepts: ["tallest building", "skyscraper"],
  entityConfidence: 0.97,
  entityWasInferred: true,
  matchedCategoryId: null,
  newCategoryName: "Travel",
  imageKeywords: ["Burj Khalifa", "Dubai skyline"],
  experienceSearchQuery: "Burj Khalifa",
  experienceLocation: "Dubai, United Arab Emirates",
} satisfies SemanticItem;

describe("analyzeItem", () => {
  it("parses structured semantic metadata", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(ANALYSIS), refusal: null } }],
    });

    const result = await analyzeItem({
      title: "Visit the tallest building on earth",
      existingCategories: [],
    });
    expect(result.subject).toBe("Burj Khalifa");
    expect(result.entityWasInferred).toBe(true);
    expect(result.experienceSearchQuery).toBe("Burj Khalifa");
  });

  it("rejects a hallucinated category id", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              ...ANALYSIS,
              matchedCategoryId: "missing",
              newCategoryName: null,
            }),
            refusal: null,
          },
        },
      ],
    });

    const result = await analyzeItem({
      title: "Visit the tallest building",
      existingCategories: [{ id: "travel", name: "Travel" }],
    });
    expect(result.matchedCategoryId).toBeNull();
    expect(result.newCategoryName).toBe("General");
  });

  it("bounds model-generated keyword arrays before validation", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              ...ANALYSIS,
              imageKeywords: ["one", "two", "three", "four", "five"],
            }),
            refusal: null,
          },
        },
      ],
    });

    const result = await analyzeItem({
      title: "Visit the tallest building",
      existingCategories: [],
    });
    expect(result.imageKeywords).toEqual(["one", "two", "three", "four"]);
  });
});

describe("semantic representation", () => {
  it("builds a stable high-confidence key", () => {
    expect(buildSemanticKey(ANALYSIS)).toBe(
      "experience:landmark:burj-khalifa:dubai-united-arab-emirates",
    );
  });

  it("does not enforce a key for uncertain entity inference", () => {
    expect(buildSemanticKey({ ...ANALYSIS, entityConfidence: 0.7 })).toBeNull();
  });

  it("builds an embedding input from meaning rather than user wording", () => {
    expect(buildEmbeddingInput(ANALYSIS)).toContain("subject: Burj Khalifa");
    expect(buildEmbeddingInput(ANALYSIS)).toContain("concepts: tallest building, skyscraper");
  });
});
