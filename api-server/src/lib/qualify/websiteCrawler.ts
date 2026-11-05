import * as cheerio from "cheerio";

/** What the crawler keeps of one web page. */
export interface PageData {
  url: string;
  title: string;
  description: string;
  headings: string[];
  bodyText: string;
  links: string[];
  jsonLd: string[];
  socialMeta: string[];
  phones: string[];
  emails: string[];
  imageAlts: string[];
}

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

// Plain fetch + cheerio instead of one CheerioCrawler per site: with 8 leads qualifying
// in parallel, each Crawlee instance saw the machine as "overloaded", paused, and most
// sites ended with 0 pages after a 15-30s wait.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en;q=0.5, *;q=0.1",
};
const PAGE_TIMEOUT_MS = 8000;
const PAGE_CONCURRENCY = 3;
const MAX_HTML_CHARS = 2_000_000;

const bareHost = (host: string) => host.replace(/^www\./, "");

async function fetchHtml(url: string, signal: AbortSignal): Promise<{ url: string; html: string } | null> {
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: "follow",
      signal: AbortSignal.any([signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || (type && !type.includes("html"))) {
      void res.body?.cancel();
      return null;
    }
    const html = await res.text();
    return { url: res.url || url, html: html.slice(0, MAX_HTML_CHARS) };
  } catch {
    return null;
  }
}

function extractPage(url: string, html: string): PageData {
  const $ = cheerio.load(html);

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

  // ── Collect all links (used for PageData and for prioritised crawling) ──
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

  return { url, title, description, headings, bodyText, links: allLinks, jsonLd, socialMeta, phones, emails, imageAlts: imageAlts.slice(0, 30) };
}

export async function crawlSite(
  startUrl: string,
  maxDepth: number = 2,
  maxPages: number = 20,
  signal?: AbortSignal,
  /** Stop crawling after this long and keep the pages read so far. */
  deadlineMs?: number,
): Promise<PageData[]> {
  const pages: PageData[] = [];
  const visited = new Set<string>();

  const normalizedStart = startUrl.startsWith("http")
    ? startUrl
    : `https://${startUrl}`;

  try {
    new URL(normalizedStart);
  } catch {
    throw new Error(`Invalid URL: ${startUrl}`);
  }

  if (signal?.aborted) throw new Error("Qualification cancelled");
  const stop = AbortSignal.any([
    ...(signal ? [signal] : []),
    ...(deadlineMs ? [AbortSignal.timeout(deadlineMs)] : []),
  ]);

  // The homepage may redirect (http → https, bare → www): later pages must stay on
  // the site it lands on.
  let siteHost = bareHost(new URL(normalizedStart).hostname);
  let level = [normalizedStart];

  for (let depth = 0; depth <= maxDepth && level.length > 0 && pages.length < maxPages; depth++) {
    const batch = level.filter((u) => !visited.has(u)).slice(0, maxPages - pages.length);
    for (const u of batch) visited.add(u);

    const results: Array<{ url: string; html: string } | null> = [];
    for (let i = 0; i < batch.length && !stop.aborted; i += PAGE_CONCURRENCY) {
      results.push(...(await Promise.all(batch.slice(i, i + PAGE_CONCURRENCY).map((u) => fetchHtml(u, stop)))));
    }
    // Without the homepage the lead is scored blind: try it once more (slow or busy server).
    if (depth === 0 && !results[0] && !stop.aborted) results[0] = await fetchHtml(normalizedStart, stop);
    if (signal?.aborted) throw new Error("Qualification cancelled");

    const nextLinks = new Map<string, number>();
    for (const result of results) {
      if (!result || pages.length >= maxPages) continue;
      if (depth === 0) siteHost = bareHost(new URL(result.url).hostname);
      visited.add(result.url);
      const page = extractPage(result.url, result.html);
      pages.push(page);

      for (const link of page.links) {
        let host: string;
        try { host = new URL(link).hostname; } catch { continue; }
        if (bareHost(host) !== siteHost || SKIP_EXTENSIONS.test(link) || visited.has(link)) continue;
        const priority = urlPriority(link);
        if (priority >= 0 && !nextLinks.has(link)) nextLinks.set(link, priority);
      }
    }
    if (stop.aborted) break;

    // High-value pages (games, parties, pricing…) first.
    level = [...nextLinks.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
  }

  // Final sort: present high-value pages first in AI context
  pages.sort((a, b) => urlPriority(b.url) - urlPriority(a.url));

  return pages;
}
