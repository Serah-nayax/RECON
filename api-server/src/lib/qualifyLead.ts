import pRetry, { AbortError } from "p-retry";
import { ai } from "@workspace/integrations-gemini-ai";
import { isRateLimitError } from "@workspace/integrations-gemini-ai/batch";
import { crawlSite } from "./crawler.js";
import { extractReviewLinks } from "./reviewCrawler.js";
import { extractSocialLinks } from "./socialCrawler.js";
import type { ReviewAnalysis } from "./analyzeReviews.js";
import type { CompetitorAnalysis } from "./analyzeCompetitor.js";
import type { IcpConfig } from "./icpStore.js";
import type { LeadInput } from "./qualifyStore.js";
import type { SocialIntel } from "./socialCrawler.js";
import { logger } from "./logger.js";
import { canonicalizeLeadUrl } from "./leadIdentity.js";

export interface SourceSummary {
  pages: number;
  reviews: { platform: string; url: string }[];
  socials: { platform: string; url: string }[];
}

export interface VenueIntel {
  estimatedMachineCount: string;
  paymentSystem: string;
  venueType: string;
  hasRedemption: boolean;
  hasLoyalty: boolean;
  hasFoodBeverage: boolean;
  hasPartyRooms: boolean;
  isChain: boolean;
  chainName: string | null;
}

export interface DecisionMaker {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
}

export interface OutreachIntel {
  pitchAngle: string;
  competitorSystem: string | null;
  decisionMakers: DecisionMaker[];
  openingHook: string | null;
}

export interface QualifyResult {
  score: number;
  verdict: "QUALIFY" | "BORDERLINE" | "DISQUALIFY";
  icpExplanation: string;
  keySignals: string[];
  missingSignals: string[];
  painPoints: string[];
  venueIntel: VenueIntel | null;
  outreachIntel: OutreachIntel | null;
  recommendedAction: string;
  crawledPages: number;
  sourceSummary: SourceSummary;
  socialProfiles: SocialIntel[];
  reviewAnalysis: ReviewAnalysis | null;
  competitorAnalysis: CompetitorAnalysis | null;
}

function isUnconfiguredAiIntegrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Replit AI Integrations is not configured") ||
    (message.includes('"code":404') && message.includes("AI Integrations"))
  );
}

function isRecoverableAiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    isUnconfiguredAiIntegrationError(error) ||
    isRateLimitError(error) ||
    /\b(408|429|500|502|503|504)\b|rate.?limit|timed? ?out|timeout|temporar|unavailable|econnreset|fetch failed/i.test(message)
  );
}

function buildEvidenceFallback(
  lead: LeadInput,
  pageText: string,
  crawledPages: number,
  socialProfiles: SocialIntel[],
  sourceSummary: SourceSummary,
): QualifyResult {
  const evidence = `${lead.name} ${lead.category ?? ""} ${lead.notes ?? ""} ${pageText}`.toLowerCase();
  const signals: Array<{ pattern: RegExp; label: string; weight: number }> = [
    { pattern: /\b(arcade|amusement|game room|gaming centre|gaming center)\b/i, label: "arcade venue confirmed", weight: 20 },
    { pattern: /\b(redemption|prize wall|tickets? prizes?)\b/i, label: "redemption offering present", weight: 15 },
    { pattern: /\b(birthday|party package|party room|private event)\b/i, label: "party packages available", weight: 12 },
    { pattern: /\b(bowling|laser tag|trampoline|mini golf|go-?kart)\b/i, label: "multiple attractions available", weight: 10 },
    { pattern: /\b(food|restaurant|cafe|bar|drinks?|menu)\b/i, label: "food and beverage offered", weight: 7 },
    { pattern: /\b(loyalty|rewards?|membership|member points?)\b/i, label: "loyalty program present", weight: 8 },
    { pattern: /\b(cashless|play card|power card|embed|sacoa|intercard|parafait)\b/i, label: "cashless system detected", weight: 8 },
  ];

  const matched = signals.filter(({ pattern }) => pattern.test(evidence));
  const score = Math.min(92, 15 + (crawledPages > 0 ? 10 : 0) + matched.reduce((sum, signal) => sum + signal.weight, 0));
  const verdict: QualifyResult["verdict"] = score >= 65 ? "QUALIFY" : score >= 40 ? "BORDERLINE" : "DISQUALIFY";
  const has = (pattern: RegExp) => pattern.test(evidence);
  const paymentMatch = evidence.match(/\b(power card|embed|sacoa|intercard|parafait|cashless|token|coin-op)\b/i);
  const keySignals = matched.map(({ label }) => label);
  const missingSignals = [
    !has(/\b(redemption|prize wall|tickets? prizes?)\b/i) ? "redemption offering unconfirmed" : "",
    !has(/\b(cashless|play card|power card|embed|sacoa|intercard|parafait)\b/i) ? "payment system unconfirmed" : "",
    !has(/\b(loyalty|rewards?|membership)\b/i) ? "loyalty program unconfirmed" : "",
  ].filter(Boolean);

  return {
    score,
    verdict,
    icpExplanation: `Evidence-based fallback scoring was used because the managed AI scorer was temporarily unavailable. ${crawledPages} website page${crawledPages === 1 ? " was" : "s were"} evaluated against observable venue signals.`,
    keySignals,
    missingSignals,
    painPoints: [
      !paymentMatch ? "payment and machine management system unconfirmed" : "",
      !has(/\b(loyalty|rewards?|membership)\b/i) ? "repeat-visit loyalty capability not evident" : "",
    ].filter(Boolean),
    venueIntel: {
      estimatedMachineCount: "unknown",
      paymentSystem: paymentMatch?.[1] ?? "unknown",
      venueType: has(/\b(bowling|laser tag|trampoline|mini golf|go-?kart)\b/i)
        ? "multi-attraction entertainment venue"
        : has(/\barcade\b/i)
          ? "arcade"
          : lead.category ?? "unknown",
      hasRedemption: has(/\b(redemption|prize wall|tickets? prizes?)\b/i),
      hasLoyalty: has(/\b(loyalty|rewards?|membership|member points?)\b/i),
      hasFoodBeverage: has(/\b(food|restaurant|cafe|bar|drinks?|menu)\b/i),
      hasPartyRooms: has(/\b(birthday|party package|party room|private event)\b/i),
      isChain: false,
      chainName: null,
    },
    outreachIntel: {
      pitchAngle: `Confirm ${lead.name}'s current payment and machine-management setup, then position a measurable cashless upgrade around the venue features found on its website.`,
      competitorSystem: paymentMatch?.[1] ?? null,
      decisionMakers: [],
      openingHook: keySignals.length > 0
        ? `I noticed that ${lead.name} promotes ${keySignals[0]}.`
        : `I was reviewing ${lead.name}'s entertainment offering.`,
    },
    recommendedAction: verdict === "DISQUALIFY"
      ? "Review manually before outreach."
      : "Verify the current payment system and contact the venue operator.",
    crawledPages,
    sourceSummary,
    socialProfiles,
    reviewAnalysis: null,
    competitorAnalysis: null,
  };
}

// ── High-value page slots fed to the AI ──────────────────────────────────────
const MAX_PAGES_IN_CONTEXT = 8;
const MAX_CHARS_PER_PAGE = 2000;
const MAX_CONTEXT_CHARS = 20000;
const FAST_CRAWL_PAGE_LIMIT = 4;
const QUALIFICATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const QUALIFICATION_CACHE_MAX_ENTRIES = 250;

const qualificationCache = new Map<string, { result: QualifyResult; expiresAt: number }>();

function getQualificationCacheKey(lead: LeadInput, icp: IcpConfig): string {
  return JSON.stringify([
    canonicalizeLeadUrl(lead.url),
    lead.name.trim().toLowerCase(),
    lead.category?.trim().toLowerCase() ?? "",
    lead.city?.trim().toLowerCase() ?? "",
    lead.country?.trim().toLowerCase() ?? "",
    lead.notes?.trim().toLowerCase() ?? "",
    icp.id,
    icp.updatedAt,
  ]);
}

function readCachedQualification(key: string): QualifyResult | null {
  const cached = qualificationCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    qualificationCache.delete(key);
    return null;
  }
  qualificationCache.delete(key);
  qualificationCache.set(key, cached);
  return structuredClone(cached.result);
}

function cacheQualification(
  key: string,
  result: QualifyResult,
  ttlMs: number = QUALIFICATION_CACHE_TTL_MS,
): void {
  qualificationCache.set(key, {
    result: structuredClone(result),
    expiresAt: Date.now() + ttlMs,
  });
  while (qualificationCache.size > QUALIFICATION_CACHE_MAX_ENTRIES) {
    const oldest = qualificationCache.keys().next().value;
    if (!oldest) break;
    qualificationCache.delete(oldest);
  }
}

function buildPrompt(icp: IcpConfig, leadContext: string): string {
  const qualifyList = icp.qualifySignals.map((s) => `- ${s}`).join("\n");
  const disqualifyList = icp.disqualifySignals.map((s) => `- ${s}`).join("\n");
  const bandList = icp.scoreBands
    .map((b) => `- ${b.range} (${b.band}): ${b.description}`)
    .join("\n");

  const systemSection = icp.systemPrompt
    .replace("{ICP_DESCRIPTION}", icp.description)
    .replace("{QUALIFY_SIGNALS}", qualifyList)
    .replace("{DISQUALIFY_SIGNALS}", disqualifyList)
    .replace("{SCORE_BANDS}", bandList);

  const signalFormatInstructions = `
SIGNAL FORMAT — CRITICAL:
keySignals and missingSignals MUST be short noun phrases of 3-6 words each.
DO NOT write full sentences or explanations in signals.
DO write specific, factual, evidence-based phrases drawn directly from the crawled data.

GOOD signal examples (copy this style exactly):
  "50+ arcade machines confirmed"
  "full redemption counter present"
  "cashless card kiosks installed"
  "active loyalty rewards program"
  "birthday party rooms available"
  "4.7★ Google (800+ reviews)"
  "token coin-op machines"
  "largest arcade in [city]"
  "no cashless system found"
  "machine count unconfirmed"
  "bar-primary with 3 machines"

BAD signal examples (never do this):
  "The venue appears to have a large arcade section with many machines" ← too long, not factual
  "Based on the website content..." ← never start with filler
  "Opportunity for cashless upgrade" ← too vague

PAIN POINTS — extract 2-4 specific operational problems this venue faces that Nayax/Tigapo solves:
Each pain point is 5-10 words, specific and evidence-based from the crawled data.
Examples:
  "token-based cash handling inefficiency"
  "no player spend data available"
  "manual cash collection from machines"
  "loyalty program absent, no repeat visits"
  "party package payments still cash-only"
  "no centralised machine management system"

VENUE INTEL — extract structured facts about the venue:
- estimatedMachineCount: best estimate (e.g. "50+", "20-30", "2-3", "unknown")
- paymentSystem: current system visible (e.g. "token/coin-op", "cashless (Power Card)", "cashless (Embed)", "mixed token + card", "unknown")
- venueType: most specific label (e.g. "FEC", "barcade", "trampoline park + arcade", "bowling + arcade", "standalone arcade")
- hasRedemption: true if evidence of redemption counter, prize wall, or ticket redemption
- hasLoyalty: true if evidence of loyalty card, rewards program, or member points
- hasFoodBeverage: true if venue serves food or drinks
- hasPartyRooms: true if they offer birthday parties or private event rooms
- isChain: true if this is one location in a multi-site chain
- chainName: chain brand name or null

OUTREACH INTEL — actionable sales intelligence for the sales rep:
- pitchAngle: 1-2 sentence custom pitch for THIS specific venue (what Nayax/Tigapo solves for THEM specifically)
- competitorSystem: name of any existing cashless/card system found (e.g. "Power Card", "Embed", "Sacoa", "Intercard"), or null
- decisionMakers: array of named decision-makers (owner, GM, manager, operator) found on the site. For each, extract: name (required), title (their role or null), email (personal/direct only — NOT generic info@/contact@/admin@ addresses), phone (direct line or null). Use empty array [] if no named individuals found.
- openingHook: ONE specific, research-backed sentence a sales rep can open with — referencing something found on the site

MULTILINGUAL CONTENT:
The crawled website content may be written in any language (French, German, Spanish,
Portuguese, Italian, Dutch, Japanese, Arabic, Korean, or others). You MUST analyse and
interpret ALL content regardless of language — do not penalise a venue for having a
non-English website; a French FEC is just as valid a lead as an American one.
Extract signals from the native-language text exactly as you would from English content.
ALL output fields MUST be written in English, regardless of the source language.

Return ONLY valid JSON with this exact structure:
{
  "score": <number 0-100>,
  "verdict": "QUALIFY" | "BORDERLINE" | "DISQUALIFY",
  "icpExplanation": "<2-3 sentence explanation of score and fit>",
  "keySignals": ["<3-6 word phrase>", ...],
  "missingSignals": ["<3-6 word phrase>", ...],
  "painPoints": ["<5-10 word specific pain point>", ... up to 4],
  "venueIntel": {
    "estimatedMachineCount": "<string>",
    "paymentSystem": "<string>",
    "venueType": "<string>",
    "hasRedemption": <boolean>,
    "hasLoyalty": <boolean>,
    "hasFoodBeverage": <boolean>,
    "hasPartyRooms": <boolean>,
    "isChain": <boolean>,
    "chainName": <string | null>
  },
  "outreachIntel": {
    "pitchAngle": "<1-2 sentence custom pitch>",
    "competitorSystem": <string | null>,
    "decisionMakers": [{"name": "<string>", "title": <string | null>, "email": <string | null>, "phone": <string | null>}],
    "openingHook": "<specific research-backed opener>"
  },
  "competitorIntel": {
    "vendorName": <string | null>,
    "productCategory": <string | null>,
    "description": <string | null>,
    "aspectClaims": [{"aspect": "<aspect name e.g. Pricing model>", "them": "<brief claim about competitor>"}]
  },
  "recommendedAction": "<specific next action for sales team>",
  "sourceSummary": {
    "pages": <number of internal pages crawled>,
    "reviews": ["<platform name>", ...],
    "socials": ["<platform name>", ...]
  }
}

COMPETITOR INTEL INSTRUCTIONS:
If you find evidence of an existing cashless/payment system (from competitorSystem or elsewhere), populate competitorIntel.
vendorName: the competitor vendor name (Power Card, Embed, Sacoa, Intercard, Parafait, or other), or null if none detected.
productCategory: their product type (e.g. "Cashless FEC platform"), or null.
description: 1 sentence about what they offer, or null.
aspectClaims: 3-5 aspect claims you can infer about the competitor from context (pricing, hardware, loyalty, reporting, support). Return [] if unknown.
Set competitorIntel to null if no competitor system is detected.`;

  return `${systemSection}\n\n${leadContext}\n\n${signalFormatInstructions}`;
}

export async function qualifyLead(
  lead: LeadInput,
  icp: IcpConfig,
  onProgress?: (phase: "crawling" | "scoring") => void,
  signal?: AbortSignal,
): Promise<QualifyResult> {
  const cacheKey = getQualificationCacheKey(lead, icp);
  const cached = readCachedQualification(cacheKey);
  if (cached) {
    logger.info({ lead: lead.name }, "Qualification cache hit");
    onProgress?.("scoring");
    return cached;
  }

  onProgress?.("crawling");

  // Decision-first crawl: homepage plus the highest-value linked pages.
  const pages = await crawlSite(lead.url, 1, FAST_CRAWL_PAGE_LIMIT, signal);

  // Discover optional enrichment sources without fetching them on the critical path.
  const reviewLinks = extractReviewLinks(pages);
  const socialLinks  = extractSocialLinks(pages);
  const socialIntel: SocialIntel[] = socialLinks.map(({ platform, url }) => ({ platform, url }));

  // ── Build page context: prioritise content-rich pages ─────────────────────
  const pageText = pages
    .slice(0, MAX_PAGES_IN_CONTEXT)
    .map((p) => {
      const phoneLine = p.phones?.length ? `PHONES: ${p.phones.join(", ")}` : "";
      const emailLine = p.emails?.length ? `EMAILS: ${p.emails.join(", ")}` : "";
      const altLine   = p.imageAlts?.length ? `IMAGE ALTS: ${p.imageAlts.slice(0, 15).join(" | ")}` : "";
      const parts = [
        `--- PAGE: ${p.url} ---`,
        `TITLE: ${p.title}`,
        p.description ? `DESCRIPTION: ${p.description}` : "",
        p.headings.length ? `HEADINGS: ${p.headings.slice(0, 20).join(" | ")}` : "",
        phoneLine,
        emailLine,
        altLine,
        p.bodyText.slice(0, MAX_CHARS_PER_PAGE),
        p.jsonLd.length ? `STRUCTURED DATA: ${p.jsonLd.join("\n")}` : "",
      ];
      return parts.filter(Boolean).join("\n");
    })
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);

  const leadContext = [
    `LEAD TO QUALIFY:`,
    `- Company Name: ${lead.name}`,
    `- Website: ${lead.url}`,
    lead.category ? `- Category: ${lead.category}` : "",
    lead.city    ? `- City: ${lead.city}` : "",
    lead.country ? `- Country: ${lead.country}` : "",
    lead.notes   ? `- Notes: ${lead.notes}` : "",
    "",
    pages.length === 0
      ? "NOTE: The website could not be crawled. Base your assessment on the company name, category, and any available metadata only. Be conservative with the score."
      : `CRAWLED WEBSITE CONTENT (${pages.length} pages):`,
    pages.length > 0 ? pageText : "",
  ]
    .filter(Boolean)
    .join("\n");

  onProgress?.("scoring");

  const fullPrompt = buildPrompt(icp, leadContext);

  const inferredSource: SourceSummary = {
    pages: pages.length,
    reviews: reviewLinks,
    socials: socialLinks,
  };

  let rawText: string;
  try {
    const response = await pRetry(
      async () => {
        try {
          return await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
            config: {
              responseMimeType: "application/json",
              maxOutputTokens: 8192,
              abortSignal: signal,
            },
          });
        } catch (err) {
          if (signal?.aborted) {
            throw new AbortError(new Error("Qualification cancelled"));
          }
          if (isRateLimitError(err)) throw err;
          if (isRecoverableAiError(err)) throw err;
          throw new AbortError(err instanceof Error ? err : new Error(String(err)));
        }
      },
      { retries: 2, minTimeout: 1500, maxTimeout: 5000, factor: 2, randomize: true },
    );
    rawText = response.text || "{}";
  } catch (error) {
    if (signal?.aborted) throw new Error("Qualification cancelled");
    if (!isRecoverableAiError(error)) throw error;
    logger.warn(
      { lead: lead.name, error: error instanceof Error ? error.message : String(error) },
      "Managed AI scorer unavailable; using evidence-based qualification fallback",
    );
    const fallback = buildEvidenceFallback(lead, pageText, pages.length, socialIntel, inferredSource);
    cacheQualification(cacheKey, fallback, 5 * 60 * 1000);
    return fallback;
  }

  let result: QualifyResult;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);

    const aiPages = typeof parsed.sourceSummary?.pages === "number" ? parsed.sourceSummary.pages : null;

    const venueIntel: VenueIntel | null = parsed.venueIntel
      ? {
          estimatedMachineCount: String(parsed.venueIntel.estimatedMachineCount ?? "unknown"),
          paymentSystem: String(parsed.venueIntel.paymentSystem ?? "unknown"),
          venueType: String(parsed.venueIntel.venueType ?? "unknown"),
          hasRedemption: Boolean(parsed.venueIntel.hasRedemption),
          hasLoyalty: Boolean(parsed.venueIntel.hasLoyalty),
          hasFoodBeverage: Boolean(parsed.venueIntel.hasFoodBeverage),
          hasPartyRooms: Boolean(parsed.venueIntel.hasPartyRooms),
          isChain: Boolean(parsed.venueIntel.isChain),
          chainName: parsed.venueIntel.chainName ?? null,
        }
      : null;

    const rawDMs = parsed.outreachIntel?.decisionMakers;
    const decisionMakers: DecisionMaker[] = Array.isArray(rawDMs)
      ? rawDMs
          .filter((d: unknown) => d && typeof d === "object" && typeof (d as Record<string, unknown>).name === "string")
          .map((d: Record<string, unknown>) => ({
            name: String(d.name),
            title: d.title ? String(d.title) : null,
            email: d.email ? String(d.email) : null,
            phone: d.phone ? String(d.phone) : null,
          }))
      : [];

    const outreachIntel: OutreachIntel | null = parsed.outreachIntel
      ? {
          pitchAngle: String(parsed.outreachIntel.pitchAngle ?? ""),
          competitorSystem: parsed.outreachIntel.competitorSystem ?? null,
          decisionMakers,
          openingHook: parsed.outreachIntel.openingHook ?? null,
        }
      : null;

    result = {
      score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
      verdict: parsed.verdict || "BORDERLINE",
      icpExplanation: parsed.icpExplanation || "No explanation provided.",
      keySignals: Array.isArray(parsed.keySignals) ? parsed.keySignals.slice(0, 12) : [],
      missingSignals: Array.isArray(parsed.missingSignals) ? parsed.missingSignals.slice(0, 8) : [],
      painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints.slice(0, 4) : [],
      venueIntel,
      outreachIntel,
      recommendedAction: parsed.recommendedAction || "Review manually.",
      crawledPages: pages.length,
      sourceSummary: {
        pages: aiPages ?? inferredSource.pages,
        reviews: inferredSource.reviews,
        socials: inferredSource.socials,
      },
      socialProfiles: socialIntel,
      reviewAnalysis: null,
      competitorAnalysis: null,
    };
  } catch (parseErr) {
    throw new Error(
      `Gemini returned unparseable response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. Raw: ${rawText.slice(0, 200)}`,
    );
  }

  cacheQualification(cacheKey, result);
  return result;
}
