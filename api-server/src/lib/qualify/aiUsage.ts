// AI consumption tracking: what each lead's AI calls used, and totals per batch and per month.
// The provider's console (Claude Console) is the source of truth for billing; these are estimates.

export interface AiUsage {
  provider: "claude" | "gemini";
  model: string;
  /** API calls made for this lead, retries included. */
  calls: number;
  /** Uncached input tokens (full price). */
  inputTokens: number;
  outputTokens: number;
  /** Claude prompt cache: tokens written (1.25x input price) and read (0.1x). Missing on older leads. */
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}

export interface UsageSummary {
  /** Leads that made at least one AI call (cached and free-scored leads cost nothing). */
  leadsWithAi: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** Estimated cost in US dollars, from the price table below. */
  estimatedCostUsd: number;
  models: string[];
  /** Models missing from the price table: their tokens are counted but not priced. */
  unpricedModels: string[];
}

export interface MonthUsage extends UsageSummary {
  /** "YYYY-MM", from the date each lead finished. */
  month: string;
}

// US dollars per million tokens (standard API prices, Nov 2026). Update when prices change.
// cacheWrite = 5-minute cache write, cacheRead = cache hit (claude.com prompt-caching pricing).
const PRICES_PER_MILLION: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheWrite: 0.3, cacheRead: 0.3 },
};

export function emptyUsage(provider: AiUsage["provider"], model: string): AiUsage {
  return { provider, model, calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
}

function costOf(usage: AiUsage): number | null {
  const price = PRICES_PER_MILLION[usage.model];
  if (!price) return null;
  return (
    usage.inputTokens * price.input +
    usage.outputTokens * price.output +
    (usage.cacheWriteTokens ?? 0) * price.cacheWrite +
    (usage.cacheReadTokens ?? 0) * price.cacheRead
  ) / 1_000_000;
}

interface LeadWithUsage {
  aiUsage?: AiUsage | null;
  completedAt?: string | null;
}

export function summarizeUsage(leads: LeadWithUsage[]): UsageSummary {
  const summary: UsageSummary = {
    leadsWithAi: 0,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    estimatedCostUsd: 0,
    models: [],
    unpricedModels: [],
  };
  for (const { aiUsage } of leads) {
    if (!aiUsage || aiUsage.calls === 0) continue;
    summary.leadsWithAi++;
    summary.calls += aiUsage.calls;
    summary.inputTokens += aiUsage.inputTokens;
    summary.outputTokens += aiUsage.outputTokens;
    summary.cacheWriteTokens += aiUsage.cacheWriteTokens ?? 0;
    summary.cacheReadTokens += aiUsage.cacheReadTokens ?? 0;
    if (!summary.models.includes(aiUsage.model)) summary.models.push(aiUsage.model);
    const cost = costOf(aiUsage);
    if (cost === null) {
      if (!summary.unpricedModels.includes(aiUsage.model)) summary.unpricedModels.push(aiUsage.model);
    } else {
      summary.estimatedCostUsd += cost;
    }
  }
  summary.estimatedCostUsd = Math.round(summary.estimatedCostUsd * 10_000) / 10_000;
  return summary;
}

/** Totals per calendar month (from each lead's completedAt), most recent first. */
export function summarizeByMonth(leads: LeadWithUsage[]): MonthUsage[] {
  const byMonth = new Map<string, LeadWithUsage[]>();
  for (const lead of leads) {
    if (!lead.aiUsage || lead.aiUsage.calls === 0) continue;
    const month = lead.completedAt ? lead.completedAt.slice(0, 7) : "unknown";
    const list = byMonth.get(month) ?? [];
    list.push(lead);
    byMonth.set(month, list);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, monthLeads]) => ({ month, ...summarizeUsage(monthLeads) }));
}
