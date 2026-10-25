import type { GridCell } from "./geoGrid.js";
import type { QualifyResult } from "./qualifyLead.js";

export type MapsField =
  | "address"
  | "phone"
  | "website"
  | "mapsUrl"
  | "rating"
  | "reviewCount"
  | "category"
  | "hours";

export const ALL_FIELDS: MapsField[] = [
  "address", "phone", "website", "mapsUrl",
  "rating", "reviewCount", "category", "hours",
];

// Fields that require visiting the individual place detail page.
export const DETAIL_FIELDS: MapsField[] = ["phone", "website", "hours"];

export interface MapsLead {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  mapsUrl?: string;
  rating?: number;
  reviewCount?: number;
  category?: string;
  hours?: string;
  /** Coordinates extracted from the Google Maps place URL */
  lat?: number;
  lng?: number;
  detailStatus?: "idle" | "running" | "done" | "failed";
  detailError?: string | null;
  enrichStatus?: "idle" | "running" | "done" | "failed";
  enrichResult?: QualifyResult | null;
  enrichError?: string | null;
}

/** Extract lat/lng from a Google Maps URL of the form /@lat,lng,zoom */
function extractCoords(url: string): { lat: number; lng: number } | null {
  const m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+),\d/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** Extract the hex place-ID from a Google Maps URL — unique per business. */
function extractPlaceId(url: string): string {
  const m = url.match(/1s(0x[0-9a-fA-F]+:[0-9a-fA-F]+)/);
  if (m) return m[1];
  // Fallback: normalise the URL path into a stable key
  return url.replace(/[^a-z0-9]/gi, "").slice(0, 80);
}

/** Build a dedup key from name + address when the URL-based ID is unavailable. */
function nameAddrKey(name: string, address?: string): string {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const a = (address ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
  return `name__${n}__${a}`;
}

export function buildGoogleMapsSearchUrl(
  scope: string,
  searchTerm: string,
  location: string,
  cell: GridCell,
): string {
  // When a namedLocation is set, include "in <area>" in the query to
  // geographically constrain Google Maps to that location.
  // Always include lat/lng coordinates so each cell focuses on a different
  // sub-region within the area (important when a city is split into multiple cells).
  // Exception: the geocoding-failure fallback has lat=0,lng=0 — skip coordinates
  // in that case so Maps can centre on the location name instead.
  const hasRealCoords = !(cell.lat === 0 && cell.lng === 0);

  const query = cell.namedLocation
    ? encodeURIComponent(`${searchTerm} in ${cell.namedLocation}`)
    : encodeURIComponent(searchTerm);

  if (!hasRealCoords) {
    return `https://www.google.com/maps/search/${query}`;
  }

  return `https://www.google.com/maps/search/${query}/@${cell.lat},${cell.lng},${cell.zoom}z`;
}

// ── Raw data extracted directly from the feed DOM ─────────────────────────────

interface FeedEntry {
  href: string;
  name: string;
  rating: number | null;
  reviewCount: number | null;
  /** Raw text chunks from card content — used to parse category and address. */
  chunks: string[];
}

async function extractVisibleFeedEntries(
  page: import("playwright").Page,
): Promise<FeedEntry[]> {
  return page.evaluate(() => {
    const seen = new Set<string>();
    const results: Array<{
      href: string;
      name: string;
      rating: number | null;
      reviewCount: number | null;
      chunks: string[];
    }> = [];

    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href*="/maps/place/"]'),
    );

    for (const link of links) {
      const href = link.href;
      if (!href || seen.has(href)) continue;
      seen.add(href);

      const name = (link.getAttribute("aria-label") ?? "").trim();
      if (!name) continue;

      const card =
        link.closest(".Nv2PK") ??
        link.closest(".bfdHYd") ??
        link.closest('[jsaction*="mouseover"]') ??
        link.parentElement?.parentElement?.parentElement ??
        null;

      let rating: number | null = null;
      const starEl = card?.querySelector('[role="img"][aria-label*="star"]');
      const starMatch = starEl?.getAttribute("aria-label")?.match(/([\d.]+)/);
      if (starMatch) rating = parseFloat(starMatch[1]);

      let reviewCount: number | null = null;
      const reviewMatch = card?.textContent?.match(/\(([\d,]+)\)/);
      if (reviewMatch) reviewCount = parseInt(reviewMatch[1].replace(/,/g, ""), 10);

      const chunks: string[] = [];
      if (card) {
        for (const el of Array.from(card.querySelectorAll("span, div"))) {
          const text = (el.textContent ?? "").trim();
          if (
            text.length > 1 &&
            text.length < 120 &&
            el.children.length <= 1 &&
            text !== name &&
            !chunks.includes(text)
          ) {
            chunks.push(text);
          }
          if (chunks.length >= 12) break;
        }
      }

      results.push({ href, name, rating, reviewCount, chunks });
    }

    return results;
  });
}

// ── Phase 1: scroll the feed and extract everything in one evaluate() pass ────

async function scrapeFeed(
  page: import("playwright").Page,
  searchUrl: string,
  signal?: AbortSignal,
  onEntries?: (entries: FeedEntry[]) => void,
  initialNavigationDone = false,
): Promise<FeedEntry[]> {
  const localizedUrl = searchUrl.includes("?")
    ? `${searchUrl}&hl=en&gl=au`
    : `${searchUrl}?hl=en&gl=au`;
  const urls = [
    localizedUrl,
    searchUrl,
  ];

  for (let attempt = 0; attempt < urls.length; attempt++) {
    if (!(initialNavigationDone && attempt === 0)) {
      try {
        await page.goto(urls[attempt], { waitUntil: "domcontentloaded", timeout: 30000 });
      } catch {
        if (attempt === urls.length - 1) return [];
        continue;
      }
    }

    if (signal?.aborted) return [];

    // Handle redirect to a single-place page (0 or 1 result)
    if (page.url().includes("/maps/place/")) {
      const href = page.url();
      const name = await page.locator("h1").first().textContent({ timeout: 5000 }).catch(() => "");
      if (name?.trim()) {
        return [{ href, name: name.trim(), rating: null, reviewCount: null, chunks: [] }];
      }
    }

    // Dismiss consent dialogs before waiting for the results feed.
    try {
      const consent = page
        .locator(
          'button:has-text("Reject all"), button:has-text("Accept all"), button:has-text("Alle ablehnen"), button:has-text("Tout refuser"), button[aria-label*="Reject all"], form[action*="consent"] button',
        )
        .first();
      if (await consent.isVisible({ timeout: 3000 })) {
        await consent.click();
        await sleep(1000);
      }
    } catch { /* no dialog */ }

    try {
      await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
      break;
    } catch {
      if (attempt === urls.length - 1) return [];
    }
  }

  let lastEmittedCount = 0;
  const emitVisibleEntries = async () => {
    const visible = await extractVisibleFeedEntries(page);
    if (visible.length > lastEmittedCount) {
      lastEmittedCount = visible.length;
      onEntries?.(visible);
    }
    return visible;
  };

  // Publish the first viewport immediately instead of waiting for every Maps
  // result to load. Production Maps feeds can take tens of seconds to finish.
  await emitVisibleEntries();

  // Scroll until all results are loaded
  let prevCount = 0;
  let stable = 0;
  for (let i = 0; i < 25 && !signal?.aborted; i++) {
    await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) feed.scrollTop = feed.scrollHeight;
    });
    await sleep(1400);

    const count = await page.locator('a[href*="/maps/place/"]').count();
    const ended = await page
      .locator('span:has-text("You\'ve reached the end"), span:has-text("No more results")')
      .count();
    if (ended > 0) break;

    if (count === prevCount) {
      if (++stable >= 2) break;
    } else {
      stable = 0;
      await emitVisibleEntries();
    }
    prevCount = count;
  }

  if (signal?.aborted) return [];

  // Extract everything that's already in the DOM — no reload needed.
  return emitVisibleEntries();
}

// ── Map a FeedEntry to a MapsLead using only feed data (fast mode) ───────────

function feedEntryToLead(entry: FeedEntry, selectedFields: MapsField[]): MapsLead | null {
  if (!entry.name) return null;

  const id = extractPlaceId(entry.href);
  const lead: MapsLead = { id, name: entry.name };

  // Detail extraction needs the Maps URL internally even when the user did not
  // request it as a visible output column.
  if (
    selectedFields.includes("mapsUrl") ||
    selectedFields.some((field) => DETAIL_FIELDS.includes(field))
  ) {
    lead.mapsUrl = entry.href;
  }

  if (selectedFields.includes("rating") && entry.rating !== null) {
    lead.rating = entry.rating;
  }
  if (selectedFields.includes("reviewCount") && entry.reviewCount !== null) {
    lead.reviewCount = entry.reviewCount;
  }

  // Parse category and address from text chunks.
  // Google Maps cards show: [category] · [address] in nearby spans.
  const meaningful = entry.chunks.filter(
    (t) => t !== entry.name && !/^\d+(\.\d+)?$/.test(t) && t.length > 2,
  );

  if (selectedFields.includes("category") && meaningful.length > 0) {
    // Category is usually the first chunk that doesn't look like an address
    const cat = meaningful.find((t) => !/\d/.test(t) || /[a-z]/i.test(t)) ?? meaningful[0];
    if (cat) lead.category = cat;
  }

  if (selectedFields.includes("address")) {
    // Address chunks tend to contain digits or commas
    const addr =
      meaningful.find((t) => /\d/.test(t) || t.includes(",") || t.includes("·")) ??
      (meaningful.length > 1 ? meaningful[1] : undefined);
    if (addr) lead.address = addr.replace(/^·\s*/, "").trim();
  }

  // Ensure a stable fallback dedup key if URL ID wasn't extractable
  if (!lead.id) lead.id = nameAddrKey(lead.name, lead.address);

  // Attach coordinates from place URL for out-of-bounds filtering
  const coords = extractCoords(entry.href);
  if (coords) { lead.lat = coords.lat; lead.lng = coords.lng; }

  return lead;
}

// ── Phase 2: Extract data from an individual place detail page ────────────────

async function extractPlaceDetail(
  page: import("playwright").Page,
  entry: FeedEntry,
  selectedFields: MapsField[],
  initialNavigationDone = false,
): Promise<MapsLead | null> {
  if (!initialNavigationDone) {
    try {
      await page.goto(entry.href, { waitUntil: "domcontentloaded", timeout: 12_000 });
    } catch {
      // A Maps document can be usable even when a slow secondary resource causes
      // navigation to time out. Continue with whatever DOM is available.
    }
  }

  try {
    const consent = page
      .locator('button:has-text("Reject all"), button:has-text("Accept all")')
      .first();
    if (await consent.isVisible({ timeout: 1000 })) {
      await consent.click({ timeout: 1000 });
    }
  } catch { /* no consent dialog */ }

  await page
    .waitForSelector(
      'h1, [data-item-id="address"], a[href^="tel:"], a[data-item-id="authority"], a[aria-label*="website" i]',
      { timeout: 3000 },
    )
    .catch(() => {});
  // Website and hours controls are often added shortly after the place title.
  // Give the detail panel one small render window without reintroducing the
  // old chain of multi-second waits for every optional field.
  await sleep(800);
  try {
    const hoursToggle = page
      .locator('button[aria-label*="hour" i], button[jsaction*="pane.info.openHours"]')
      .first();
    if (await hoursToggle.isVisible({ timeout: 500 })) {
      await hoursToggle.click({ timeout: 800 });
      await sleep(250);
    }
  } catch { /* hours are not available for every place */ }

  const raw = await page.evaluate(() => {
    const text = (selector: string) =>
      (document.querySelector(selector)?.textContent ?? "").replace(/\s+/g, " ").trim();
    const attr = (selector: string, name: string) =>
      document.querySelector(selector)?.getAttribute(name) ?? "";

    const phoneHref = attr('a[href^="tel:"]', "href");
    const phoneLabel = attr(
      'button[data-tooltip="Copy phone number"], button[aria-label*="phone number" i]',
      "aria-label",
    );
    const addressLabel = attr(
      'button[data-tooltip="Copy address"][aria-label], button[aria-label*="Address" i]',
      "aria-label",
    );
    const websiteEl = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        'a[data-tooltip="Open website"], a[aria-label*="website" i], a[href^="http"][target="_blank"]',
      ),
    ).find((link) => !link.href.includes("google.com"));
    const hourRows = Array.from(
      document.querySelectorAll('table.WgFkxc tr, tr[role="row"]'),
    )
      .map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 7);

    return {
      name: text("h1"),
      phone: phoneHref.replace(/^tel:/, "") || phoneLabel.replace(/^Phone:\s*/i, ""),
      website: websiteEl?.href ?? "",
      address:
        addressLabel.replace(/^Address:\s*/i, "") ||
        text('[data-item-id="address"]'),
      category: text('button.DkEaL, span.YhemCb, a[jsaction*="category"]'),
      hours: hourRows.join("; ") || text("span.ZDu9vd"),
      rating: text('div.F7nice span[aria-hidden="true"]'),
      reviews: text('button[aria-label*="review" i], div.F7nice button'),
    };
  });

  const id = extractPlaceId(entry.href);
  const lead: MapsLead = { id, name: entry.name || raw.name };
  if (!lead.name) return null;

  if (selectedFields.includes("mapsUrl")) lead.mapsUrl = entry.href;
  if (selectedFields.includes("phone") && raw.phone) lead.phone = raw.phone;
  if (selectedFields.includes("website") && raw.website) lead.website = raw.website;
  if (selectedFields.includes("address") && raw.address) lead.address = raw.address;
  if (selectedFields.includes("category") && raw.category) lead.category = raw.category;
  if (selectedFields.includes("hours") && raw.hours) lead.hours = raw.hours;

  if (selectedFields.includes("rating")) {
    const rating = entry.rating ?? parseFloat(raw.rating.replace(",", "."));
    if (!Number.isNaN(rating)) lead.rating = rating;
  }
  if (selectedFields.includes("reviewCount")) {
    const match = raw.reviews.replace(/,/g, "").match(/(\d+)/);
    const count = entry.reviewCount ?? (match ? parseInt(match[1], 10) : NaN);
    if (!Number.isNaN(count)) lead.reviewCount = count;
  }

  // Ensure dedup key is set
  if (!lead.id) lead.id = nameAddrKey(lead.name, lead.address);

  // Attach coordinates from place URL for out-of-bounds filtering
  const coords = extractCoords(entry.href);
  if (coords) { lead.lat = coords.lat; lead.lng = coords.lng; }

  return lead;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function scrapeGoogleMapsCell(
  searchTerm: string,
  scope: string,
  location: string,
  cell: GridCell,
  selectedFields: MapsField[],
  page: import("playwright").Page,
  signal?: AbortSignal,
  onPartial?: (leads: MapsLead[]) => void,
  initialNavigationDone = false,
): Promise<MapsLead[]> {
  const searchUrl = buildGoogleMapsSearchUrl(scope, searchTerm, location, cell);

  // Phase 1: scroll the feed, extract everything visible (names + fast fields)
  const entries = await scrapeFeed(page, searchUrl, signal, (visibleEntries) => {
    const partial = visibleEntries
      .map((entry) => feedEntryToLead(entry, selectedFields))
      .filter((lead): lead is MapsLead => lead !== null && lead.name.length > 0);
    if (partial.length > 0) onPartial?.(partial);
  }, initialNavigationDone);
  if (!entries.length || signal?.aborted) return [];

  // Always return feed-level leads immediately. Detail fields are populated by
  // the bounded background detail worker so the UI never waits on every place.
  return entries
    .map((e) => feedEntryToLead(e, selectedFields))
    .filter((l): l is MapsLead => l !== null && l.name.length > 0);
}

export interface MapsDetailResult {
  leadId: string;
  details: Partial<MapsLead> | null;
  error: string | null;
}

/**
 * Extract one place page that Crawlee has already navigated to. Browser pages,
 * deadlines, retries, and concurrency are owned by PlaywrightCrawler.
 */
export async function scrapeGoogleMapsDetailPage(
  source: MapsLead,
  selectedFields: MapsField[],
  page: import("playwright").Page,
): Promise<MapsDetailResult> {
  if (!source.mapsUrl) {
    return { leadId: source.id, details: null, error: "Business has no Google Maps URL" };
  }

  const entry: FeedEntry = {
    href: source.mapsUrl,
    name: source.name,
    rating: source.rating ?? null,
    reviewCount: source.reviewCount ?? null,
    chunks: [],
  };
  const lead = await extractPlaceDetail(page, entry, selectedFields, true);
  if (!lead) {
    return { leadId: source.id, details: null, error: "Google Maps detail page had no business data" };
  }

  const details: Partial<MapsLead> = {};
  for (const field of DETAIL_FIELDS) {
    if (selectedFields.includes(field) && lead[field] !== undefined) {
      Object.assign(details, { [field]: lead[field] });
    }
  }
  return { leadId: source.id, details, error: null };
}
