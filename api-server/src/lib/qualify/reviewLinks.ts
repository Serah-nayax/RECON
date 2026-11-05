// Links from a lead's website to its pages on review sites (TripAdvisor, Yelp...).
import type { PageData } from "./websiteCrawler.js";

const REVIEW_PLATFORMS: { name: string; pattern: RegExp }[] = [
  { name: "Google Maps",       pattern: /google\.[a-z.]+\/maps/i },
  { name: "TripAdvisor",      pattern: /tripadvisor\.[a-z.]+/i },
  { name: "Yelp",             pattern: /yelp\.(com|de|nl|fr|at|ch|be|co\.uk|es|it|pt)/i },
  { name: "Facebook",         pattern: /facebook\.com\/(pages\/|pg\/|[^/]+\/reviews)/i },
  { name: "Booking.com",      pattern: /booking\.com\/hotel/i },
  { name: "Trustpilot",       pattern: /trustpilot\.[a-z.]+\/review/i },
  { name: "Foursquare",       pattern: /foursquare\.com\/v\//i },
  { name: "Google Play",      pattern: /play\.google\.com\/store\/apps/i },
  { name: "Zomato",           pattern: /zomato\.com\//i },
  { name: "TheFork",          pattern: /thefork\.[a-z.]+|lafourchette\.com/i },
  { name: "OpenTable",        pattern: /opentable\.[a-z.]+\/[a-z-]+/i },
  { name: "Pages Jaunes",     pattern: /pagesjaunes\.fr/i },
  { name: "Gelbe Seiten",     pattern: /gelbeseiten\.de|stadtbranchenbuch\.de/i },
  { name: "Páginas Amarillas",pattern: /paginasamarillas\.es/i },
  { name: "Treatwell",        pattern: /treatwell\.[a-z.]+/i },
];

/**
 * Scan already-crawled pages for links to known review platforms.
 * Returns up to 4 unique links (one per platform).
 */
export function extractReviewLinks(pages: PageData[]): { platform: string; url: string }[] {
  const found: { platform: string; url: string }[] = [];
  const seenPlatforms = new Set<string>();
  const seenUrls = new Set<string>();

  for (const page of pages) {
    for (const link of page.links) {
      for (const { name, pattern } of REVIEW_PLATFORMS) {
        if (pattern.test(link) && !seenPlatforms.has(name) && !seenUrls.has(link)) {
          seenPlatforms.add(name);
          seenUrls.add(link);
          found.push({ platform: name, url: link });
          break;
        }
      }
    }
    if (found.length >= 3) break;
  }

  return found;
}
