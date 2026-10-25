import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { PageData, IntelReport, IntelSignals } from "./jobStore.js";

const EMPTY_SIGNALS: IntelSignals = {
  company: { name: null, description: null, location: null, employees: null, founded: null },
  hiring: { isHiring: false, roles: [], signals: [] },
  pricing: { tiers: [], recentChanges: [] },
  techStack: [],
  news: { announcements: [], pressReleases: [] },
  contact: { emails: [], phones: [], socialLinks: [], decisionMakers: [], socialProfiles: [] },
};

export async function synthesizeIntel(
  targetUrl: string,
  pages: PageData[],
): Promise<IntelReport> {
  if (pages.length === 0) {
    return {
      url: targetUrl,
      crawledPages: 0,
      summary: "No pages could be crawled from this URL.",
      signals: EMPTY_SIGNALS,
      rawPages: [],
    };
  }

  const pageText = pages
    .slice(0, 15)
    .map((p) => {
      const parts = [
        `--- PAGE: ${p.url} ---`,
        `TITLE: ${p.title}`,
        p.description ? `DESCRIPTION: ${p.description}` : "",
        p.headings.length ? `HEADINGS: ${p.headings.slice(0, 20).join(" | ")}` : "",
        p.bodyText,
        p.jsonLd.length ? `STRUCTURED DATA: ${p.jsonLd.join("\n")}` : "",
      ];
      return parts.filter(Boolean).join("\n");
    })
    .join("\n\n")
    .slice(0, 80000);

  const prompt = `You are a business intelligence analyst. Analyze the following web pages crawled from "${targetUrl}" and extract structured signal intelligence.

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "summary": "2-3 sentence executive summary of the company",
  "signals": {
    "company": {
      "name": "company name or null",
      "description": "what they do in 1-2 sentences or null",
      "location": "city/country or null",
      "employees": "estimated headcount range or null",
      "founded": "founding year or null"
    },
    "hiring": {
      "isHiring": true or false,
      "roles": ["list of open roles found"],
      "signals": ["hiring signals like 'rapidly expanding engineering team'"]
    },
    "pricing": {
      "tiers": ["list of pricing tiers or plans found"],
      "recentChanges": ["any pricing changes detected"]
    },
    "techStack": ["technologies detected from content, job posts, meta, or structured data"],
    "news": {
      "announcements": ["recent product or company announcements"],
      "pressReleases": ["press releases or media mentions"]
    },
    "contact": {
      "emails": ["email addresses found"],
      "phones": ["phone numbers found"],
      "socialLinks": ["social media profile URLs found"],
      "decisionMakers": [
        {
          "name": "full name of person",
          "title": "job title or role, or null",
          "email": "their direct email if found, or null",
          "phone": "their direct phone if found, or null"
        }
      ],
      "socialProfiles": [
        {
          "platform": "platform name e.g. LinkedIn, Instagram, Facebook, X, YouTube, TikTok",
          "url": "full URL of the profile",
          "bio": "bio or description text visible on the company website about this profile, or null",
          "followers": "follower/subscriber count if mentioned, or null",
          "postTone": "inferred tone e.g. Professional, Casual, Educational, Promotional, or null",
          "categoryTags": ["topic tags inferred from the content e.g. B2B, SaaS, Events"]
        }
      ]
    }
  }
}

For decisionMakers: extract named individuals found on About, Team, Contact, or Leadership pages — people with names and roles (e.g. CEO, Founder, Manager). Do NOT include generic mailboxes like info@, support@, contact@. Return an empty array if no named individuals are found.
For socialProfiles: for each social link found, include enriched metadata if visible on the site. Infer platform from the URL. Return socialLinks AND socialProfiles — they can coexist. Return empty array if no social links found.

CRAWLED PAGES:
${pageText}`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const block = message.content[0];
  const rawText = block.type === "text" ? block.text : "{}";

  let parsed: { summary: string; signals: IntelSignals };
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
  } catch {
    parsed = {
      summary: rawText.slice(0, 500),
      signals: EMPTY_SIGNALS,
    };
  }

  return {
    url: targetUrl,
    crawledPages: pages.length,
    summary: parsed.summary ?? "Analysis complete.",
    signals: parsed.signals ?? EMPTY_SIGNALS,
    rawPages: pages,
  };
}
