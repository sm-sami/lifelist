const LEADING_INTENT =
  /^(?:(?:i(?:'d| would)? like to|i want to|my (?:dream|goal) is to|bucket list:?)\s+|(?:visit|see|experience|explore|discover|go to|travel to|learn to|hike|climb|watch|try|do)\s+|take\s+(?:(?:a|an|the)\s+)?)/i;

function baseNormalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ");
}

function applyKnownAliases(value: string): string {
  return value
    .replace(/\baurora borealis\b/g, "northern lights")
    .replace(/\bworld'?s tallest (?:building|tower|skyscraper)\b/g, "burj khalifa")
    .replace(
      /\btallest (?:building|tower|skyscraper) (?:on|in) (?:the )?(?:earth|world|planet)\b/g,
      "burj khalifa",
    )
    .replace(/\btallest (?:building|tower|skyscraper)\b/g, "burj khalifa");
}

function stripIntent(value: string): string {
  let query = value.trim();
  let previous = "";
  while (query !== previous) {
    previous = query;
    query = query.replace(LEADING_INTENT, "").trim();
  }
  return query;
}

export function canonicalizeBucketTitle(title: string): string {
  const aliased = applyKnownAliases(baseNormalize(title));
  const stripped = stripIntent(aliased)
    .replace(/^the\s+/i, "")
    .replace(/\s+in\s+/gi, " ")
    .replace(/[.!?]+$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  if (/\bburj khalifa\b/.test(stripped)) return "burj khalifa";
  if (/\bnorthern lights\b/.test(stripped)) return "northern lights";

  return stripped || baseNormalize(title).replace(/[.!?]+$/g, "");
}

export interface DeterministicItemMetadata {
  imageKeywords?: string[];
  experienceSearchQuery?: string;
  experienceLocation?: string | null;
}

export function getDeterministicItemMetadata(title: string): DeterministicItemMetadata | null {
  const canonical = canonicalizeBucketTitle(title);

  if (canonical === "burj khalifa") {
    return {
      imageKeywords: ["burj khalifa", "dubai skyline", "skyscraper"],
      experienceSearchQuery: "Burj Khalifa",
      experienceLocation: "Dubai, United Arab Emirates",
    };
  }

  if (canonical === "northern lights") {
    return {
      imageKeywords: ["northern lights", "aurora", "night sky"],
      experienceSearchQuery: "Northern Lights",
      experienceLocation: null,
    };
  }

  return null;
}
