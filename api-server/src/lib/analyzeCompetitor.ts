import pRetry, { AbortError } from "p-retry";
import { ai } from "@workspace/integrations-gemini-ai";
import { isRateLimitError } from "@workspace/integrations-gemini-ai/batch";
import type { SocialIntel } from "./socialCrawler.js";

export interface CompetitorAspect {
  aspect: string;
  them: string;
  us: string;
}

export interface CompetitorSocialSummary {
  platform: string;
  url: string;
  bio?: string;
  followers?: string;
  postTone?: string;
  categoryTags?: string[];
}

export interface CompetitorAnalysis {
  vendorName: string;
  productCategory: string | null;
  description: string | null;
  comparisonTable: CompetitorAspect[];
  socialIntel: CompetitorSocialSummary[];
  strategicOverview: string;
  competitiveAngle: string;
}

function buildPrompt(
  vendorName: string,
  vendorDescription: string | null,
  productCategory: string | null,
  aspectClaims: { aspect: string; them: string }[],
  socialLines: string[],
  ourProductName: string,
): string {
  const competitorContext = [
    `Competitor vendor: ${vendorName}`,
    productCategory ? `Category: ${productCategory}` : "",
    vendorDescription ? `Description: ${vendorDescription}` : "",
    aspectClaims.length > 0
      ? `Known aspect claims from their site:\n${aspectClaims.map((a) => `- ${a.aspect}: ${a.them}`).join("\n")}`
      : "",
    socialLines.length > 0
      ? `Competitor social presence:\n${socialLines.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `You are a sales intelligence analyst specializing in the cashless payment and amusement technology market.

Our product: ${ourProductName} (modern cashless payment solutions for FECs, arcades, and entertainment venues — includes Nayax and Tigapo brands, covering contactless payments, loyalty programs, cashless card systems, real-time reporting, and remote machine management).

${competitorContext}

Generate a competitive analysis comparing ${vendorName} against our product (${ourProductName}).

The comparison must cover these 5 aspects: Pricing model, Hardware flexibility, Cashless & loyalty features, Reporting & analytics, Support & service.

For "them" claims: describe what ${vendorName} offers (or is known for) for each aspect.
For "us" claims: describe what ${ourProductName} offers as the competitive advantage.

Keep each claim to 1 short sentence (max 12 words).

Also write:
- strategicOverview: a 3-4 sentence paragraph describing the competitive landscape and where ${vendorName} is weak, giving the sales rep strategic context
- competitiveAngle: a single punchy sentence (max 20 words) the rep can use to position against ${vendorName}

Return ONLY valid JSON:
{
  "comparisonTable": [
    {"aspect": "<aspect name>", "them": "<their approach>", "us": "<our advantage>"},
    ...
  ],
  "strategicOverview": "<3-4 sentence strategic context>",
  "competitiveAngle": "<one punchy competitive angle sentence>"
}`;
}

export async function analyzeCompetitor(
  vendorName: string,
  vendorProfile: { description: string; productCategory: string } | null,
  aspectClaims: { aspect: string; them: string }[],
  socialIntel: SocialIntel[],
  ourProductName: string,
): Promise<CompetitorAnalysis> {
  const socialLines = socialIntel.map((s) => {
    const parts: string[] = [`[${s.platform}]`];
    if (s.followers) parts.push(`Followers: ${s.followers}`);
    if (s.bio) parts.push(`Bio: ${s.bio.slice(0, 200)}`);
    if (s.postTone) parts.push(`Tone: ${s.postTone}`);
    return parts.join(" | ");
  });

  const prompt = buildPrompt(
    vendorName,
    vendorProfile?.description ?? null,
    vendorProfile?.productCategory ?? null,
    aspectClaims,
    socialLines,
    ourProductName,
  );

  const socialSummary: CompetitorSocialSummary[] = socialIntel.map((s) => ({
    platform: s.platform,
    url: s.url,
    bio: s.bio,
    followers: s.followers,
    postTone: s.postTone,
    categoryTags: s.categoryTags,
  }));

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
      { retries: 3, minTimeout: 5000, maxTimeout: 60000, factor: 2 },
    );

    const rawText = response.text || "{}";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);

    const comparisonTable: CompetitorAspect[] = Array.isArray(parsed.comparisonTable)
      ? parsed.comparisonTable
          .filter(
            (r: unknown) =>
              r &&
              typeof r === "object" &&
              typeof (r as Record<string, unknown>).aspect === "string",
          )
          .map((r: Record<string, unknown>) => ({
            aspect: String(r.aspect),
            them: String(r.them ?? ""),
            us: String(r.us ?? ""),
          }))
      : [];

    return {
      vendorName,
      productCategory: vendorProfile?.productCategory ?? null,
      description: vendorProfile?.description ?? null,
      comparisonTable,
      socialIntel: socialSummary,
      strategicOverview: String(parsed.strategicOverview ?? ""),
      competitiveAngle: String(parsed.competitiveAngle ?? ""),
    };
  } catch {
    return {
      vendorName,
      productCategory: vendorProfile?.productCategory ?? null,
      description: vendorProfile?.description ?? null,
      comparisonTable: [],
      socialIntel: socialSummary,
      strategicOverview: "",
      competitiveAngle: "",
    };
  }
}
