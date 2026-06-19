import { describe, expect, it } from "vitest";
import { generateGradient, slugify } from "./gradient";

const HEX = /^#[0-9A-F]{6}$/;

describe("generateGradient", () => {
  it("is deterministic — same seed yields the same pair", () => {
    const a = generateGradient("Travel");
    const b = generateGradient("Travel");
    expect(a).toEqual(b);
  });

  it("produces different pairs for different seeds", () => {
    const travel = generateGradient("Travel");
    const food = generateGradient("Food & Drink");
    expect(travel.gradientStart).not.toBe(food.gradientStart);
  });

  it("returns valid uppercase hex strings", () => {
    const { gradientStart, gradientEnd } = generateGradient("Outdoor Adventure");
    expect(gradientStart).toMatch(HEX);
    expect(gradientEnd).toMatch(HEX);
  });

  it("is case/whitespace-insensitive (same hash as lowercased+trimmed)", () => {
    expect(generateGradient("TRAVEL")).toEqual(generateGradient("travel"));
    expect(generateGradient("  Travel  ")).toEqual(generateGradient("travel"));
  });
});

describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric with hyphens", () => {
    expect(slugify("Food & Drink")).toBe("food-drink");
    expect(slugify("Outdoor Adventure")).toBe("outdoor-adventure");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("  Travel  ")).toBe("travel");
    expect(slugify("--test--")).toBe("test");
  });

  it("collapses consecutive non-alphanumeric chars to a single hyphen", () => {
    expect(slugify("Arts & Culture!!!")).toBe("arts-culture");
  });
});
