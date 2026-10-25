import { MemoryStorage } from "@crawlee/memory-storage";
import { CheerioCrawler, Configuration } from "@crawlee/cheerio";
import type { PageData } from "./jobStore.js";

const SKIP_EXTENSIONS =
  /\.(pdf|jpg|jpeg|png|gif|svg|css|js|xml|zip|tar|gz|ico|woff|woff2|ttf|mp4|mp3|webp|avif|mov|avi|mkv|flv|wmv|swf)$/i;

// Low-value path segments — skip to save crawl budget for content pages
const SKIP_PATHS =
  /\/(wp-admin|wp-login|wp-json|feed|rss|sitemap|robots|xmlrpc|admin|login|register|signup|cart|checkout|account|profile|tag\/|page\/\d+|privacy|terms|legal|cookie|gdpr|imprint|impressum|datenschutz|lang\?|\.well-known|mentions-legales|politique-confidentialite|cgu|cgv|plan-du-site|agb|nutzungsbedingungen|datenschutzerklaerung|widerrufsrecht|aviso-legal|politica-privacidad|terminos|mapa-sitio|politica-privacidade|termos|mapa-site|note-legali|informativa-privacy|termini|mappa-sito|algemene-voorwaarden|privacybeleid)/i;

// High-value path segments — prioritise before generic pages (English + multilingual)
const HIGH_VALUE_PATH =
  /\/(about|attract|game|games|gaming|arcade|machine|redemption|prize|party|events?|birthday|package|pricing|entertainment|activity|activities|experience|fun|kids|family|bowling|laser|kart|trampoline|escape|ticket|reward|loyalty|member|play|park|juego|juegos|entretenimiento|diversion|fiesta|cumpleanos|premio|canjes|fichas|recreacion|ocio|animacion|atraccion|jeu|jeux|divertissement|loisir|fete|anniversaire|tarif|prix|recompense|attraction|activite|enfants|spiel|spiele|unterhaltung|vergnugen|geburtstag|preis|belohnung|attraktion|erlebnis|spass|freizeit|eintritt|jogo|jogos|entretenimento|diversao|festa|aniversario|atracao|atividade|criancas|ingresso|gioco|giochi|intrattenimento|divertimento|compleanno|attivita|animazione|spel|spellen|vermaak|plezier|feest|verjaardag|prijs|beloning|activiteit|attractie|entree)/i;

/** Score a URL for crawl priority. Higher = more likely to contain signal-rich content. */
export function urlPriority(url: string): number {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (SKIP_PATHS.test(path)) return -1;     // excluded
    if (path === "/" || path === "") return 3;  // homepage always first
    if (HIGH_VALUE_PATH.test(path)) return 2;  // priority content pages
    return 1;                                   // normal pages
  } catch {
    return 0;
  }
}

export async function crawlSite(
  startUrl: string,
  maxDepth: number = 2,
  maxPages: number = 20,
  signal?: AbortSignal,
): Promise<PageData[]> {
  const pages: PageData[] = [];
  const visited = new Set<string>();

  const normalizedStart = startUrl.startsWith("http")
    ? startUrl
    : `https://${startUrl}`;

  let startDomain: string;
  try {
    startDomain = new URL(normalizedStart).hostname;
  } catch {
    throw new Error(`Invalid URL: ${startUrl}`);
  }

  // Each crawl run gets its own in-memory storage client so concurrent
  // CheerioCrawler instances never collide on the same JSON5 state files.
  const config = new Configuration({ storageClient: new MemoryStorage({ persistStorage: false }) });

  const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: maxPages,
    requestHandlerTimeoutSecs: 10,
    maxConcurrency: 3,
    useSessionPool: false,
    preNavigationHooks: [
      async ({ request }) => {
        request.headers = {
          ...request.headers,
          "Accept-Language": "en;q=0.5, *;q=0.1",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        };
      },
    ],

    async requestHandler({ request, $, addRequests }) {
      const url = request.url;
      if (visited.has(url)) return;
      visited.add(url);

      const currentDepth: number = (request.userData?.["depth"] as number) ?? 0;

      const title =
        $("title").text().trim() ||
        $("h1").first().text().trim() ||
        url;

      const description =
        $('meta[name="description"]').attr("content")?.trim() ||
        $('meta[property="og:description"]').attr("content")?.trim() ||
        "";

      const headings: string[] = [];
      $("h1, h2, h3").each((_i, el) => {
        const text = $(el).text().trim();
        if (text) headings.push(text);
      });

      const jsonLd: string[] = [];
      $('script[type="application/ld+json"]').each((_i, el) => {
        const text = $(el).text().trim();
        if (text) jsonLd.push(text.slice(0, 1200));
      });

      // ── Social meta discovery via explicit meta tags ─────────────────────
      const socialMeta: string[] = [];

      $('meta[property="og:see_also"]').each((_i, el) => {
        const content = $(el).attr("content")?.trim();
        if (content) socialMeta.push(content);
      });

      $('link[rel~="me"], a[rel~="me"]').each((_i, el) => {
        const href = $(el).attr("href")?.trim();
        if (href) {
          try {
            socialMeta.push(new URL(href, url).href);
          } catch { /* ignore */ }
        }
      });

      const twitterSite = $('meta[name="twitter:site"]').attr("content")?.trim();
      if (twitterSite) {
        const handle = twitterSite.replace(/^@/, "");
        if (handle) socialMeta.push(`https://twitter.com/${handle}`);
      }

      // ── Collect all links (used for PageData and for prioritised enqueueing) ──
      const allLinks: string[] = [];
      $("a[href]").each((_i, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
          const resolved = new URL(href, url).href.split("#")[0];
          if (resolved) allLinks.push(resolved);
        } catch {
          // ignore malformed
        }
      });

      // ── Phone numbers ────────────────────────────────────────────────────
      const phonesSet = new Set<string>();
      $("a[href^='tel:']").each((_i, el) => {
        const tel = $(el).attr("href")?.replace(/^tel:/, "").trim();
        if (tel) phonesSet.add(tel);
      });
      $('[itemprop="telephone"]').each((_i, el) => {
        const tel = $(el).attr("content")?.trim() || $(el).text().trim();
        if (tel) phonesSet.add(tel);
      });
      const phones = [...phonesSet].slice(0, 5);

      // ── Email addresses ──────────────────────────────────────────────────
      const emailsSet = new Set<string>();
      $("a[href^='mailto:']").each((_i, el) => {
        const mail = $(el).attr("href")?.replace(/^mailto:/, "").split("?")[0].trim();
        if (mail) emailsSet.add(mail);
      });
      const emails = [...emailsSet].slice(0, 5);

      // ── Image alt text ────────────────────────────────────────────────────
      const imageAlts: string[] = [];
      $("img[alt]").each((_i, el) => {
        const alt = $(el).attr("alt")?.trim() || "";
        if (alt.length >= 5 && alt.length <= 80) imageAlts.push(alt);
      });

      $("script, style, nav, footer, iframe, noscript, header").remove();
      const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 3000);

      pages.push({ url, title, description, headings, bodyText, links: allLinks, jsonLd, socialMeta, phones, emails, imageAlts: imageAlts.slice(0, 30) });

      // ── Priority-sorted enqueue: high-value pages queued first ────────────
      if (currentDepth < maxDepth && pages.length < maxPages) {
        const prioritized = allLinks
          .map((u) => {
            let domain: string;
            try { domain = new URL(u).hostname; } catch { return null; }
            if (domain !== startDomain) return null;
            if (SKIP_EXTENSIONS.test(u)) return null;
            const priority = urlPriority(u);
            if (priority < 0) return null;
            return { url: u, priority };
          })
          .filter((x): x is { url: string; priority: number } => x !== null)
          .sort((a, b) => b.priority - a.priority);

        // Deduplicate preserving priority order
        const deduped = new Map<string, number>();
        for (const { url: u, priority } of prioritized) {
          if (!deduped.has(u)) deduped.set(u, priority);
        }

        const requests = Array.from(deduped.keys()).map((u) => ({
          url: u,
          userData: { depth: currentDepth + 1 },
        }));

        if (requests.length > 0) {
          await addRequests(requests);
        }
      }
    },

    failedRequestHandler({ request, log }) {
      log.warning(`Failed to crawl: ${request.url}`);
    },
  }, config);

  if (signal?.aborted) throw new Error("Qualification cancelled");
  const onAbort = () => {
    void crawler.teardown();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    await crawler.run([{ url: normalizedStart, userData: { depth: 0 } }]);
    if (signal?.aborted) throw new Error("Qualification cancelled");
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  // Final sort: present high-value pages first in AI context
  pages.sort((a, b) => urlPriority(b.url) - urlPriority(a.url));

  return pages;
}
