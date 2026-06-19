import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const GOOD_RESPONSE = {
  results: [
    {
      type: "PRODUCT",
      values: [{ id: 1, displayName: "Eiffel Tower Tour", urlSlug: "/eiffel" }],
    },
  ],
};

// Mock global fetch before importing client so env-level setup is correct.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { searchExperiences, assertAllowedHost, _testCache } = await import("./client");

function okResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.resetAllMocks();
  _testCache.clear();
});

afterEach(() => {
  _testCache.clear();
});

describe("searchExperiences", () => {
  it("fetches from Headout and returns sanitized experiences", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(GOOD_RESPONSE));

    const results = await searchExperiences({ query: "Eiffel Tower", limit: 6 });
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Eiffel Tower Tour");
    expect(results[0].bookingUrl).toBe("https://www.headout.com/eiffel");
    expect(results[0]).not.toHaveProperty("id");

    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.hostname).toBe("search.headout.com");
    expect(url.searchParams.get("query")).toBe("Eiffel Tower");
  });

  it("normalizes bucket-list intent before querying Headout", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(GOOD_RESPONSE));

    await searchExperiences({ query: "Visit the Eiffel Tower", limit: 6 });

    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.searchParams.get("query")).toBe("Eiffel Tower");
  });

  it("returns cached result on second call without re-fetching", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(GOOD_RESPONSE));

    await searchExperiences({ query: "Eiffel Tower", limit: 6 });
    const second = await searchExperiences({ query: "Eiffel Tower", limit: 6 });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second).toHaveLength(1);
  });

  it("passes the city param when provided", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(GOOD_RESPONSE));

    await searchExperiences({ query: "Tour", city: "PARIS", limit: 3 });

    const [url] = mockFetch.mock.calls[0] as [URL];
    expect(url.searchParams.get("city")).toBe("PARIS");
    expect(url.searchParams.get("limit")).toBe("3");
  });

  it("slices results to the requested limit", async () => {
    const manyValues = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      displayName: `Tour ${i}`,
      urlSlug: `/tour-${i}`,
    }));
    mockFetch.mockResolvedValueOnce(
      okResponse({ results: [{ type: "PRODUCT", values: manyValues }] }),
    );

    const results = await searchExperiences({ query: "Tour", limit: 3 });
    expect(results).toHaveLength(3);
  });

  it("throws on non-ok upstream response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    await expect(searchExperiences({ query: "Tokyo" })).rejects.toThrow("Headout upstream 503");
  });

  it("assertAllowedHost throws for disallowed hosts before fetch", () => {
    expect(() => assertAllowedHost(new URL("http://169.254.169.254/api/v3/search/"))).toThrow(
      "Outbound host not allowed: 169.254.169.254",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
