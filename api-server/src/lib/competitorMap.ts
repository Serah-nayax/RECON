export interface CompetitorProfile {
  website: string;
  description: string;
  productCategory: string;
  social: { platform: string; url: string }[];
}

// Add the competitors you want Recon to recognise. Example:
//
// "Competitor Name": {
//   website: "https://www.example.com",
//   description: "What the competitor sells",
//   productCategory: "Product category",
//   social: [{ platform: "LinkedIn", url: "https://www.linkedin.com/company/example" }],
// },
export const COMPETITOR_MAP: Record<string, CompetitorProfile> = {};

export function lookupCompetitor(name: string): CompetitorProfile | null {
  const lower = name.toLowerCase().trim();
  for (const [key, profile] of Object.entries(COMPETITOR_MAP)) {
    if (
      key.toLowerCase() === lower ||
      lower.includes(key.toLowerCase()) ||
      key.toLowerCase().includes(lower)
    ) {
      return profile;
    }
  }
  return null;
}

export function detectCompetitorFromText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const name of Object.keys(COMPETITOR_MAP)) {
    if (lower.includes(name.toLowerCase())) return name;
  }
  return null;
}
