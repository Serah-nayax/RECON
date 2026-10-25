import { getConfig } from "./configStore.js";
import { logger } from "./logger.js";
import type { DecisionMaker } from "./qualifyLead.js";

const BASE_URL = "https://api.seamless.ai/v1";

interface SeamlessContact {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  job_title?: string;
  title?: string;
  email?: string;
  phone?: string;
  work_phone?: string;
  mobile_phone?: string;
  linkedin_url?: string;
}

interface SeamlessSearchResponse {
  data?: SeamlessContact[];
  contacts?: SeamlessContact[];
  results?: SeamlessContact[];
  total?: number;
}

function extractDomain(url: string): string {
  try {
    const raw = url.startsWith("http") ? url : `https://${url}`;
    const parsed = new URL(raw);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
}

function buildName(contact: SeamlessContact): string {
  if (contact.full_name) return contact.full_name.trim();
  const parts = [contact.first_name, contact.last_name].filter(Boolean);
  return parts.join(" ").trim();
}

function pickPhone(contact: SeamlessContact): string | null {
  return contact.phone ?? contact.work_phone ?? contact.mobile_phone ?? null;
}

function toDecisionMaker(contact: SeamlessContact): DecisionMaker | null {
  const name = buildName(contact);
  if (!name) return null;
  return {
    name,
    title: contact.job_title ?? contact.title ?? null,
    email: contact.email ?? null,
    phone: pickPhone(contact),
  };
}

export async function enrichWithSeamlessAi(
  leadUrl: string,
  companyName: string,
): Promise<DecisionMaker[]> {
  const apiKey = getConfig("SEAMLESS_AI_API_KEY");
  if (!apiKey) return [];

  const domain = extractDomain(leadUrl);

  try {
    const res = await fetch(`${BASE_URL}/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        domain,
        company_name: companyName,
        page: 1,
        page_size: 10,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, domain, body: body.slice(0, 200) }, "Seamless.AI returned non-200");
      return [];
    }

    const data = (await res.json()) as SeamlessSearchResponse;
    const raw: SeamlessContact[] = data.data ?? data.contacts ?? data.results ?? [];

    const makers = raw
      .map(toDecisionMaker)
      .filter((d): d is DecisionMaker => d !== null)
      .slice(0, 8);

    logger.info({ domain, found: makers.length }, "Seamless.AI enrichment complete");
    return makers;
  } catch (err) {
    logger.warn({ err, domain }, "Seamless.AI enrichment failed — skipping");
    return [];
  }
}

export function mergeDecisionMakers(
  aiMakers: DecisionMaker[],
  seamlessMakers: DecisionMaker[],
): DecisionMaker[] {
  const seen = new Set<string>();
  const merged: DecisionMaker[] = [];

  for (const dm of [...seamlessMakers, ...aiMakers]) {
    const key = dm.name.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(dm);
  }

  return merged.slice(0, 10);
}
