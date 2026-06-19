# Backend 005 — Headout Search Proxy Endpoints

> Phase 5 of the Lifelist backend. Exposes a single clean, typed proxy —
> `GET /api/experiences` — that queries Headout's global search service
> (`search.headout.com/api/v3/search/`) server-side, strips the verbose native payload
> down to exactly the five fields the item-detail panel needs, and returns a
> strictly-typed array. We proxy for sanitization, caching, and a stable contract — the
> search endpoint itself is public.

---

## 🎯 Objective

1. Provide a Hono proxy controller `GET /api/experiences?q=<query>&city=<optional>&limit=<n>`
   that forwards the item title as a free-text query to Headout's v3 search service.
2. Implement a **sanitization layer** that consumes the verbose search JSON and returns
   only: `title`, `description`, `priceToken`, `rating`, and `bookingUrl`.
3. Add short-lived caching to speed up repeat lookups (the detail panel re-queries on
   open) and shield the upstream from bursts.
4. Fail gracefully: upstream errors map to a clean, typed empty/`502` response — the
   UI degrades to "no live experiences" rather than crashing.

---

## 💻 Code & Configuration Blueprints

> ✅ **Live contract verified June 19, 2026:** Headout's global search service (the public
> `next-deimos` search backend, *not* the deprecated `headout/api-docs` Partner v2).
> Key facts that shape this phase:
> - **Endpoint:** `GET https://search.headout.com/api/v3/search/`
>   (base = `NEXT_PUBLIC_API_CDN_BASE_URL_SEARCH`, resolves to `https://search.headout.com`).
>   POST is rejected by the CDN with 403.
> - **Free-text search exists.** It's **keyword-based 4-gram (n-gram) matching** — so we
>   pass the item **title** as `query` (no city extraction required). Semantic/vector
>   search via Algolia Neural Search is being trialed in dev
>   (`semantic.deimos.dev-headout.com`) but is **not yet in production** — design
>   against keyword matching for now.
> - **Params:** `query` (search string), `language`/`lang`, `city`/`cityCode`
>   (optional filter), `limit`, `currency`.
> - **Auth:** this is the same public endpoint the website's browser calls
>   (`NEXT_PUBLIC_*`), so it needs no secret key. We still proxy it through Hono for
>   **response sanitization, caching, a stable typed contract, and rate-limit control** —
>   not for secrecy. Confirm whether it expects an `Origin`/`Referer`/`User-Agent`.
> - **Response:** `{results:[{type:"PRODUCT"|"COLLECTION"|"CITY",values:[…]}]}`.
>   Product cards currently expose `id`, `displayName`, `city`, `country`, `imageUrl`,
>   and relative `urlSlug`. They do not include description, price, or rating, so the
>   stable DTO intentionally returns `description:""`, `priceToken:"See price"`, and
>   `rating:null` until a documented product-detail source is deliberately added.

### 1. Env additions

| Variable               | Value                                                | Notes                                          |
| ---------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| `HEADOUT_SEARCH_BASE`  | `https://search.headout.com`                         | = `NEXT_PUBLIC_API_CDN_BASE_URL_SEARCH`. No trailing slash. |
| `HEADOUT_SEARCH_PATH`  | `/api/v3/search/`                                    | Search endpoint path (GET).                    |
| `HEADOUT_CURRENCY`     | `USD`                                                | Passed as `currency`.                          |
| `HEADOUT_LANGUAGE`     | `en`                                                 | Passed as `language`.                          |

### 2. Strict output contract — `src/experiences/types.ts`

`Experience`/`ExperienceSchema` are **canonical** and live in `packages/shared` (the
anti-drift layer — see `000-conventions-and-tooling.md` §7). We **import** them here
rather than redefining, so the backend and the mobile client validate against the exact
same schema. This file only adds the proxy's response envelope.

```ts
// src/experiences/types.ts
import { z } from "zod";
// Canonical Experience contract — defined ONCE in packages/shared, imported by both apps.
import { ExperienceSchema, type Experience } from "@lifelist/shared";

export { ExperienceSchema };
export type { Experience };

/**
 * The response envelope for GET /api/experiences. `experiences` is an array of the
 * shared Experience shape — the ONLY shape the client ever sees. Search currently lacks
 * commercial metadata, so `priceToken` is "See price" and `rating` is null.
 */
export const ExperiencesResponseSchema = z.object({
  query: z.string(),
  count: z.number(),
  experiences: z.array(ExperienceSchema),
});

export type ExperiencesResponse = z.infer<typeof ExperiencesResponseSchema>;
```

> Reminder: do NOT re-declare `ExperienceSchema` locally. If the contract changes, edit
> `packages/shared/src/dto.ts` once and both apps' typechecks enforce it. The sanitizer
> below stays here because it knows the upstream shape — only the *output* type is shared.

### 3. Sanitization layer — `src/experiences/sanitize.ts`

```ts
// src/experiences/sanitize.ts
import type { Experience } from "./types";

/**
 * Pinned to the live v3 grouped response. This is the ONLY file that knows the upstream
 * shape. Only PRODUCT values become bookable experiences.
 */
interface HeadoutSearchCard {
  id: number;
  displayName: string;
  city?: { code: string; displayName: string };
  country?: { code: string; displayName: string };
  imageUrl?: string;
  urlSlug: string;
}

interface HeadoutSearchResponse {
  results?: Array<{ type?: string; values?: HeadoutSearchCard[] }>;
}

const SITE_BASE = "https://www.headout.com";
const BOOKING_HOSTS = new Set(["headout.com", "www.headout.com"]);

function buildBookingUrl(c: HeadoutSearchCard): string | null {
  const base = `${SITE_BASE}${c.urlSlug.startsWith("/") ? "" : "/"}${c.urlSlug}`;
  const u = new URL(base);
  if (u.protocol !== "https:" || !BOOKING_HOSTS.has(u.hostname)) return null;
  return u.toString();
}

/**
 * Maps one search card → our Experience, or null if it lacks the minimum fields
 * (title + a resolvable URL). Nulls are filtered out by the caller.
 */
export function sanitizeCard(
  c: HeadoutSearchCard,
): Experience | null {
  const bookingUrl = buildBookingUrl(c);
  if (!c.displayName?.trim() || !bookingUrl) return null;

  return {
    title: c.displayName.trim(),
    description: "",
    priceToken: "See price",
    rating: null,
    bookingUrl,
  };
}

/** Pulls product cards from whichever bucket v3 search used, then sanitizes each. */
export function sanitizeHeadoutResponse(
  raw: unknown,
): Experience[] {
  const data = raw as HeadoutSearchResponse;
  const cards = data.results?.find((group) => group.type === "PRODUCT")?.values ?? [];
  return cards
    .map((c) => sanitizeCard(c))
    .filter((e): e is Experience => e !== null);
}
```

### 4. Headout client + tiny TTL cache — `src/experiences/client.ts`

```ts
// src/experiences/client.ts
import { sanitizeHeadoutResponse } from "./sanitize";
import type { Experience } from "./types";

const BASE = process.env.HEADOUT_SEARCH_BASE ?? "https://search.headout.com";
const PATH = process.env.HEADOUT_SEARCH_PATH ?? "/api/v3/search/";
const CURRENCY = process.env.HEADOUT_CURRENCY ?? "USD";
const LANGUAGE = process.env.HEADOUT_LANGUAGE ?? "en";

/**
 * OUTBOUND HOSTNAME ALLOWLIST (SSRF/abuse guard). This proxy must only ever talk to the
 * known Headout search host. Even though BASE comes from our own env, we re-validate the
 * fully-built URL's hostname against this set before every fetch — so a misconfigured env
 * var, a future code path, or an injected base can never make the serverless fn fetch an
 * arbitrary internal/external host on the caller's behalf. Add hosts here only when a new
 * trusted upstream is deliberately introduced.
 */
const ALLOWED_HOSTS = new Set<string>(["search.headout.com"]);

function assertAllowedHost(url: URL): void {
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Outbound host not allowed: ${url.hostname}`);
  }
}

// In-memory TTL cache. Per-instance only (Vercel warm functions); good enough to
// absorb the detail-panel's re-query on open and shield the upstream from bursts.
// BOUNDED: a long-lived warm instance could otherwise accumulate an entry per unique
// query forever, leaking memory. We cap entries and evict the oldest (insertion-order
// Map = cheap FIFO) once over the cap, in addition to per-entry TTL expiry.
const TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map<string, { at: number; data: Experience[] }>();

function cacheSet(key: string, data: Experience[]): void {
  // Evict expired entries opportunistically, then enforce the hard cap (FIFO).
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.at >= TTL_MS) cache.delete(k);
  }
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, { at: now, data });
}

export interface ExperienceQuery {
  query: string; // free-text — the item title (v3 search is 4-gram keyword matching)
  city?: string; // optional city/cityCode filter
  limit?: number;
}

/**
 * Free-text GET against Headout's v3 search service. No secret key: this is the same
 * public endpoint the website calls.
 */
export async function searchExperiences({
  query,
  city,
  limit = 6,
}: ExperienceQuery): Promise<Experience[]> {
  const cacheKey = `${query.toLowerCase()}:${city ?? ""}:${limit}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const url = new URL(`${BASE}${PATH}`);
  url.searchParams.set("query", query);
  url.searchParams.set("language", LANGUAGE);
  url.searchParams.set("currency", CURRENCY);
  url.searchParams.set("limit", String(limit));
  if (city) url.searchParams.set("city", city);

  // SSRF guard: never fetch a host that isn't explicitly allowlisted.
  assertAllowedHost(url);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Origin: "https://www.headout.com",
      Referer: "https://www.headout.com/",
      "User-Agent": "Lifelist/1.0 (+https://www.headout.com)",
    },
    // Tight timeout so a slow upstream doesn't hang the serverless fn.
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) {
    throw Object.assign(new Error(`Headout upstream ${res.status}`), {
      upstreamStatus: res.status,
    });
  }

  const raw = await res.json();
  const experiences = sanitizeHeadoutResponse(raw).slice(0, limit);
  cacheSet(cacheKey, experiences);
  return experiences;
}
```

### 5. The route — `src/experiences/routes.ts`

```ts
// src/experiences/routes.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { AppEnv } from "../types";
import { searchExperiences } from "./client";
import { ExperiencesResponseSchema } from "./types";
import { rateLimit } from "../middleware/rate-limit"; // shared limiter from backend/004 §8

export const experiencesRoutes = new Hono<AppEnv>();

// Per-user rate limit — this route hits the upstream Headout search on every call.
// 30 req/min matches the item routes; swap for Upstash Ratelimit in prod (backend/004 §8).
experiencesRoutes.use("/", rateLimit({ max: 30, windowMs: 60_000 }));

const querySchema = z.object({
  q: z.string().trim().min(1).max(120),
  city: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional().default(6),
});

/**
 * GET /api/experiences?q=Visit+the+Eiffel+Tower&city=PARIS&limit=6
 * Forwards the item title as a free-text query to Headout v3 search. Returns ONLY the
 * sanitized, strictly-typed experiences array. On upstream failure returns 502 with an
 * empty list so the UI can show a graceful fallback.
 */
experiencesRoutes.get("/", zValidator("query", querySchema), async (c) => {
  const { q, city, limit } = c.req.valid("query");
  try {
    const experiences = await searchExperiences({ query: q, city, limit });
    const body = ExperiencesResponseSchema.parse({
      query: q,
      count: experiences.length,
      experiences,
    });
    // Authenticated, user-scoped route: never place it in a shared public cache.
    c.header("Cache-Control", "private, max-age=60");
    return c.json(body);
  } catch (err) {
    console.error("[experiences] upstream failure", err);
    return c.json(
      { query: q, count: 0, experiences: [], error: "upstream_unavailable" },
      502,
    );
  }
});
```

Mount in `src/index.ts`:

```ts
import { experiencesRoutes } from "./experiences/routes";
app.route("/api/experiences", experiencesRoutes);
```

### 6. Integration: free-text by default, city as an optional booster

Because v3 search takes free text, the default needs no extra plumbing — `frontend/004`'s
`useExperiences` already calls `/experiences?q=${item.title}`. Two optional enhancements:

- **City filter (optional):** if you later extract a city during LLM classification
  (`backend/004`) and store it on the item, pass it as `&city=${item.city}` to tighten
  results. Not required — leave it out and search runs title-only.
- **Result quality:** keyword 4-gram matching does best with concrete nouns. The
  `imageKeywords` the classifier already produces (`backend/004`) make a good alternate
  query if the raw title is too verbose — e.g. search `"eiffel tower paris"` rather than
  `"I want to finally visit the Eiffel Tower someday"`. Consider passing
  `imageKeywords.join(" ")` as the query when the title exceeds ~6 words.
- **Future semantic search:** when Algolia Neural Search ships to prod, only
  `client.ts` changes (swap the path/params) — the sanitizer, route, and frontend stay
  identical.

---

## 🚶 Step-by-Step Execution Guide

1. **Add env vars** (`HEADOUT_SEARCH_BASE`, `HEADOUT_SEARCH_PATH`, `HEADOUT_CURRENCY`,
   `HEADOUT_LANGUAGE`) to `.env.local` and Vercel. No secret key — the v3 search endpoint
   is public.

2. **Wire the contract** `src/experiences/types.ts` (§2) — **import** `Experience`/
   `ExperienceSchema` from `@lifelist/shared` (do NOT redefine them) and add the response
   envelope. Ensure `@lifelist/shared` is a workspace dependency of the backend.

3. **Build the sanitizer** `src/experiences/sanitize.ts` (§3). This is the only file
   that knows the pinned grouped upstream shape.

4. **Add the client + cache** `src/experiences/client.ts` (§4) — GET with query-string
   params, browser-compatible headers, 6s timeout, and a 5-minute TTL cache. Note two
   hardening details: the
   **outbound hostname allowlist** (`assertAllowedHost` — the proxy only ever fetches
   `search.headout.com`, an SSRF guard) and the **bounded cache** (TTL sweep + hard
   `MAX_CACHE_ENTRIES` cap so a warm instance can't leak memory). The shared rate-limit
   bucket map (backend/004 §8) is likewise bounded.

5. **Add the route** `src/experiences/routes.ts` (§5) with `q` validation, the per-user
   **rate limiter** (shared from backend/004 §8), and the graceful 502 fallback. Mount
   under `/api/experiences`.

6. **Run** `pnpm dev` and exercise verification.

---

## 🧪 Verification & Test Protocols

### A. Happy path — sanitized array only

```bash
TOKEN="<valid supabase jwt>"
curl -s "http://localhost:3000/api/experiences?q=Eiffel%20Tower&limit=3" \
  -H "Authorization: Bearer $TOKEN" | jq
# {
#   "query":"Eiffel Tower","count":3,
#   "experiences":[
#     {"title":"...","description":"","priceToken":"See price","rating":null,
#      "bookingUrl":"https://www.headout.com/...?aff=..."}, ...
#   ]
# }
```

Assert no extra keys leaked:

```bash
curl -s "http://localhost:3000/api/experiences?q=Tokyo" -H "Authorization: Bearer $TOKEN" \
 | jq '.experiences[0] | keys'
# ["bookingUrl","description","priceToken","rating","title"]  ← exactly five
```

### B. Validation — missing q is 400

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/experiences" \
  -H "Authorization: Bearer $TOKEN"
# 400
```

### C. Auth required (401)

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/experiences?q=Paris"
# 401  (the /api/* authMiddleware from backend/002 protects this route)
```

### D. Sanitizer unit test (no network)

```ts
// _sanitize_smoke.ts — pinned Headout v3 grouped response
import { sanitizeHeadoutResponse } from "./src/experiences/sanitize";
const raw = {
  results: [
    {
      type: "PRODUCT",
      values: [
        {
          id: 12345,
          displayName: "Skip-the-Line: Eiffel Tower Summit",
          city: { code: "PARIS", displayName: "Paris" },
          country: { code: "FR", displayName: "France" },
          imageUrl: "https://cdn-imgix.headout.com/example.jpg",
          urlSlug: "/paris/eiffel-tower-summit",
        },
      ],
    },
    { type: "COLLECTION", values: [] },
  ],
};
console.log(JSON.stringify(sanitizeHeadoutResponse(raw), null, 2));
// One experience: description "", priceToken "See price", rating null,
// bookingUrl "https://www.headout.com/paris/eiffel-tower-summit".
// Upstream id/city/country/imageUrl and non-PRODUCT groups do not leak.
```

```bash
pnpm tsx _sanitize_smoke.ts
```

### E. Cache + graceful degradation

- Hit the same `q` twice quickly; the second response should be near-instant (served
  from the TTL cache). Confirm via timing or a temporary cache-hit log line.
- Temporarily point `HEADOUT_SEARCH_BASE` at an invalid host and confirm the endpoint
  returns `{"count":0,"experiences":[],"error":"upstream_unavailable"}` with status
  `502` — never a 500 stack trace.

### E2. Outbound hostname allowlist (SSRF guard)

Point `HEADOUT_SEARCH_BASE` at a host NOT in `ALLOWED_HOSTS` (e.g.
`http://169.254.169.254` or any non-Headout host) and confirm the client throws before any
fetch leaves the box — the route then returns the graceful `502` fallback, and no request
is ever made to the disallowed host:

```bash
# With HEADOUT_SEARCH_BASE=http://169.254.169.254 (a metadata endpoint — must NOT be hit):
curl -s -o /tmp/s.json -w "%{http_code}\n" "http://localhost:3000/api/experiences?q=paris" \
  -H "Authorization: Bearer $TOKEN"
# 502 ; cat /tmp/s.json → {"query":"paris","count":0,"experiences":[],"error":"upstream_unavailable"}
# Server log shows "Outbound host not allowed: 169.254.169.254" — the fetch never fired.
```

### F. Rate limit (429 past the bucket)

```bash
for i in $(seq 1 31); do
  curl -s -o /dev/null -w "%{http_code} " "http://localhost:3000/api/experiences?q=paris" \
    -H "Authorization: Bearer $TOKEN"
done; echo
# The last code should be 429 once the 30/min per-user bucket drains.
```

✅ **Phase complete when:** the pinned live GET contract remains covered by a sanitizer
fixture, the endpoint
returns exactly the five sanitized fields (validated against the shared `Experience`
schema imported from `@lifelist/shared`), rejects unauthenticated/invalid requests,
applies the per-user rate limit (429 past the bucket), drops malformed upstream products,
caches repeat queries in a **bounded** cache (TTL sweep + hard cap), only ever fetches an
**allowlisted** outbound host (SSRF guard), and degrades gracefully on upstream failure.

---

### ✅ Phase gate (Definition of Done)

Run the shared workspace gate from [`000-conventions-and-tooling.md`](../000-conventions-and-tooling.md) before starting the next phase:

```bash
pnpm gate          # tsc --noEmit (all packages) + biome lint + biome format check
pnpm -r test       # any unit tests added in this phase
```

Both must exit `0`. The same gate runs in CI on every push, and a pre-commit hook runs it on staged files — this is how type-safety and style stay consistent across phases.
