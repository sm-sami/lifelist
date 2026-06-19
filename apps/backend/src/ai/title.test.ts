import { describe, expect, it } from "vitest";
import { canonicalizeBucketTitle, getDeterministicItemMetadata } from "./title";

describe("canonicalizeBucketTitle", () => {
  it("collapses northern lights aliases and bucket-list intent", () => {
    expect(canonicalizeBucketTitle("See the northern lights")).toBe("northern lights");
    expect(canonicalizeBucketTitle("Experience aurora borealis")).toBe("northern lights");
  });

  it("maps tallest-building phrasing to Burj Khalifa", () => {
    expect(canonicalizeBucketTitle("Visit the tallest building on the earth")).toBe("burj khalifa");
    expect(canonicalizeBucketTitle("Visit the tallest building")).toBe("burj khalifa");
    expect(canonicalizeBucketTitle("See the world's tallest building")).toBe("burj khalifa");
    expect(canonicalizeBucketTitle("Tallest building")).toBe("burj khalifa");
  });
});

describe("getDeterministicItemMetadata", () => {
  it("returns specific metadata for Burj Khalifa", () => {
    expect(getDeterministicItemMetadata("Visit the tallest building")).toEqual({
      imageKeywords: ["burj khalifa", "dubai skyline", "skyscraper"],
      experienceSearchQuery: "Burj Khalifa",
      experienceLocation: "Dubai, United Arab Emirates",
    });
  });

  it("returns specific metadata for aurora/northern lights", () => {
    expect(getDeterministicItemMetadata("Experience aurora borealis")).toEqual({
      imageKeywords: ["northern lights", "aurora", "night sky"],
      experienceSearchQuery: "Northern Lights",
      experienceLocation: null,
    });
  });
});
