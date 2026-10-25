import pRetry, { AbortError } from "p-retry";
import { ai } from "@workspace/integrations-gemini-ai";
import { isRateLimitError } from "@workspace/integrations-gemini-ai/batch";
import type { ReviewSignal } from "./reviewCrawler.js";

export interface ReviewPlatformSummary {
  platform: string;
  url: string;
  rating: number | null;
  reviewCount: number | null;
}

export interface ReviewInsight {
  summary: string;
  quote: string | null;
}

export interface ReviewAspect {
  name: string;
  score: number;
  quote: string | null;
}

export type ReviewSentiment = "Excellent" | "Good" | "Mixed" | "Concerning";

export interface ReviewAnalysis {
  sentiment: ReviewSentiment;
  platformSummaries: ReviewPlatformSummary[];
  strengths: ReviewInsight[];
  weaknesses: ReviewInsight[];
  aspects: ReviewAspect[];
}

export async function analyzeReviews(
  signals: ReviewSignal[],
): Promise<ReviewAnalysis | null> {
  const useful = signals.filter(
    (s) => s.rating || s.reviewCount || s.snippets.length > 0,
  );

  const platformSummaries: ReviewPlatformSummary[] = signals.map((s) => ({
    platform: s.platform,
    url: s.url,
    rating: s.rating ?? null,
    reviewCount: s.reviewCount ?? null,
  }));

  if (useful.length === 0) {
    return useful.length === 0 && platformSummaries.length === 0
      ? null
      : {
          sentiment: "Good",
          platformSummaries,
          strengths: [],
          weaknesses: [],
          aspects: [],
        };
  }

  const reviewText = useful
    .map((s) => {
      const meta: string[] = [`[${s.platform}]`];
      if (s.rating) meta.push(`⭐ ${s.rating}/5`);
      if (s.reviewCount) meta.push(`${s.reviewCount} reviews`);
      const lines = [meta.join("  ")];
      for (const snippet of s.snippets) {
        lines.push(`  • "${snippet.slice(0, 400)}"`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const prompt = `You are a customer sentiment analyst. Analyze the following review data and return a structured JSON analysis.

REVIEW DATA:
${reviewText}

Return ONLY valid JSON with this exact structure:
{
  "sentiment": "Excellent" | "Good" | "Mixed" | "Concerning",
  "strengths": [
    { "summary": "3-6 word strength title", "quote": "short supporting quote from reviews or null" }
  ],
  "weaknesses": [
    { "summary": "3-6 word weakness title", "quote": "short supporting quote from reviews or null" }
  ],
  "aspects": [
    { "name": "aspect name e.g. Service, Atmosphere, Value, Cleanliness, Food, Staff", "score": 4.2, "quote": "supporting quote or null" }
  ]
}

Rules:
- sentiment: "Excellent" for avg ≥4.5★, "Good" for ≥4.0★, "Mixed" for ≥3.0★, "Concerning" below
- strengths: 3-5 items, each backed by evidence from the snippets
- weaknesses: 2-4 items, honest about negatives found
- aspects: 3-6 aspects relevant to this business type with a 1.0-5.0 score
- quotes: use real text from the provided snippets, max 80 chars, or null if no clear evidence
- All output in English`;

  try {
    const response = await pRetry(
      async () => {
        try {
          return await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: { responseMimeType: "application/json", maxOutputTokens: 4096 },
          });
        } catch (err) {
          if (isRateLimitError(err)) throw err;
          throw new AbortError(err instanceof Error ? err : new Error(String(err)));
        }
      },
      { retries: 3, minTimeout: 3000, maxTimeout: 30000, factor: 2 },
    );

    const rawText = response.text || "{}";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);

    const sentiment: ReviewSentiment =
      ["Excellent", "Good", "Mixed", "Concerning"].includes(parsed.sentiment)
        ? parsed.sentiment
        : "Good";

    const strengths: ReviewInsight[] = Array.isArray(parsed.strengths)
      ? parsed.strengths
          .slice(0, 5)
          .map((s: Record<string, unknown>) => ({
            summary: String(s.summary ?? ""),
            quote: s.quote ? String(s.quote).slice(0, 120) : null,
          }))
          .filter((s: ReviewInsight) => s.summary)
      : [];

    const weaknesses: ReviewInsight[] = Array.isArray(parsed.weaknesses)
      ? parsed.weaknesses
          .slice(0, 4)
          .map((w: Record<string, unknown>) => ({
            summary: String(w.summary ?? ""),
            quote: w.quote ? String(w.quote).slice(0, 120) : null,
          }))
          .filter((w: ReviewInsight) => w.summary)
      : [];

    const aspects: ReviewAspect[] = Array.isArray(parsed.aspects)
      ? parsed.aspects
          .slice(0, 6)
          .map((a: Record<string, unknown>) => ({
            name: String(a.name ?? ""),
            score: Math.min(5, Math.max(1, Number(a.score) || 3)),
            quote: a.quote ? String(a.quote).slice(0, 100) : null,
          }))
          .filter((a: ReviewAspect) => a.name)
      : [];

    return { sentiment, platformSummaries, strengths, weaknesses, aspects };
  } catch {
    return {
      sentiment: "Good",
      platformSummaries,
      strengths: [],
      weaknesses: [],
      aspects: [],
    };
  }
}
