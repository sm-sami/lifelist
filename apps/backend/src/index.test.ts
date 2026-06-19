import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock modules that throw at load time when env vars are absent.
// vi.mock is hoisted above imports by Vitest, so these run before src/index loads.
vi.mock("./auth/verify-token", () => ({
  verifySupabaseToken: vi.fn(),
}));
// Items routes pull in embed (throws without OPENAI_API_KEY), supabase clients, etc.
// Replace with an empty Hono-compatible stub so index.test stays focused on auth middleware.
vi.mock("./items/routes", () => ({ itemsRoutes: { routes: [] } }));

import { verifySupabaseToken } from "./auth/verify-token";
import app from "./index";

const mockVerify = vi.mocked(verifySupabaseToken);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /health", () => {
  it("returns 200 without a token", async () => {
    const res = await app.request("/health");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, ts: expect.any(Number) });
  });
});

describe("GET /api/me — auth middleware", () => {
  it("returns 401 when Authorization header is absent", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized_missing_token");
  });

  it("returns 401 when Authorization header is malformed (no Bearer scheme)", async () => {
    const res = await app.request("/api/me", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    mockVerify.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    const res = await app.request("/api/me", {
      headers: { Authorization: "Bearer bad.token.here" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("token_invalid");
  });

  it("returns 503 when auth verifier is unavailable", async () => {
    mockVerify.mockResolvedValueOnce({ ok: false, reason: "unavailable" });
    const res = await app.request("/api/me", {
      headers: { Authorization: "Bearer any.token" },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("auth_verifier_unavailable");
  });

  it("returns 200 with userId and email for a valid token", async () => {
    mockVerify.mockResolvedValueOnce({
      ok: true,
      payload: { sub: "user-uuid-123", email: "test@example.com" },
    });
    const res = await app.request("/api/me", {
      headers: { Authorization: "Bearer valid.jwt.token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ userId: "user-uuid-123", email: "test@example.com" });
  });

  it("returns 200 for email-less (phone-auth) user with empty email string", async () => {
    mockVerify.mockResolvedValueOnce({
      ok: true,
      payload: { sub: "phone-user-uuid", phone: "+15555550100" },
    });
    const res = await app.request("/api/me", {
      headers: { Authorization: "Bearer valid.jwt.token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ userId: "phone-user-uuid", email: "" });
  });
});
