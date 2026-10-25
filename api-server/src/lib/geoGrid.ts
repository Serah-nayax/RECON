export type MapsScope = "city" | "country" | "continent" | "worldwide";

export const VALID_SCOPES: MapsScope[] = ["city", "country", "continent", "worldwide"];

export interface GridCell {
  index: number;
  lat: number;
  lng: number;
  zoom: number;
  /** Half the cell width/height in degrees — used for gap-free rendering. */
  halfDeg?: number;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  leadsFound: number;
  error?: string;
  /**
   * When set, the scraper builds "searchTerm in <namedLocation>" without
   * lat/lng coordinates (city-style URL). Used only when geocoding fails.
   */
  namedLocation?: string;
  /** Per-cell search term override — takes precedence over job-level searchTerm. */
  searchTerm?: string;
}

interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// ── Nominatim geocoding ───────────────────────────────────────────────────────

/**
 * Geocode a free-text location string using OpenStreetMap Nominatim.
 * Returns the bounding box of the best match, or null on failure.
 * Rate limit: Nominatim allows 1 req/s; we only call this once per job creation.
 */
async function geocodeToBox(location: string): Promise<BoundingBox | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(location)}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "CRAWLee-Maps-Crawler/1.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data: Array<{ boundingbox?: string[] }> = await res.json();
    if (!data.length || !data[0].boundingbox) return null;
    const [s, n, w, e] = data[0].boundingbox.map(Number);
    return { minLat: s, maxLat: n, minLng: w, maxLng: e };
  } catch {
    return null;
  }
}

// ── Known bounding boxes (fast path, no network call) ─────────────────────────

const COUNTRY_BOXES: Record<string, BoundingBox> = {
  "united states": { minLat: 24.5, maxLat: 49.4, minLng: -125, maxLng: -66.9 },
  "usa": { minLat: 24.5, maxLat: 49.4, minLng: -125, maxLng: -66.9 },
  "us": { minLat: 24.5, maxLat: 49.4, minLng: -125, maxLng: -66.9 },
  "united kingdom": { minLat: 49.9, maxLat: 58.7, minLng: -8.2, maxLng: 1.8 },
  "uk": { minLat: 49.9, maxLat: 58.7, minLng: -8.2, maxLng: 1.8 },
  "germany": { minLat: 47.3, maxLat: 55, minLng: 5.9, maxLng: 15.1 },
  "france": { minLat: 41.3, maxLat: 51.1, minLng: -5.1, maxLng: 9.6 },
  "spain": { minLat: 35.9, maxLat: 43.8, minLng: -9.3, maxLng: 4.3 },
  "italy": { minLat: 36.6, maxLat: 47.1, minLng: 6.6, maxLng: 18.5 },
  "australia": { minLat: -43.7, maxLat: -10.7, minLng: 113.3, maxLng: 153.6 },
  "canada": { minLat: 42, maxLat: 83, minLng: -141, maxLng: -52.6 },
  "brazil": { minLat: -33.8, maxLat: 5.3, minLng: -73.9, maxLng: -34.8 },
  "mexico": { minLat: 14.5, maxLat: 32.7, minLng: -117.1, maxLng: -86.7 },
  "china": { minLat: 18, maxLat: 53.6, minLng: 73.5, maxLng: 135.1 },
  "japan": { minLat: 24.2, maxLat: 45.5, minLng: 122.9, maxLng: 145.8 },
  "india": { minLat: 8.1, maxLat: 37.1, minLng: 68.1, maxLng: 97.4 },
  "netherlands": { minLat: 50.8, maxLat: 53.6, minLng: 3.3, maxLng: 7.2 },
  "belgium": { minLat: 49.5, maxLat: 51.5, minLng: 2.5, maxLng: 6.4 },
  "austria": { minLat: 46.4, maxLat: 49.0, minLng: 9.5, maxLng: 17.2 },
  "switzerland": { minLat: 45.8, maxLat: 47.8, minLng: 5.9, maxLng: 10.5 },
  "poland": { minLat: 49.0, maxLat: 54.8, minLng: 14.1, maxLng: 24.2 },
  "sweden": { minLat: 55.3, maxLat: 69.1, minLng: 10.9, maxLng: 24.2 },
  "norway": { minLat: 57.9, maxLat: 71.2, minLng: 4.5, maxLng: 31.1 },
  "denmark": { minLat: 54.6, maxLat: 57.8, minLng: 8.1, maxLng: 15.2 },
  "south africa": { minLat: -34.8, maxLat: -22.1, minLng: 16.5, maxLng: 32.9 },
  "new zealand": { minLat: -46.6, maxLat: -34.4, minLng: 166.4, maxLng: 178.6 },
  "argentina": { minLat: -55.1, maxLat: -21.8, minLng: -73.6, maxLng: -53.7 },
  "south korea": { minLat: 33.1, maxLat: 38.6, minLng: 125.1, maxLng: 129.6 },
  "singapore": { minLat: 1.1, maxLat: 1.5, minLng: 103.6, maxLng: 104.1 },
  "uae": { minLat: 22.6, maxLat: 26.1, minLng: 51, maxLng: 56.4 },
  "united arab emirates": { minLat: 22.6, maxLat: 26.1, minLng: 51, maxLng: 56.4 },
  "portugal": { minLat: 36.9, maxLat: 42.2, minLng: -9.5, maxLng: -6.2 },
  "ireland": { minLat: 51.4, maxLat: 55.4, minLng: -10.5, maxLng: -6 },
  "czech republic": { minLat: 48.5, maxLat: 51.1, minLng: 12.1, maxLng: 18.9 },
  "russia": { minLat: 41.2, maxLat: 81.9, minLng: 19.6, maxLng: 180 },
  "turkey": { minLat: 35.8, maxLat: 42.1, minLng: 25.6, maxLng: 44.8 },
  "chile": { minLat: -55.9, maxLat: -17.5, minLng: -75.6, maxLng: -66.4 },
  "colombia": { minLat: -4.2, maxLat: 12.4, minLng: -81.7, maxLng: -66.9 },
  "peru": { minLat: -18.4, maxLat: 0, minLng: -81.3, maxLng: -68.7 },
  "venezuela": { minLat: 0.6, maxLat: 12.2, minLng: -73.4, maxLng: -59.8 },
  "indonesia": { minLat: -11, maxLat: 5.9, minLng: 95.0, maxLng: 141.0 },
  "malaysia": { minLat: 0.9, maxLat: 7.4, minLng: 99.6, maxLng: 119.3 },
  "thailand": { minLat: 5.6, maxLat: 20.5, minLng: 97.3, maxLng: 105.6 },
  "vietnam": { minLat: 8.4, maxLat: 23.4, minLng: 102.1, maxLng: 109.5 },
  "philippines": { minLat: 4.6, maxLat: 21.1, minLng: 116.9, maxLng: 126.6 },
  "pakistan": { minLat: 23.7, maxLat: 37.1, minLng: 60.9, maxLng: 77.8 },
  "bangladesh": { minLat: 20.7, maxLat: 26.6, minLng: 88.0, maxLng: 92.7 },
  "egypt": { minLat: 22.0, maxLat: 31.7, minLng: 24.7, maxLng: 37.2 },
  "nigeria": { minLat: 4.3, maxLat: 13.9, minLng: 2.7, maxLng: 14.7 },
  "kenya": { minLat: -4.7, maxLat: 4.6, minLng: 33.9, maxLng: 41.9 },
  "ghana": { minLat: 4.7, maxLat: 11.2, minLng: -3.3, maxLng: 1.2 },
  "ethiopia": { minLat: 3.4, maxLat: 14.9, minLng: 33.0, maxLng: 47.9 },
  "greece": { minLat: 34.8, maxLat: 41.7, minLng: 19.4, maxLng: 29.6 },
  "romania": { minLat: 43.6, maxLat: 48.3, minLng: 20.3, maxLng: 29.7 },
  "hungary": { minLat: 45.7, maxLat: 48.6, minLng: 16.1, maxLng: 22.9 },
  "finland": { minLat: 59.8, maxLat: 70.1, minLng: 20.0, maxLng: 31.6 },
  "ukraine": { minLat: 44.4, maxLat: 52.4, minLng: 22.1, maxLng: 40.2 },
  "israel": { minLat: 29.5, maxLat: 33.3, minLng: 34.3, maxLng: 35.9 },
  "saudi arabia": { minLat: 16.4, maxLat: 32.2, minLng: 34.6, maxLng: 55.7 },
  "iran": { minLat: 25.1, maxLat: 39.8, minLng: 44.0, maxLng: 63.3 },
  "iraq": { minLat: 29.1, maxLat: 37.4, minLng: 38.8, maxLng: 48.6 },
  "morocco": { minLat: 27.7, maxLat: 35.9, minLng: -13.2, maxLng: -1.0 },
  "algeria": { minLat: 18.9, maxLat: 37.1, minLng: -8.7, maxLng: 12.0 },
  "taiwan": { minLat: 21.9, maxLat: 25.3, minLng: 120.0, maxLng: 122.0 },
  "hong kong": { minLat: 22.1, maxLat: 22.6, minLng: 113.8, maxLng: 114.5 },
  "cambodia": { minLat: 10.4, maxLat: 14.7, minLng: 102.3, maxLng: 107.6 },
  "myanmar": { minLat: 9.6, maxLat: 28.5, minLng: 92.2, maxLng: 101.2 },
  "sri lanka": { minLat: 5.9, maxLat: 9.8, minLng: 79.7, maxLng: 81.9 },
  "nepal": { minLat: 26.4, maxLat: 30.4, minLng: 80.1, maxLng: 88.2 },
};

const CONTINENT_BOXES: Record<string, BoundingBox> = {
  "north america": { minLat: 14.5, maxLat: 72, minLng: -168, maxLng: -52 },
  "south america": { minLat: -56, maxLat: 13, minLng: -82, maxLng: -34 },
  "europe": { minLat: 35, maxLat: 71, minLng: -25, maxLng: 45 },
  "africa": { minLat: -35, maxLat: 38, minLng: -18, maxLng: 52 },
  "asia": { minLat: 1, maxLat: 55, minLng: 26, maxLng: 145 },
  "oceania": { minLat: -47, maxLat: -10, minLng: 112, maxLng: 179 },
  "middle east": { minLat: 12, maxLat: 42, minLng: 25, maxLng: 63 },
};

export const SUPPORTED_CONTINENTS = Object.keys(CONTINENT_BOXES);

// ── Grid generation helpers ───────────────────────────────────────────────────

function boxToGrid(
  box: BoundingBox,
  degreesPerCell: number,
): Array<{ lat: number; lng: number; zoom: number; halfDeg: number }> {
  const cells: Array<{ lat: number; lng: number; zoom: number; halfDeg: number }> = [];
  const zoom =
    degreesPerCell >= 10 ? 8 :
    degreesPerCell >= 5  ? 9 :
    degreesPerCell >= 2  ? 10 :
    degreesPerCell >= 0.5 ? 11 :
    degreesPerCell >= 0.15 ? 12 :
    degreesPerCell >= 0.06 ? 13 :
    degreesPerCell >= 0.03 ? 14 : 15;

  const half = degreesPerCell / 2;

  // Include a cell if any part of it overlaps the bbox (lat < maxLat + half)
  // so the top/right edges are never left uncovered.
  for (let lat = box.minLat + half; lat < box.maxLat + half; lat += degreesPerCell) {
    for (let lng = box.minLng + half; lng < box.maxLng + half; lng += degreesPerCell) {
      cells.push({
        lat: Math.round(lat * 10000) / 10000,
        lng: Math.round(lng * 10000) / 10000,
        zoom,
        halfDeg: half,
      });
    }
  }
  return cells;
}

/**
 * Tile a bounding box into a city-scale grid.
 * Targets ~9–16 cells (3×3 to 4×4) regardless of physical city size.
 */
function tileLocationBox(box: BoundingBox, label: string): GridCell[] {
  const width = box.maxLng - box.minLng;
  const height = box.maxLat - box.minLat;
  const maxDim = Math.max(width, height);
  // Target ~3 cells per dimension
  const deg = Math.max(maxDim / 3, 0.01);
  return boxToGrid(box, deg).map((c, i) => ({
    index: i,
    lat: c.lat,
    lng: c.lng,
    zoom: c.zoom,
    halfDeg: c.halfDeg,
    label: `${label} cell ${i + 1} (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})`,
    status: "pending" as const,
    leadsFound: 0,
  }));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate the geo-grid for a Maps search job.
 *
 * - City scope: geocodes the location via Nominatim → tiles the bounding box.
 * - Country (known): tiles from hardcoded bounding box.
 * - Country (unknown): geocodes via Nominatim → tiles the bounding box.
 * - Continent: tiles from hardcoded bounding box (throws on unknown input).
 * - Worldwide: fixed global grid.
 *
 * @throws {Error} when the continent name is not recognised.
 */
/**
 * Choose a cell size (degrees) that produces ~16–25 cells for any bounding box.
 * Clamps to sane min/max values so city grids aren't too granular or continent
 * grids aren't too coarse.
 */
function autoDeg(box: BoundingBox): number {
  const w = box.maxLng - box.minLng;
  const h = box.maxLat - box.minLat;
  const maxDim = Math.max(w, h);
  // Target ~4 cells per largest dimension
  const raw = maxDim / 4;
  // Clamp: smallest = ~city-block (0.03°), largest = continent (15°)
  return Math.min(Math.max(raw, 0.03), 15);
}

/**
 * Smart grid: accepts any free-text area (city, neighborhood, state, country,
 * continent) and auto-detects the right grid density from the geocoded bbox.
 * Falls back to named-location if geocoding fails.
 */
export async function generateSmartGrid(
  area: string,
  _searchTerm: string,
): Promise<GridCell[]> {
  const key = area.toLowerCase().trim();

  // ── Worldwide shortcut ─────────────────────────────────────────────────────
  if (!key || key === "worldwide" || key === "world") {
    const worldBox: BoundingBox = { minLat: -60, maxLat: 72, minLng: -180, maxLng: 180 };
    return boxToGrid(worldBox, 10).map((c, i) => ({
      index: i, lat: c.lat, lng: c.lng, zoom: c.zoom, halfDeg: c.halfDeg,
      label: `Worldwide cell ${i + 1} (${c.lat.toFixed(1)}, ${c.lng.toFixed(1)})`,
      status: "pending" as const, leadsFound: 0,
    }));
  }

  // ── Known continent ────────────────────────────────────────────────────────
  if (CONTINENT_BOXES[key]) {
    const box = CONTINENT_BOXES[key];
    const deg = autoDeg(box);
    return boxToGrid(box, deg).map((c, i) => ({
      index: i, lat: c.lat, lng: c.lng, zoom: c.zoom, halfDeg: c.halfDeg,
      label: `${area} cell ${i + 1} (${c.lat.toFixed(1)}, ${c.lng.toFixed(1)})`,
      status: "pending" as const, leadsFound: 0,
    }));
  }

  // ── Known country ──────────────────────────────────────────────────────────
  if (COUNTRY_BOXES[key]) {
    const box = COUNTRY_BOXES[key];
    const deg = autoDeg(box);
    return boxToGrid(box, deg).map((c, i) => ({
      index: i, lat: c.lat, lng: c.lng, zoom: c.zoom, halfDeg: c.halfDeg,
      label: `${area} cell ${i + 1} (${c.lat.toFixed(2)}, ${c.lng.toFixed(2)})`,
      status: "pending" as const, leadsFound: 0,
    }));
  }

  // ── Geocode anything else (city, state, region, neighborhood…) ─────────────
  const box = await geocodeToBox(area);
  if (box) {
    let deg = autoDeg(box);
    let rawCells = boxToGrid(box, deg);

    // Safety cap: Nominatim sometimes returns a much larger bounding box than
    // expected (e.g. a metropolitan statistical area or the whole state).
    // Recalculate with a larger cell size when that happens.
    const MAX_GEOCODED_CELLS = 36;
    if (rawCells.length > MAX_GEOCODED_CELLS) {
      const w = Math.abs(box.maxLng - box.minLng);
      const h = Math.abs(box.maxLat - box.minLat);
      deg = Math.max(Math.sqrt((w * h) / 16), 0.05);
      rawCells = boxToGrid(box, deg);
    }

    // Set namedLocation on every cell so the scraper adds "in <area>" to the
    // search query — this geographically constrains Google Maps to the area
    // while the lat/lng coordinates focus each cell on a different sub-region.
    return rawCells.map((c, i) => ({
      index: i, lat: c.lat, lng: c.lng, zoom: c.zoom, halfDeg: c.halfDeg,
      label: `${area} cell ${i + 1} (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})`,
      status: "pending" as const, leadsFound: 0,
      namedLocation: area,
    }));
  }

  // ── Geocoding failed — named-location fallback (no real coordinates) ────────
  return [
    {
      index: 0, lat: 0, lng: 0, zoom: 13,
      label: area, status: "pending", leadsFound: 0,
      namedLocation: area,
    },
  ];
}

/**
 * Generate a grid directly from a bounding box (no geocoding needed).
 * Used when the user draws a rectangle on the map.
 */
export function generateGridFromBbox(
  bbox: BoundingBox,
  _searchTerm: string,
): GridCell[] {
  const deg = autoDeg(bbox);
  return boxToGrid(bbox, deg).map((c, i) => ({
    index: i, lat: c.lat, lng: c.lng, zoom: c.zoom, halfDeg: c.halfDeg,
    label: `Custom area cell ${i + 1} (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})`,
    status: "pending" as const, leadsFound: 0,
  }));
}

/** @deprecated Use generateSmartGrid — keeping for backwards compat */
export async function generateGrid(
  scope: MapsScope,
  location: string,
  searchTerm: string,
): Promise<GridCell[]> {
  if (scope === "worldwide" || !location) {
    return generateSmartGrid("worldwide", searchTerm);
  }
  return generateSmartGrid(location, searchTerm);
}

export function estimateTimeMinutes(totalCells: number): number {
  return Math.ceil(totalCells * 1.0);
}
