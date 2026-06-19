const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY ?? "";
const BASE = "https://api.unsplash.com";
const UTM = "utm_source=lifelist&utm_medium=referral";

export interface UnsplashPick {
  imageUrl: string;
  attribution: string;
  attributionUrl: string;
  downloadLocation: string;
}

interface UnsplashSearchResponse {
  results: Array<{
    urls: { regular: string };
    user: { name: string; links: { html: string } };
    links: { download_location: string };
  }>;
}

export async function searchPortraitImage(keywords: string[]): Promise<UnsplashPick | null> {
  const query = keywords.join(" ");
  const url = new URL(`${BASE}/search/photos`);
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("per_page", "1");
  url.searchParams.set("content_filter", "high");

  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${ACCESS_KEY}`, "Accept-Version": "v1" },
  });
  if (!res.ok) {
    console.warn(`[unsplash] search failed: ${res.status}`);
    return null;
  }

  const data = (await res.json()) as UnsplashSearchResponse;
  const first = data.results[0];
  if (!first) return null;

  const profile = first.user.links.html;
  const attributionUrl = `${profile}${profile.includes("?") ? "&" : "?"}${UTM}`;

  return {
    imageUrl: first.urls.regular,
    attribution: `Photo by ${first.user.name} on Unsplash`,
    attributionUrl,
    downloadLocation: first.links.download_location,
  };
}

export async function triggerUnsplashDownload(downloadLocation: string): Promise<void> {
  try {
    await fetch(downloadLocation, {
      headers: { Authorization: `Client-ID ${ACCESS_KEY}`, "Accept-Version": "v1" },
    });
  } catch (err) {
    console.warn("[unsplash] download trigger failed", err);
  }
}
