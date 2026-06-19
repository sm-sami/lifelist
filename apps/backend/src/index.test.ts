import { describe, expect, it } from "vitest";
import app from "./index";

describe("GET /health", () => {
  it("returns a successful health payload", async () => {
    const response = await app.request("/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      ts: expect.any(Number),
    });
  });
});
