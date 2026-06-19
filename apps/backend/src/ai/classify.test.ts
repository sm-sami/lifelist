import { describe, expect, it, vi } from "vitest";

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

const { classifyItem } = await import("./classify");
const OpenAI = (await import("openai")).default;
const mockCreate = vi.mocked(OpenAI).mock.results[0]?.value.chat.completions.create as ReturnType<
  typeof vi.fn
>;

function mockResponse(payload: object) {
  mockCreate.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(payload), refusal: null } }],
  });
}

describe("classifyItem", () => {
  it("returns a new category when no existing categories match", async () => {
    mockResponse({
      matchedCategoryId: null,
      newCategoryName: "Travel",
      imageKeywords: ["mountain", "adventure"],
      experienceSearchQuery: "Inca Trail",
      experienceLocation: "Peru",
    });
    const result = await classifyItem({ title: "Hike the Inca Trail", existingCategories: [] });
    expect(result.matchedCategoryId).toBeNull();
    expect(result.newCategoryName).toBe("Travel");
    expect(result.imageKeywords).toHaveLength(2);
    expect(result.experienceSearchQuery).toBe("Inca Trail");
    expect(result.experienceLocation).toBe("Peru");
  });

  it("returns the matched category id when one fits", async () => {
    mockResponse({
      matchedCategoryId: "cat-travel",
      newCategoryName: null,
      imageKeywords: ["paris", "eiffel"],
      experienceSearchQuery: "Eiffel Tower",
      experienceLocation: "Paris, France",
    });
    const result = await classifyItem({
      title: "Visit the Eiffel Tower",
      existingCategories: [{ id: "cat-travel", name: "Travel" }],
    });
    expect(result.matchedCategoryId).toBe("cat-travel");
    expect(result.newCategoryName).toBeNull();
  });

  it("replaces a hallucinated category id with null and falls back to General", async () => {
    mockResponse({
      matchedCategoryId: "does-not-exist",
      newCategoryName: null,
      imageKeywords: ["sky", "cloud"],
      experienceSearchQuery: "Skydiving",
      experienceLocation: null,
    });
    const result = await classifyItem({
      title: "Skydive",
      existingCategories: [{ id: "cat-food", name: "Food" }],
    });
    expect(result.matchedCategoryId).toBeNull();
    expect(result.newCategoryName).toBe("General");
  });

  it("throws when the model returns a refusal", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { refusal: "I cannot help with that.", content: null } }],
    });
    await expect(classifyItem({ title: "bad input", existingCategories: [] })).rejects.toThrow(
      "Classification refused",
    );
  });

  it("throws when the model returns empty content", async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: null, refusal: null } }] });
    await expect(classifyItem({ title: "empty", existingCategories: [] })).rejects.toThrow(
      "Classification returned empty content",
    );
  });
});
