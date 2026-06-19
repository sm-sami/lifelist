import { canonicalizeBucketTitle, getDeterministicItemMetadata } from "../ai/title";

const LEADING_INTENT =
  /^(?:(?:i(?:'d| would)? like to|i want to|my (?:dream|goal) is to|bucket list:?)\s+|(?:visit|see|experience|explore|discover|go to|travel to|learn to|hike|climb|watch|try|do)\s+|take\s+(?:(?:a|an|the)\s+)?)/i;

/**
 * Best-effort fallback for old items that predate AI-generated search metadata.
 * New items should normally use their stored experienceSearchQuery.
 */
export function normalizeExperienceQuery(title: string): string {
  const deterministic = getDeterministicItemMetadata(title);
  if (deterministic?.experienceSearchQuery) return deterministic.experienceSearchQuery;

  let query = title.trim().replace(/\s+/g, " ");
  const canonical = canonicalizeBucketTitle(query);
  if (canonical === "burj khalifa") return "Burj Khalifa";
  if (canonical === "northern lights") return "Northern Lights";

  let previous = "";
  while (query !== previous) {
    previous = query;
    query = query.replace(LEADING_INTENT, "").trim();
  }
  return (
    query
      .replace(/^the\s+/i, "")
      .replace(/\s+in\s+/gi, " ")
      .trim() || title.trim()
  );
}
