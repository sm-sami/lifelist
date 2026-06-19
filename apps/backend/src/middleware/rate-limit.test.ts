import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../types";
import { rateLimit } from "./rate-limit";

let testUserId = "u0";

function makeApp(max: number, windowMs: number) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", testUserId);
    c.set("userEmail", "");
    await next();
  });
  app.use("/limited", rateLimit({ max, windowMs }));
  app.get("/limited", (c) => c.json({ ok: true }));
  // Mirror the onError handler from src/index.ts so HTTPException becomes JSON.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    return c.json({ error: "Internal Server Error" }, 500);
  });
  return app;
}

beforeEach(() => {
  // Fresh userId per test — avoids shared-Map bleed between tests.
  testUserId = `test-user-${Math.random()}`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rateLimit", () => {
  it("allows requests up to the max", async () => {
    const app = makeApp(3, 60_000);
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/limited");
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 after the bucket is exhausted", async () => {
    const app = makeApp(2, 60_000);
    await app.request("/limited");
    await app.request("/limited");
    const res = await app.request("/limited");
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
  });

  it("sets the Retry-After header on 429", async () => {
    const app = makeApp(0, 30_000);
    const res = await app.request("/limited");
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(30);
  });

  it("resets the bucket after the window expires", async () => {
    const now = Date.now();
    const spy = vi.spyOn(Date, "now");
    spy.mockReturnValue(now);

    const app = makeApp(1, 1_000);
    await app.request("/limited"); // consume the one token
    expect((await app.request("/limited")).status).toBe(429);

    // Advance past the window
    spy.mockReturnValue(now + 1_001);
    expect((await app.request("/limited")).status).toBe(200);
  });
});
