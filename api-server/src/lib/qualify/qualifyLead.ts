import pRetry, { AbortError } from "p-retry";
import { ai, isGeminiConfigured } from "@workspace/integrations-gemini-ai";
import { scoreLeadWithRules } from "./ruleScoring.js";
import { scoreLeadWithIcp } from "./icpScoring.js";
import type { PageData } from "./websiteCrawler.js";
import { isRateLimitError } from "@workspace/integrations-gemini-ai/batch";
import { crawlSite } from "./websiteCrawler.js";
import { extractReviewLinks } from "./reviewLinks.js";
import { extractSocialLinks } from "./socialLinks.js";
import type { ReviewAnalysis, CompetitorAnalysis } from "./qualifyStore.js";
import type { IcpConfig } from "../icpStore.js";
import type { LeadInput } from "./qualifyStore.js";
import type { SocialIntel } from "./socialLinks.js";
import { logger } from "../logger.js";
import { canonicalizeLeadUrl } from "./leadIdentity.js";
import { runGeminiCall } from "../geminiLimiter.js";
import { buildAiPrompt, readAssessment, scoreAssessment, type AiPrompt } from "./aiScoring.js";
import { askClaude, claudeModel, isClaudeConfigured } from "./claudeClient.js";
import { emptyUsage, type AiUsage } from "./aiUsage.js";

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
  /** AI tokens this qualification consumed; null when no AI call was made (free scoring, cache). */
  aiUsage?: AiUsage | null;
}

function isUnconfiguredAiIntegrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("to use Gemini") ||
    (message.includes('"code":404') && message.includes("AI Integrations"))
  );
}

function isRecoverableAiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    isUnconfiguredAiIntegrationError(error) ||
    isRateLimitError(error) ||
    /\b(408|429|500|502|503|504|529)\b|rate.?limit|overloaded|timed? ?out|timeout|temporar|unavailable|econnreset|fetch failed|connection error/i.test(message)
  );
}

function parseModelJson(rawText: string): any {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
}

// Gemini 2.5 Flash "thinks" before answering, which adds latency to every lead. Unset keeps
// the model default; GEMINI_THINKING_BUDGET=0 turns thinking off, or a number caps it.
function thinkingOption(): { thinkingConfig?: { thinkingBudget: number } } {
  const raw = process.env.GEMINI_THINKING_BUDGET;
  if (raw === undefined || raw === "") return {};
  const thinkingBudget = Number(raw);
  return Number.isFinite(thinkingBudget) ? { thinkingConfig: { thinkingBudget } } : {};
}

const geminiModel = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";

// One AI call, returning the raw text and adding the tokens it used to `usage`.
// Claude when RECON_ENABLE_CLAUDE=1 and its key is set, otherwise Gemini (paced by the Gemini limiter).
async function requestRawText(
  prompt: AiPrompt,
  leadName: string,
  usage: AiUsage,
  signal?: AbortSignal,
): Promise<string> {
  if (isClaudeConfigured()) {
    const reply = await askClaude(prompt.instructions, prompt.lead, prompt.schema, signal);
    usage.calls++;
    usage.inputTokens += reply.inputTokens;
    usage.outputTokens += reply.outputTokens;
    usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + reply.cacheWriteTokens;
    usage.cacheReadTokens = (usage.cacheReadTokens ?? 0) + reply.cacheReadTokens;
    logger.info(
      {
        lead: leadName,
        model: usage.model,
        inputTokens: reply.inputTokens,
        cacheWriteTokens: reply.cacheWriteTokens,
        cacheReadTokens: reply.cacheReadTokens,
        outputTokens: reply.outputTokens,
      },
      "Claude call done",
    );
    return reply.text;
  }
  const response = await runGeminiCall(
    () =>
      ai.models.generateContent({
        model: geminiModel(),
        contents: [{ role: "user", parts: [{ text: `${prompt.instructions}\n\n${prompt.lead}` }] }],
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          abortSignal: signal,
          ...thinkingOption(),
        },
      }),
    signal,
  );
  // Gemini bills its "thinking" tokens as output.
  const meta = response.usageMetadata;
  usage.calls++;
  usage.inputTokens += meta?.promptTokenCount ?? 0;
  usage.outputTokens += (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0);
  // Empty stays empty, so the parsing rejects it and the call is retried (see askClaude).
  return response.text ?? "";
}

/**
 * The tokens of a lead that ends in failure were still billed: they ride on the error so the
 * runner can save them with the failed lead, and the batch and month costs stay complete.
 */
export function withAiUsage(error: unknown, usage: AiUsage): Error {
  const err = error instanceof Error ? error : new Error(String(error));
  if (usage.calls > 0) (err as Error & { aiUsage?: AiUsage }).aiUsage = usage;
  return err;
}

export function aiUsageOfError(error: unknown): AiUsage | null {
  return (error as { aiUsage?: AiUsage } | null)?.aiUsage ?? null;
}

// ── High-value page slots fed to the AI ──────────────────────────────────────
const MAX_PAGES_IN_CONTEXT = 8;
const MAX_CHARS_PER_PAGE = 2000;
const MAX_CONTEXT_CHARS = 20000;
const FAST_CRAWL_PAGE_LIMIT = 4;
// A normal site is read in ~5 s; past this, score with whatever pages arrived.
const FAST_CRAWL_DEADLINE_MS = 15_000;
const QUALIFICATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const UNREAD_SITE_CACHE_TTL_MS = 5 * 60 * 1000;
const CRAWL_ATTEMPTS = 2;
const CRAWL_RETRY_DELAY_MS = 5000;
// Above the size of a big batch (Lyon: 258 leads), so retrying a batch never pays twice.
const QUALIFICATION_CACHE_MAX_ENTRIES = 2000;

const qualificationCache = new Map<string, { result: QualifyResult; expiresAt: number }>();

function getQualificationCacheKey(lead: LeadInput, icp: IcpConfig): string {
  return JSON.stringify([
    lead.url?.trim() ? canonicalizeLeadUrl(lead.url) : "",
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

interface Opinion {
  parsed: any;
  assessment: ReturnType<typeof readAssessment>;
  scored: ReturnType<typeof scoreAssessment>;
}

function scoreOpinion(parsed: any, icp: IcpConfig, content: string, hasContent: boolean): Opinion {
  const assessment = readAssessment(parsed, icp, content);
  return { parsed, assessment, scored: scoreAssessment(assessment, { hasContent }) };
}

// Scores where one more or one less signal changes the verdict. Below 25 the lead is another kind
// of business (10) and above 75 a target with several quoted signals: both were identical on repeat runs.
const UNCERTAIN_SCORE_MIN = 25;
const UNCERTAIN_SCORE_MAX = 75;

function isUncertainScore(score: number): boolean {
  return score >= UNCERTAIN_SCORE_MIN && score <= UNCERTAIN_SCORE_MAX;
}

/** Second opinion, and a third if the first two disagree on the verdict. A failed extra call keeps what we have. */
async function addOpinions(
  opinions: Opinion[],
  askOnce: () => Promise<any>,
  icp: IcpConfig,
  content: string,
  hasContent: boolean,
  leadName: string,
  signal: AbortSignal | undefined,
): Promise<Opinion[]> {
  const all = [...opinions];
  while (all.length < 3) {
    if (all.length === 2 && all[0].scored.verdict === all[1].scored.verdict) break;
    try {
      all.push(scoreOpinion(await askOnce(), icp, content, hasContent));
    } catch (err) {
      if (signal?.aborted) throw new Error("Qualification cancelled");
      logger.warn(
        { lead: leadName, error: err instanceof Error ? err.message : String(err) },
        "Extra AI opinion failed; keeping the opinions already made",
      );
      break;
    }
  }
  return all;
}

/**
 * One opinion: itself. Two that agree on the verdict: the lower score (the cautious one).
 * Three: the median. Two that disagree (third call failed): the lower one.
 */
function pickOpinion(opinions: Opinion[]): Opinion {
  const sorted = [...opinions].sort((a, b) => a.scored.score - b.scored.score);
  return sorted.length === 3 ? sorted[1] : sorted[0];
}

/**
 * Free scoring: the chosen ICP's signals compared by meaning with the website (local model).
 * The rules-based arcade scorer is the fallback when the model cannot be loaded.
 */
async function scoreFree(
  lead: LeadInput,
  icp: IcpConfig,
  pages: PageData[],
  socialIntel: SocialIntel[],
  sourceSummary: SourceSummary,
  reason: "no-ai-key" | "ai-unavailable",
): Promise<QualifyResult> {
  const rules = () => scoreLeadWithRules(lead, icp, pages, socialIntel, sourceSummary, reason);
  try {
    const result = await scoreLeadWithIcp(lead, icp, pages, socialIntel, sourceSummary);
    // Arcade ICPs also get the venue details (payment system, machines, pitch) the rules extract.
    if (/arcade|redemption/i.test(`${icp.description} ${icp.qualifySignals.join(" ")}`)) {
      const { venueIntel, outreachIntel, painPoints } = rules();
      Object.assign(result, { venueIntel, outreachIntel, painPoints });
    }
    return result;
  } catch (err) {
    logger.warn({ lead: lead.name, err: err instanceof Error ? err.message : String(err) }, "Local ICP model unavailable; using rules-based scoring");
    return rules();
  }
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
    // A cached answer made no new AI call, so it costs nothing this time.
    return { ...cached, aiUsage: null };
  }

  onProgress?.("crawling");

  // Decision-first crawl: homepage plus the highest-value linked pages. A place Google Maps lists
  // without a website is still scored, from its name, category and notes.
  const hasWebsite = !!lead.url?.trim();
  let pages: PageData[] = [];
  if (hasWebsite) {
    // A site that gives nothing is tried again: during a network hiccup (Nov 2026 test), sites
    // read fine before and after came back empty, and an arcade scored without its site drops
    // from 67 to 42.
    for (let attempt = 0; attempt < CRAWL_ATTEMPTS && pages.length === 0; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, CRAWL_RETRY_DELAY_MS * attempt));
        if (signal?.aborted) throw new Error("Qualification cancelled");
      }
      pages = await crawlSite(lead.url, 1, FAST_CRAWL_PAGE_LIMIT, signal, FAST_CRAWL_DEADLINE_MS);
    }
  }
  // A score made without the lead's own site is kept briefly only, so a retry reads the site again.
  const resultCacheTtlMs = hasWebsite && pages.length === 0 ? UNREAD_SITE_CACHE_TTL_MS : QUALIFICATION_CACHE_TTL_MS;

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
    `- Website: ${hasWebsite ? lead.url : "none listed"}`,
    lead.category ? `- Category: ${lead.category}` : "",
    lead.city    ? `- City: ${lead.city}` : "",
    lead.country ? `- Country: ${lead.country}` : "",
    lead.notes   ? `- Notes: ${lead.notes}` : "",
    "",
    !hasWebsite
      ? "NOTE: This place has no website listed on Google Maps. Base your assessment on the company name, category, and any available metadata only. Be conservative with the score."
      : pages.length === 0
      ? "NOTE: The website could not be crawled. Base your assessment on the company name, category, and any available metadata only. Be conservative with the score."
      : `CRAWLED WEBSITE CONTENT (${pages.length} pages):`,
    pages.length > 0 ? pageText : "",
  ]
    .filter(Boolean)
    .join("\n");

  onProgress?.("scoring");

  const fullPrompt = buildAiPrompt(icp, leadContext);

  const inferredSource: SourceSummary = {
    pages: pages.length,
    reviews: reviewLinks,
    socials: socialLinks,
  };

  if (!isClaudeConfigured() && !isGeminiConfigured()) {
    const result = await scoreFree(lead, icp, pages, socialIntel, inferredSource, "no-ai-key");
    cacheQualification(cacheKey, result, resultCacheTtlMs);
    return result;
  }

  const usage = isClaudeConfigured() ? emptyUsage("claude", claudeModel()) : emptyUsage("gemini", geminiModel());
  const askOnce = (): Promise<any> =>
    pRetry(
      async () => {
        let rawText: string;
        try {
          // Each attempt takes its own paced slot, so retries also respect the quota.
          rawText = await requestRawText(fullPrompt, lead.name, usage, signal);
        } catch (err) {
          if (signal?.aborted) {
            throw new AbortError(new Error("Qualification cancelled"));
          }
          if (isRateLimitError(err)) throw err;
          if (isRecoverableAiError(err)) throw err;
          throw new AbortError(err instanceof Error ? err : new Error(String(err)));
        }
        // A truncated or malformed reply is retried, rather than failing the lead outright.
        try {
          return parseModelJson(rawText);
        } catch (parseErr) {
          throw new Error(
            `The AI (${usage.model}) returned an unparseable response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. Raw: ${rawText.slice(0, 200)}`,
          );
        }
      },
      // Free-tier quota resets per minute, so rate-limit waits must be long enough to matter.
      { retries: 4, minTimeout: 3000, maxTimeout: 30000, factor: 2, randomize: true },
    );

  let parsed: any;
  try {
    parsed = await askOnce();
  } catch (error) {
    if (signal?.aborted) throw new Error("Qualification cancelled");
    if (!isRecoverableAiError(error)) throw withAiUsage(error, usage);
    // With Claude, the free scorers are not a fallback: they ranked toy shops above arcades on the
    // Lyon test, and a wrong score looks like a real one. The lead fails instead, so that a retry
    // (or the resume after a restart) scores it properly.
    if (isClaudeConfigured()) {
      throw withAiUsage(
        new Error(
          `Claude unavailable after retries, retry this lead later: ${error instanceof Error ? error.message : String(error)}`,
        ),
        usage,
      );
    }
    logger.warn(
      { lead: lead.name, error: error instanceof Error ? error.message : String(error) },
      "Managed AI scorer unavailable; using rules-based qualification fallback",
    );
    const fallback = await scoreFree(lead, icp, pages, socialIntel, inferredSource, "ai-unavailable");
    // Replies that came back unusable were still billed.
    fallback.aiUsage = usage.calls > 0 ? usage : null;
    cacheQualification(cacheKey, fallback, 5 * 60 * 1000);
    return fallback;
  }

  let result: QualifyResult;
  try {
    // The model reports facts with quotes; the score is computed here from the verified ones.
    const hasContent = pages.length > 0;
    let opinions = [scoreOpinion(parsed, icp, leadContext, hasContent)];
    // The model is not fully repeatable: on repeat runs, clear cases kept their score but some
    // uncertain ones moved by up to 25 points and changed verdict. An uncertain score gets a
    // second opinion; if the two verdicts differ, a third decides (the median opinion is kept).
    if (isUncertainScore(opinions[0].scored.score)) {
      opinions = await addOpinions(opinions, askOnce, icp, leadContext, hasContent, lead.name, signal);
    }
    const chosen = pickOpinion(opinions);
    parsed = chosen.parsed;
    const { assessment, scored } = chosen;
    if (opinions.length > 1) {
      logger.info(
        { lead: lead.name, scores: opinions.map((o) => o.scored.score), kept: scored.score },
        "Uncertain lead re-checked",
      );
    }

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

    const missingSignals = pages.length === 0
      ? [hasWebsite ? "website could not be crawled" : "no website listed on Google Maps", ...scored.missingSignals]
      : scored.missingSignals;
    logger.info(
      {
        lead: lead.name,
        icp: icp.name,
        score: scored.score,
        fit: assessment.fit,
        met: assessment.qualify.filter((s) => s.status === "met").length,
        disqualified: assessment.disqualify.filter((s) => s.status === "met").length,
        rejectedQuotes: [...assessment.qualify, ...assessment.disqualify].filter((s) => !s.verified).length,
      },
      "Lead scored with AI evidence",
    );

    result = {
      score: scored.score,
      verdict: scored.verdict,
      icpExplanation: scored.explanation,
      keySignals: scored.keySignals,
      missingSignals: missingSignals.slice(0, 8),
      painPoints: Array.isArray(parsed.painPoints) ? parsed.painPoints.slice(0, 4) : [],
      venueIntel,
      outreachIntel,
      recommendedAction: parsed.recommendedAction || "Review manually.",
      crawledPages: pages.length,
      sourceSummary: {
        pages: inferredSource.pages,
        reviews: inferredSource.reviews,
        socials: inferredSource.socials,
      },
      socialProfiles: socialIntel,
      reviewAnalysis: null,
      competitorAnalysis: null,
      aiUsage: usage,
    };
  } catch (buildErr) {
    if (signal?.aborted) throw new Error("Qualification cancelled");
    throw withAiUsage(
      new Error(
        `The AI (${usage.model}) response could not be mapped to a qualification: ${buildErr instanceof Error ? buildErr.message : String(buildErr)}`,
      ),
      usage,
    );
  }

  cacheQualification(cacheKey, result, resultCacheTtlMs);
  return result;
}
