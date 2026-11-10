import type { GridCell } from "./geoGrid.js";

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
  /** The search term whose cell first listed the place (measures what each term brings). */
  foundBy?: string;
  /** That cell's index in the job. */
  foundInCell?: number;
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
  // Both halves are "0x…" (e.g. 0x47e66e39596a4c91:0x8e2959f40f42a814). The old
  // pattern stopped at the second "x", so places in the same building collided.
  const m = url.match(/1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
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

// ── Place data from Google's own search responses ─────────────────────────────
//
// Every batch of ~20 results in the feed comes from a /search?tbm=map response that
// already holds each place's website, phone, full address, categories, coordinates
// and today's hours. Reading it gives "deep" data for every lead without opening one
// place page per lead (the old detail pass, ~3-5s per lead).

interface SearchPlaceData {
  name?: string;
  reviewCount?: number;
  closed?: boolean;
  phone?: string;
  website?: string;
  address?: string;
  category?: string;
  hours?: string;
  rating?: number;
  lat?: number;
  lng?: number;
}

interface SearchCollector {
  places: Map<string, SearchPlaceData>;
  pending: Set<Promise<void>>;
  /** Search requests (one per batch of ~20 places) sent so far / still waiting for an answer. */
  requestsSent: number;
  requestsInFlight: number;
  /** URL of the last search request: replayed with the next offsets instead of scrolling. */
  lastSearchUrl?: string;
  /** Places of each search answer, by "<url without offset>#<offset>": reused by a replay. */
  pageByKey: Map<string, Map<string, SearchPlaceData>>;
}

/** Key of a search answer: the same search at the same offset gives the same key. */
function searchPageKey(url: string): string {
  return `${url.replace(OFFSET_RX, "")}#${Number(url.match(OFFSET_RX)?.[1] ?? 0)}`;
}

const searchCollectors = new WeakMap<import("playwright").Page, SearchCollector>();

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function readSearchPlace(p: unknown[]): SearchPlaceData {
  const at = (...path: number[]): unknown =>
    path.reduce<unknown>((v, i) => (Array.isArray(v) ? v[i] : undefined), p);
  const categories = Array.isArray(p[13]) ? (p[13] as unknown[]).map(str).filter(Boolean) : [];
  const today = at(203, 0, 0);
  const hours = Array.isArray(today) && str(today[0]) && str(at(203, 0, 0, 3, 0, 0))
    ? `${today[0]}: ${at(203, 0, 0, 3, 0, 0)}`
    : undefined;
  const website = str(at(7, 0));
  return {
    name: str(p[11]),
    reviewCount: num(at(4, 8)),
    closed: /Permanently closed/i.test(JSON.stringify(p)),
    website: website && !/google\.com/.test(website) ? website : undefined,
    phone: str(at(178, 0, 0)),
    address: str(p[39]) ?? str(p[18]),
    category: categories.length ? categories.join(", ") : undefined,
    hours,
    rating: num(at(4, 7)),
    lat: num(at(9, 2)),
    lng: num(at(9, 3)),
  };
}

function parseSearchResponse(text: string, into: Map<string, SearchPlaceData>): void {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\)\]\}'\s*/, ""));
  } catch {
    return;
  }
  // Place records are arrays with the name at [11], the "0x…:0x…" place id at [10]
  // and coordinates at [9][2..3]; their depth varies between the first and later pages.
  const walk = (x: unknown, depth: number) => {
    if (!Array.isArray(x) || depth > 12) return;
    if (typeof x[11] === "string" && typeof x[10] === "string" && Array.isArray(x[9])) {
      into.set(x[10], readSearchPlace(x));
      return;
    }
    for (const y of x) walk(y, depth + 1);
  };
  walk(data, 0);
}

/**
 * Start recording search responses on a page. Call before navigating to the search
 * URL (Crawlee pre-navigation hook) so the first batch of results is not missed.
 */
export function collectSearchResponses(page: import("playwright").Page): void {
  if (searchCollectors.has(page)) return;
  const collector: SearchCollector = { places: new Map(), pending: new Set(), requestsSent: 0, requestsInFlight: 0, pageByKey: new Map() };
  searchCollectors.set(page, collector);
  const isSearch = (request: import("playwright").Request) => request.url().includes("tbm=map");
  page.on("request", (request) => {
    if (!isSearch(request)) return;
    collector.lastSearchUrl = request.url();
    collector.requestsSent++;
    collector.requestsInFlight++;
  });
  const settle = (request: import("playwright").Request) => {
    if (isSearch(request)) collector.requestsInFlight = Math.max(0, collector.requestsInFlight - 1);
  };
  page.on("requestfinished", settle);
  page.on("requestfailed", settle);
  page.on("response", (response) => {
    if (!response.url().includes("tbm=map")) return;
    const key = searchPageKey(response.url());
    const job = response
      .text()
      .then((text) => {
        const found = new Map<string, SearchPlaceData>();
        parseSearchResponse(text, found);
        collector.pageByKey.set(key, found);
        for (const [placeId, place] of found) collector.places.set(placeId, place);
      })
      .catch(() => { /* body unavailable (navigation, closed page) */ });
    collector.pending.add(job);
    void job.finally(() => collector.pending.delete(job));
  });
}

/** Fill a feed lead with the search-response data for the same place, if captured. */
function applySearchData(lead: MapsLead, place: SearchPlaceData | undefined, selectedFields: MapsField[]): MapsLead {
  if (!place) return lead;
  for (const field of ["phone", "website", "address", "category", "hours", "rating"] as const) {
    const value = place[field];
    if (value !== undefined && selectedFields.includes(field)) Object.assign(lead, { [field]: value });
  }
  if (place.lat !== undefined && place.lng !== undefined) {
    lead.lat = place.lat;
    lead.lng = place.lng;
  }
  // Search data is as complete as the place page (minus the full week of hours).
  lead.detailStatus = "done";
  lead.detailError = null;
  return lead;
}

// ── Raw data extracted directly from the feed DOM ─────────────────────────────

interface FeedEntry {
  href: string;
  name: string;
  rating: number | null;
  reviewCount: number | null;
  /** Raw text chunks from card content — used to parse category and address. */
  chunks: string[];
  /** Card shows "Permanently closed". */
  closed?: boolean;
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
      closed: boolean;
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

      results.push({ href, name, rating, reviewCount, chunks, closed: /Permanently closed/.test(card?.textContent ?? "") });
    }

    return results;
  });
}

// ── Phase 1: scroll the feed and extract everything in one evaluate() pass ────

const NO_RESULTS_RX = /can['’]t find|No results found/i;

/** Google's banner when it limits a session (it shows fewer places): the cell may be incomplete. */
const LIMITED_VIEW_RX = /limited view of Google Maps|affichage limit[ée]/i;
const limitedViewPages = new WeakMap<import("playwright").Page, boolean>();

/** True when Google showed its limited-view banner for the last cell scraped on this page. */
export function isLimitedView(page: import("playwright").Page): boolean {
  return limitedViewPages.get(page) ?? false;
}

/** How long a scroll waits for Google to load more places before deciding the list is complete. */
const SCROLL_WAIT_MS = Number(process.env.MAPS_SCROLL_WAIT_MS ?? 6000);
/** Without a search request this long after a scroll, Google is not loading more places. */
const QUICK_END_MS = 2000;

// Each scroll makes Google send one search request for the next ~20 places ("!8i<offset>"
// in its URL). Sending those same requests directly, one after the other, gets the same
// places without rendering them or waiting for the feed (~35s per cell when scrolling).
const REPLAY_ENABLED = process.env.MAPS_REPLAY !== "0";
const REPLAY_MAX_PAGES = 20;
/** Pause between two replayed requests: no faster than a person scrolling quickly. */
const REPLAY_PAUSE_MS = 400;
/** Replayed pages asked for at once (1 = one after the other, as before). */
const REPLAY_PARALLEL = Math.max(1, Number(process.env.MAPS_REPLAY_PARALLEL ?? 3));
const OFFSET_RX = /!8i(\d+)/;

export interface ReplayStats {
  /** Search requests replayed for the cell. */
  pages: number;
  /** Places found by those requests that the feed did not show yet. */
  places: number;
  /** Google did not answer the replayed request: the cell was scrolled instead. */
  fellBack: boolean;
  /** Diagnostics: places per replayed page, places the feed showed, page size. */
  foundPerPage?: number[];
  shownInFeed?: number;
  pageSize?: number;
  /** Pages already answered during the scroll, reused without asking Google again. */
  cachedPages?: number;
  /** Search URL of the first replay in this process, logged once to learn Google's format. */
  sampleUrl?: string;
}
let sampleUrlLogged = false;
const replayStatsPages = new WeakMap<import("playwright").Page, ReplayStats | null>();

// Diagnostics: where a cell's time goes (navigation, feed, scroll, waits, replay).
const navStartedAt = new WeakMap<import("playwright").Page, number>();
const phaseTimings = new WeakMap<import("playwright").Page, Record<string, number>>();

/** Called before Crawlee navigates a cell page, to time the page load. */
export function markNavigationStart(page: import("playwright").Page): void {
  navStartedAt.set(page, Date.now());
}

/** Milliseconds spent in each phase of the last cell scraped on this page. */
export function lastPhaseTimings(page: import("playwright").Page): Record<string, number> | null {
  return phaseTimings.get(page) ?? null;
}

function addPhase(page: import("playwright").Page, phase: string, since: number): number {
  const now = Date.now();
  const timings = phaseTimings.get(page) ?? {};
  timings[phase] = (timings[phase] ?? 0) + (now - since);
  phaseTimings.set(page, timings);
  return now;
}

/** Google showed its end-of-list marker for the last cell scraped on this page. */
const listEndPages = new WeakMap<import("playwright").Page, boolean>();
export function listEndSeen(page: import("playwright").Page): boolean {
  return listEndPages.get(page) ?? false;
}

/** How the last cell scraped on this page used replayed requests (null: it only scrolled). */
export function lastReplayStats(page: import("playwright").Page): ReplayStats | null {
  return replayStatsPages.get(page) ?? null;
}

/** A feed entry for a place known only from a search response (never rendered in the feed). */
function searchPlaceToEntry(placeId: string, place: SearchPlaceData): FeedEntry | null {
  if (!place.name) return null;
  const at = place.lat !== undefined && place.lng !== undefined ? `/@${place.lat},${place.lng},17z` : "";
  return {
    href: `https://www.google.com/maps/place/${encodeURIComponent(place.name)}${at}/data=!4m2!3m1!1s${placeId}`,
    name: place.name,
    rating: place.rating ?? null,
    reviewCount: place.reviewCount ?? null,
    chunks: [],
    closed: place.closed,
  };
}

/**
 * Fetches the pages after `searchUrl` until Google has no more places. Returns the new
 * entries, or null when Google does not answer the first replayed request (scroll instead).
 */
async function replaySearchPages(
  page: import("playwright").Page,
  collector: SearchCollector,
  searchUrl: string,
  knownIds: Set<string>,
  signal: AbortSignal | undefined,
  maxPlaces: number | undefined,
  onEntries: (entries: FeedEntry[]) => void,
): Promise<{ entries: FeedEntry[]; pages: number; foundPerPage: number[]; shownInFeed: number; pageSize: number; cachedPages: number; sampleUrl?: string } | null> {
  const pageSize = Number(searchUrl.match(/!7i(\d+)/)?.[1] ?? 20);
  const base = searchUrl.replace(OFFSET_RX, "");
  // Start from the first page: the feed may not have shown every place of the pages Google
  // already sent (starting after them lost ~10 places per cell). Pages already received
  // during the scroll are reused; known places are skipped below.
  const shownInFeed = knownIds.size;
  const entries: FeedEntry[] = [];
  const foundPerPage: number[] = [];
  let cachedPages = 0;
  let offset = 0;
  // Pages fetched ahead (REPLAY_PARALLEL at a time) and not read yet, by offset.
  const prefetched = new Map<number, string>();
  while (foundPerPage.length < REPLAY_MAX_PAGES && !signal?.aborted) {
    let found = collector.pageByKey.get(`${base}#${offset}`);
    if (found) {
      cachedPages++;
    } else {
      if (!prefetched.has(offset)) {
        // Ask for this page and the next uncached ones together: the same requests as one
        // by one, in a fraction of the time. Pages past the end of the list cost one wasted
        // request at most and are never read.
        const offsets: number[] = [];
        for (let o = offset; offsets.length < REPLAY_PARALLEL && foundPerPage.length + (o - offset) / pageSize < REPLAY_MAX_PAGES; o += pageSize) {
          if (!collector.pageByKey.has(`${base}#${o}`)) offsets.push(o);
        }
        const fetchStartedAt = Date.now();
        const texts = await page
          .evaluate(async (urls) =>
            Promise.all(
              urls.map(async (url) => {
                try {
                  const res = await fetch(url, { credentials: "include" });
                  return res.ok ? await res.text() : "";
                } catch {
                  return "";
                }
              }),
            ),
            offsets.map((o) => searchUrl.replace(OFFSET_RX, `!8i${o}`)),
          )
          .catch(() => offsets.map(() => ""));
        addPhase(page, "replayFetch", fetchStartedAt);
        offsets.forEach((o, k) => prefetched.set(o, texts[k] ?? ""));
        await sleep(REPLAY_PAUSE_MS);
      }
      const text = prefetched.get(offset) ?? "";
      prefetched.delete(offset);
      // Not a search answer (refused, consent page, error): the caller scrolls instead.
      if (!/^\)\]\}'/.test(text)) return null;
      const parseStartedAt = Date.now();
      found = new Map<string, SearchPlaceData>();
      parseSearchResponse(text, found);
      addPhase(page, "replayParse", parseStartedAt);
    }
    foundPerPage.push(found.size);
    let added = 0;
    for (const [placeId, place] of found) {
      collector.places.set(placeId, place);
      if (knownIds.has(placeId)) continue;
      const entry = searchPlaceToEntry(placeId, place);
      if (!entry) continue;
      knownIds.add(placeId);
      entries.push(entry);
      added++;
    }
    if (added) onEntries(entries);
    offset += pageSize;
    // Past what the feed showed, a page with nothing new means Google has no more places.
    // Pages are not always full (a 20-place page can hold fewer records), so only an
    // empty one or a nearly empty one ends the list.
    if (!found.size) break;
    if (offset >= shownInFeed && (!added || found.size < pageSize / 2)) break;
    if (maxPlaces !== undefined && knownIds.size >= maxPlaces) break;
  }
  let sampleUrl: string | undefined;
  if (!sampleUrlLogged) {
    sampleUrlLogged = true;
    sampleUrl = searchUrl.slice(0, 600);
  }
  return { entries, pages: foundPerPage.length, foundPerPage, shownInFeed, pageSize, cachedPages, sampleUrl };
}

/** Google Maps answered the search with no results: the cell is done, not failed. */
export class MapsNoResultsError extends Error {
  constructor() {
    super("Google Maps found no results for this search in this area");
    this.name = "MapsNoResultsError";
  }
}

async function scrapeFeed(
  page: import("playwright").Page,
  searchUrl: string,
  signal?: AbortSignal,
  onEntries?: (entries: FeedEntry[]) => void,
  initialNavigationDone = false,
  maxPlaces?: number,
): Promise<FeedEntry[]> {
  const localizedUrl = searchUrl.includes("?")
    ? `${searchUrl}&hl=en&gl=au`
    : `${searchUrl}?hl=en&gl=au`;
  const urls = [
    localizedUrl,
    searchUrl,
  ];
  let phaseStart = Date.now();
  phaseTimings.set(page, {});
  const navStart = navStartedAt.get(page);
  if (initialNavigationDone && navStart !== undefined) addPhase(page, "navigation", navStart);

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

    // Wait for whichever comes first: the results list, a late redirect to a single
    // place (1 result), or Google's "can't find" message (0 results). Without this, an
    // empty search waited for the feed and was retried 3 times as if Google failed.
    const outcome = await Promise.race(
      [
        page.waitForSelector('div[role="feed"]', { timeout: 15000 }).then(() => "feed" as const),
        page.waitForURL(/\/maps\/place\//, { timeout: 15000 }).then(() => "place" as const),
        page.getByText(NO_RESULTS_RX).first().waitFor({ timeout: 15000 }).then(() => "none" as const),
      ].map((p) => p.catch(() => "timeout" as const)),
    );
    if (outcome === "feed") break;
    if (outcome === "none") throw new MapsNoResultsError();
    if (outcome === "place") {
      const name = await page.locator("h1").first().textContent({ timeout: 5000 }).catch(() => "");
      if (name?.trim()) {
        return [{ href: page.url(), name: name.trim(), rating: null, reviewCount: null, chunks: [] }];
      }
    }
    if (attempt === urls.length - 1) return [];
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
  phaseStart = addPhase(page, "feed", phaseStart);

  // Scroll until all results are loaded. Google loads ~20 places per scroll and the next
  // batch can take several seconds when the machine is busy (parallel pages), so wait for
  // the count to grow instead of stopping after a fixed short pause: a 2.8s cutoff stopped
  // cells at 20/40/60 places when Google had more.
  const collector = searchCollectors.get(page);
  const placeLinks = page.locator('a[href*="/maps/place/"]');
  const endMarker = page.locator('span:has-text("You\'ve reached the end"), span:has-text("No more results")');
  let prevCount = await placeLinks.count();
  let stable = 0;
  let replayAllowed = REPLAY_ENABLED;
  let replayed: FeedEntry[] = [];
  replayStatsPages.set(page, null);
  listEndPages.set(page, false);
  for (let i = 0; i < 40 && !signal?.aborted; i++) {
    // Step back up a little first: if the feed is already at the bottom, setting scrollTop
    // to the max fires no scroll event and Google never loads the next batch.
    await page.evaluate(async () => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return;
      feed.scrollTop = Math.max(0, feed.scrollHeight - feed.clientHeight - 400);
      await new Promise((r) => setTimeout(r, 150));
      feed.scrollTop = feed.scrollHeight;
    });

    let count = prevCount;
    let ended = false;
    const scrolledAt = Date.now();
    const sentBefore = collector?.requestsSent ?? 0;
    const waitUntil = scrolledAt + SCROLL_WAIT_MS;
    while (Date.now() < waitUntil && !signal?.aborted) {
      await sleep(400);
      count = await placeLinks.count();
      ended = (await endMarker.count()) > 0;
      if (count > prevCount || ended) break;
      // Google asks for each batch right after the scroll: no search request since then and
      // none in flight means it has nothing more to load, so don't sit out the full wait
      // (limited view shows no end marker: ~12s lost per cell). Only once this page has been
      // seen loading batches that way, else fall back to waiting.
      if (
        collector && collector.requestsSent > 0 && Date.now() - scrolledAt >= QUICK_END_MS &&
        collector.requestsSent === sentBefore && collector.requestsInFlight === 0
      ) break;
    }
    const visible = count > prevCount ? await emitVisibleEntries() : null;
    if (ended) listEndPages.set(page, true);
    if (ended || (maxPlaces !== undefined && count >= maxPlaces)) break;

    // This scroll's batch came from a search request: fetch the following ones directly.
    const lastUrl = collector?.lastSearchUrl;
    if (replayAllowed && visible && collector && lastUrl && OFFSET_RX.test(lastUrl) && collector.requestsSent > sentBefore) {
      const knownIds = new Set(visible.map((entry) => extractPlaceId(entry.href)));
      phaseStart = addPhase(page, "scroll", phaseStart);
      // Answers still being read must be stored before the replay looks for them.
      await Promise.race([Promise.allSettled([...collector.pending]), sleep(3000)]);
      phaseStart = addPhase(page, "pendingWait", phaseStart);
      const result = await replaySearchPages(page, collector, lastUrl, knownIds, signal, maxPlaces, (entries) =>
        onEntries?.([...visible, ...entries]),
      );
      phaseStart = addPhase(page, "replay", phaseStart);
      if (result) {
        const { entries, ...stats } = result;
        replayed = entries;
        replayStatsPages.set(page, { ...stats, places: entries.length, fellBack: false });
        break;
      }
      replayAllowed = false;
      replayStatsPages.set(page, { pages: 1, places: 0, fellBack: true });
    }

    if (count === prevCount) {
      // Nothing new after 6s: nudge once more before deciding the list is complete.
      if (++stable >= 2) break;
      await page.hover('div[role="feed"]', { timeout: 2000 }).catch(() => {});
      await page.mouse.wheel(0, 3000).catch(() => {});
    } else {
      stable = 0;
    }
    prevCount = count;
  }

  if (signal?.aborted) return [];
  addPhase(page, "scroll", phaseStart);

  // Extract everything that's already in the DOM — no reload needed.
  if (!replayed.length) return emitVisibleEntries();
  const visible = await extractVisibleFeedEntries(page);
  const visibleIds = new Set(visible.map((entry) => extractPlaceId(entry.href)));
  return [...visible, ...replayed.filter((entry) => !visibleIds.has(extractPlaceId(entry.href)))];
}

// ── Map a FeedEntry to a MapsLead using only feed data (fast mode) ───────────

/**
 * A Maps card reads "<name><rating>(<reviews>)<category> · <price> · <address><Open · Closes …>".
 * Card containers often concatenate those spans, so parse the whole line instead of
 * guessing which chunk is which.
 */
function parseCardInfo(entry: FeedEntry): { category?: string; address?: string } {
  const full =
    entry.chunks.find((t) => t.startsWith(entry.name) && t.length > entry.name.length) ??
    entry.chunks.find((t) => t.includes("·") && !/^(Open|Closed|Opens|Closes)\b/.test(t));
  if (!full) return {};

  const info = (full.startsWith(entry.name) ? full.slice(entry.name.length) : full)
    .replace(/^\s*\d[.,]\d\s*\([\d.,\s]+\)/, "") // rating + review count
    .replace(/^\s*No reviews/, "")
    .replace(/(?:Open|Closed|Opens|Temporarily closed|Permanently closed)(?: ·| 24 hours|$).*$/, "");

  const parts = info.split("·").map((p) => p.trim()).filter(Boolean);
  const category = parts.find((p) => !/\d/.test(p) && !/^[$€£¥₩]+(\s*[-–]\s*[$€£¥₩]+)?$/.test(p) && p.length <= 60);
  const address = [...parts].reverse().find((p) => p !== category && /\d|,/.test(p) && !/^[$€£¥₩]/.test(p));
  return { category, address };
}

function feedEntryToLead(entry: FeedEntry, selectedFields: MapsField[]): MapsLead | null {
  if (!entry.name) return null;
  // Closed venues are not leads (the page loads with hl=en, so the label is English).
  if (entry.closed) return null;

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

  // Parse category and address from the card text.
  const { category, address } = parseCardInfo(entry);
  if (selectedFields.includes("category") && category) lead.category = category;
  if (selectedFields.includes("address") && address) lead.address = address;

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
  maxPlaces?: number,
): Promise<MapsLead[]> {
  const searchUrl = buildGoogleMapsSearchUrl(scope, searchTerm, location, cell);
  // Normally attached by the pre-navigation hook; this covers callers that navigate here.
  collectSearchResponses(page);
  const collector = searchCollectors.get(page)!;

  const toLeads = (feedEntries: FeedEntry[]) =>
    feedEntries
      .map((entry) => feedEntryToLead(entry, selectedFields))
      .filter((lead): lead is MapsLead => lead !== null && lead.name.length > 0)
      .map((lead) => applySearchData(lead, collector.places.get(lead.id), selectedFields));

  // Phase 1: scroll the feed, extract everything visible (names + fast fields)
  const entries = await scrapeFeed(page, searchUrl, signal, (visibleEntries) => {
    const partial = toLeads(visibleEntries);
    if (partial.length > 0) onPartial?.(partial);
  }, initialNavigationDone, maxPlaces);
  limitedViewPages.set(page, (await page.getByText(LIMITED_VIEW_RX).count().catch(() => 0)) > 0);
  if (!entries.length || signal?.aborted) return [];

  // Let the last search responses finish parsing before matching them to the feed.
  const finalWaitStart = Date.now();
  await Promise.race([Promise.allSettled([...collector.pending]), sleep(3000)]);
  addPhase(page, "finalWait", finalWaitStart);

  // Leads matched to search data come back complete (detailStatus "done"); only the
  // rest need the background detail pass.
  return toLeads(entries);
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
  // The detail page has the full address and exact category; prefer them over the card text.
  for (const field of [...DETAIL_FIELDS, "address", "category"] as const) {
    if (selectedFields.includes(field) && lead[field] !== undefined) {
      Object.assign(details, { [field]: lead[field] });
    }
  }
  return { leadId: source.id, details, error: null };
}
