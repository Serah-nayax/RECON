export interface CompetitorProfile {
  website: string;
  description: string;
  productCategory: string;
  social: { platform: string; url: string }[];
}

export const COMPETITOR_MAP: Record<string, CompetitorProfile> = {
  "Power Card": {
    website: "https://www.powercard.com",
    description: "Card-based cashless gaming platform for FECs and amusement parks with play credits and loyalty",
    productCategory: "Cashless FEC platform",
    social: [
      { platform: "Facebook", url: "https://www.facebook.com/PowerCardFEC/" },
      { platform: "LinkedIn", url: "https://www.linkedin.com/company/power-card" },
    ],
  },
  "Embed": {
    website: "https://www.embedcard.com",
    description: "All-in-one cashless and management solution for family entertainment centers",
    productCategory: "FEC cashless & management platform",
    social: [
      { platform: "Facebook", url: "https://www.facebook.com/EmbedCard/" },
      { platform: "LinkedIn", url: "https://www.linkedin.com/company/embed-card" },
    ],
  },
  "Sacoa": {
    website: "https://www.sacoausa.com",
    description: "Cashless debit card systems and amusement management software for arcades and FECs",
    productCategory: "Cashless arcade management",
    social: [
      { platform: "LinkedIn", url: "https://www.linkedin.com/company/sacoa" },
      { platform: "Facebook", url: "https://www.facebook.com/SacoaPlaycard/" },
    ],
  },
  "Intercard": {
    website: "https://www.intercardinc.com",
    description: "Debit card payment and amusement management systems for entertainment venues worldwide",
    productCategory: "Debit card amusement payment",
    social: [
      { platform: "LinkedIn", url: "https://www.linkedin.com/company/intercard-inc" },
    ],
  },
  "Parafait": {
    website: "https://www.semnox.com",
    description: "Semnox Parafait — game management and cashless ticketing platform for family entertainment",
    productCategory: "Entertainment venue management",
    social: [
      { platform: "LinkedIn", url: "https://www.linkedin.com/company/semnox-solutions" },
    ],
  },
  "CenterEdge": {
    website: "https://www.centeredgesoftware.com",
    description: "Point-of-sale and venue management software for family entertainment and attractions",
    productCategory: "FEC POS & management",
    social: [
      { platform: "LinkedIn", url: "https://www.linkedin.com/company/centeredge-software" },
      { platform: "Facebook", url: "https://www.facebook.com/CenterEdgeSoftware/" },
    ],
  },
};

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
