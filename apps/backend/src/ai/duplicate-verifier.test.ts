import { describe, expect, it, vi } from "vitest";
import type { SemanticItem } from "./analyze-item";

const mockCreate = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

const { verifyDuplicateCandidates } = await import("./duplicate-verifier");

const INCOMING = {
  canonicalTitle: "See the Northern Lights",
  action: "see",
  subject: "Northern Lights",
  subjectType: "natural_phenomenon",
  location: null,
  concepts: ["aurora borealis"],
  entityConfidence: 0.99,
  entityWasInferred: false,
  matchedCategoryId: null,
  newCategoryName: "Outdoor Adventure",
  imageKeywords: ["northern lights", "night sky"],
  experienceSearchQuery: "Northern Lights",
  experienceLocation: null,
} satisfies SemanticItem;

describe("verifyDuplicateCandidates", () => {
  it("returns a deterministic no-match decision when retrieval is empty", async () => {
    await expect(verifyDuplicateCandidates(INCOMING, [])).resolves.toMatchObject({
      candidateId: null,
      relationship: "different_goal",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("validates the selected candidate", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              candidateId: "item-1",
              relationship: "same_goal",
              confidence: 0.98,
              reason: "Aurora borealis and northern lights are the same phenomenon.",
            }),
            refusal: null,
          },
        },
      ],
    });

    const result = await verifyDuplicateCandidates(INCOMING, [
      {
        id: "item-1",
        title: "Experience aurora borealis",
        semanticData: INCOMING,
        distance: 0.04,
        similarity: 0.96,
      },
    ]);
    expect(result.relationship).toBe("same_goal");
  });
});
