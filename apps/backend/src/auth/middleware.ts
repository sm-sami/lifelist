import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types";
import { verifySupabaseToken } from "./verify-token";

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = extractBearer(c.req.header("Authorization"));
  if (!token) {
    throw new HTTPException(401, { message: "unauthorized_missing_token" });
  }

  const result = await verifySupabaseToken(token);
  if (!result.ok) {
    throw new HTTPException(result.reason === "unavailable" ? 503 : 401, {
      message: result.reason === "unavailable" ? "auth_verifier_unavailable" : "token_invalid",
    });
  }

  c.set("userId", result.payload.sub);
  c.set("userEmail", result.payload.email ?? "");
  await next();
});
