import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { db } from "../db/client";
import { users } from "../db/schema";
import { DuplicateItemError } from "./ai/errors";
import { authMiddleware } from "./auth/middleware";
import { experiencesRoutes } from "./experiences/routes";
import { itemsRoutes } from "./items/routes";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin,
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

app.use("/api/*", authMiddleware);

app.get("/api/me", async (c) => {
  const userId = c.get("userId");
  const email = c.get("userEmail");
  const [row] = await db
    .select({ displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, userId));
  return c.json({
    userId,
    email,
    displayName: row?.displayName ?? null,
    avatarUrl: row?.avatarUrl ?? null,
  });
});

app.route("/api/items", itemsRoutes);
app.route("/api/experiences", experiencesRoutes);

app.onError((err, c) => {
  if (err instanceof DuplicateItemError) {
    return err.getResponse();
  }
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("[unhandled]", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
