// Free lead scoring driven by the chosen ICP, for any ICP created online (no AI service).
// A small multilingual model runs locally (no data leaves the machine) and compares by meaning:
//   - each qualify / disqualify signal of the ICP with the sentences of the website,
//   - the ICP itself with the Google category and the site identity (is it the right sector?),
//   - numeric signals ("15+ machines", "fewer than 15 machines") with the numbers on the site.
// It does not reason like an AI: it finds the evidence each ICP signal describes and scores
// on how much of the ICP is covered.
import path from "node:path";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import type { PageData } from "./websiteCrawler.js";
import type { IcpConfig } from "../icpStore.js";
import type { LeadInput } from "./qualifyStore.js";
import type { QualifyResult, SourceSummary } from "./qualifyLead.js";
import type { SocialIntel } from "./socialLinks.js";
import { logger } from "../logger.js";

// Chosen on a multilingual test set (EN/FR/HE): separates relevant from unrelated sentences
// well, loads in ~1 s and reads a sentence in ~3 ms on a laptop CPU. Downloaded once (~120 MB).
const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const MODELS_DIR = process.env.RECON_MODELS_DIR ?? path.resolve(process.cwd(), "..", ".models");

/** A signal is found when a sentence says the same thing (cosine similarity on this model). */
const STRONG_MATCH = 0.55;
/** A weaker match counts only when that sentence is closest to this signal among all signals. */
const WEAK_MATCH = 0.45;
const WEAK_MARGIN = 0.05;
/** A number on the site counts for a numeric signal when its words mean the signal's noun. */
// Measured: "80 arcade games", "60 מכונות משחק", "50 jeux d'arcade" 0.43–0.47 for "arcade machines";
// "12 bowling lanes", "3 boutiques", "15 rue de la Paix" 0.27 or less.
const NUMBER_MATCH = 0.38;
/** Below this, the place is outside the ICP's sector; between the two, the fit is unsure. */
const SECTOR_OFF = 0.2;
const SECTOR_UNSURE = 0.32;
/** Matching this share of the signals (weighted, at least 3) is full coverage: no venue shows all of them. */
const FULL_COVERAGE_SHARE = 0.4;
const MAX_PASSAGES = 250;
/** Fewer sentences than this on the site is too little to judge the lead on the site alone. */
const THIN_EVIDENCE = 10;
/** Sector fit of the name and category alone. Measured on arcade Jerusalem: Kiftzuba 0.61,
 *  G@me Zone 0.64, Jungle play town 0.47; coworking 0.37, laser clinic 0.14. */
const SECTOR_CLEAR = 0.55;
const SECTOR_LIKELY = 0.45;
/** Name and category against an example the ICP lists: "Laser tag center" 0.75, "Ten Pin Bowling Alley" 0.69. */
const EXAMPLE_CLEAR = 0.65;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = MODELS_DIR;
      const startedAt = Date.now();
      const extractor = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
      logger.info({ model: MODEL, ms: Date.now() - startedAt }, "Local scoring model loaded");
      return extractor;
    })();
    // A failed load (offline first run) is retried on the next lead.
    extractorPromise.catch(() => { extractorPromise = null; });
  }
  return extractorPromise;
}

/** Loads the model in the background at startup, so the first lead is not slowed down. */
export function warmUpIcpScoring(): void {
  getExtractor().catch((err) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Local scoring model unavailable; rules-based scoring will be used"),
  );
}

const embedCache = new Map<string, number[]>();
const EMBED_CACHE_MAX = 5000;

async function embed(texts: string[]): Promise<number[][]> {
  const missing = [...new Set(texts.filter((t) => !embedCache.has(t)))];
  if (missing.length) {
    const extractor = await getExtractor();
    for (let i = 0; i < missing.length; i += 64) {
      const batch = missing.slice(i, i + 64);
      const vectors = (await extractor(batch, { pooling: "mean", normalize: true })).tolist() as number[][];
      batch.forEach((t, k) => embedCache.set(t, vectors[k]));
    }
    while (embedCache.size > EMBED_CACHE_MAX) embedCache.delete(embedCache.keys().next().value!);
  }
  return texts.map((t) => embedCache.get(t)!);
}

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);

// ── ICP parsing ───────────────────────────────────────────────────────────────

interface NumericRule {
  /** "at least N" (15+ machines) or "below N" (fewer than 15 machines). */
  kind: "min" | "max";
  n: number;
  /** What is counted, e.g. "arcade redemption ticket machines". */
  noun: string;
}

interface Signal {
  text: string;
  /** The signal without parentheses and examples, as embedded. */
  core: string;
  numeric: NumericRule | null;
  weight: number;
}

function parseNumeric(text: string): NumericRule | null {
  const lower = text.toLowerCase();
  const nounAfter = (index: number) =>
    lower.slice(index).replace(/\(.*?\)/g, " ").split(/\b(with|and|or|but|no|without|in|at|on|for)\b|[,;.]/)[0]
      .replace(/[/+-]/g, " ").replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim();
  let m = lower.match(/(?:fewer than|less than|under|below|only|up to|moins de|max(?:imum)?)\s*(\d{1,4})/);
  if (m) return { kind: "max", n: Number(m[1]), noun: nounAfter(m.index! + m[0].length) };
  m = lower.match(/(\d{1,4})\s*[-–]\s*(\d{1,4})\s+/);
  if (m && /only|standalone|small|just/.test(lower)) return { kind: "max", n: Number(m[2]) + 1, noun: nounAfter(m.index! + m[0].length) };
  m = lower.match(/(?:at least|minimum|min\.?|more than|over|plus de|au moins)\s*(\d{1,4})|(\d{1,4})\s*\+/);
  if (m) return { kind: "min", n: Number(m[1] ?? m[2]), noun: nounAfter(m.index! + m[0].length) };
  return null;
}

function parseSignals(signals: string[]): Signal[] {
  return signals
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => {
      const numeric = parseNumeric(text);
      return {
        text,
        core: text.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim() || text,
        numeric: numeric && numeric.noun ? numeric : null,
        // ICP authors list the main criterion first.
        weight: index === 0 ? 1.5 : 1,
      };
    });
}

// ── Evidence from the lead ───────────────────────────────────────────────────

/** A passage of fewer words ("Arcade", "Bakery") is close to every signal of its theme: it proves nothing. */
const MIN_WORDS = 4;

/** The sentences of the site that can prove a signal. The name and Google category feed the sector fit instead. */
function passagesOf(lead: LeadInput, pages: PageData[]): string[] {
  const head: string[] = [lead.notes ?? ""];
  const body: string[] = [];
  for (const p of pages) {
    head.push(p.title, p.description, ...p.headings.slice(0, 30));
    if (p.imageAlts?.length) head.push(p.imageAlts.slice(0, 20).join(", "));
    // Sentences, merged into chunks long enough to carry meaning.
    let chunk = "";
    for (const sentence of p.bodyText.split(/(?<=[.!?։׃])\s+|\n+|\s{3,}/)) {
      const s = sentence.trim();
      if (!s) continue;
      if (chunk && chunk.length + s.length > 220) { body.push(chunk); chunk = ""; }
      chunk = chunk ? `${chunk} ${s}` : s;
      if (chunk.length >= 60) { body.push(chunk); chunk = ""; }
    }
    if (chunk) body.push(chunk);
  }
  const seen = new Set<string>();
  return [...head, ...body]
    .map((t) => t.replace(/\s+/g, " ").trim().slice(0, 300))
    .filter((t) => t.split(" ").length >= MIN_WORDS && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, MAX_PASSAGES);
}

/** Numbers on the site with the words right after them ("50 arcade games", "120 מכונות"). */
function numberPhrases(pages: PageData[]): { n: number; phrase: string }[] {
  const out: { n: number; phrase: string }[] = [];
  const text = pages.map((p) => `${p.title}. ${p.description}. ${p.headings.join(". ")}. ${p.bodyText}`).join(" ");
  for (const m of text.matchAll(/(\d{1,4})\s*\+?\s*((?:[\p{L}'’-]+\s*){1,4})/gu)) {
    const n = Number(m[1]);
    // Years, times and implausible counts are not fleet sizes.
    if (n < 1 || n > 2000 || (n >= 1900 && n <= 2100)) continue;
    // "3 s", "14 x": a unit or fragment, yet its vector lands near any counted noun.
    const words = m[2].trim();
    if (words.replace(/[^\p{L}]/gu, "").length < 4) continue;
    out.push({ n, phrase: `${n} ${words}` });
    if (out.length >= 200) break;
  }
  return out;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

interface Match {
  signal: Signal;
  similarity: number;
  quote: string;
  strong: boolean;
}

const short = (s: string, max = 90) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * Scores a lead against the chosen ICP with the local model. Throws when the model cannot be
 * loaded (the caller then falls back to the rules-based scorer).
 */
export async function scoreLeadWithIcp(
  lead: LeadInput,
  icp: IcpConfig,
  pages: PageData[],
  socialProfiles: SocialIntel[],
  sourceSummary: SourceSummary,
): Promise<QualifyResult> {
  const qualify = parseSignals(icp.qualifySignals);
  const disqualify = parseSignals(icp.disqualifySignals);
  const all = [...qualify, ...disqualify];
  const passages = passagesOf(lead, pages);
  const numbers = numberPhrases(pages);
  const identity = [lead.name, lead.category ?? "", pages[0]?.title ?? "", pages[0]?.description ?? ""]
    .filter(Boolean).join(" · ").slice(0, 300);
  const icpCore = icp.description.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 300) || icp.name;
  const nouns = [...new Set(all.flatMap((s) => (s.numeric ? [s.numeric.noun] : [])))];
  // Example lists in a signal ("bowling, laser tag, go-karts + arcade") name places of the sector.
  const examples = [...new Set(icp.qualifySignals.flatMap((text) =>
    [...text.matchAll(/\(([^)]*,[^)]*)\)/g)].flatMap((m) => m[1].split(/,|\bor\b/))
      .map((x) => x.replace(/\betc\.?/i, "").trim())
      .filter((x) => x.replace(/[^\p{L}]/gu, "").length >= 4),
  ))];

  // The description often starts with what the seller offers ("cashless payments for…"), so the
  // sector is also read from the qualify signals, which describe the target place.
  const [signalVecs, passageVecs, numberVecs, nounVecs, [identityVec, ...icpVecs]] = await Promise.all([
    embed(all.map((s) => s.core)),
    embed(passages),
    embed(numbers.map((x) => x.phrase)),
    embed(nouns),
    embed([identity || lead.name, icpCore, ...qualify.map((s) => s.core)]),
  ]);
  const exampleVecs = await embed(examples);

  // Similarity of every signal with every passage; for each passage, its closest signal.
  const sims = signalVecs.map((sv) => passageVecs.map((pv) => dot(sv, pv)));
  const closest = passageVecs.map((_, j) => {
    const ranked = sims.map((row, i) => ({ i, s: row[j] })).sort((a, b) => b.s - a.s);
    return { i: ranked[0]?.i ?? -1, margin: (ranked[0]?.s ?? 0) - (ranked[1]?.s ?? 0) };
  });

  // A disqualifier shares its theme with the qualify signals ("selling arcade hardware" vs
  // "arcade floor"): it counts only on a sentence that is closer to it than to any other signal.
  const findMatch = (signal: Signal, index: number, exclusive = false): Match | null => {
    if (signal.numeric) {
      const nounVec = nounVecs[nouns.indexOf(signal.numeric.noun)];
      const counted = numbers
        .map((x, k) => ({ ...x, s: dot(nounVec, numberVecs[k]) }))
        .filter((x) => x.s >= NUMBER_MATCH);
      if (counted.length === 0) return null;
      const best = counted.reduce((a, b) => (b.n > a.n ? b : a));
      const ok = signal.numeric.kind === "min" ? best.n >= signal.numeric.n : best.n < signal.numeric.n;
      return ok ? { signal, similarity: best.s, quote: best.phrase, strong: true } : null;
    }
    let bestJ = -1;
    for (let j = 0; j < passages.length; j++) {
      const s = sims[index][j];
      const isClosest = closest[j].i === index;
      const strong = s >= STRONG_MATCH && (!exclusive || isClosest);
      const weak = s >= WEAK_MATCH && isClosest && closest[j].margin >= WEAK_MARGIN;
      if ((strong || weak) && (bestJ === -1 || s > sims[index][bestJ])) bestJ = j;
    }
    if (bestJ === -1) return null;
    const s = sims[index][bestJ];
    return { signal, similarity: s, quote: passages[bestJ], strong: s >= STRONG_MATCH };
  };

  const qualifyMatches = qualify.map((s, i) => findMatch(s, i)).filter((m): m is Match => m !== null);
  const disqualifyMatches = disqualify.map((s, i) => findMatch(s, qualify.length + i, true)).filter((m): m is Match => m !== null);
  const sectorFit = Math.max(...icpVecs.map((v) => dot(identityVec, v)));
  // The place itself may still read as the sector through a matched signal (a laser tag centre
  // whose main category is "party equipment rental").
  const bestQualify = Math.max(0, ...qualifyMatches.map((m) => m.similarity));
  const fit = Math.max(sectorFit, bestQualify - 0.15);

  const reasons: string[] = [];
  const matchedWeight = qualifyMatches.reduce((sum, m) => sum + m.signal.weight * (m.strong ? 1 : 0.6), 0);
  const totalWeight = qualify.reduce((sum, s) => sum + s.weight, 0);
  const coverage = totalWeight === 0 ? 0 : Math.min(1, matchedWeight / Math.min(totalWeight, Math.max(3, totalWeight * FULL_COVERAGE_SHARE)));
  let score = 25 + 70 * coverage;
  reasons.push(`${qualifyMatches.length} of ${qualify.length} ICP signals found`);

  if (fit < SECTOR_OFF) {
    score = Math.min(score, 20);
    reasons.push(`"${short(lead.category || lead.name, 60)}" is outside the ICP's sector`);
  } else if (fit < SECTOR_UNSURE) {
    score = Math.min(score, 50);
    reasons.push("the fit with the ICP's sector is unsure");
  }
  for (const m of disqualifyMatches) {
    // A clear disqualifier ends the lead; a weak one only lowers it.
    score = m.strong ? Math.min(score, m.signal.numeric ? 35 : 20) : score - 15;
    reasons.push(`disqualifier: ${short(m.signal.text, 70)}`);
  }
  if (pages.length === 0) {
    score = Math.min(score, 50);
    reasons.push(lead.url?.trim() ? "the website could not be read" : "no website is listed on Google Maps");
  }
  // With little to read on the site, the name and Google category are the only evidence: a place
  // that clearly reads as the sector stays borderline (to check by hand) instead of being dropped.
  if (passages.length < THIN_EVIDENCE && disqualifyMatches.length === 0) {
    // A one- or two-word example is close to look-alikes ("laser tag" vs a laser clinic, 0.57),
    // hence its own, stricter threshold.
    const exampleFit = Math.max(0, ...exampleVecs.map((v) => dot(identityVec, v)));
    const floor = sectorFit >= SECTOR_CLEAR || exampleFit >= EXAMPLE_CLEAR ? 55 : sectorFit >= SECTOR_LIKELY ? 45 : 0;
    if (score < floor) {
      score = floor;
      reasons.push(lead.url?.trim()
        ? "the name and Google category fit the ICP's sector, but the website gives little evidence"
        : "the name and Google category fit the ICP's sector (no website to confirm it)");
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict: QualifyResult["verdict"] = score >= 60 ? "QUALIFY" : score >= 40 ? "BORDERLINE" : "DISQUALIFY";
  const band = icp.scoreBands.find((b) => {
    const [lo, hi] = b.range.split("-").map(Number);
    return score >= lo && score <= hi;
  });

  const keySignals = [
    ...qualifyMatches.sort((a, b) => b.similarity - a.similarity).map((m) => `${m.signal.text} — "${short(m.quote, 70)}"`),
    ...disqualifyMatches.map((m) => `✕ ${m.signal.text} — "${short(m.quote, 70)}"`),
  ];
  const found = new Set(qualifyMatches.map((m) => m.signal.text));
  const missingSignals = qualify.filter((s) => !found.has(s.text)).map((s) => s.text);
  if (pages.length === 0) missingSignals.unshift(lead.url?.trim() ? "website could not be crawled" : "no website listed on Google Maps");

  logger.info(
    { lead: lead.name, icp: icp.name, score, sectorFit: Number(sectorFit.toFixed(2)), qualify: qualifyMatches.length, disqualify: disqualifyMatches.length, passages: passages.length },
    "Lead scored with the local ICP model",
  );

  return {
    score,
    verdict,
    icpExplanation: `Free ICP scoring (local model, no AI) for "${icp.name}": ${reasons.join("; ")}.${band ? ` Band: ${band.band}.` : ""}${lead.url?.trim() ? ` Based on ${pages.length} website page${pages.length === 1 ? "" : "s"}.` : " Based on Google Maps data only."}`,
    keySignals: keySignals.slice(0, 12),
    missingSignals: missingSignals.slice(0, 8),
    painPoints: [],
    venueIntel: null,
    outreachIntel: null,
    recommendedAction: verdict === "QUALIFY"
      ? `Contact ${lead.name}: it matches the "${icp.name}" ICP${band ? ` (${band.band})` : ""}.`
      : verdict === "BORDERLINE"
        ? `Check the missing ICP signals (${missingSignals.slice(0, 2).join("; ") || "website"}) before outreach.`
        : "Low priority for this ICP: review manually only if other evidence suggests a fit.",
    crawledPages: pages.length,
    sourceSummary,
    socialProfiles,
    reviewAnalysis: null,
    competitorAnalysis: null,
  };
}
