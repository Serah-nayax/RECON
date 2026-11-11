// Areas the user can search: any country, region, department, city or district known to
// OpenStreetMap, with its exact outline. All sources are free and keyless:
//  - the area list in data/places.json.gz (gazetteer.ts): instant suggestions while typing;
//  - Photon (photon.komoot.io): more suggestions (districts, small towns) when the list has few.
//    It often takes several seconds, so it only completes the list;
//  - Nominatim (nominatim.openstreetmap.org): the outline of the chosen area.
//    Its usage policy allows at most 1 request per second: calls are queued below.
//
// The outline matters for completeness and for precision: a country's bounding box is mostly
// sea or neighbouring countries (Japan's box spans 20°N-46°N, 122°E-154°E: most of it is the
// Pacific, Korea, China and Russia). Cells are kept only where they touch the outline, and a
// place is kept only when it is inside the outline.

import { logger } from "../logger.js";
import type { BoundingBox } from "./geoGrid.js";
import { findPlace, type GazetteerPlace } from "./gazetteer.js";

const USER_AGENT = "Recon-Maps-Search/1.0";

/** [lng, lat] as in GeoJSON. */
type Point = [number, number];
/** One polygon: its outer ring first, then its holes. */
type Polygon = Point[][];

export interface AreaSuggestion {
  /** OpenStreetMap id with its type letter: "R382313" (relation), "W…" (way), or "G…" (area list, see gazetteer.ts). */
  osmId: string;
  name: string;
  /** country, state, county, city, district, locality */
  type: string;
  /** What the area is called in its country ("département", "district"), when known. */
  typeLabel?: string;
  /** Where it is: "Île-de-France, France". */
  context: string;
  /** Name shown once picked, when the server sets it. */
  label?: string;
  countryCode?: string;
}

export interface ResolvedArea {
  osmId: string;
  name: string;
  countryCode?: string;
  bbox: BoundingBox;
  polygons: Polygon[];
  /** How far the outline may be from the real border (degrees). */
  precisionDeg: number;
}

// ── Nominatim queue (1 request per second) ────────────────────────────────────

let nominatimTail: Promise<unknown> = Promise.resolve();
let lastNominatimAt = 0;

function nominatim<T>(path: string): Promise<T | null> {
  const run = nominatimTail.then(async () => {
    const wait = lastNominatimAt + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatimAt = Date.now();
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/${path}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        logger.warn({ path, status: res.status }, "Nominatim request failed");
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      logger.warn({ path, err: err instanceof Error ? err.message : String(err) }, "Nominatim request failed");
      return null;
    }
  });
  nominatimTail = run.catch(() => {});
  return run;
}

// ── Suggestions (Photon) ──────────────────────────────────────────────────────

const PLACE_LAYERS = ["country", "state", "county", "city", "district", "locality"];
const suggestCache = new Map<string, AreaSuggestion[]>();

interface PhotonFeature {
  properties: {
    osm_type?: string;
    osm_id?: number;
    osm_key?: string;
    type?: string;
    name?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    countrycode?: string;
    /** [west, north, east, south] */
    extent?: number[];
  };
}

/** OpenStreetMap areas whose name starts with or matches `query`, best first (slow: seconds). */
export async function suggestOsmAreas(query: string, lang = "en"): Promise<AreaSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  // Photon labels places in de, en, fr or it only.
  const language = ["de", "en", "fr", "it"].includes(lang) ? lang : "en";
  const key = `${language}:${q.toLowerCase()}`;
  const cached = suggestCache.get(key);
  if (cached) return cached;

  const layers = PLACE_LAYERS.map((l) => `&layer=${l}`).join("");
  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=12&lang=${language}${layers}`,
      { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { features?: PhotonFeature[] };
    const seen = new Set<string>();
    const suggestions: AreaSuggestion[] = [];
    for (const { properties: p } of data.features ?? []) {
      // Only areas with an outline (relations and closed ways), and only real places or
      // boundaries: not squares, car parks or shops that happen to share the name.
      if (!p.osm_id || !p.name || (p.osm_type !== "R" && p.osm_type !== "W")) continue;
      if (p.osm_key !== "place" && p.osm_key !== "boundary") continue;
      const osmId = `${p.osm_type}${p.osm_id}`;
      // One entry per area: OSM often has the same area several times (Paris is a city, a
      // département and an administrative boundary, all with the same outline).
      const sameArea = p.extent?.length === 4
        ? `${p.name.toLowerCase()}|${p.countrycode ?? ""}|${p.extent.map((v) => v.toFixed(2)).join(",")}`
        : osmId;
      if (seen.has(osmId) || seen.has(sameArea)) continue;
      seen.add(osmId);
      seen.add(sameArea);
      const context = [p.city, p.county, p.state, p.country]
        .filter((part): part is string => !!part && part !== p.name)
        .filter((part, i, all) => all.indexOf(part) === i)
        .join(", ");
      suggestions.push({ osmId, name: p.name, type: p.type ?? "", context, countryCode: p.countrycode?.toLowerCase() });
      if (suggestions.length >= 8) break;
    }
    suggestCache.set(key, suggestions);
    return suggestions;
  } catch (err) {
    logger.warn({ query: q, err: err instanceof Error ? err.message : String(err) }, "Area suggestions failed");
    return [];
  }
}

// ── Outline (Nominatim) ───────────────────────────────────────────────────────

const areaCache = new Map<string, ResolvedArea>();
const textToOsmId = new Map<string, string>();
/** Area-list id ("G293397") → OpenStreetMap id ("R1382494"). */
const listToOsmId = new Map<string, string>();

interface NominatimPlace {
  osm_type: "relation" | "way" | "node";
  osm_id: number;
  name?: string;
  display_name?: string;
  boundingbox?: string[];
  address?: { country_code?: string };
  geojson?: { type: string; coordinates: unknown };
}

const osmLetter = (type: string) => (type === "relation" ? "R" : type === "way" ? "W" : "N");

const FEATURE_TYPE = ["country", "state", "", "city"];

/**
 * The OpenStreetMap area of a place picked in the area list: searched by name in its country
 * and kind (city, state…), and the one around the place's position when there are namesakes.
 */
async function findOsmPlace(p: GazetteerPlace): Promise<NominatimPlace | undefined> {
  const around = (place: NominatimPlace) => {
    const box = toBox(place);
    if (!box || (p.lat === 0 && p.lng === 0)) return true;
    const m = 0.02;
    return p.lat >= box.minLat - m && p.lat <= box.maxLat + m && p.lng >= box.minLng - m && p.lng <= box.maxLng + m;
  };
  const text = p.kind === 2 && p.region ? `${p.name}, ${p.region}` : p.name;
  const attempts = FEATURE_TYPE[p.kind] ? [FEATURE_TYPE[p.kind], ...(p.kind === 3 ? ["settlement"] : [])] : [""];
  for (const featureType of attempts) {
    const found = await nominatim<NominatimPlace[]>(
      `search?q=${encodeURIComponent(text)}&countrycodes=${p.countryCode}` +
        (featureType ? `&featureType=${featureType}` : "") +
        "&format=json&limit=5&addressdetails=1&accept-language=en",
    );
    const best = (found ?? []).find((place) => place.osm_type !== "node" && around(place));
    if (best) return best;
  }
  return undefined;
}

/**
 * Outline simplification (degrees): the outline is at most this far from the real border.
 * ~20 m for a city or a district, ~100 m for a country (a 1 km outline could cut off
 * venues on the waterfront). Places this close to the outline are kept (see isInArea).
 */
function outlineThreshold(bbox: BoundingBox): number {
  const size = Math.max(bbox.maxLat - bbox.minLat, bbox.maxLng - bbox.minLng);
  return size < 1 ? 0.0002 : size < 10 ? 0.0005 : 0.001;
}

function toPolygons(geojson: NominatimPlace["geojson"]): Polygon[] {
  if (!geojson) return [];
  if (geojson.type === "Polygon") return [geojson.coordinates as Polygon];
  if (geojson.type === "MultiPolygon") return geojson.coordinates as Polygon[];
  return [];
}

function toBox(place: NominatimPlace): BoundingBox | null {
  const [s, n, w, e] = (place.boundingbox ?? []).map(Number);
  if ([s, n, w, e].some((v) => !Number.isFinite(v))) return null;
  return { minLat: s, maxLat: n, minLng: w, maxLng: e };
}

/**
 * The area chosen in the suggestions (osmId) or typed freely (text, first OpenStreetMap match),
 * with its outline. Null when OpenStreetMap does not know it or cannot be reached.
 */
export async function resolveArea(input: { osmId?: string; text?: string }): Promise<ResolvedArea | null> {
  let osmId = input.osmId?.trim().toUpperCase();
  const textKey = input.text?.trim().toLowerCase();
  // Picked in the area list: its OpenStreetMap twin (found once, then remembered).
  const listed = osmId && /^G\d+$/.test(osmId) ? findPlace(osmId) : undefined;
  if (listed) osmId = listToOsmId.get(listed.id);
  if (!osmId && !listed && textKey) osmId = textToOsmId.get(textKey);
  if (osmId && areaCache.has(osmId)) return areaCache.get(osmId)!;

  // First the place itself (its size decides how detailed the outline must be)…
  let place: NominatimPlace | undefined;
  if (listed && !osmId) {
    place = await findOsmPlace(listed);
  } else if (osmId) {
    if (!/^[RWN]\d+$/.test(osmId)) return null;
    place = (await nominatim<NominatimPlace[]>(`lookup?osm_ids=${osmId}&format=json&addressdetails=1`))?.[0];
  }
  // Typed freely, or a listed place OpenStreetMap does not have under that name: the first match for the text.
  if (!place && textKey && (listed || !osmId)) {
    place = (await nominatim<NominatimPlace[]>(
      `search?q=${encodeURIComponent(input.text!.trim())}&format=json&limit=1&addressdetails=1`,
    ))?.[0];
  }
  if (!place) return null;
  const bbox = toBox(place);
  if (!bbox) return null;
  osmId = `${osmLetter(place.osm_type)}${place.osm_id}`;
  if (listed) listToOsmId.set(listed.id, osmId);
  else if (textKey) textToOsmId.set(textKey, osmId);
  if (areaCache.has(osmId)) return areaCache.get(osmId)!;

  // …then its outline.
  const precisionDeg = outlineThreshold(bbox);
  const withOutline = (await nominatim<NominatimPlace[]>(
    `lookup?osm_ids=${osmId}&format=json&polygon_geojson=1&polygon_threshold=${precisionDeg}`,
  ))?.[0];
  const polygons = toPolygons(withOutline?.geojson);
  const area: ResolvedArea = {
    osmId,
    name: listed?.name || place.name || place.display_name || input.text || osmId,
    countryCode: place.address?.country_code?.toLowerCase() ?? listed?.countryCode,
    bbox,
    polygons,
    precisionDeg,
  };
  // A place without an outline (a node) keeps its bounding box only: not cached, retried next time.
  if (polygons.length) areaCache.set(osmId, area);
  return area;
}

// ── Geometry ──────────────────────────────────────────────────────────────────

// Bounding box of each ring, computed once: most rings (islands) are far from the point
// tested and are skipped without walking their points.
const ringBoxes = new WeakMap<Point[], BoundingBox>();
function ringBox(ring: Point[]): BoundingBox {
  let box = ringBoxes.get(ring);
  if (!box) {
    box = { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity };
    for (const [lng, lat] of ring) {
      if (lat < box.minLat) box.minLat = lat;
      if (lat > box.maxLat) box.maxLat = lat;
      if (lng < box.minLng) box.minLng = lng;
      if (lng > box.maxLng) box.maxLng = lng;
    }
    ringBoxes.set(ring, box);
  }
  return box;
}

function boxesTouch(a: BoundingBox, b: BoundingBox, margin = 0): boolean {
  return a.minLat - margin <= b.maxLat && a.maxLat + margin >= b.minLat && a.minLng - margin <= b.maxLng && a.maxLng + margin >= b.minLng;
}

function insideRing(ring: Point[], lng: number, lat: number): boolean {
  const b = ringBox(ring);
  if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insidePolygons(polygons: Polygon[], lng: number, lat: number): boolean {
  // Even-odd over a polygon's rings: inside the outer ring and outside its holes.
  return polygons.some((rings) => rings.reduce((inside, ring) => (insideRing(ring, lng, lat) ? !inside : inside), false));
}

function segmentDistance(lng: number, lat: number, [x1, y1]: Point, [x2, y2]: Point): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((lng - x1) * dx + (lat - y1) * dy) / len)) : 0;
  return Math.hypot(lng - (x1 + t * dx), lat - (y1 + t * dy));
}

/**
 * True when the point is inside the area, or within `toleranceDeg` of its border (never less
 * than the outline's own simplification when a tolerance is asked).
 */
export function isInArea(area: ResolvedArea, lat: number, lng: number, toleranceDeg = 0): boolean {
  if (toleranceDeg > 0) toleranceDeg = Math.max(toleranceDeg, area.precisionDeg * 1.5);
  const b = area.bbox;
  if (lat < b.minLat - toleranceDeg || lat > b.maxLat + toleranceDeg || lng < b.minLng - toleranceDeg || lng > b.maxLng + toleranceDeg) {
    return false;
  }
  if (!area.polygons.length) return true; // no outline: the bounding box is all we know
  if (insidePolygons(area.polygons, lng, lat)) return true;
  if (toleranceDeg <= 0) return false;
  const point: BoundingBox = { minLat: lat, maxLat: lat, minLng: lng, maxLng: lng };
  for (const rings of area.polygons) {
    for (const ring of rings) {
      if (!boxesTouch(ringBox(ring), point, toleranceDeg)) continue;
      for (let i = 1; i < ring.length; i++) {
        if (segmentDistance(lng, lat, ring[i - 1], ring[i]) <= toleranceDeg) return true;
      }
    }
  }
  return false;
}

/** Does the segment cross the rectangle? (Liang–Barsky clipping) */
function segmentHitsRect([x1, y1]: Point, [x2, y2]: Point, r: BoundingBox): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, x1 - r.minLng], [dx, r.maxLng - x1], [-dy, y1 - r.minLat], [dy, r.maxLat - y1],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** True when the rectangle (a grid cell) touches the area. */
export function rectTouchesArea(area: ResolvedArea, rect: BoundingBox): boolean {
  const b = area.bbox;
  if (rect.maxLat < b.minLat || rect.minLat > b.maxLat || rect.maxLng < b.minLng || rect.minLng > b.maxLng) return false;
  if (!area.polygons.length) return true;
  // The cell's middle or a corner lies in the area (the cell is inside or overlaps it)…
  const points: Array<[number, number]> = [
    [(rect.minLng + rect.maxLng) / 2, (rect.minLat + rect.maxLat) / 2],
    [rect.minLng, rect.minLat], [rect.minLng, rect.maxLat], [rect.maxLng, rect.minLat], [rect.maxLng, rect.maxLat],
  ];
  if (points.some(([lng, lat]) => insidePolygons(area.polygons, lng, lat))) return true;
  // …or the outline crosses the cell (an island smaller than the cell, a thin coastline).
  for (const rings of area.polygons) {
    for (const ring of rings) {
      if (!boxesTouch(ringBox(ring), rect)) continue;
      for (let i = 1; i < ring.length; i++) {
        if (segmentHitsRect(ring[i - 1], ring[i], rect)) return true;
      }
    }
  }
  return false;
}

/** Outer-ring bounding boxes: where to lay the grid for areas in several parts (France and its islands). */
export function areaParts(area: ResolvedArea): BoundingBox[] {
  if (!area.polygons.length) return [area.bbox];
  return area.polygons.map(([outer]) => ringBox(outer));
}
