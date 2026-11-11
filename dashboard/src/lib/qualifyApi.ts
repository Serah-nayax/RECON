import { getCrawlerApiKey } from "./crawlerAuth";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": getCrawlerApiKey(),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface IcpConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  qualifySignals: string[];
  disqualifySignals: string[];
  /** Terms offered on the Maps page; null or missing: guessed from the description. */
  searchTerms?: string[] | null;
  scoreBands: { band: string; range: string; description: string }[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeadInput {
  name: string;
  url: string;
  category?: string;
  city?: string;
  country?: string;
  notes?: string;
}

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

export interface SocialProfile {
  platform: string;
  url: string;
  bio?: string;
  category?: string;
  followers?: string;
  postTone?: string;
  categoryTags?: string[];
}

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

export interface ReviewAnalysis {
  sentiment: "Excellent" | "Good" | "Mixed" | "Concerning";
  platformSummaries: ReviewPlatformSummary[];
  strengths: ReviewInsight[];
  weaknesses: ReviewInsight[];
  aspects: ReviewAspect[];
}

export interface OutreachIntel {
  pitchAngle: string;
  competitorSystem: string | null;
  decisionMakers: DecisionMaker[];
  openingHook: string | null;
}

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

export interface LeadResult {
  leadId: string;
  input: LeadInput;
  status: "pending" | "crawling" | "scoring" | "done" | "failed";
  score: number | null;
  verdict: "QUALIFY" | "BORDERLINE" | "DISQUALIFY" | null;
  icpExplanation: string | null;
  keySignals: string[];
  missingSignals: string[];
  painPoints: string[];
  venueIntel: VenueIntel | null;
  outreachIntel: OutreachIntel | null;
  recommendedAction: string | null;
  crawledPages: number;
  sourceSummary: SourceSummary | null;
  socialProfiles: SocialProfile[];
  reviewAnalysis: ReviewAnalysis | null;
  competitorAnalysis: CompetitorAnalysis | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  aiUsage?: AiUsage | null;
}

export interface AiUsage {
  provider: "claude" | "gemini";
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}

/** AI consumption totals. estimatedCostUsd is an estimate; the provider's console is authoritative. */
export interface UsageSummary {
  leadsWithAi: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
  models: string[];
  unpricedModels: string[];
}

/** A batch in the past qualifications list: no leads, but where they come from and how they were scored. */
export interface BatchSummary extends Omit<QualifyBatch, "leads"> {
  /** The Maps search the leads were found by ("arcade · Santa Rosa"), null for an uploaded list. */
  source: string | null;
  firstLeads: string[];
  verdicts: { qualify: number; borderline: number; disqualify: number };
}

export interface MonthUsage extends UsageSummary {
  month: string;
}

export interface QualifyBatch {
  batchId: string;
  /** "cancelled": stopped by the user; its unscored leads are "failed" with "Qualification cancelled". */
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  icpSnapshot: string;
  leads: LeadResult[];
  createdAt: string;
  updatedAt: string;
  completedCount: number;
  totalCount: number;
  usage?: UsageSummary;
}

export const icpApi = {
  list: () => apiFetch<{ icps: IcpConfig[]; active: IcpConfig }>("/api/icp"),
  getActive: () => apiFetch<IcpConfig>("/api/icp/active"),
  getById: (id: string) => apiFetch<IcpConfig>(`/api/icp/${id}`),
  create: (data: Omit<IcpConfig, "id" | "isActive" | "createdAt" | "updatedAt">) =>
    apiFetch<IcpConfig>("/api/icp", { method: "POST", body: JSON.stringify(data) }),
  update: (
    id: string,
    data: Partial<Omit<IcpConfig, "id" | "isActive" | "createdAt" | "updatedAt">>,
  ) => apiFetch<IcpConfig>(`/api/icp/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  activate: (id: string) =>
    apiFetch<IcpConfig>(`/api/icp/${id}/activate`, { method: "POST" }),
  delete: (id: string) =>
    apiFetch<{ success: boolean }>(`/api/icp/${id}`, { method: "DELETE" }),
  reset: () => apiFetch<IcpConfig>("/api/icp/reset", { method: "POST" }),
};

export const qualifyApi = {
  submit: (leads: LeadInput[]) =>
    apiFetch<{ batchId: string; status: string; totalCount: number; message: string }>(
      "/api/qualify",
      { method: "POST", body: JSON.stringify({ leads }) },
    ),
  getBatch: (batchId: string) => apiFetch<QualifyBatch>(`/api/qualify/${batchId}`),
  listBatches: () =>
    apiFetch<{ batches: BatchSummary[] }>("/api/qualify"),
  stopBatch: (batchId: string) =>
    apiFetch<{ ok: boolean }>(`/api/qualify/${batchId}/stop`, { method: "POST" }),
  usageByMonth: () => apiFetch<{ months: MonthUsage[] }>("/api/qualify/usage"),
  retryBatch: (batchId: string) =>
    apiFetch<{ batchId: string; status: string; totalCount: number; message: string }>(
      `/api/qualify/${batchId}/retry`,
      { method: "POST" },
    ),
};

export type CrmTarget = "hubspot" | "salesforce";

export interface CrmPushPayload {
  crm: CrmTarget;
  leads: {
    name: string;
    url?: string;
    category?: string;
    city?: string;
    country?: string;
    score?: number | null;
    verdict?: string | null;
    keySignals?: string[];
    missingSignals?: string[];
    icpExplanation?: string | null;
    recommendedAction?: string | null;
  }[];
}

export interface CrmPushResult {
  crm: CrmTarget;
  pushed: number;
  failed: number;
  errors: string[];
}

export interface CrmStatus {
  hubspot: boolean;
  salesforce: boolean;
}

export const crmApi = {
  status: () => apiFetch<CrmStatus>("/api/crm/status"),
  push: (payload: CrmPushPayload) =>
    apiFetch<CrmPushResult>("/api/crm/push", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};