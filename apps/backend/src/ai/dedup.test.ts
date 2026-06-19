import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("./embed", () => ({
  EMBEDDING_MODEL: "text-embedding-3-small",
}));

import { db } from "../../db/client";
import { findSemanticDuplicate } from "./dedup";

const mockExecute = vi.mocked(db.execute);

const QUERY_VEC = new Array(1536).fill(0.1);
const USER_ID = "user-uuid-001";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findSemanticDuplicate", () => {
  it("returns null when no rows found", async () => {
    mockExecute.mockResolvedValueOnce([] as never);
    const result = await findSemanticDuplicate(USER_ID, QUERY_VEC);
    expect(result).toBeNull();
  });

  it("returns null when nearest row is beyond the distance threshold", async () => {
    mockExecute.mockResolvedValueOnce([
      { id: "item-1", title: "Learn to surf", distance: 0.5 },
    ] as never);
    const result = await findSemanticDuplicate(USER_ID, QUERY_VEC);
    expect(result).toBeNull();
  });

  it("returns the match when nearest row is within the threshold", async () => {
    mockExecute.mockResolvedValueOnce([
      { id: "item-2", title: "See the Northern Lights", distance: 0.08 },
    ] as never);
    const result = await findSemanticDuplicate(USER_ID, QUERY_VEC);
    expect(result).toMatchObject({
      id: "item-2",
      title: "See the Northern Lights",
      distance: 0.08,
      similarity: 0.92,
    });
  });

  it("accepts a custom executor (transaction handle)", async () => {
    const txExecute = vi.fn().mockResolvedValue([]);
    const tx = { execute: txExecute };
    await findSemanticDuplicate(USER_ID, QUERY_VEC, tx);
    expect(txExecute).toHaveBeenCalledOnce();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
