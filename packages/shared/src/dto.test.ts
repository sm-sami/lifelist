import { describe, expect, it } from "vitest";
import { ExperienceSchema, ItemDtoSchema } from "./dto";

describe("shared DTO schemas", () => {
  it("accepts a canonical item response", () => {
    const item = ItemDtoSchema.parse({
      id: "7e3c6446-bef6-4a57-93b2-4d5fc5574e6c",
      title: "See the Northern Lights",
      notes: null,
      imageUrl: null,
      imageAttribution: null,
      imageAttributionUrl: null,
      experienceSearchQuery: "Northern Lights",
      experienceLocation: "Tromso, Norway",
      status: "pending_enrichment",
      categoryId: null,
      category: null,
      completedAt: null,
      createdAt: "2026-06-19T00:00:00.000Z",
    });

    expect(item.status).toBe("pending_enrichment");
    expect(item.experienceSearchQuery).toBe("Northern Lights");
  });

  it("rejects ratings outside the five-point scale", () => {
    const result = ExperienceSchema.safeParse({
      title: "Example",
      description: "",
      priceToken: "See price",
      rating: 6,
      bookingUrl: "https://www.headout.com/example",
    });

    expect(result.success).toBe(false);
  });
});
