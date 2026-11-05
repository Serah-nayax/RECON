// Links from a lead's website to its social profiles (Facebook, Instagram...).
import type { PageData } from "./websiteCrawler.js";

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
