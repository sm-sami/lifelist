import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { db } from "../../db/client";
import { users } from "../../db/schema";
import type { AppEnv } from "../types";
import { resolveAvatarUrl, resolveDisplayName } from "./avatar";
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
    if (result.reason === "unavailable") {
      throw new HTTPException(503, { message: "auth_verifier_unavailable" });
    }
    throw new HTTPException(401, { message: "token_invalid" });
  }

  const { sub: userId, email } = result.payload;

  await db
    .insert(users)
    .values({
      id: userId,
      email: email ?? null,
      displayName: resolveDisplayName(result.payload),
      avatarUrl: resolveAvatarUrl(result.payload),
    })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: email ?? null, updatedAt: new Date() },
    });

  c.set("userId", userId);
  c.set("userEmail", email ?? "");

  await next();
});
