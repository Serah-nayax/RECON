// Free, offline lead scoring used when no AI key is configured (or the AI is unavailable).
// Mirrors the default ICP logic (fleet size first) with multilingual keyword evidence
// (EN/FR/DE/ES/IT/NL/PT), so venues in any of these markets score comparably.
import type { PageData } from "./websiteCrawler.js";
import type { IcpConfig } from "../icpStore.js";
import type { LeadInput } from "./qualifyStore.js";
import type { DecisionMaker, QualifyResult, SourceSummary } from "./qualifyLead.js";
import type { SocialIntel } from "./socialLinks.js";
import { isOffTopicPlace } from "../maps/searchProfile.js";

const RX = {
  arcade:
    /\b(arcades?|amusements?|game ?rooms?|gaming (centre|center|zone)|family entertainment|fec|barcade|beercade|super ?arcade|salles? de jeux|salle d'arcade|jeux d'arcade|spielhallen?|arcadehalle|spielautomaten|sala (de )?(juegos|recreativos|giochi)|salón recreativo|recreativos|giochi arcade|speelhal|speelautomaten|fliperama|jogos de arcade)\b/i,
  redemption:
    /\b(redemption|prize (wall|counter|shop)|ticket (games?|prizes?|redemption)|win tickets|tickets? (et|&) (lots|cadeaux)|gagnez des tickets|boutique (de )?cadeaux|gewinn(e|theke)|ticketspiele|premios|canje de tickets|premi|riscatto|prijzen(winkel)?|prêmios|resgate)\b/i,
  tokens: /\b(tokens?|jetons?|fichas?|gettoni|munten|wertmarken|spielmarken|coin-?op|münzbetrieb)\b/i,
  cashless:
    /\b(cashless|play ?cards?|game ?cards?|power ?cards?|fun ?cards?|carte de jeu|carte (prépayée|rechargeable)|spielkarte|guthabenkarte|bargeldlos|tarjeta (de juego|recargable)|sin efectivo|carta (gioco|ricaricabile)|speelkaart|cartão de jogo)\b/i,
  loyalty:
    /\b(loyalty|rewards? (program|club|points)|membership|member points|vip club|fidélité|programme de fidélité|treue(punkte|programm)|bonus(programm|karte)|stammkunden|fidelidad|programa de puntos|fedeltà|klantenkaart|spaarpunten|fidelidade)\b/i,
  party:
    /\b(birthday|party (rooms?|packages?)|private (events?|hire)|anniversaires?|fêtes? d'enfants|kinder ?geburtstag|geburtstag|cumpleaños|fiestas infantiles|compleanni?|feste|verjaardag|kinderfeestje|aniversário|festa infantil)\b/i,
  food:
    /\b(restaurant|café|cafe|bar|snacks?|food|menu|speisekarte|gastronomie|restauration|comida|ristorante|eten|lanchonete)\b/i,
  attractions:
    /\b(bowling|laser ?(tag|game|maxx)|lasergame|trampolin(e|park)?s?|mini ?golf|minigolf|go-?karts?|karting|escape ?(room|game)s?|billiards?|billard|billar|biliardo|vr arena|bumper cars|auto-?scooter)\b/i,
  largest:
    /\b(largest|biggest) (arcade|game room|family entertainment)|la plus grande salle|plus grand(e)? (salle|centre) de jeux|größte(n)? (spielhalle|arcade)|más grande (sala|salón)|più grande sala/i,
  retail:
    /\b(arcade machines? for sale|buy arcade machines|we (sell|supply) (arcade|amusement)|distributor of|machines? à vendre|automaten kaufen|zu verkaufen|venta de máquinas|vendita (di )?macchine)\b/i,
  route: /\b(route operator|vending route|we place machines|placement (of|de) machines|aufstellunternehmen)\b/i,
  vrOnly: /\b(vr (lounge|arcade|center|centre)|virtual reality (lounge|arcade|center|centre))\b/i,
  multiSite:
    /\b(our (locations|venues|parks|centres|centers)|all locations|find a location|nos (parcs|centres|salles)|unsere standorte|nuestros centros|i nostri centri|onze vestigingen)\b/i,
};

// Hebrew equivalents, kept apart because \b does not work around Hebrew letters.
const HE: Partial<Record<keyof typeof RX, RegExp>> = {
  arcade: /ארקייד|משחקייה|מתחם משחקים|מתחם גיימינג|מכונות משחק|לונה ?פארק/,
  redemption: /חנות פרסים|דלפק פרסים|כרטיסי זכייה|כרטיסי פרסים|טיקטים/,
  tokens: /אסימונים|אסימון|טוקנים/,
  cashless: /כרטיס משחק|כרטיס נטען|כרטיס משחקים|כרטיס טעינה/,
  loyalty: /מועדון לקוחות|מועדון חברים|כרטיס מועדון/,
  party: /ימי הולדת|יום הולדת|מסיבות|אירועים פרטיים/,
  food: /מסעדה|בית קפה|מזנון|תפריט|בר /,
  multiSite: /הסניפים שלנו|סניפים|סניף /,
};

// Google Maps categories (searched with hl=en) that already say "arcade venue".
const ARCADE_CATEGORY_RX =
  /\b(video arcade|amusement (center|centre|arcade)|children's amusement center|family entertainment center|game room|gaming lounge)\b/i;
// Categories that are never operating venues, unless an arcade category is also listed.
const NON_VENUE_CATEGORY_RX =
  /\b(video game store|game store|toy store|computer store|electronics|shop|shopping (mall|center|centre)|software company|corporate office|coworking space|training center|community center|cultural center|country club|chess club|gym|rock climbing gym|hobby store|collectibles store)\b/i;

const HE_BY_RX = new Map<RegExp, RegExp>(
  Object.entries(HE).map(([key, he]) => [RX[key as keyof typeof RX], he as RegExp]),
);

const KNOWN_CHAINS = [
  "dave & buster's", "dave and buster's", "round1", "round 1", "main event", "chuck e. cheese", "chuck e cheese",
  "timezone", "namco", "bandai namco", "game zone", "flip out", "lasergame evolution", "urban planet",
  "elev8", "funtasticks", "scene75", "pinstack", "bowlero", "lucky strike", "pinstripes", "puttshack",
  "kingpin", "hollywood bowl", "tenpin", "superbowl", "xtreme action park", "jumpyard", "superfly",
  "sky zone", "altitude trampoline", "ninja warrior", "playtopia", "magic planet",
];

const COMPETITOR_SYSTEMS: Array<[RegExp, string]> = [
  [/\bembed\b/i, "Embed"],
  [/\bintercard\b/i, "Intercard"],
  [/\bsacoa\b/i, "Sacoa"],
  [/\bsemnox\b/i, "Semnox"],
  [/\bcenteredge\b/i, "CenterEdge"],
  [/\bcore cashless\b/i, "Core Cashless"],
  [/\bteeg\b/i, "Teeg"],
  [/\bplaycard\b/i, "PlayCard"],
  [/\blaigames\b/i, "LAI Games"],
];

const MACHINE_WORDS =
  "(?:arcade |video |redemption |ticket |amusement )?(?:games|machines|cabinets|jeux|machines de jeux|bornes|spiele|automaten|spielautomaten|geräte|máquinas|juegos|giochi|macchine|spellen|kasten|jogos|máquinas)";
const MACHINE_COUNT_RX = new RegExp(
  `(?:over|more than|plus de|über|mehr als|más de|oltre|meer dan|mais de)?\\s*(\\d{1,4})\\s*\\+?\\s*(?:[\\p{L}-]+\\s){0,2}${MACHINE_WORDS}\\b`,
  "giu",
);

const ROLE_RX =
  /\b(owner|co-?owner|founder|general manager|managing director|gm|ceo|director|manager|propriétaire|gérant(e)?|directeur|directrice|inhaber(in)?|geschäftsführer(in)?|betriebsleiter(in)?|propietario|gerente|director general|titolare|proprietario|eigenaar|bedrijfsleider|proprietário)\b\s*[:\-–—,]?\s*((?:[A-ZÀ-Ý][a-zà-ÿ'-]+\s){1,2}[A-ZÀ-Ý][a-zà-ÿ'-]+|[A-ZÀ-Ý][a-zà-ÿ'-]+\s[A-ZÀ-Ý][a-zà-ÿ'-]+)/g;

const GENERIC_EMAIL = /^(info|contact|hello|hallo|bonjour|admin|office|booking|bookings|events?|party|parties|reservations?|reservierung|reservation|sales|support|team|mail|kontakt|service|welcome|enquiries|inquiries|noreply|no-reply)@/i;

// Hebrew counts ("50 מכונות"); \b does not work around Hebrew letters.
const MACHINE_COUNT_HE_RX = /(\d{1,4})\s*\+?\s*(?:מכונות|מכשירי משחק|משחקי ארקייד|משחקי וידאו)/g;
// "330 games" in a board-game café is not a fleet: bare "games" only counts outside that context.
const BOARD_GAMES_RX =
  /\b(board ?games?|tabletop|jeux de société|brettspiele?|juegos de mesa|giochi da tavolo|bordspel(len)?|jogos de tabuleiro)\b|משחקי קופסה/i;
const STRONG_MACHINE_RX =
  /(arcade|video|redemption|ticket|amusement) |machines|cabinets|bornes|automaten|geräte|máquinas|macchine|kasten/i;

function extractMachineCount(text: string): number | null {
  const boardGames = BOARD_GAMES_RX.test(text);
  let best: number | null = null;
  for (const m of [...text.matchAll(MACHINE_COUNT_RX), ...text.matchAll(MACHINE_COUNT_HE_RX)]) {
    const n = Number(m[1]);
    // Ignore years, prices and implausible values.
    if (!Number.isFinite(n) || n < 3 || n > 1000 || (n >= 1900 && n <= 2100)) continue;
    if (boardGames && !STRONG_MACHINE_RX.test(m[0]) && !/[֐-׿]/.test(m[0])) continue;
    if (best === null || n > best) best = n;
  }
  return best;
}

function extractDecisionMakers(text: string, pages: PageData[]): DecisionMaker[] {
  const found = new Map<string, DecisionMaker>();
  for (const m of text.matchAll(ROLE_RX)) {
    const name = m[3]?.trim();
    if (!name || name.split(/\s+/).length < 2 || found.has(name)) continue;
    found.set(name, { name, title: m[1], email: null, phone: null });
    if (found.size >= 3) break;
  }
  const personalEmails = [...new Set(pages.flatMap((p) => p.emails ?? []))].filter((e) => !GENERIC_EMAIL.test(e));
  for (const dm of found.values()) {
    const [first, last] = dm.name.toLowerCase().split(/\s+/);
    dm.email = personalEmails.find((e) => e.toLowerCase().includes(first) || (last && e.toLowerCase().includes(last))) ?? null;
  }
  return [...found.values()];
}

// Light generic layer for custom ICPs (display only, no score impact): a qualify signal
// counts as seen when most of its distinctive words (5+ letters) appear in the evidence.
const STOPWORDS = new Set(["about", "their", "there", "which", "where", "with", "without", "present", "venue", "venues", "system", "place", "other", "staffed", "fewer", "least", "evidence", "arcade", "machines", "games", "national", "regional", "program"]);
function matchIcpSignals(signals: string[], evidence: string): string[] {
  return signals.filter((signal) => {
    const words = (signal.toLowerCase().match(/[\p{L}]{5,}/gu) ?? []).filter((w) => !STOPWORDS.has(w));
    const hits = words.filter((w) => evidence.includes(w)).length;
    return words.length >= 2 && hits / words.length >= 0.75;
  });
}

export function scoreLeadWithRules(
  lead: LeadInput,
  icp: IcpConfig,
  pages: PageData[],
  socialProfiles: SocialIntel[],
  sourceSummary: SourceSummary,
  reason: "no-ai-key" | "ai-unavailable",
): QualifyResult {
  const pageText = pages
    .map((p) => [p.title, p.description, p.headings.join(" "), (p.imageAlts ?? []).join(" "), p.bodyText, p.jsonLd.join(" ")].join(" "))
    .join(" ");
  const evidence = `${lead.name} ${lead.category ?? ""} ${lead.notes ?? ""} ${pageText}`;
  const lower = evidence.toLowerCase();
  const has = (rx: RegExp) => rx.test(evidence) || Boolean(HE_BY_RX.get(rx)?.test(evidence));
  const arcadeCategory = (lead.category ?? "").match(ARCADE_CATEGORY_RX)?.[0] ?? null;
  const firstCategory = (lead.category ?? "").split(",")[0];
  const nonVenue = !arcadeCategory && NON_VENUE_CATEGORY_RX.test(firstCategory);

  const machineCount = extractMachineCount(evidence);
  const isArcade = Boolean(arcadeCategory) || has(RX.arcade);
  const hasRedemption = has(RX.redemption);
  const hasTokens = has(RX.tokens);
  const hasCashless = has(RX.cashless);
  const hasLoyalty = has(RX.loyalty);
  const hasParty = has(RX.party);
  const hasFood = has(RX.food);
  const attractions = [...new Set((evidence.match(new RegExp(RX.attractions.source, "gi")) ?? []).map((a) => a.toLowerCase()))];
  const isLargest = has(RX.largest);
  const chainName = KNOWN_CHAINS.find((c) => lower.includes(c)) ?? null;
  const isChain = Boolean(chainName) || has(RX.multiSite);
  const competitor = COMPETITOR_SYSTEMS.find(([rx]) => rx.test(evidence))?.[1] ?? null;
  const isRetail = has(RX.retail);
  const isRoute = has(RX.route);
  const isVrOnly = has(RX.vrOnly) && !isArcade;
  // Off-topic main category (a laser hair removal clinic found by "laser tag"): kept in the
  // search results for completeness, rated low here unless the venue itself shows leisure evidence.
  const offTopic = isOffTopicPlace(lead.category) && !isArcade && attractions.length === 0;

  const keySignals: string[] = [];
  const missingSignals: string[] = [];
  const reasons: string[] = [];

  // ── Base score from fleet size (primary qualifier) ──────────────────────────
  let score: number;
  if (machineCount !== null && machineCount >= 15) {
    score = machineCount >= 50 ? 85 : machineCount >= 30 ? 80 : machineCount >= 20 ? 72 : 63;
    keySignals.push(`${machineCount}+ machines mentioned`);
    reasons.push(`the website mentions about ${machineCount} games/machines`);
  } else if (machineCount !== null) {
    // Below the 15-machine threshold; a redemption counter suggests the count may be understated.
    score = hasRedemption ? 40 : 25;
    keySignals.push(`only ~${machineCount} machines mentioned`);
    reasons.push(`only about ${machineCount} machines are mentioned, below the 15-machine threshold`);
  } else if (isArcade) {
    // ICP: "No machine count signal: score conservatively (60-65) if category fits".
    score = arcadeCategory ? 62 : 60;
    keySignals.push(arcadeCategory ? `Google category: ${arcadeCategory}` : "arcade identity confirmed");
    missingSignals.push("machine count unconfirmed");
    reasons.push("arcade signals were found but the fleet size is not stated");
  } else if (attractions.length > 0 || hasParty) {
    score = 35;
    missingSignals.push("no arcade evidence found");
    reasons.push("it is a leisure venue, but no arcade fleet was found");
  } else {
    score = 15;
    missingSignals.push("no arcade evidence found");
    reasons.push("no arcade or entertainment evidence was found");
  }

  // ── Supporting evidence ─────────────────────────────────────────────────────
  if (hasRedemption) { score += 10; keySignals.push("redemption / prize counter"); }
  else missingSignals.push("redemption counter unconfirmed");
  if (hasTokens) { score += 6; keySignals.push("token / coin-op payments"); }
  if (hasCashless) { score += 4; keySignals.push(competitor ? `cashless system (${competitor})` : "cashless card system"); }
  if (!hasTokens && !hasCashless) missingSignals.push("payment system unconfirmed");
  if (hasLoyalty) { score += 4; keySignals.push("loyalty program present"); }
  else missingSignals.push("loyalty program unconfirmed");
  if (hasParty) { score += 3; keySignals.push("birthday / party packages"); }
  if (attractions.length > 0) { score += Math.min(6, attractions.length * 2); keySignals.push(`attractions: ${attractions.slice(0, 3).join(", ")}`); }
  if (hasFood) keySignals.push("food & beverage offered");
  if (isLargest) { score = Math.max(score, 85); keySignals.push("\"largest arcade\" claim"); }
  if (chainName) { score = Math.max(score, 90); keySignals.push(`known chain: ${chainName}`); reasons.push(`it belongs to the ${chainName} chain`); }
  else if (isChain) keySignals.push("multi-location operator");

  for (const s of matchIcpSignals(icp.qualifySignals, lower).slice(0, 3)) keySignals.push(`ICP: ${s}`);

  // ── Disqualifiers ───────────────────────────────────────────────────────────
  if (isRetail) { score = Math.min(score, 15); keySignals.push("sells machines (retail)"); reasons.push("the site looks like a machine seller, not a venue"); }
  if (isRoute) { score = Math.min(score, 15); keySignals.push("route operator"); reasons.push("it looks like an unattended route operator"); }
  if (isVrOnly) { score = Math.min(score, 20); keySignals.push("VR-only venue"); }
  if (offTopic) { score = Math.min(score, 10); keySignals.push(`Google category: ${firstCategory}`); reasons.push(`Google lists it as "${firstCategory}", outside the searched sector`); }
  if (nonVenue) { score = Math.min(score, 30); keySignals.push(`Google category: ${firstCategory}`); reasons.push(`Google lists it as "${firstCategory}", not an operating venue`); }

  // Without a crawlable website the evidence is thin: stay conservative.
  // An arcade category on Google still counts as "category fits" (ICP: 60-65).
  if (pages.length === 0) {
    score = Math.min(score, arcadeCategory ? 62 : 55);
    missingSignals.push(lead.url?.trim() ? "website could not be crawled" : "no website listed on Google Maps");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict: QualifyResult["verdict"] = score >= 60 ? "QUALIFY" : score >= 40 ? "BORDERLINE" : "DISQUALIFY";
  const band = icp.scoreBands.find((b) => {
    const [lo, hi] = b.range.split("-").map(Number);
    return score >= lo && score <= hi;
  });

  const paymentSystem = hasTokens && hasCashless ? "mixed token + card" : hasCashless ? `cashless${competitor ? ` (${competitor})` : ""}` : hasTokens ? "token/coin-op" : "unknown";
  const painPoints = [
    hasTokens && !hasCashless ? "token handling and manual cash collection" : "",
    !hasTokens && !hasCashless ? "payment and machine management unconfirmed" : "",
    !hasLoyalty ? "no visible loyalty program for repeat visits" : "",
    hasParty && !hasCashless ? "party packages likely paid outside a card system" : "",
  ].filter(Boolean).slice(0, 4);

  const modeLabel = reason === "no-ai-key" ? "Free rules-based scoring (no AI)" : "Rules-based scoring (AI temporarily unavailable)";

  return {
    score,
    verdict,
    icpExplanation: `${modeLabel}: ${reasons.join("; ")}.${band ? ` Band: ${band.band}.` : ""}${lead.url?.trim() ? ` Based on ${pages.length} website page${pages.length === 1 ? "" : "s"}.` : " Based on Google Maps data only."}`,
    keySignals: keySignals.slice(0, 12),
    missingSignals: [...new Set(missingSignals)].slice(0, 8),
    painPoints,
    venueIntel: {
      estimatedMachineCount: machineCount !== null ? `${machineCount}+` : hasRedemption ? "15+ (inferred from redemption)" : "unknown",
      paymentSystem,
      venueType: attractions.length > 0 && isArcade
        ? `${attractions[0]} + arcade`
        : isArcade ? (/barcade|beercade/i.test(evidence) ? "barcade" : "arcade / FEC") : lead.category ?? "unknown",
      hasRedemption,
      hasLoyalty,
      hasFoodBeverage: hasFood,
      hasPartyRooms: hasParty,
      isChain,
      chainName,
    },
    outreachIntel: {
      pitchAngle: hasTokens && !hasCashless
        ? `${lead.name} still runs on tokens: pitch a cashless upgrade that removes cash handling and adds spend data.`
        : competitor
          ? `${lead.name} uses ${competitor}: position a switch on reporting, loyalty and total cost.`
          : `Confirm ${lead.name}'s payment and machine-management setup, then pitch cashless + loyalty around the features on its website.`,
      competitorSystem: competitor,
      decisionMakers: extractDecisionMakers(evidence, pages),
      openingHook: keySignals.length > 0 ? `I noticed ${lead.name} offers ${keySignals[0].replace(/^ICP: /, "").toLowerCase()}.` : null,
    },
    recommendedAction: verdict === "QUALIFY"
      ? "Contact the venue operator and verify the current payment system."
      : verdict === "BORDERLINE"
        ? "Verify the machine count (call or Google Maps photos) before outreach."
        : "Low priority: review manually only if other evidence suggests a fleet.",
    crawledPages: pages.length,
    sourceSummary,
    socialProfiles,
    reviewAnalysis: null,
    competitorAnalysis: null,
  };
}
