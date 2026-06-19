import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { DuplicateItemError } from "./ai/errors";
import { authMiddleware } from "./auth/middleware";
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

app.get("/api/me", (c) => c.json({ userId: c.get("userId"), email: c.get("userEmail") }));

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
