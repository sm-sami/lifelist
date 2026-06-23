import { describe, expect, it } from "vitest";
import { normalizeExperienceQuery } from "./query";

describe("normalizeExperienceQuery", () => {
  it("only performs mechanical cleanup for legacy items", () => {
    expect(normalizeExperienceQuery("  Visit   the Eiffel Tower  ")).toBe("Visit the Eiffel Tower");
  });
});
