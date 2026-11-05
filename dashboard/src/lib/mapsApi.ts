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
  /**
   * How the place fits the search (computed by the server): its category or name says what was
   * searched / probable (a bar, an escape room...) / unrelated (a shop, a clinic...: not listed).
   */
  relevance?: "match" | "other" | "offTopic";
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
  limitedView?: boolean;
  /** The list was full but the job's cell budget was spent: places may be missing here. */
  splitSkipped?: boolean;
  /** Full during the quick pass: its quarters are searched by the refinement that follows. */
  splitDeferred?: boolean;
  /** Added by the refinement that follows the quick pass. */
  refinement?: boolean;
  /** Searches a related term RECON added (not one the user typed). */
  autoTerm?: boolean;
}

/** An area to search: free text, or a suggestion picked in the list (exact area, outline from OpenStreetMap). */
export interface AreaInput {
  label: string;
  osmId?: string;
}

export interface AreaSuggestion {
  /** "R…"/"W…": OpenStreetMap area; "G…": RECON's area list (its outline is found when picked). */
  osmId: string;
  name: string;
  /** country, state, county, city, district, locality */
  type: string;
  /** What the area is called in its country: "département", "district"… */
  typeLabel?: string;
  context: string;
  /** Name to show once picked ("Tel Aviv (district), Israel"). */
  label?: string;
  countryCode?: string;
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
  /** Places in the list (unrelated places left out): job list only. */
  shownLeads?: number;
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
  areas?: AreaInput[];
  area?: string;
  bbox?: DrawnBbox;
  selectedFields: MapsField[];
  selectedCellIndices?: number[];
  label?: string;
}

export const mapsApi = {
  /** Instant (RECON's area list); `osm` asks OpenStreetMap for more (districts, small towns: seconds). */
  suggestAreas: (q: string, signal?: AbortSignal, source?: "osm") =>
    apiFetch<{ suggestions: AreaSuggestion[] }>(
      `/api/maps/areas/suggest?q=${encodeURIComponent(q)}&lang=${navigator.language.slice(0, 2)}${source ? `&source=${source}` : ""}`,
      { signal },
    ),
  previewGrid: (req: { area?: string; osmId?: string; bbox?: DrawnBbox }) =>
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
  listJobs: () => apiFetch<{ jobs: Omit<MapsJob, "results" | "cells">[] }>("/api/maps"),
  pause: (jobId: string) =>
    apiFetch<{ ok: boolean }>(`/api/maps/${jobId}/pause`, { method: "POST" }),
  resume: (jobId: string) =>
    apiFetch<{ jobId: string; status: string; message: string }>(
      `/api/maps/${jobId}/resume`,
      { method: "POST" },
    ),
  /** Sends the places to the Lead Qualifier: those in leadIds, or every place of the list. */
  qualifyAll: (jobId: string, leadIds?: string[]) =>
    apiFetch<{ ok: boolean; batchId: string; count: number; message: string }>(
      `/api/maps/${jobId}/qualify-all`,
      { method: "POST", body: JSON.stringify(leadIds ? { leadIds } : {}) },
    ),
};