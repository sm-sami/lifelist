import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types";

interface Bucket {
  tokens: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function sweepAndCap(now: number) {
  for (const [k, v] of buckets) {
    if (now >= v.resetAt) buckets.delete(k);
  }
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

export function rateLimit(opts: { max: number; windowMs: number }) {
  const { max, windowMs } = opts;
  return createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.get("userId");
    const now = Date.now();
    const key = userId;
    let b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      sweepAndCap(now);
      b = { tokens: max, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    if (b.tokens <= 0) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      throw new HTTPException(429, { message: "rate_limited" });
    }
    b.tokens -= 1;
    await next();
  });
}
