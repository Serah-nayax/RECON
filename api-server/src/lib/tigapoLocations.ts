/**
 * Tigapo's own locations, to flag the Maps places that already use Tigapo (or used it).
 *
 * Read from the exports in data/tigapo/ (never committed): Locations.xlsx (name, operator,
 * test/demo/closed), Customers.xlsx (operator names) and Locations*.csv (address and GPS),
 * joined on the location ID. Until RECON has read access to the Tigapo DB.
 *
 * A place is flagged when it shares a name word with a location (or its operator) within
 * 150 m, or sits within 15 m of one, or shares 2 name words within 1.5 km ("maybe": Tigapo has
 * Mountain Mike's Santa Rosa at 2280 Santa Rosa Ave, Google Maps at 1150, 1 km apart).
 * Leads without GPS (an uploaded list) are matched in the same city on name and street address.
 * Distance alone at 40-80 m gave false hits in Santa Rosa (a 7-Eleven, an Applebee's next to Tigapo venues). It is only a flag: nothing is hidden.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { logger } from "./logger.js";

export interface TigapoMatch {
  /** The Tigapo location's name. */
  name: string;
  /** The Tigapo customer (operator) it belongs to. */
  operator: string | null;
  /** false: the location is closed or disabled in Tigapo (a former customer). */
  active: boolean;
  /** null: matched on name and city (the lead had no GPS). */
  distanceM: number | null;
  /**
   * "name": close and same name; "address": at the same spot, names differ;
   * "maybe": same name but up to 1.5 km away (the location moved, or its address is off),
   * or same name in the same city for a lead without GPS.
   */
  how: "name" | "address" | "maybe";
}

interface TigapoPoint {
  name: string;
  operator: string | null;
  active: boolean;
  lat: number;
  lng: number;
  words: Set<string>;
  /** The city name, in words, to match leads that have no GPS. */
  cityWords: string[];
  /** The street address ("3125 Cleveland Ave"), for leads that have no GPS. */
  street: { number: string; words: string[] } | null;
}

const NAME_RADIUS_M = 150;
const ADDRESS_RADIUS_M = 15;
const MAYBE_RADIUS_M = 1500;
const HOW_RANK = { name: 0, address: 1, maybe: 2 } as const;

/** Words too common in venue names to tell two places apart. */
const GENERIC_WORDS = new Set([
  "the", "and", "inc", "llc", "ltd", "corp", "company", "arcade", "arcades", "game", "games", "gaming",
  "fun", "center", "centre", "family", "entertainment", "pizza", "pizzeria", "bar", "grill", "restaurant",
  "bowl", "bowling", "lanes", "club", "cafe", "kids", "park", "zone", "city", "street", "mall", "shopping",
  "vending", "amusement", "amusements", "store", "shop", "west", "east", "north", "south",
]);

function nameWords(text: string): string[] {
  return text
    .replace(/^z(?=[A-Z])/, "") // disabled locations are renamed "zName"
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9֐-׿]+/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const x = (lng2 - lng1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

function dataDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.TIGAPO_DATA_DIR,
    path.resolve(here, "../../data/tigapo"), // dist/index.mjs
    path.resolve(here, "../../../data/tigapo"), // src/lib/tigapoLocations.ts
    path.resolve(process.cwd(), "data/tigapo"),
    path.resolve(process.cwd(), "../data/tigapo"),
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function sheetRows(file: string): Record<string, unknown>[] {
  const wb = XLSX.read(readFileSync(file));
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // Row 1 is a title ("Locations"), row 2 the column names.
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { range: 1 });
}

/**
 * The CSV export is quoted twice over and some addresses run over two lines, so each record
 * is read from its ends: "ID;" at the start, ";city;state;lat;lng;country" at the end.
 */
function csvPoints(text: string): Map<string, { lat: number; lng: number; city: string; line1: string }> {
  const records: string[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (/^"?\d+;/.test(line) || records.length === 0) records.push(line);
    else records[records.length - 1] += " " + line;
  }
  const points = new Map<string, { lat: number; lng: number; city: string; line1: string }>();
  for (const raw of records) {
    const rec = raw.replace(/,+\s*$/, "").replace(/^"/, "").replace(/"$/, "").replace(/""/g, '"');
    const m = rec.match(/^(\d+);(.*);([^;]*);[^;]*;(-?\d+(?:\.\d+)?);(-?\d+(?:\.\d+)?);[A-Z]{2}$/);
    if (!m) continue;
    const lat = Number(m[4]);
    const lng = Number(m[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) continue;
    points.set(m[1], { lat, lng, city: m[3].replace(/"/g, ""), line1: m[2].replace(/"/g, "") });
  }
  return points;
}

let cache: { stamp: string; points: TigapoPoint[] } | null = null;

/** The locations, re-read when a file in data/tigapo/ changes (no restart needed). */
function loadPoints(): TigapoPoint[] {
  const dir = dataDir();
  if (!dir) return [];
  const files = readdirSync(dir);
  const locationsXlsx = files.find((f) => /^locations.*\.xlsx$/i.test(f));
  const customersXlsx = files.find((f) => /^customers.*\.xlsx$/i.test(f));
  const locationsCsv = files.find((f) => /^locations.*\.csv$/i.test(f));
  if (!locationsXlsx || !locationsCsv) return [];
  const used = [locationsXlsx, customersXlsx, locationsCsv].filter((f): f is string => !!f);
  const stamp = used.map((f) => `${f}:${statSync(path.join(dir, f)).mtimeMs}`).join("|");
  if (cache?.stamp === stamp) return cache.points;

  try {
    const operators = new Map<string, string>();
    if (customersXlsx) {
      for (const c of sheetRows(path.join(dir, customersXlsx))) operators.set(String(c.id), String(c.name ?? ""));
    }
    const coords = csvPoints(readFileSync(path.join(dir, locationsCsv), "utf8"));
    const points: TigapoPoint[] = [];
    for (const loc of sheetRows(path.join(dir, locationsXlsx))) {
      if (Number(loc.test) === 1 || Number(loc.demo) === 1) continue; // Tigapo's own test sites
      const at = coords.get(String(loc.ID));
      if (!at) continue;
      const name = String(loc.name ?? "").trim();
      const operator = operators.get(String(loc.customerId)) ?? null;
      const cityWords = new Set(nameWords(at.city));
      const words = new Set([...nameWords(name), ...nameWords(operator ?? "")].filter((w) => !cityWords.has(w)));
      points.push({
        name: name.replace(/^z(?=[A-Z])/, ""),
        operator,
        active: Number(loc.disabled) !== 1 && loc.currentState === "ACTIVE",
        lat: at.lat,
        lng: at.lng,
        words,
        cityWords: [...cityWords],
        street: streetOf(at.line1),
      });
    }
    logger.info({ locations: points.length, active: points.filter((p) => p.active).length }, "Tigapo locations loaded");
    cache = { stamp, points };
    return points;
  } catch (err) {
    logger.warn({ err }, "Tigapo locations: could not read data/tigapo/");
    cache = { stamp, points: [] };
    return [];
  }
}

/** The Tigapo location this place is (or is at), or null. */
export function findTigapoLocation(place: {
  name?: string;
  lat?: number;
  lng?: number;
  /** City or full address: used only when there is no GPS. */
  city?: string;
}): TigapoMatch | null {
  const points = loadPoints();
  if (points.length === 0) return null;
  const placeWords = nameWords(place.name ?? "");
  if (place.lat == null || place.lng == null) return findByNameAndCity(points, placeWords, place.city ?? "");
  let best: TigapoMatch | null = null;
  // 0.015° of latitude is over 1.5 km: skip the distance maths for far points.
  for (const p of points) {
    if (Math.abs(p.lat - place.lat) > 0.015) continue;
    const d = distanceM(place.lat, place.lng, p.lat, p.lng);
    if (d > MAYBE_RADIUS_M) continue;
    const shared = placeWords.filter((w) => p.words.has(w)).length;
    const how =
      shared >= 1 && d <= NAME_RADIUS_M ? "name"
      : d <= ADDRESS_RADIUS_M ? "address"
      : shared >= 2 ? "maybe"
      : null;
    if (!how) continue;
    const better = !best || HOW_RANK[how] < HOW_RANK[best.how] || (how === best.how && d < (best.distanceM ?? Infinity));
    if (better) best = { name: p.name, operator: p.operator, active: p.active, distanceM: Math.round(d), how };
  }
  return best;
}

/** Street types: "2280 Mendocino Ave" and "2280 Santa Rosa Ave" must not match on "ave". */
const STREET_TYPES = new Set([
  "ave", "avenue", "road", "street", "blvd", "boulevard", "drive", "lane", "way", "court", "place", "highway", "hwy",
  "suite", "ste", "unit", "rue", "route", "chemin", "allee", "rehov",
]);

/** "3125 Cleveland Ave" -> 3125 + ["cleveland", "ave"]; null without a house number. */
function streetOf(line1: string): { number: string; words: string[] } | null {
  const number = line1.match(/\d+/)?.[0];
  if (!number) return null;
  return { number, words: nameWords(line1).filter((w) => !/^\d+$/.test(w)) };
}

/**
 * A lead without GPS (an uploaded list), in the same city as a location:
 * - same street address and same name: "name";
 * - same street address only (house number + a street word): "address";
 * - same name only (2 words, or the only word of a one-word name): "maybe".
 * Santa Rosa has 3 Mountain Mike's: the street address tells which one it is.
 */
function findByNameAndCity(points: TigapoPoint[], placeWords: string[], address: string): TigapoMatch | null {
  if (!address) return null;
  const addressWords = new Set(nameWords(address));
  const numbers = new Set(address.match(/\d+/g) ?? []);
  let best: { match: TigapoMatch; streetWords: number } | null = null;
  for (const p of points) {
    if (p.cityWords.length === 0 || !p.cityWords.every((w) => addressWords.has(w))) continue;
    const own = placeWords.filter((w) => !p.cityWords.includes(w));
    const shared = own.filter((w) => p.words.has(w)).length;
    // The street's own name: not the city ("Santa Rosa Ave" in Santa Rosa), not "Ave".
    const streetName = p.street?.words.filter((w) => !p.cityWords.includes(w) && !STREET_TYPES.has(w)) ?? [];
    const sameStreet = !!p.street && numbers.has(p.street.number) && streetName.some((w) => addressWords.has(w));
    const how =
      sameStreet && shared >= 1 ? "name"
      : sameStreet ? "address"
      : shared >= 1 && shared >= Math.min(2, own.length) ? "maybe"
      : null;
    if (!how) continue;
    // Several "maybe" in a city (3 Mountain Mike's in Santa Rosa): the one on the lead's street.
    const streetWords = p.street?.words.filter((w) => addressWords.has(w)).length ?? 0;
    const better =
      !best || HOW_RANK[how] < HOW_RANK[best.match.how] || (how === best.match.how && streetWords > best.streetWords);
    if (better) best = { match: { name: p.name, operator: p.operator, active: p.active, distanceM: null, how }, streetWords };
  }
  return best?.match ?? null;
}
