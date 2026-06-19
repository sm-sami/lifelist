import type { Experience } from "./types";

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

interface RelevanceContext {
  query: string;
  location?: string;
}

const SITE_BASE = "https://www.headout.com";
const BOOKING_HOSTS = new Set(["headout.com", "www.headout.com"]);
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "do",
  "experience",
  "go",
  "in",
  "of",
  "see",
  "the",
  "to",
  "tour",
  "visit",
  "with",
]);

function tokens(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .normalize("NFKD")
        .replace(/\p{M}+/gu, "")
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 1 && !STOP_WORDS.has(token)),
    ),
  ];
}

function tokenMatches(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  if (left.startsWith(right) || right.startsWith(left)) return true;
  if (left.endsWith("ing") && `${left.slice(0, -3)}e` === right) return true;
  if (right.endsWith("ing") && `${right.slice(0, -3)}e` === left) return true;
  return false;
}

function overlapCount(needles: string[], haystack: string[]): number {
  return needles.filter((needle) => haystack.some((token) => tokenMatches(needle, token))).length;
}

export function isRelevantCard(c: HeadoutSearchCard, context: RelevanceContext): boolean {
  const queryTokens = tokens(context.query);
  const candidateTokens = tokens(
    [c.displayName, c.city?.displayName, c.country?.displayName].filter(Boolean).join(" "),
  );
  if (queryTokens.length > 0) {
    const requiredMatches = Math.min(2, queryTokens.length);
    if (overlapCount(queryTokens, candidateTokens) < requiredMatches) return false;
  }

  const locationTokens = context.location ? tokens(context.location) : [];
  const hasLocationMetadata = Boolean(c.city?.displayName || c.country?.displayName);
  if (
    hasLocationMetadata &&
    locationTokens.length > 0 &&
    overlapCount(locationTokens, candidateTokens) === 0
  ) {
    return false;
  }
  return true;
}

function buildBookingUrl(c: HeadoutSearchCard): string | null {
  const base = `${SITE_BASE}${c.urlSlug.startsWith("/") ? "" : "/"}${c.urlSlug}`;
  const u = new URL(base);
  if (u.protocol !== "https:" || !BOOKING_HOSTS.has(u.hostname)) return null;
  return u.toString();
}

export function sanitizeCard(c: HeadoutSearchCard): Experience | null {
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

export function sanitizeHeadoutResponse(raw: unknown, context?: RelevanceContext): Experience[] {
  const data = raw as HeadoutSearchResponse;
  const cards = data.results?.find((group) => group.type === "PRODUCT")?.values ?? [];
  return cards
    .filter((card) => !context || isRelevantCard(card, context))
    .map((c) => sanitizeCard(c))
    .filter((e): e is Experience => e !== null);
}
