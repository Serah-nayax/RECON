import { MemoryStorage } from "@crawlee/memory-storage";
import { CheerioCrawler, Configuration } from "@crawlee/cheerio";
import type { PageData } from "./jobStore.js";

export interface ReviewSignal {
  platform: string;
  url: string;
  rating?: number;
  reviewCount?: number;
  snippets: string[];
  category?: string;
}

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

function parseJsonLd($: cheerio.CheerioAPI): { rating?: number; reviewCount?: number; category?: string } {
  let rating: number | undefined;
  let reviewCount: number | undefined;
  let category: string | undefined;

  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const text = (el as unknown as { children: Array<{ data?: string }> }).children?.[0]?.data ?? "";
      if (!text) return;
      const entries = (() => { try { const d = JSON.parse(text); return Array.isArray(d) ? d : [d]; } catch { return []; } })();
      for (const entry of entries) {
        if (!rating && entry?.aggregateRating?.ratingValue)
          rating = Number(entry.aggregateRating.ratingValue);
        if (!reviewCount && (entry?.aggregateRating?.reviewCount || entry?.aggregateRating?.ratingCount))
          reviewCount = Number(entry.aggregateRating.reviewCount ?? entry.aggregateRating.ratingCount);
        if (!category && (entry?.servesCuisine || entry?.category))
          category = String(entry.servesCuisine ?? entry.category);
      }
    } catch {
      // ignore
    }
  });

  return {
    rating:      rating && !isNaN(rating)      ? Math.round(rating * 10) / 10 : undefined,
    reviewCount: reviewCount && !isNaN(reviewCount) ? reviewCount : undefined,
    category,
  };
}

/**
 * Fetch each review page and extract rating, count, and snippet text.
 * Failures are swallowed — review data is best-effort.
 */
export async function crawlReviewPages(
  links: { platform: string; url: string }[],
): Promise<ReviewSignal[]> {
  if (links.length === 0) return [];

  const results: Map<string, ReviewSignal> = new Map();

  // Pre-populate with empty entries so failed crawls are recorded too
  for (const { platform, url } of links) {
    results.set(url, { platform, url, snippets: [] });
  }

  const config = new Configuration({ storageClient: new MemoryStorage({ persistStorage: false }) });

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: links.length,
    requestHandlerTimeoutSecs: 8,
    maxConcurrency: 4,
    useSessionPool: false,

    additionalMimeTypes: ["text/html"],


    async requestHandler({ request, $ }) {
      const meta = request.userData as { platform: string };
      const { rating, reviewCount, category } = parseJsonLd($);

      // Fallback: microdata / aria attributes
      let fallbackRating: number | undefined;
      if (!rating) {
        const rVal =
          $('[itemprop="ratingValue"]').first().attr("content") ||
          $('[itemprop="ratingValue"]').first().text().trim() ||
          $('[aria-label*="stars"]').first().attr("aria-label")?.match(/[\d.]+/)?.[0];
        if (rVal) fallbackRating = Number(rVal);
      }

      // Review text snippets (generic selectors that work across platforms)
      const snippets: string[] = [];
      const selectors = [
        '[itemprop="reviewBody"]',
        '[class*="review-text"]',
        '[class*="reviewText"]',
        '[class*="review_body"]',
        '[data-automation="reviewQuote"]',
        '[class*="review-content"]',
        '.bui-review-score__text',
      ];
      for (const sel of selectors) {
        $(sel).each((_i, el) => {
          const text = $(el).text().replace(/\s+/g, " ").trim();
          if (text.length >= 40 && text.length <= 600) snippets.push(text);
        });
        if (snippets.length >= 5) break;
      }

      results.set(request.url, {
        platform: meta.platform,
        url: request.url,
        rating: rating ?? (fallbackRating && !isNaN(fallbackRating) ? Math.round(fallbackRating * 10) / 10 : undefined),
        reviewCount,
        snippets: snippets.slice(0, 4),
        category,
      });
    },

    failedRequestHandler({ request, log }) {
      log.debug(`Review page not accessible: ${request.url}`);
    },
  }, config);

  await crawler.run(
    links.map(({ platform, url }) => ({ url, userData: { platform } })),
  );

  return [...results.values()];
}

/**
 * Format review signals into a compact text block for the Claude prompt.
 */
export function formatReviewSignals(signals: ReviewSignal[]): string {
  const useful = signals.filter((s) => s.rating || s.reviewCount || s.snippets.length > 0);
  if (useful.length === 0) return "";

  const lines: string[] = ["--- EXTERNAL REVIEW SIGNALS ---"];
  for (const s of useful) {
    const meta: string[] = [`[${s.platform}]`];
    if (s.rating)       meta.push(`⭐ ${s.rating}/5`);
    if (s.reviewCount)  meta.push(`${s.reviewCount} reviews`);
    if (s.category)     meta.push(`Category: ${s.category}`);
    lines.push(meta.join("  "));
    for (const snippet of s.snippets) {
      lines.push(`  • "${snippet.slice(0, 300)}"`);
    }
  }
  lines.push("--- END REVIEW SIGNALS ---");
  return lines.join("\n");
}
