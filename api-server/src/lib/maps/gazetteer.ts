// Instant area suggestions: countries, regions, sub-regions and towns of 5,000+ inhabitants,
// matched in memory while the user types (OpenStreetMap's Photon takes seconds per query).
// Data: data/places.json.gz, built by scripts/build-gazetteer.mjs from GeoNames (CC BY 4.0).
// The outline of a picked area still comes from OpenStreetMap (see resolveArea in areas.ts).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { logger } from "../logger.js";

/** 0 country, 1 region (state, région, district), 2 sub-region (county, département), 3 town. */
export type PlaceKind = 0 | 1 | 2 | 3;

export interface GazetteerPlace {
  /** "G" + GeoNames id. */
  id: string;
  kind: PlaceKind;
  name: string;
  countryCode: string;
  country: string;
  /** Region the place is in (towns and sub-regions). */
  region?: string;
  /** A point inside the area (towns), or its biggest town (countries, regions). 0,0 when unknown. */
  lat: number;
  lng: number;
  population: number;
  /** Normalized names to match, the main one first. */
  names: string[];
}

export interface PlaceSuggestion {
  osmId: string;
  name: string;
  type: string;
  /** What the area is called in its country: "state", "département", "district"… */
  typeLabel: string;
  context: string;
  /** Name shown once picked (and searched as text if the outline cannot be found). */
  label: string;
  countryCode: string;
}

type Row = [string, PlaceKind, string, string, string, number, number, number, string];

/** Lowercase, without accents or punctuation: "Saint-Étienne" → "saint etienne". */
export function normalize(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** The name without "State of", "Region"…: "State of Berlin" → "berlin", "Lima Province" → "lima". */
export function coreName(name: string): string {
  return normalize(name)
    .replace(/^(state|province|region|department|district|county|governorate|prefecture|city|municipality) of /, "")
    .replace(/ (state|province|region|district|county|governorate|prefecture|oblast|metropolitan|d c)$/, "");
}

let places: GazetteerPlace[] | null = null;
let byId = new Map<string, GazetteerPlace>();

function dataFile(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../data/places.json.gz"), // dist/index.mjs
    path.resolve(here, "../../../data/places.json.gz"), // src/lib/maps/gazetteer.ts
    path.resolve(process.cwd(), "data/places.json.gz"),
    path.resolve(process.cwd(), "api-server/data/places.json.gz"),
  ];
  return candidates.find((file) => existsSync(file)) ?? null;
}

function load(): GazetteerPlace[] {
  if (places) return places;
  places = [];
  const file = dataFile();
  if (!file) {
    logger.warn("Area list not found (api-server/data/places.json.gz): suggestions come from OpenStreetMap only");
    return places;
  }
  try {
    const started = Date.now();
    const data = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as {
      countries: Record<string, string>;
      regions: Record<string, string>;
      entries: Row[];
    };
    places = data.entries.map(([id, kind, name, cc, regionKey, lat, lng, population, alts]) => ({
      id,
      kind,
      name,
      countryCode: cc.toLowerCase(),
      country: data.countries[cc] ?? cc,
      region: regionKey ? data.regions[regionKey] : undefined,
      lat,
      lng,
      population,
      names: [normalize(name), ...(alts ? alts.split("|") : [])],
    }));
    byId = new Map(places.map((p) => [p.id, p]));
    logger.info({ areas: places.length, ms: Date.now() - started }, "Area list loaded");
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Area list could not be read");
  }
  return places;
}

/** Loads the list in the background, so the first suggestion is instant too. */
export function preloadGazetteer(): void {
  setTimeout(load, 0).unref?.();
}

export function findPlace(id: string): GazetteerPlace | undefined {
  load();
  return byId.get(id);
}

// What regions are called, by country: [region, sub-region].
const KIND_WORDS: Record<string, [string, string]> = {
  fr: ["region", "département"], us: ["state", "county"], il: ["district", "sub-district"],
  gb: ["nation", "county"], de: ["state", "district"], es: ["community", "province"],
  it: ["region", "province"], ca: ["province", "division"], be: ["region", "province"],
  ch: ["canton", "district"], nl: ["province", "municipality"], au: ["state", "council"],
  br: ["state", "municipality"], mx: ["state", "municipality"], in: ["state", "district"],
  jp: ["prefecture", "municipality"], pt: ["district", "municipality"], at: ["state", "district"],
};
const TYPES = ["country", "state", "county", "city"] as const;

function typeLabel(p: GazetteerPlace): string {
  if (p.kind === 0) return "country";
  if (p.kind === 3) return "city";
  return (KIND_WORDS[p.countryCode] ?? ["region", "district"])[p.kind - 1];
}

/** How big the area is, for ranking: a town counts fully, a region a part of its towns ("par" → Paris before Paraná). */
const WEIGHT = [0.2, 0.15, 0.1, 1];

/**
 * Areas whose name (in any of the team's languages) starts with what was typed, biggest first.
 * A town comes before the region of the same name (Tel Aviv, then the Tel Aviv district).
 */
export function suggestPlaces(query: string, limit = 8): PlaceSuggestion[] {
  const q = normalize(query);
  if (!q) return [];
  const wordStart = " " + q;
  // Other names (Londres, Allemagne, תל אביב) count from 4 letters and below the main names:
  // GeoNames also lists old and foreign names ("Frunze" for Bishkek, "Berlin" for Kitchener).
  const scored: Array<{ p: GazetteerPlace; score: number; other: boolean }> = [];
  let mainExact = false;
  for (const p of load()) {
    const main = p.names[0];
    let bonus = main === q ? 1.5 : main.startsWith(q) ? 0.5 : q.length >= 3 && main.includes(wordStart) ? 0 : -9;
    let other = false;
    if (bonus === 1.5) mainExact = true;
    else if (bonus < 0 && q.length >= 4) {
      for (let i = 1; i < p.names.length; i++) {
        const n = p.names[i];
        if (n === q) { bonus = 0.5; break; }
        if (n.startsWith(q)) bonus = Math.max(bonus, -1);
      }
      other = bonus > -9;
    } else if (bonus < 0 && q.length < 4 && /[^a-z0-9 ]/.test(q)) {
      // Hebrew (or any non-Latin script) is only in the other names: match from the first letter.
      other = p.names.some((n, i) => i > 0 && n.startsWith(q));
      if (other) bonus = 0;
    }
    if (bonus <= -9) continue;
    scored.push({ p, other, score: Math.log10(p.population * WEIGHT[p.kind] + 10) + bonus });
  }
  // A place really called what was typed leaves out the places it is only another name of
  // ("new york": not Jakarta, whose GeoNames names include "New York").
  let kept = mainExact ? scored.filter((s) => !s.other) : scored;
  // "paris": Paris, not its 20 arrondissements ("Paris 15 Vaugirard"); "paris 15" finds them.
  if (!/\d/.test(q)) {
    const townNames = new Set(kept.filter((s) => s.p.kind === 3).map((s) => `${s.p.countryCode}|${s.p.names[0]}`));
    kept = kept.filter((s) => {
      const m = /^(.+?) \d/.exec(s.p.names[0]);
      return !m || !townNames.has(`${s.p.countryCode}|${m[1]}`);
    });
  }
  kept.sort((a, b) => b.score - a.score);
  const top = kept.slice(0, limit * 3);

  // A region named like a town of its country goes right after the town.
  // ("New York City" counts as "new york").
  const towns = new Map<string, (typeof top)[number]>();
  for (const s of top.filter((t) => t.p.kind === 3).reverse()) {
    towns.set(`${s.p.countryCode}|${s.p.names[0]}`, s);
    towns.set(`${s.p.countryCode}|${s.p.names[0].replace(/ city$/, "")}`, s);
  }
  const clash = new Set<GazetteerPlace>();
  for (const s of top) {
    const town = s.p.kind !== 3 ? towns.get(`${s.p.countryCode}|${coreName(s.p.name)}`) : undefined;
    if (town) {
      s.score = town.score - 1e-6;
      clash.add(s.p);
    }
  }
  top.sort((a, b) => b.score - a.score);

  return top.slice(0, limit).map(({ p }) => {
    const type = typeLabel(p);
    const regionDiffers = p.region && coreName(p.region) !== p.names[0];
    const shownName = clash.has(p) && coreName(p.name) === p.names[0] ? `${p.name} (${type})` : p.name;
    const context = p.kind === 0 ? "" : [regionDiffers ? p.region : "", p.country].filter(Boolean).join(", ");
    const parent = p.kind === 0 ? "" : p.kind === 1 ? p.country : regionDiffers ? p.region : p.country;
    return {
      osmId: p.id,
      name: p.name,
      type: TYPES[p.kind],
      typeLabel: type,
      context,
      label: parent ? `${shownName}, ${parent}` : shownName,
      countryCode: p.countryCode,
    };
  });
}
