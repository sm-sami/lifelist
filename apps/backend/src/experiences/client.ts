import { sanitizeHeadoutResponse } from "./sanitize";
import type { Experience } from "./types";

const BASE = process.env.HEADOUT_SEARCH_BASE ?? "https://search.headout.com";
const PATH = process.env.HEADOUT_SEARCH_PATH ?? "/api/v3/search/";
const CURRENCY = process.env.HEADOUT_CURRENCY ?? "USD";
const LANGUAGE = process.env.HEADOUT_LANGUAGE ?? "en";

const ALLOWED_HOSTS = new Set<string>(["search.headout.com"]);

export function assertAllowedHost(url: URL): void {
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Outbound host not allowed: ${url.hostname}`);
  }
}

const TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 500;
const cache = new Map<string, { at: number; data: Experience[] }>();

function cacheSet(key: string, data: Experience[]): void {
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
  query: string;
  city?: string;
  limit?: number;
}

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

  assertAllowedHost(url);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Origin: "https://www.headout.com",
      Referer: "https://www.headout.com/",
      "User-Agent": "Lifelist/1.0 (+https://www.headout.com)",
    },
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

export { cache as _testCache };
