import type { PageData } from "./jobStore.js";

export interface SocialIntel {
  platform: string;
  url: string;
  bio?: string;
  category?: string;
  followers?: string;
  postTone?: string;
  categoryTags?: string[];
}

const SOCIAL_PATTERNS: { name: string; pattern: RegExp }[] = [
  {
    name: "Facebook",
    pattern: /facebook\.com\/(?!sharer|share|dialog|login|photo|video|story|groups\/|events\/|marketplace\/|watch\/|gaming\/|pages\/create|policy|help|about$)[\w.-]{2,}\/?$/i,
  },
  { name: "Instagram", pattern: /instagram\.com\/[\w.][\w.]{1,}(\/)?$/i },
  { name: "LinkedIn",  pattern: /linkedin\.com\/company\/[\w-]+/i },
  { name: "Twitter",   pattern: /(?:twitter|x)\.com\/(?!share|intent|home|login|i\/)[\w]{2,}\/?$/i },
  { name: "YouTube",   pattern: /youtube\.com\/(c\/|channel\/|@|user\/)[\w-]+/i },
  { name: "TikTok",   pattern: /tiktok\.com\/@[\w.]+/i },
];

/** Extract social profile URLs from already-crawled pages.
 *  Sources checked (in order):
 *  1. og:see_also / rel=me / twitter:site meta tags (stored in page.socialMeta)
 *  2. Outbound <a href> links matching known social patterns
 *  3. JSON-LD sameAs arrays
 */
export function extractSocialLinks(pages: PageData[]): { platform: string; url: string }[] {
  const found: { platform: string; url: string }[] = [];
  const seenPlatforms = new Set<string>();
  const seenUrls = new Set<string>();

  const tryAdd = (url: string) => {
    for (const { name, pattern } of SOCIAL_PATTERNS) {
      if (pattern.test(url) && !seenPlatforms.has(name) && !seenUrls.has(url)) {
        seenPlatforms.add(name);
        seenUrls.add(url);
        found.push({ platform: name, url });
        return;
      }
    }
  };

  for (const page of pages) {
    // 1. Explicit social meta tags (og:see_also, rel=me, twitter:site)
    for (const metaUrl of page.socialMeta) {
      tryAdd(metaUrl);
    }

    // 2. Outbound links matching social platform patterns
    for (const link of page.links) {
      tryAdd(link);
    }

    // 3. JSON-LD sameAs
    for (const ld of page.jsonLd) {
      try {
        const parsed = JSON.parse(ld) as Record<string, unknown>;
        const same = parsed["sameAs"];
        if (Array.isArray(same)) {
          for (const u of same) if (typeof u === "string") tryAdd(u);
        } else if (typeof same === "string") {
          tryAdd(same);
        }
      } catch { /* ignore */ }
    }
  }

  return found;
}

// ── Heuristics for post tone and category tags ────────────────────────────────

const POSITIVE_TERMS = ["fun", "best", "award", "premier", "top", "largest", "family", "friendly", "great", "amazing", "love", "voted", "award-winning", "popular", "favorite", "exciting", "must-visit"];
const NEGATIVE_TERMS = ["closed", "temporarily", "sorry", "complaint", "unfortunately", "disappointed", "scam", "avoid", "worst", "never again"];

function derivePostTone(bio: string): string | undefined {
  if (!bio) return undefined;
  const lower = bio.toLowerCase();
  const negCount = NEGATIVE_TERMS.filter((t) => lower.includes(t)).length;
  const posCount = POSITIVE_TERMS.filter((t) => lower.includes(t)).length;
  if (negCount >= 2) return "negative";
  if (negCount === 1) return "mixed";
  if (posCount >= 3) return "strongly positive";
  if (posCount >= 1) return "positive";
  return undefined;
}

/** Parse bullet-style category tags from social bio (e.g. "Arcade • Bar • FEC") */
function extractCategoryTags(bio: string): string[] {
  if (!bio) return [];
  const separators = /[•|·\|\/,;]/;
  const segments = bio.split(separators).map((s) => s.trim()).filter((s) => s.length > 0 && s.length < 40);
  if (segments.length < 2) return [];
  // Only return short-ish segments that look like category tags, not full sentences
  return segments.filter((s) => s.split(" ").length <= 4 && !/https?:\/\//i.test(s)).slice(0, 6);
}

/** Extract follower / likes count from text using multiple patterns */
function extractFollowers(text: string): string | undefined {
  const patterns = [
    /(\d[\d,.]*)k?\s*(?:followers?|fans?|likes?|subscribers?)/i,
    /(?:followers?|fans?|likes?|subscribers?)[:\s]+(\d[\d,.]*k?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1]?.trim() + " followers";
  }
  return undefined;
}

// ── Lightweight social profile meta fetch ─────────────────────────────────────

async function fetchSocialMeta(url: string): Promise<Partial<SocialIntel>> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept: "text/html",
      },
    });

    clearTimeout(timeout);
    if (!res.ok) return {};

    const html = await res.text().catch(() => "");
    if (!html) return {};

    const metaContent = (prop: string): string => {
      const m =
        html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`, "i")) ??
        html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`, "i"));
      return m?.[1]?.trim() ?? "";
    };

    const bio = metaContent("og:description") || metaContent("description");
    const ogTitle = metaContent("og:title") || "";
    const ogType = metaContent("og:type");

    // Followers: check og:description and og:title for count patterns
    const combinedText = `${ogTitle} ${bio}`;
    const followers = extractFollowers(combinedText);

    // Post tone from bio content
    const postTone = derivePostTone(bio);

    // Category tags: check for bullet-separated segments in bio (common on IG/FB pages)
    const categoryTags = extractCategoryTags(bio);

    // Category: og:type only if it's a meaningful value
    const category = ogType && !["website", "article", "object"].includes(ogType) ? ogType : undefined;

    return {
      bio: bio ? bio.slice(0, 350) : undefined,
      category,
      followers,
      postTone,
      categoryTags: categoryTags.length > 0 ? categoryTags : undefined,
    };
  } catch {
    return {};
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function crawlSocialProfiles(
  links: { platform: string; url: string }[],
): Promise<SocialIntel[]> {
  if (links.length === 0) return [];

  const results = await Promise.allSettled(
    links.map(async ({ platform, url }) => {
      const meta = await fetchSocialMeta(url);
      return { platform, url, ...meta } satisfies SocialIntel;
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<SocialIntel> => r.status === "fulfilled")
    .map((r) => r.value);
}

export function formatSocialIntel(socials: SocialIntel[]): string {
  if (socials.length === 0) return "";

  const lines: string[] = ["--- SOCIAL MEDIA PROFILES ---"];
  for (const s of socials) {
    const parts: string[] = [`[${s.platform}] ${s.url}`];
    if (s.followers) parts.push(`Followers: ${s.followers}`);
    if (s.category) parts.push(`Type: ${s.category}`);
    if (s.categoryTags?.length) parts.push(`Tags: ${s.categoryTags.join(" • ")}`);
    if (s.postTone) parts.push(`Tone: ${s.postTone}`);
    if (s.bio) parts.push(`Bio: ${s.bio}`);
    lines.push(parts.join(" | "));
  }
  lines.push("--- END SOCIAL PROFILES ---");
  return lines.join("\n");
}
