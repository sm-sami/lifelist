import { describe, expect, it } from "vitest";
import { normalizeExperienceQuery } from "./query";

describe("normalizeExperienceQuery", () => {
  it.each([
    ["Visit the Eiffel Tower", "Eiffel Tower"],
    ["See the Northern Lights", "Northern Lights"],
    ["Hike the Inca Trail", "Inca Trail"],
    ["Take a gondola ride in Venice", "gondola ride Venice"],
    ["I want to learn to surf in Bali", "surf Bali"],
  ])("turns %j into %j", (title, expected) => {
    expect(normalizeExperienceQuery(title)).toBe(expected);
  });

  it("preserves an already compact query", () => {
    expect(normalizeExperienceQuery("Eiffel Tower")).toBe("Eiffel Tower");
  });
});
