import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger.js";

const cache = new Map<string, string>();

/**
 * Translates a business search term to the most commonly used local-language
 * equivalent for a given geographic area (city, region, country).
 *
 * Returns the original term unchanged if:
 *  - The area is primarily English-speaking
 *  - The AI call fails
 *  - The result looks suspicious (too long, empty, etc.)
 */
export async function translateSearchTerm(term: string, area: string): Promise<string> {
  const cacheKey = `${area.toLowerCase().trim()}:${term.toLowerCase().trim()}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `You are a business search localisation expert. Given a business type and a geographic area, return the single most common local-language term that people would type into Google Maps to find that kind of business in that area.

Rules:
- If the area is primarily English-speaking (USA, UK, Australia, Canada, New Zealand, Ireland, Singapore, South Africa, etc.) return the original term EXACTLY unchanged.
- Otherwise translate or adapt to the dominant local language. Use colloquial everyday terms, not formal or academic ones.
- Return ONLY the search term — nothing else. No quotes, no punctuation, no explanation.
- If you are not confident about the language or translation, return the original term EXACTLY unchanged.

Area: ${area}
Business type: ${term}
Local search term:`,
            },
          ],
        },
      ],
    });

    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    const translated = raw.replace(/^["']|["']$/g, "").trim();

    if (!translated || translated.length === 0 || translated.length > 120) {
      cache.set(cacheKey, term);
      return term;
    }

    cache.set(cacheKey, translated);
    if (translated.toLowerCase() !== term.toLowerCase()) {
      logger.info({ area, term, translated }, "Search term localised");
    }
    return translated;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ area, term, err: msg }, "Term translation failed, keeping original");
    cache.set(cacheKey, term);
    return term;
  }
}

/**
 * Translate all search terms for a single area in parallel.
 */
export async function translateTermsForArea(terms: string[], area: string): Promise<string[]> {
  return Promise.all(terms.map((t) => translateSearchTerm(t, area)));
}
