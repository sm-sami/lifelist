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

const SITE_BASE = "https://www.headout.com";
const BOOKING_HOSTS = new Set(["headout.com", "www.headout.com"]);

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

export function sanitizeHeadoutResponse(raw: unknown): Experience[] {
  const data = raw as HeadoutSearchResponse;
  const cards = data.results?.find((group) => group.type === "PRODUCT")?.values ?? [];
  return cards.map((c) => sanitizeCard(c)).filter((e): e is Experience => e !== null);
}
