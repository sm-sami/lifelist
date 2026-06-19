import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { rateLimit } from "../middleware/rate-limit";
import type { AppEnv } from "../types";
import { searchExperiences } from "./client";
import { ExperiencesResponseSchema } from "./types";

export const experiencesRoutes = new Hono<AppEnv>();

experiencesRoutes.use("/", rateLimit({ max: 30, windowMs: 60_000 }));

const querySchema = z.object({
  q: z.string().trim().min(1).max(120),
  city: z.string().trim().max(40).optional(),
  location: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional().default(6),
});

experiencesRoutes.get("/", zValidator("query", querySchema), async (c) => {
  const { q, city, location, limit } = c.req.valid("query");
  try {
    const experiences = await searchExperiences({ query: q, city, location, limit });
    const body = ExperiencesResponseSchema.parse({
      query: q,
      count: experiences.length,
      experiences,
    });
    c.header("Cache-Control", "private, max-age=60");
    return c.json(body);
  } catch (err) {
    console.error("[experiences] upstream failure", err);
    return c.json({ query: q, count: 0, experiences: [], error: "upstream_unavailable" }, 502);
  }
});
