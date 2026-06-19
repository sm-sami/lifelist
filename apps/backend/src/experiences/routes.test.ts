import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";

vi.mock("./client", () => ({ searchExperiences: vi.fn() }));
vi.mock("../middleware/rate-limit", () => ({
  rateLimit: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

const { searchExperiences } = await import("./client");
const { experiencesRoutes } = await import("./routes");

const mockSearch = vi.mocked(searchExperiences);

const FAKE_EXPERIENCE = {
  title: "Eiffel Tower Tour",
  description: "",
  priceToken: "See price",
  rating: null,
  bookingUrl: "https://www.headout.com/eiffel",
};

function makeApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", "user-001");
    c.set("userEmail", "test@example.com");
    await next();
  });
  app.route("/api/experiences", experiencesRoutes);
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    return c.json({ error: "Internal Server Error" }, 500);
  });
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/experiences", () => {
  it("returns sanitized experiences with correct envelope", async () => {
    mockSearch.mockResolvedValueOnce([FAKE_EXPERIENCE]);

    const res = await makeApp().request("/api/experiences?q=Eiffel+Tower");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query).toBe("Eiffel Tower");
    expect(body.count).toBe(1);
    expect(body.experiences[0]).toEqual(FAKE_EXPERIENCE);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
  });

  it("forwards city and limit params to searchExperiences", async () => {
    mockSearch.mockResolvedValueOnce([FAKE_EXPERIENCE]);

    await makeApp().request("/api/experiences?q=Tour&city=PARIS&limit=3");

    expect(mockSearch).toHaveBeenCalledWith({
      query: "Tour",
      city: "PARIS",
      location: undefined,
      limit: 3,
    });
  });

  it("returns 400 when q is missing", async () => {
    const res = await makeApp().request("/api/experiences");
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is too long (>120 chars)", async () => {
    const longQ = "a".repeat(121);
    const res = await makeApp().request(`/api/experiences?q=${longQ}`);
    expect(res.status).toBe(400);
  });

  it("returns 502 with empty list on upstream failure", async () => {
    mockSearch.mockRejectedValueOnce(new Error("Headout upstream 503"));

    const res = await makeApp().request("/api/experiences?q=Paris");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.experiences).toEqual([]);
    expect(body.error).toBe("upstream_unavailable");
  });

  it("returns an empty list (not 502) when upstream returns no results", async () => {
    mockSearch.mockResolvedValueOnce([]);

    const res = await makeApp().request("/api/experiences?q=VeryObscureQuery");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.experiences).toEqual([]);
  });
});
