// Searches the main Google category of each term too, so places Google lists only under that
// category are found (completeness). Measured gains on the same spot: "boulangerie" Lyon +
// "bakery" +45 places, "coiffeur" Marseille + "hair salon" +33, "mini golf" London +
// "miniature golf course" +32.
//
// Google ranks the best matches first, so the categories of the first results say which kind
// of place a term means, in any language (the scraper loads Maps in English). Every place found is
// stored; places clearly unrelated to the search are hidden from the list (see placeRelevance).

export interface RankedPlace {
  name: string;
  category?: string | null;
}

/** How many of Google's first results are read: enough to see the main categories. */
export const TOP_RESULTS = 20;
const MAX_EXPANSIONS = 2;

/** Categories carried by many kinds of places: never searched on their own ("barcade" must not become "bar"). */
const GENERIC_CATEGORIES = new Set([
  "bar", "pub", "restaurant", "cafe", "coffee shop", "event venue", "tourist attraction", "park",
  "shop", "store", "service establishment", "corporate office", "association / organization",
]);

/** Categories of off-topic places ("laser" must not search hair removal). A term that names one itself keeps it. */
const BLOCKED_CATEGORY =
  /dermatolog|hair removal|electrolysis|tattoo|medical|doctor|physician|general practitioner|clinic|dental|dentist|optic|pharmac|facial spa|\bspa\b|print|copy shop|manufacturer|equipment rental|beauty|cosmetic|skin|surg|tanning|massage|\bnails?\b|esthet|epilat/i;

const splitCategories = (category?: string | null) =>
  (category ?? "").split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);

/**
 * Words too generic to tie a category to a search ("club" would keep every sports club; "park" from
 * "trampoline park" matched every city park and parking lot; "family" matched "Family law attorney").
 */
const GENERIC_WORDS = new Set([
  "club", "centre", "center", "track", "venue", "service", "store", "school", "event", "park", "family",
]);

/** Words of the searched terms that identify the kind of place ("laser tag" → "laser", "tag"). */
const termWords = (searchTerms: string[]) => [
  ...new Set(
    searchTerms
      .flatMap((term) => term.toLowerCase().split(/[^a-z]+/))
      .filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word)),
  ),
];

/**
 * A place whose main Google category is off-topic (a laser hair removal clinic found by "laser tag").
 * It is kept only when another category names what was searched: a laser tag centre with a
 * "Party equipment rental service" main category stays; a clinic with one stray "Hair salon" tag does not.
 * A place whose main category is relevant (a bar, a bowling alley) is always kept.
 */
export function isOffTopicPlace(category?: string | null, searchTerms: string[] = []): boolean {
  const categories = splitCategories(category);
  if (categories.length === 0 || !BLOCKED_CATEGORY.test(categories[0])) return false;
  const words = termWords(searchTerms);
  return !categories.some(
    (c) => !BLOCKED_CATEGORY.test(c) && words.some((word) => c.includes(word)),
  );
}

export type PlaceRelevance = "match" | "other" | "offTopic";

/** Words that say where, not what ("salle d'arcade" → only "arcade" says what). */
const PLACE_WORDS = new Set(["salle", "sala", "room", "hall", "place", "zone", "lieu", "local", "spot"]);

/**
 * Main categories of places that have nothing to do with a venue search: shops, offices, services,
 * health, schools, monuments… (a Fnac or a lawyer named "Arcade" found by "arcade"). Only for places
 * that do not match the search; anything not listed here stays (bars, escape rooms, event planners…).
 */
const UNRELATED_CATEGORY = new RegExp(
  "\\b(" +
    [
      "store", "shop", "supplier", "wholesaler", "manufacturer", "dealer", "distributor", "repair",
      "office", "company", "agency", "agents?", "consultant", "e-commerce", "website", "publisher",
      "solicitor", "lawyer", "attorney", "notary", "legal services", "accountant", "bank", "atm",
      "currency exchange", "insurance", "real estate", "apartment", "vacation rental", "hotel", "hostel",
      "storage", "warehouse", "shopping mall", "hypermarket", "supermarket", "flea market", "car rental",
      "parking", "tailor", "dry cleaner", "laundry", "package locker", "shipping", "courier", "jeweler",
      "pest control", "printer", "printing", "production service", "animation studio",
      "school", "college", "university", "training", "archive", "library", "dating service",
      "business park", "business center", "coworking", "pilates", "yoga", "gym", "fitness",
      "martial arts", "jujitsu", "karate", "judo", "fencing", "squash", "tennis", "climbing", "stadium",
      "wellness", "beauty", "hair salon", "barber", "massage", "spa", "physiotherapist", "doctor",
      "dentist", "clinic", "hospital", "pharmacy", "medical", "health", "care", "retirement",
      "church", "mosque", "synagogue", "place of worship", "embassy", "government", "city hall",
      "police", "post office", "historical landmark", "monument", "fountain", "memorial", "cemetery",
      "environmental", "charity", "volunteer organization",
    ].join("|") +
    ")\\b|^(park|city park|garden|botanical garden|national park|dog park)$",
  "i",
);

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Where a place goes: first the places whose category or name says what was searched, then the
 * probable ones; "offTopic" places are left out of the list (a laser clinic for "laser tag", a game
 * shop for "arcade"). Works for any ICP: a bar is never off-topic (a barcade search wants bars).
 * `userTerms` are the terms typed (and their translations); `autoTerms` the Google categories RECON
 * added: those match only as a whole ("video arcade" must not pull in "Video game store").
 */
export function placeRelevance(
  place: { name: string; category?: string | null },
  userTerms: string[],
  autoTerms: string[] = [],
): PlaceRelevance {
  if (isOffTopicPlace(place.category, userTerms)) return "offTopic";
  const words = [
    ...new Set(
      userTerms
        .flatMap((term) => plain(term).split(/[^a-z]+/))
        .filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w) && !PLACE_WORDS.has(w)),
    ),
  ];
  const phrases = autoTerms.map(plain).filter(Boolean);
  const says = (text: string) =>
    words.some((w) => new RegExp(`\\b${w}`).test(text)) || phrases.some((p) => text.includes(p));
  // The category is the stronger evidence: a "Real estate developer" named "Arcade…" is not an arcade.
  if (says(plain(place.category ?? ""))) return "match";
  const main = splitCategories(place.category)[0];
  if (main && UNRELATED_CATEGORY.test(main)) return "offTopic";
  return says(plain(place.name)) ? "match" : "other";
}

/**
 * The extra searches for one term: its dominant categories in Google's ranking, best first.
 * `places` holds the places Google listed for the term in the middle of the area.
 */
export function learnExpansions(term: string, places: RankedPlace[]): string[] {
  const key = term.toLowerCase().trim();
  const allowBlocked = BLOCKED_CATEGORY.test(key);
  const usable = (c: string) => !GENERIC_CATEGORIES.has(c) && (allowBlocked || !BLOCKED_CATEGORY.test(c));
  const top = places.filter((p) => splitCategories(p.category).length > 0).slice(0, TOP_RESULTS);
  if (top.length < 3) return []; // too few places to learn from

  const primaries = top.map((p) => splitCategories(p.category)[0]);
  const counts = new Map<string, number>();
  for (const c of primaries) counts.set(c, (counts.get(c) ?? 0) + 1);

  // Worth searching: a category that leads the best results and covers a good share of them,
  // and that is not already the term. Weaker ones bring noise ("video arcade" for "laser tag"
  // adds adult stores).
  const leaders = new Set(primaries.slice(0, 5));
  return [...counts.entries()]
    .filter(([c, n]) => n >= Math.max(3, top.length * 0.25) && leaders.has(c) && c !== key && usable(c))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_EXPANSIONS)
    .map(([c]) => c);
}
