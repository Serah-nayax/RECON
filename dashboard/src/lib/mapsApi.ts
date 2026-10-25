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

export type MapsScope = "city" | "country" | "continent" | "worldwide";
export type MapsField =
  | "address"
  | "phone"
  | "website"
  | "mapsUrl"
  | "rating"
  | "reviewCount"
  | "category"
  | "hours";

export const FIELD_LABELS: Record<MapsField, string> = {
  address: "Address",
  phone: "Phone Number",
  website: "Website URL",
  mapsUrl: "Google Maps URL",
  rating: "Star Rating",
  reviewCount: "Review Count",
  category: "Business Category",
  hours: "Opening Hours",
};

export const DETAIL_FIELDS: MapsField[] = ["phone", "website", "hours"];

export interface EnrichResult {
  score: number;
  verdict: "QUALIFY" | "BORDERLINE" | "DISQUALIFY";
  icpExplanation: string;
  keySignals: string[];
  missingSignals: string[];
  painPoints: string[];
  venueIntel: {
    estimatedMachineCount: string;
    paymentSystem: string;
    venueType: string;
    hasRedemption: boolean;
    hasLoyalty: boolean;
    hasFoodBeverage: boolean;
    hasPartyRooms: boolean;
    isChain: boolean;
    chainName: string | null;
  } | null;
  outreachIntel: {
    pitchAngle: string;
    competitorSystem: string | null;
    decisionMakers: {
      name: string;
      title: string | null;
      email: string | null;
      phone: string | null;
    }[];
    openingHook: string | null;
  } | null;
  recommendedAction: string;
  crawledPages: number;
  sourceSummary: {
    pages: number;
    reviews: { platform: string; url: string }[];
    socials: { platform: string; url: string }[];
  };
  socialProfiles: {
    platform: string;
    url: string;
    bio?: string;
    followers?: string;
    postTone?: string;
    categoryTags?: string[];
  }[];
  reviewAnalysis: {
    sentiment: "Excellent" | "Good" | "Mixed" | "Concerning";
    platformSummaries: {
      platform: string;
      url: string;
      rating: number | null;
      reviewCount: number | null;
    }[];
    strengths: { summary: string; quote: string | null }[];
    weaknesses: { summary: string; quote: string | null }[];
    aspects: { name: string; score: number; quote: string | null }[];
  } | null;
  competitorAnalysis: {
    vendorName: string;
    productCategory: string | null;
    description: string | null;
    competitiveAngle: string;
    strategicOverview: string;
  } | null;
}

export interface MapsLead {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  mapsUrl?: string;
  rating?: number;
  reviewCount?: number;
  category?: string;
  hours?: string;
  lat?: number;
  lng?: number;
  detailStatus?: "idle" | "running" | "done" | "failed";
  detailError?: string | null;
  enrichStatus?: "idle" | "running" | "done" | "failed";
  enrichResult?: EnrichResult | null;
  enrichError?: string | null;
}

export interface GridCell {
  index: number;
  lat: number;
  lng: number;
  zoom: number;
  halfDeg?: number;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  leadsFound: number;
  error?: string;
}

export interface MapsJob {
  jobId: string;
  config: {
    searchTerm: string;
    scope: MapsScope;
    location: string;
    selectedFields: MapsField[];
    label?: string;
  };
  cells: GridCell[];
  results: MapsLead[];
  status: "pending" | "running" | "paused" | "done" | "failed";
  totalCells: number;
  completedCells: number;
  totalLeads: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DrawnBbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface MapsSearchRequest {
  searchTerms: string[];
  areas?: string[];
  area?: string;
  bbox?: DrawnBbox;
  selectedFields: MapsField[];
  selectedCellIndices?: number[];
  label?: string;
}

export const mapsApi = {
  previewGrid: (req: { area?: string; bbox?: DrawnBbox }) =>
    apiFetch<{ cells: GridCell[]; count: number }>("/api/maps/preview-grid", {
      method: "POST",
      body: JSON.stringify(req),
    }),
  search: (req: MapsSearchRequest) =>
    apiFetch<{ jobId: string; status: string; totalCells: number; message: string }>(
      "/api/maps/search",
      { method: "POST", body: JSON.stringify(req) },
    ),
  getJob: (jobId: string) => apiFetch<MapsJob>(`/api/maps/${jobId}`),
  keepAlive: (jobId: string, signal?: AbortSignal) =>
    apiFetch<{ active: boolean; status: string | null }>(`/api/maps/${jobId}/keepalive`, { signal }),
  listJobs: () => apiFetch<{ jobs: Omit<MapsJob, "results" | "cells">[] }>("/api/maps"),
  pause: (jobId: string) =>
    apiFetch<{ ok: boolean }>(`/api/maps/${jobId}/pause`, { method: "POST" }),
  resume: (jobId: string) =>
    apiFetch<{ jobId: string; status: string; message: string }>(
      `/api/maps/${jobId}/resume`,
      { method: "POST" },
    ),
  enrichLead: (jobId: string, leadId: string) =>
    apiFetch<{ ok: boolean; leadId: string; message: string }>(
      `/api/maps/${jobId}/enrich/${leadId}`,
      { method: "POST" },
    ),
  enrichAll: (jobId: string) =>
    apiFetch<{ ok: boolean; count: number; message: string }>(
      `/api/maps/${jobId}/enrich-all`,
      { method: "POST" },
    ),
  qualifyAll: (jobId: string) =>
    apiFetch<{ ok: boolean; batchId: string; count: number; message: string }>(
      `/api/maps/${jobId}/qualify-all`,
      { method: "POST" },
    ),
};