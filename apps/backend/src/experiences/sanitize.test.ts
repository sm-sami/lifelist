import { describe, expect, it } from "vitest";
import { isRelevantCard, sanitizeCard, sanitizeHeadoutResponse } from "./sanitize";

const BASE_CARD = {
  id: 1,
  displayName: "Skip-the-Line: Eiffel Tower Summit",
  urlSlug: "/paris/eiffel-tower-summit",
};

describe("sanitizeCard", () => {
  it("maps a valid card to the Experience shape", () => {
    const result = sanitizeCard(BASE_CARD);
    expect(result).toEqual({
      title: "Skip-the-Line: Eiffel Tower Summit",
      description: "",
      priceToken: "See price",
      rating: null,
      bookingUrl: "https://www.headout.com/paris/eiffel-tower-summit",
    });
  });

  it("prepends / to urlSlug when missing", () => {
    const result = sanitizeCard({ ...BASE_CARD, urlSlug: "paris/eiffel-tower-summit" });
    expect(result?.bookingUrl).toBe("https://www.headout.com/paris/eiffel-tower-summit");
  });

  it("trims leading/trailing whitespace from displayName", () => {
    const result = sanitizeCard({ ...BASE_CARD, displayName: "  Eiffel Tower  " });
    expect(result?.title).toBe("Eiffel Tower");
  });

  it("returns null when displayName is empty", () => {
    expect(sanitizeCard({ ...BASE_CARD, displayName: "" })).toBeNull();
    expect(sanitizeCard({ ...BASE_CARD, displayName: "   " })).toBeNull();
  });

  it("does not leak upstream fields (id, imageUrl, city, country)", () => {
    const result = sanitizeCard({
      ...BASE_CARD,
      city: { code: "PARIS", displayName: "Paris" },
      country: { code: "FR", displayName: "France" },
      imageUrl: "https://cdn.headout.com/img.jpg",
    });
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("imageUrl");
    expect(result).not.toHaveProperty("city");
    expect(result).not.toHaveProperty("country");
  });
});

describe("sanitizeHeadoutResponse", () => {
  const RAW = {
    results: [
      {
        type: "PRODUCT",
        values: [
          { id: 1, displayName: "Eiffel Tower", urlSlug: "/eiffel" },
          { id: 2, displayName: "Louvre Museum", urlSlug: "/louvre" },
        ],
      },
      {
        type: "COLLECTION",
        values: [{ id: 99, displayName: "Paris Bundle", urlSlug: "/paris-bundle" }],
      },
      {
        type: "CITY",
        values: [{ id: 999, displayName: "Paris", urlSlug: "/paris" }],
      },
    ],
  };

  it("extracts only PRODUCT values", () => {
    const results = sanitizeHeadoutResponse(RAW);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Eiffel Tower");
    expect(results[1].title).toBe("Louvre Museum");
  });

  it("returns an empty array when results is absent", () => {
    expect(sanitizeHeadoutResponse({})).toEqual([]);
  });

  it("returns an empty array when there are no PRODUCT groups", () => {
    expect(sanitizeHeadoutResponse({ results: [{ type: "CITY", values: [] }] })).toEqual([]);
  });

  it("drops cards that fail sanitization (empty displayName)", () => {
    const raw = {
      results: [
        {
          type: "PRODUCT",
          values: [
            { id: 1, displayName: "", urlSlug: "/bad" },
            { id: 2, displayName: "Good Experience", urlSlug: "/good" },
          ],
        },
      ],
    };
    const results = sanitizeHeadoutResponse(raw);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Good Experience");
  });
});

describe("isRelevantCard", () => {
  it("accepts a product matching the compact query and location", () => {
    expect(
      isRelevantCard(
        {
          ...BASE_CARD,
          city: { code: "PARIS", displayName: "Paris" },
          country: { code: "FR", displayName: "France" },
        },
        { query: "Eiffel Tower", location: "Paris, France" },
      ),
    ).toBe(true);
  });

  it("rejects a generic trail result for an Inca Trail query", () => {
    expect(
      isRelevantCard(
        {
          ...BASE_CARD,
          displayName: "Wadi Mujib Siq Trail Hike to the Waterfall",
          city: { code: "AMMAN", displayName: "Amman" },
          country: { code: "JO", displayName: "Jordan" },
        },
        { query: "Inca Trail", location: "Peru" },
      ),
    ).toBe(false);
  });

  it("allows word-form variations such as skydive and skydiving", () => {
    expect(
      isRelevantCard(
        { ...BASE_CARD, displayName: "Skydive Dubai Tandem Experience" },
        { query: "Skydiving" },
      ),
    ).toBe(true);
  });

  it("does not require location overlap when Headout omits location metadata", () => {
    expect(isRelevantCard(BASE_CARD, { query: "Eiffel Tower", location: "Paris" })).toBe(true);
  });
});
