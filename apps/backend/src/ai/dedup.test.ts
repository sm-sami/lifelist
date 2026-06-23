import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("./embed", () => ({
  EMBEDDING_MODEL: "text-embedding-3-small",
}));

import { db } from "../../db/client";
import { findDuplicateCandidates, findSemanticKeyDuplicate } from "./dedup";

const mockExecute = vi.mocked(db.execute);
const QUERY_VEC = new Array(1536).fill(0.1);
const USER_ID = "user-uuid-001";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findDuplicateCandidates", () => {
  it("returns plausible candidates and discards distant rows", async () => {
    mockExecute.mockResolvedValueOnce([
      {
        id: "item-1",
        title: "See the Northern Lights",
        semantic_data: null,
        distance: 0.12,
      },
      {
        id: "item-2",
        title: "Learn to surf",
        semantic_data: null,
        distance: 0.7,
      },
    ] as never);

    const result = await findDuplicateCandidates(USER_ID, QUERY_VEC);
    expect(result).toEqual([
      {
        id: "item-1",
        title: "See the Northern Lights",
        semanticData: null,
        distance: 0.12,
        similarity: 0.88,
      },
    ]);
  });

  it("accepts a transaction executor", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await findDuplicateCandidates(USER_ID, QUERY_VEC, { execute });
    expect(execute).toHaveBeenCalledOnce();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("findSemanticKeyDuplicate", () => {
  it("does not query for a low-confidence null key", async () => {
    expect(await findSemanticKeyDuplicate(USER_ID, null)).toBeNull();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns an exact semantic-key match", async () => {
    mockExecute.mockResolvedValueOnce([
      { id: "item-1", title: "See the Northern Lights" },
    ] as never);

    expect(
      await findSemanticKeyDuplicate(USER_ID, "natural-phenomenon:northern-lights"),
    ).toMatchObject({
      id: "item-1",
      title: "See the Northern Lights",
      distance: 0,
      similarity: 1,
    });
  });
});
