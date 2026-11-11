import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  mapsApi,
  FIELD_LABELS,
  DETAIL_FIELDS,
  type MapsField,
  type MapsScope,
  type MapsJob,
  type MapsLead,
  type GridCell,
  type AreaInput,
  type AreaSuggestion,
} from "@/lib/mapsApi";
import { MapGridPicker } from "@/components/MapGridPicker";
import { QualifyIcpDialog } from "@/components/QualifyIcpDialog";
import { icpApi } from "@/lib/qualifyApi";
import { icpSearchTerms } from "@/lib/icpTerms";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Map, Play, Pause, ExternalLink,
  Star, MessageSquare, Phone, MapPin, Tag, Clock, Link, Target,
  ChevronRight, Loader2, AlertTriangle, CheckCircle2, Download, Trash2,
} from "lucide-react";

/**
 * Every search fetches the same fields. Category and address decide which places are kept and
 * score places without a website; phone and website come from each place page.
 */
const SEARCH_FIELDS: MapsField[] = ["address", "phone", "website", "mapsUrl", "rating", "reviewCount", "category"];

const FIELD_ICONS: Record<MapsField, React.ReactNode> = {
  address: <MapPin className="h-3.5 w-3.5" />,
  phone: <Phone className="h-3.5 w-3.5" />,
  website: <Link className="h-3.5 w-3.5" />,
  mapsUrl: <Map className="h-3.5 w-3.5" />,
  rating: <Star className="h-3.5 w-3.5" />,
  reviewCount: <MessageSquare className="h-3.5 w-3.5" />,
  category: <Tag className="h-3.5 w-3.5" />,
  hours: <Clock className="h-3.5 w-3.5" />,
};

/**
 * A search runs in two steps: every area once (the quick list), then the busy areas cut into
 * smaller pieces, which can be cut again. Step 2 adds cells while it runs, so a plain
 * done/total bar reached 100% at the end of step 1 and then fell back. Step 1 fills the first
 * 30% of the bar (about its share of the time, Paris "arcade": 2 of 7 min), step 2 the rest,
 * and the bar only reaches 100% when the search is complete.
 */
const STEP1_SHARE = 30;

function searchSteps(job: MapsJob) {
  const active = job.cells.filter((cell) => cell.status !== "skipped");
  const isOpen = (cell: MapsJob["cells"][number]) => cell.status === "pending" || cell.status === "running";
  const step1 = active.filter((cell) => !cell.refinement);
  const step2 = active.filter((cell) => cell.refinement);
  const step1Left = step1.filter(isOpen).length;
  const step2Left = step2.filter(isOpen).length;
  const inStep2 = step1Left === 0 && step2.length > 0;
  const pct = inStep2
    ? STEP1_SHARE + ((100 - STEP1_SHARE - 1) * (step2.length - step2Left)) / step2.length
    : step1.length > 0
    ? (STEP1_SHARE * (step1.length - step1Left)) / step1.length
    : 0;
  return { inStep2, step1Done: step1Left === 0, cellsLeft: inStep2 ? step2Left : step1Left, pct };
}

/**
 * How long a finished search took: from its start to its last update (the moment it ended).
 * A search paused then resumed also counts the time it stayed paused.
 */
function searchDuration(job: { createdAt: string; updatedAt: string; status: string }): string | null {
  if (job.status !== "done") return null;
  const secs = Math.round((new Date(job.updatedAt).getTime() - new Date(job.createdAt).getTime()) / 1000);
  if (!(secs > 0)) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h} h ${m} min`;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

function estimateTimeLeft(job: MapsJob, remaining: number, inStep2: boolean): string {
  if (remaining <= 0) return inStep2 ? "almost done" : "step 1 done";
  // Use the measured pace once a few cells are done (capped, since time spent paused
  // also counts as elapsed); before that, assume ~0.75 min per cell (2 cells in parallel).
  const elapsedMins = (Date.now() - new Date(job.createdAt).getTime()) / 60_000;
  const minsPerCell = job.completedCells >= 2
    ? Math.min(elapsedMins / job.completedCells, 1.5)
    : 0.75;
  const mins = Math.ceil(remaining * minsPerCell);
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  const time = mins < 60 ? `~${mins}m` : m > 0 ? `~${hrs}h ${m}m` : `~${hrs}h`;
  // Step 1 cannot tell how many busy areas step 2 will cut; step 2 can still cut more.
  return inStep2 ? `${time}+ remaining` : `step 1: ${time} remaining`;
}

/** One numbered step of the search form. */
function FormStep({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/30">
          {n}
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-6">{title}</h2>
          {hint && <p className="text-sm text-muted-foreground leading-snug">{hint}</p>}
        </div>
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function StatusBadge({ status }: { status: MapsJob["status"] }) {
  const map: Record<MapsJob["status"], { label: string; className: string }> = {
    pending: { label: "Starting...", className: "bg-muted/30 text-muted-foreground" },
    running: { label: "Running", className: "bg-blue-500/15 text-blue-400 border border-blue-500/30" },
    paused: { label: "Paused", className: "bg-amber-500/15 text-amber-400 border border-amber-500/30" },
    done: { label: "Complete", className: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" },
    failed: { label: "Failed", className: "bg-rose-500/15 text-rose-400 border border-rose-500/30" },
  };
  const v = map[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${v.className}`}>
      {v.label}
    </span>
  );
}

/** Columns of an export: the name, the fields picked for the search, and the match group. */
function exportTable(job: MapsJob, leads: MapsLead[]): { headers: string[]; rows: (string | number)[][] } {
  const fields = job.config.selectedFields;
  const headers = ["Name", ...fields.map((f) => FIELD_LABELS[f] ?? f), "Match"];
  const rows = leads.map((lead) => [
    lead.name ?? "",
    ...fields.map((f) => {
      const v = lead[f as keyof MapsLead];
      if (v === undefined || v === null) return "";
      return typeof v === "number" ? v : String(v);
    }),
    lead.relevance === "match" ? "match" : "probable",
  ]);
  return { headers, rows };
}

/** "arcade-Lyon-2026-11-10": no characters Windows refuses in a file name. */
function exportFileName(job: MapsJob, ext: string): string {
  const base = `${job.config.searchTerm}-${job.config.location || job.config.scope}-${new Date().toISOString().slice(0, 10)}`;
  return `${base.replace(/[\\/:*?"<>|,]+/g, "").replace(/\s+/g, "-")}.${ext}`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Excel file: opens with the right columns and accents whatever the Windows language. */
async function exportToXlsx(job: MapsJob, leads: MapsLead[]) {
  const { default: ExcelJS } = await import("exceljs");
  const { headers, rows } = exportTable(job, leads);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Places");
  ws.addRow(headers).font = { bold: true };
  for (const row of rows) ws.addRow(row);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  headers.forEach((h, i) => {
    const longest = Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(60, Math.max(10, longest + 2));
  });
  const buffer = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    exportFileName(job, "xlsx"),
  );
}

/**
 * Standard CSV (for CRM imports): fields quoted with "" escapes, and a UTF-8 mark so that
 * Excel reads the accents. JSON.stringify gave \" escapes, which broke the columns.
 */
function exportToCsv(job: MapsJob, leads: MapsLead[]) {
  const { headers, rows } = exportTable(job, leads);
  const quote = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(quote).join(",")).join("\r\n");
  downloadBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), exportFileName(job, "csv"));
}

function renderCell(field: MapsField, lead: MapsLead) {
  switch (field) {
    case "rating":
      return lead.rating != null ? (
        <span className="flex items-center gap-1 text-amber-400">
          <Star className="h-3 w-3 fill-current shrink-0" />
          {lead.rating}
        </span>
      ) : null;
    case "reviewCount":
      return lead.reviewCount != null ? lead.reviewCount.toLocaleString() : null;
    case "mapsUrl":
      return lead.mapsUrl ? (
        <a href={lead.mapsUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline">
          <Map className="h-3 w-3" /> Maps
        </a>
      ) : null;
    case "website":
      return lead.website ? (
        <a
          href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline truncate max-w-[140px]"
        >
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{lead.website.replace(/^https?:\/\//, "")}</span>
        </a>
      ) : null;
    case "phone":
      return lead.phone ? (
        <span className="flex items-center gap-1">
          <Phone className="h-3 w-3 shrink-0 text-muted-foreground" /> {lead.phone}
        </span>
      ) : null;
    case "address":
      return lead.address ? (
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate max-w-[180px]">{lead.address}</span>
        </span>
      ) : null;
    case "category":
      return lead.category ? (
        <span className="flex items-center gap-1">
          <Tag className="h-3 w-3 shrink-0 text-muted-foreground" /> {lead.category}
        </span>
      ) : null;
    case "hours":
      return lead.hours ? (
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate max-w-[140px]">{lead.hours}</span>
        </span>
      ) : null;
    default:
      return null;
  }
}

/** The best-known places (most reviews) first. */
function byReviews(a: MapsLead, b: MapsLead): number {
  return (b.reviewCount ?? -1) - (a.reviewCount ?? -1);
}

function LeadsTable({
  leads,
  selectedFields,
  onSendToQualify,
  qualifyingId,
}: {
  leads: MapsLead[];
  selectedFields: MapsField[];
  onSendToQualify: (lead: MapsLead) => void;
  qualifyingId: string | null;
}) {
  const cols = selectedFields;
  // One list: every shown place goes to the qualifier anyway, which does the real sorting.
  const sortedLeads = [...leads].sort(byReviews);

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 z-10 bg-background">
        <tr className="border-b border-input bg-background/50">
          <th className="text-left py-2 px-3 font-mono text-muted-foreground whitespace-nowrap">Name</th>
          {cols.map((f) => (
            <th key={f} className="text-left py-2 px-3 font-mono text-muted-foreground whitespace-nowrap">
              <span className="flex items-center gap-1">
                {FIELD_ICONS[f]}
                {FIELD_LABELS[f]}
              </span>
            </th>
          ))}
          <th className="py-2 px-3 font-mono text-muted-foreground text-right whitespace-nowrap">Actions</th>
        </tr>
      </thead>
      <tbody>
              {sortedLeads.map((lead, leadIndex) => (
                <tr
                  key={`${lead.id || lead.name}-${leadIndex}`}
                  className="border-b border-muted/15 transition-colors hover:bg-muted/5"
                >
                  <td className="py-2 px-3 font-medium whitespace-nowrap max-w-[220px] truncate">
                    <div className="flex items-center gap-1.5">
                      {lead.detailStatus === "running" && (
                        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" /> details
                        </span>
                      )}
                      {lead.detailStatus === "failed" && (
                        <span
                          title={lead.detailError ?? "Detail extraction failed"}
                          className="shrink-0 inline-flex px-1.5 py-0.5 rounded text-xs font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20"
                        >
                          partial
                        </span>
                      )}
                      <span className="truncate">{lead.name}</span>
                    </div>
                  </td>
                  {cols.map((f) => (
                    <td key={f} className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                      {renderCell(f, lead) ?? <span className="text-muted-foreground/70">—</span>}
                    </td>
                  ))}
                  <td className="py-2 px-3 whitespace-nowrap">
                    <div className="flex items-center justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 border border-white/10"
                        onClick={() => onSendToQualify(lead)}
                        disabled={qualifyingId === lead.id}
                        title={
                          lead.website
                            ? "Score this place against your ICP in the Lead Qualifier"
                            : "No website on Google Maps: it is scored from its name, category and Google Maps data"
                        }
                      >
                        {qualifyingId === lead.id ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Target className="h-3 w-3 mr-1" />
                        )}
                        Qualify
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
      </tbody>
    </table>
  );
}

function JobProgress({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Highest progress shown for this job: the bar never moves back when step 2 adds cells.
  const maxPctRef = useRef<{ jobId: string; pct: number }>({ jobId, pct: 0 });

  const { data: job } = useQuery({
    queryKey: ["maps-job", jobId],
    queryFn: () => mapsApi.getJob(jobId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      const hasDetailWork = q.state.data?.results?.some((r) => r.detailStatus === "running");
      return s === "running" || s === "pending" || hasDetailWork ? 2000 : false;
    },
  });

  const pauseMut = useMutation({
    mutationFn: () => mapsApi.pause(jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maps-job", jobId] }),
  });

  const resumeMut = useMutation({
    mutationFn: () => mapsApi.resume(jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maps-job", jobId] }),
  });

  const deleteMut = useMutation({
    mutationFn: () => mapsApi.remove(jobId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["maps-job", jobId] });
      void queryClient.invalidateQueries({ queryKey: ["maps-jobs"] });
      toast({ title: "Search deleted" });
      onBack();
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const [, setLocation] = useLocation();

  // "Qualify All" first asks which ICP scores the places; another pick becomes the active ICP.
  const [icpDialogOpen, setIcpDialogOpen] = useState(false);
  const qualifyAllMut = useMutation({
    mutationFn: async ({ icpId, changed }: { icpId: string; changed: boolean }) => {
      if (changed) {
        await icpApi.activate(icpId);
        void queryClient.invalidateQueries({ queryKey: ["active-icp"] });
        void queryClient.invalidateQueries({ queryKey: ["icps"] });
      }
      return mapsApi.qualifyAll(jobId);
    },
    onSuccess: (res) => {
      setIcpDialogOpen(false);
      toast({ title: `${res.count} lead(s) sent to Qualifier`, description: "Opening Lead Qualifier…" });
      setTimeout(() => setLocation(`/qualify?batch=${res.batchId}`), 600);
    },
    onError: (e) => toast({ title: "Bulk qualify failed", description: e.message, variant: "destructive" }),
  });

  // Same route as "Qualify All", so one place is sent exactly like all of them (website or not).
  const qualifyMut = useMutation({
    mutationFn: (lead: MapsLead) => mapsApi.qualifyAll(jobId, [lead.id]),
    onSuccess: (res) => {
      toast({ title: "Lead sent to Qualifier", description: "Opening Lead Qualifier..." });
      setTimeout(() => setLocation(`/qualify?batch=${res.batchId}`), 600);
    },
    onError: (e) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  if (!job) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const steps = searchSteps(job);
  if (maxPctRef.current.jobId !== jobId) maxPctRef.current = { jobId, pct: 0 };
  maxPctRef.current.pct = Math.max(maxPctRef.current.pct, Math.floor(steps.pct));
  const pct = job.status === "done" ? 100 : maxPctRef.current.pct;
  const selectedFields = job.config.selectedFields;
  const hasDetailFields = selectedFields.some((f) => DETAIL_FIELDS.includes(f));
  const detailTotal = job.results.filter((lead) => lead.detailStatus != null).length;
  const detailDone = job.results.filter((lead) => lead.detailStatus === "done").length;
  const detailFailed = job.results.filter((lead) => lead.detailStatus === "failed").length;
  const detailRunning = job.results.filter((lead) => lead.detailStatus === "running").length;
  const failedCells = job.cells.filter((cell) => cell.status === "failed").length;
  const splitSkippedCells = job.cells.filter((cell) => cell.splitSkipped).length;
  const refinementCells = job.cells.filter((cell) => cell.refinement && cell.status !== "skipped");
  const refinementPending = refinementCells.filter((cell) => cell.status === "pending" || cell.status === "running");
  const refinementLeft = refinementPending.length;
  // The user's own terms are refined first; what is left after them searches related terms
  // RECON added, which only finds a few rare places (a VR arcade most runs missed, in tests).
  const mainListReady = refinementLeft > 0 && refinementPending.every((cell) => cell.autoTerm);
  // Places unrelated to the search (a shop, an office...) stay stored but are not listed.
  const shownLeads = job.results.filter((lead) => lead.relevance !== "offTopic");
  const leftOut = job.results.filter((lead) => lead.relevance === "offTopic");
  // The list is usable once every area has been searched once (step 1): export and qualify
  // from then on. Step 2 only adds places.
  const listUsable = (job.status !== "running" && job.status !== "pending") || steps.step1Done;
  const leftOutTitle = leftOut.length
    ? `Unrelated to the search (shops, offices, services...), so not listed, exported or qualified. For example: ${leftOut
        .slice(0, 12)
        .map((lead) => `${lead.name} (${(lead.category ?? "").split(",")[0]})`)
        .join(", ")}${leftOut.length > 12 ? "..." : "."}`
    : "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={onBack}
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              ← Back
            </button>
          </div>
          <h2 className="text-lg font-semibold font-mono">
            "{job.config.label || job.config.searchTerm}"
            <span className="text-muted-foreground font-normal text-sm ml-2">
              {job.config.scope === "city"
                ? `in ${job.config.location}`
                : job.config.scope === "country"
                ? `• ${job.config.location}`
                : job.config.scope === "continent"
                ? `• ${job.config.location}`
                : "• Worldwide"}
            </span>
          </h2>
          {(() => {
            const terms = job.termYield
              ? job.termYield.filter((t) => !t.auto).map((t) => t.term)
              : [job.config.searchTerm];
            const extra = job.termYield?.filter((t) => t.auto).length ?? 0;
            return (
              <p className="text-sm text-muted-foreground mt-1">
                Searching: <span className="text-foreground">{terms.join(", ")}</span>
                {extra > 0 && <span> + {extra} related term{extra > 1 ? "s" : ""}</span>}
              </p>
            );
          })()}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusBadge status={job.status} />
            <span className="text-xs text-muted-foreground font-mono">
              {job.completedCells}/{job.totalCells} cells · {shownLeads.length.toLocaleString()} leads found
            </span>
            {leftOut.length > 0 && (
              <span className="text-xs font-mono text-muted-foreground/70 cursor-help" title={leftOutTitle}>
                ({leftOut.length} unrelated places left out)
              </span>
            )}
            {failedCells > 0 && (
              <span
                className="text-xs font-mono text-rose-400/80 bg-rose-500/8 border border-rose-500/20 px-1.5 py-0.5 rounded"
                title="Google refused these cells even after a retry: rerun the search to cover them"
              >
                {failedCells} cell{failedCells > 1 ? "s" : ""} failed
              </span>
            )}
            {mainListReady && job.status !== "done" && (
              <span
                className="text-xs font-mono text-emerald-400/80 bg-emerald-500/8 border border-emerald-500/20 px-1.5 py-0.5 rounded"
                title="Your search terms have been searched everywhere, in detail: the list below is nearly complete (about 97% of the places in tests). The remaining cells search related terms for rare places most runs miss; they only add places."
              >
                main list ready · looking for rare places in {refinementLeft} cell{refinementLeft > 1 ? "s" : ""}
              </span>
            )}
            {!mainListReady && refinementLeft > 0 && job.status !== "done" && (
              <span
                className="text-xs font-mono text-emerald-400/80 bg-emerald-500/8 border border-emerald-500/20 px-1.5 py-0.5 rounded"
                title="Every area has been searched once: the list below is usable now. The busiest areas are being searched again in smaller pieces, which only adds places."
              >
                quick list ready · refining {refinementLeft} busy cell{refinementLeft > 1 ? "s" : ""}
              </span>
            )}
            {splitSkippedCells > 0 && (
              <span
                className="text-xs font-mono text-amber-400/80 bg-amber-500/8 border border-amber-500/20 px-1.5 py-0.5 rounded"
                title="These cells had a full list of places but the search reached its cell limit, so they were not searched in more detail: places may be missing there. Search those areas separately to cover them."
              >
                {splitSkippedCells} full cell{splitSkippedCells > 1 ? "s" : ""} not detailed
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {shownLeads.length > 0 && listUsable && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => void exportToXlsx(job, shownLeads)}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Excel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => exportToCsv(job, shownLeads)}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
              </Button>
            </>
          )}
          {job.status === "running" && (
            <Button variant="outline" size="sm" onClick={() => pauseMut.mutate()} disabled={pauseMut.isPending}>
              <Pause className="h-3.5 w-3.5 mr-1.5" /> Pause
            </Button>
          )}
          {job.status === "paused" && (
            <Button variant="outline" size="sm" onClick={() => resumeMut.mutate()} disabled={resumeMut.isPending}>
              <Play className="h-3.5 w-3.5 mr-1.5" /> Resume
            </Button>
          )}
          {job.status !== "running" && job.status !== "pending" && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-rose-400"
              disabled={deleteMut.isPending}
              onClick={() => {
                if (window.confirm(`Delete this search and its ${job.totalLeads} places for the whole team? This cannot be undone.`)) {
                  deleteMut.mutate();
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {(job.status === "running" || job.status === "paused") && (
        <div className="space-y-1.5">
          <Progress value={pct} className="h-2" />
          <div className="flex justify-between gap-3 text-xs text-muted-foreground font-mono">
            <span
              title="Step 1 searches every area once: the list is usable when it ends. Step 2 searches the busiest areas again in smaller pieces (cut again while they are still full), so its number of cells grows as it runs. It only adds places."
              className="cursor-help"
            >
              {pct}% ·{" "}
              {steps.inStep2
                ? "step 2 of 2: busy areas in detail (the list is ready, this only adds places)"
                : steps.step1Done
                ? "step 1 of 2 done: the list is ready, preparing step 2"
                : "step 1 of 2: every area once"}
            </span>
            {job.status === "running" && <span>{estimateTimeLeft(job, steps.cellsLeft, steps.inStep2)}</span>}
          </div>
        </div>
      )}

      {hasDetailFields && detailTotal > 0 && (
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs font-mono">
            <span className="flex items-center gap-2 text-blue-300">
              {detailRunning > 0 ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Deep details
            </span>
            <span className="text-muted-foreground">
              {detailDone + detailFailed}/{detailTotal} processed
              {detailFailed > 0 ? ` · ${detailFailed} partial` : ""}
            </span>
          </div>
          <Progress
            value={detailTotal > 0 ? ((detailDone + detailFailed) / detailTotal) * 100 : 0}
            className="h-1.5"
          />
          <p className="text-xs text-muted-foreground">
            Leads are available now. Phone and website keep filling in without blocking the search.
          </p>
        </div>
      )}

      {job.status === "done" && (
        <div className="flex items-center gap-2 text-emerald-400 text-sm">
          <CheckCircle2 className="h-4 w-4" />
          <span>
            Search complete — {shownLeads.length.toLocaleString()} businesses found
            {searchDuration(job) && <span className="text-muted-foreground"> in {searchDuration(job)}</span>}
          </span>
        </div>
      )}

      {job.status === "failed" && job.error && (
        <div className="flex items-start gap-2 text-rose-400 text-sm bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Job failed</p>
            <p className="text-xs mt-0.5 text-rose-400/80">{job.error}</p>
          </div>
        </div>
      )}

      {/* Results table */}
      {shownLeads.length > 0 && (() => {
        const withoutWebsite = shownLeads.filter((l) => !l.website).length;

        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-sm font-semibold text-muted-foreground font-mono">
                Leads ({shownLeads.length.toLocaleString()})
              </h3>
              {!listUsable && (
                <span className="text-xs text-muted-foreground">Export and Qualify All open once every area has been searched (step 1).</span>
              )}
              {listUsable && (
              <div className="flex items-center gap-3 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 text-xs border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                  onClick={() => setIcpDialogOpen(true)}
                  disabled={qualifyAllMut.isPending}
                  title={[
                    `Send all ${shownLeads.length} places to the Lead Qualifier (next step).`,
                    withoutWebsite > 0
                      ? `${withoutWebsite} have no website on Google Maps: they are scored from their name, category and Google Maps data.`
                      : "",
                    job.status === "running" ? "Step 2 is still adding places: the ones found later are not included." : "",
                  ].filter(Boolean).join(" ")}
                >
                  {qualifyAllMut.isPending ? (
                    <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                  ) : (
                    <Target className="h-3 w-3 mr-1.5" />
                  )}
                  Qualify All ({shownLeads.length})
                </Button>
                <QualifyIcpDialog
                  open={icpDialogOpen}
                  onOpenChange={setIcpDialogOpen}
                  count={shownLeads.length}
                  searchTerms={
                    job.termYield ? job.termYield.filter((t) => !t.auto).map((t) => t.term) : [job.config.searchTerm]
                  }
                  pending={qualifyAllMut.isPending}
                  onConfirm={(icpId, changed) => qualifyAllMut.mutate({ icpId, changed })}
                />
              </div>
              )}
            </div>

            <div className="max-h-[600px] overflow-auto rounded-lg border border-white/10">
              <LeadsTable
                leads={shownLeads}
                selectedFields={selectedFields}
                onSendToQualify={(l) => qualifyMut.mutate(l)}
                qualifyingId={qualifyMut.isPending ? qualifyMut.variables?.id ?? null : null}
              />
            </div>
          </div>
        );
      })()}

      {job.status === "running" && shownLeads.length === 0 && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Searching Google Maps...</span>
        </div>
      )}
    </div>
  );
}

const areaKey = (a: AreaInput) => a.osmId ?? a.label.trim().toLowerCase();

/**
 * Name sent to the search: the place and the first level above it ("Paris, Île-de-France",
 * "11e Arrondissement, Paris"), so Google does not confuse it with a namesake (Paris, Texas).
 * Countries keep their name alone.
 */
function suggestionLabel(s: AreaSuggestion): string {
  if (s.label) return s.label;
  const parent = s.context.split(", ")[0];
  return s.type === "country" || !parent ? s.name : `${s.name}, ${parent}`;
}

/** For comparing names: "Saint-Étienne" → "saint etienne". */
const plainName = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const AREA_TYPE_LABELS: Record<string, string> = {
  country: "country",
  state: "region",
  county: "department / county",
  city: "city",
  district: "district",
  locality: "locality",
};

export function MapsSearch() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ?job=<id> opens a past search (links from the home page).
  const [activeJobId, setActiveJobId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("job"));
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [termInput, setTermInput] = useState("");
  const [label, setLabel] = useState("");
  const [areas, setAreas] = useState<AreaInput[]>([]);
  const [areaInput, setAreaInput] = useState("");
  const areaInputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<AreaSuggestion[]>([]);
  const [showAllSearches, setShowAllSearches] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  /** OpenStreetMap is being asked for more areas (districts, small towns). */
  const [moreLoading, setMoreLoading] = useState(false);
  /** Grid size of each committed area (by areaKey), from its preview. */
  const [areaCellCounts, setAreaCellCounts] = useState<Record<string, number>>({});
  const [drawnBbox, setDrawnBbox] = useState<import("@/lib/mapsApi").DrawnBbox | null>(null);
  const [previewCells, setPreviewCells] = useState<GridCell[]>([]);
  const [selectedCellIndices, setSelectedCellIndices] = useState<Set<number>>(new Set());
  const [previewLoading, setPreviewLoading] = useState(false);

  const { data: jobsData } = useQuery({
    queryKey: ["maps-jobs"],
    queryFn: () => mapsApi.listJobs(),
    refetchInterval: 5000,
  });

  const { data: activeIcp } = useQuery({
    queryKey: ["active-icp"],
    queryFn: () => icpApi.getActive(),
    staleTime: 60_000,
  });

  // The ICP's terms are offered, not pre-selected: each term searched adds a full pass over the
  // area (Jerusalem, 7 terms: 17 searches with translations and Google categories), so the team
  // picks the ones it needs.

  const pendingAreas: AreaInput[] =
    areaInput.trim() && !areas.some((a) => areaKey(a) === areaInput.trim().toLowerCase())
      ? [...areas, { label: areaInput.trim() }]
      : areas;

  // The map shows one grid (the last area, or the drawn rectangle): its cell selection only
  // applies when that grid is the whole search.
  const gridCount = pendingAreas.length + (drawnBbox ? 1 : 0);
  const partialSelection =
    selectedCellIndices.size > 0 && selectedCellIndices.size < previewCells.length;
  const cellSelectionIgnored = partialSelection && gridCount > 1;

  const searchMut = useMutation({
    mutationFn: () =>
      mapsApi.search({
        searchTerms,
        // Text still in the input (not added with Enter) is searched as typed.
        areas: pendingAreas.length > 0 ? pendingAreas : undefined,
        ...(drawnBbox ? { bbox: drawnBbox } : {}),
        selectedFields: SEARCH_FIELDS,
        selectedCellIndices:
          partialSelection && gridCount === 1 ? Array.from(selectedCellIndices) : undefined,
        label: label.trim() || undefined,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["maps-jobs"] });
      const jobCount = (data as { jobCount?: number }).jobCount ?? 1;
      if (jobCount > 1) {
        toast({ title: `${jobCount} searches queued`, description: data.message });
        setActiveJobId(null);
      } else {
        toast({ title: "Maps search started", description: `${data.totalCells} grid cell(s) queued` });
        setActiveJobId(data.jobId);
      }
    },
    onError: (e) =>
      toast({ title: "Failed to start search", description: e.message, variant: "destructive" }),
  });

  function addTerm(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || searchTerms.includes(trimmed)) return;
    setSearchTerms((prev) => [...prev, trimmed]);
    setTermInput("");
  }

  function removeTerm(t: string) {
    setSearchTerms((prev) => prev.filter((x) => x !== t));
  }

  function handleTermKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTerm(termInput);
    } else if (e.key === "Backspace" && !termInput && searchTerms.length > 0) {
      setSearchTerms((prev) => prev.slice(0, -1));
    }
  }

  function addArea(area: AreaInput) {
    const label = area.label.trim();
    if (!label) return;
    const next = { label, osmId: area.osmId };
    if (areas.some((a) => areaKey(a) === areaKey(next))) return;
    setAreas((prev) => [...prev, next]);
    setAreaInput("");
    setSuggestions([]);
    setHighlighted(-1);
  }

  function removeArea(a: AreaInput) {
    setAreas((prev) => prev.filter((x) => areaKey(x) !== areaKey(a)));
  }

  function pickSuggestion(s: AreaSuggestion) {
    addArea({ label: suggestionLabel(s), osmId: s.osmId });
  }

  function handleAreaKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setHighlighted((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === "Escape") {
      setSuggestions([]);
      setHighlighted(-1);
    } else if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      // A highlighted suggestion is the exact area; otherwise the text is searched as typed.
      if (highlighted >= 0 && suggestions[highlighted]) pickSuggestion(suggestions[highlighted]);
      else addArea({ label: areaInput });
    } else if (e.key === "Backspace" && !areaInput && areas.length > 0) {
      setAreas((prev) => prev.slice(0, -1));
    }
  }

  // Suggestions for what's being typed: at each key, from RECON's area list (countries, regions,
  // departments, towns). OpenStreetMap, slower, completes them when the list has little: a
  // district ("Montmartre"), a small town.
  useEffect(() => {
    const q = areaInput.trim();
    setMoreLoading(false);
    if (!q) {
      setSuggestions([]);
      setHighlighted(-1);
      return;
    }
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      let local: AreaSuggestion[] = [];
      try {
        local = (await mapsApi.suggestAreas(q, ctrl.signal)).suggestions;
      } catch {
        if (ctrl.signal.aborted) return;
      }
      setSuggestions(local);
      setHighlighted(local.length ? 0 : -1);
      const exact = local.some((s) => plainName(s.name) === plainName(q));
      if (q.length < 4 || (local.length >= 3 && exact)) return;
      // Only once typing pauses: each OpenStreetMap query takes seconds.
      timer = setTimeout(async () => {
        setMoreLoading(true);
        try {
          const more = (await mapsApi.suggestAreas(q, ctrl.signal, "osm")).suggestions;
          const known = new Set(local.map((s) => `${plainName(s.name)}|${s.countryCode ?? ""}`));
          const added = more.filter((s) => !known.has(`${plainName(s.name)}|${s.countryCode ?? ""}`));
          // Not after the user left the box (the list would pop up again).
          if (added.length && document.activeElement === areaInputRef.current) {
            setSuggestions([...local, ...added].slice(0, 10));
            if (!local.length) setHighlighted(0);
          }
        } catch {
          // OpenStreetMap unreachable: the list stays as it is.
        } finally {
          if (!ctrl.signal.aborted) setMoreLoading(false);
        }
      }, 600);
    })();
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [areaInput]);

  // Grid preview of the last area added (the map shows where the search will run).
  const lastArea = areas.at(-1);
  useEffect(() => {
    if (drawnBbox) return;
    if (!lastArea) {
      setPreviewCells([]);
      setSelectedCellIndices(new Set());
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void (async () => {
      try {
        const result = await mapsApi.previewGrid({ area: lastArea.label, osmId: lastArea.osmId });
        if (cancelled) return;
        setPreviewCells(result.cells);
        setSelectedCellIndices(new Set(result.cells.map((_, i) => i)));
        setAreaCellCounts((prev) => ({ ...prev, [areaKey(lastArea)]: result.count }));
      } catch {
        if (cancelled) return;
        setPreviewCells([]);
        setSelectedCellIndices(new Set());
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lastArea?.label, lastArea?.osmId, drawnBbox]);

  // When the user finishes drawing a rectangle on the map
  async function handleDrawComplete(bbox: import("@/lib/mapsApi").DrawnBbox) {
    setDrawnBbox(bbox);
    setAreaInput(""); // clear typing input; committed areas stay
    setPreviewLoading(true);
    try {
      const result = await mapsApi.previewGrid({ bbox });
      setPreviewCells(result.cells);
      setSelectedCellIndices(new Set(result.cells.map((_, i) => i)));
    } catch {
      setPreviewCells([]);
      setSelectedCellIndices(new Set());
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleClearDraw() {
    setDrawnBbox(null);
    setPreviewCells([]);
    setSelectedCellIndices(new Set());
  }

  const isWorldwide = areas.some((a) => a.label.toLowerCase() === "worldwide" || a.label.toLowerCase() === "world") ||
    areaInput.toLowerCase() === "worldwide" || areaInput.toLowerCase() === "world";
  const totalJobs = 1;
  // Same limit as the server (MAX_JOB_CELLS in api-server/src/routes/maps.ts).
  const MAX_CELLS = 2000;
  // Cells before the search splits full ones. Each area's own grid when previewed (~16 otherwise).
  // Abroad, each term is also searched in the local language, so the real count can be ~2x.
  const baseCells =
    areas.reduce((sum, a) => sum + (areaCellCounts[areaKey(a)] ?? 16), 0) + (drawnBbox ? previewCells.length || 16 : 0);
  const estimatedCells = baseCells * Math.max(searchTerms.length, 1);
  const overCellLimit = estimatedCells > MAX_CELLS;
  /** Regions and countries: many cells, and busy cells are cut into smaller ones while searching. */
  const largeSearch = estimatedCells > 300 || baseCells > 60;

  if (activeJobId) {
    return (
      <div className="space-y-6">
        <JobProgress jobId={activeJobId} onBack={() => { setActiveJobId(null); window.history.replaceState(null, "", window.location.pathname); }} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        icon={Map}
        step={2}
        title="Maps Search"
        description="Every place of a kind in an area, from Google Maps."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] items-stretch">
        {/* ── Form: what, where, start ── */}
        <Card>
          <CardContent className="p-6 space-y-7">
            <FormStep n={1} title="What to look for">
              

              {/* Pills + input */}
              <div
                className="min-h-[38px] w-full rounded-md border border-input bg-background/50 px-2 py-1.5 flex flex-wrap gap-1.5 cursor-text focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30 transition-colors"
                onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}
              >
                {searchTerms.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/15 border border-primary/30 text-primary text-xs font-mono"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeTerm(t); }}
                      className="hover:text-destructive transition-colors leading-none"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={termInput}
                  onChange={(e) => setTermInput(e.target.value)}
                  onKeyDown={handleTermKeyDown}
                  onBlur={() => addTerm(termInput)}
                  placeholder={searchTerms.length === 0 ? "e.g. arcade, bowling alley" : "Add another…"}
                  className="flex-1 min-w-[140px] bg-transparent text-sm placeholder:text-muted-foreground/70 focus:outline-none"
                />
              </div>

              {/* ICP suggestions */}
              {activeIcp && icpSearchTerms(activeIcp).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-xs text-muted-foreground">Suggestions:</span>
                  {icpSearchTerms(activeIcp).map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => (searchTerms.includes(term) ? removeTerm(term) : addTerm(term))}
                      title={searchTerms.includes(term) ? "Click to remove" : "Click to search this term too"}
                      className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors ${
                        searchTerms.includes(term)
                          ? "bg-primary/15 border-primary/40 text-primary"
                          : "border-white/10 text-muted-foreground hover:border-primary/30 hover:text-primary/80"
                      }`}
                    >
                      {searchTerms.includes(term) ? "✓ " : "+ "}{term}
                    </button>
                  ))}
                </div>
              )}
            </FormStep>

            <FormStep n={2} title="Where">
          <div className="space-y-1.5">

            {/* Pills + input */}
            <div
              className="min-h-[38px] w-full rounded-md border border-input bg-background/50 px-2 py-1.5 flex flex-wrap gap-1.5 cursor-text focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30 transition-colors"
              onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus()}
            >
              {/* Drawn bbox chip */}
              {drawnBbox && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-mono">
                  Drawn area
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleClearDraw(); }}
                    className="hover:text-destructive transition-colors leading-none"
                  >×</button>
                </span>
              )}
              {/* Text area pills */}
              {areas.map((a) => (
                <span
                  key={areaKey(a)}
                  title={a.osmId ? "Exact area from OpenStreetMap" : "Searched as typed"}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/15 border border-primary/30 text-primary text-xs font-mono"
                >
                  {a.label}
                  {areaCellCounts[areaKey(a)] != null && (
                    <span className="text-primary/50">· {areaCellCounts[areaKey(a)]} cells</span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeArea(a); }}
                    className="hover:text-destructive transition-colors leading-none"
                  >×</button>
                </span>
              ))}
              <input
                type="text"
                value={areaInput}
                onChange={(e) => { setAreaInput(e.target.value); if (drawnBbox) handleClearDraw(); }}
                onKeyDown={handleAreaKeyDown}
                ref={areaInputRef}
                onBlur={() => { setSuggestions([]); setHighlighted(-1); setMoreLoading(false); }}
                placeholder={
                  areas.length === 0 && !drawnBbox
                    ? 'City, region or country'
                    : 'Add another area…'
                }
                className="flex-1 min-w-[180px] bg-transparent text-sm placeholder:text-muted-foreground/70 focus:outline-none"
              />
            </div>
            {/* Suggestions (OpenStreetMap): the exact area, outline included */}
            {(suggestions.length > 0 || moreLoading) && (
              <div className="relative">
                <ul className="absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-auto rounded-md border border-white/10 bg-background shadow-lg">
                  {suggestions.map((s, i) => (
                    <li
                      key={s.osmId}
                      // mousedown, not click: picking must happen before the input loses focus.
                      onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                      onMouseEnter={() => setHighlighted(i)}
                      className={`px-3 py-1.5 cursor-pointer text-sm flex items-baseline gap-2 ${i === highlighted ? "bg-primary/15" : ""}`}
                    >
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-primary/80">{s.typeLabel ?? AREA_TYPE_LABELS[s.type] ?? s.type}</span>
                      {s.context && <span className="text-xs text-muted-foreground truncate">{s.context}</span>}
                    </li>
                  ))}
                  <li className="px-3 py-1 text-xs text-muted-foreground/80 border-t border-white/10 flex items-center gap-2">
                    <span>Enter picks the highlighted area · Esc then Enter searches the text as typed</span>
                    {moreLoading && (
                      <span className="inline-flex items-center gap-1 text-primary/60">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" /> more places…
                      </span>
                    )}
                    <span className="ml-auto">GeoNames · OpenStreetMap</span>
                  </li>
                </ul>
              </div>
            )}
            {drawnBbox && (
              <p className="text-xs text-muted-foreground">
                {`Drawn: ${drawnBbox.minLat.toFixed(2)}°,${drawnBbox.minLng.toFixed(2)}° → ${drawnBbox.maxLat.toFixed(2)}°,${drawnBbox.maxLng.toFixed(2)}°`}
              </p>
            )}
          </div>
            </FormStep>

            <div className="space-y-3 pt-1 border-t border-border">
            {/* Optional label */}
            <div className="pt-4">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Name of the search (optional)"
                className="w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {/* Worldwide warning */}
            {isWorldwide && (
              <div className="flex items-start gap-2 text-amber-400/80 text-xs bg-amber-500/8 border border-amber-500/20 rounded-md p-3">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Worldwide searches run <strong>~540 grid cells</strong> and may take{" "}
                  <strong>several days</strong>. Set{" "}
                  <code className="font-mono text-amber-300">MAPS_PROXY_URL</code> to rotate IPs.
                  Jobs can be paused and resumed at any time.
                </span>
              </div>
            )}

            {/* Combined search summary / cell count */}
            {(areas.length + (drawnBbox ? 1 : 0) > 0 && searchTerms.length > 0) && (
              overCellLimit ? (
                <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/10 border border-destructive/30 rounded-md p-3">
                  <span>
                    <strong>Too many cells (~{estimatedCells}).</strong> Max is {MAX_CELLS}. Remove some areas or search terms, or use the grid preview to select specific cells.
                  </span>
                </div>
              ) : (areas.length + (drawnBbox ? 1 : 0) > 1 || searchTerms.length > 1) ? (
                <div className="flex items-start gap-2 text-primary/70 text-xs bg-primary/5 border border-primary/15 rounded-md p-3">
                  <span>
                    All {searchTerms.length > 1 ? `${searchTerms.length} terms` : "terms"} across{" "}
                    {areas.length + (drawnBbox ? 1 : 0) > 1
                      ? `${areas.length + (drawnBbox ? 1 : 0)} areas`
                      : "this area"}{" "}
                    run as <strong>one combined search</strong> (~{estimatedCells} cells).
                  </span>
                </div>
              ) : null
            )}

            {largeSearch && !overCellLimit && (
              <div className="flex items-start gap-2 text-amber-400 text-xs bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
                <span>
                  <strong>Large area.</strong> Google lists at most ~120 places per search, so every busy
                  cell is cut into smaller cells during the search until each list is complete: the cell
                  count grows as it runs. A whole country can take <strong>several hours</strong>. Leads
                  appear as they are found, and the search can be paused and resumed at any time.
                </span>
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => searchMut.mutate()}
              disabled={
                searchMut.isPending ||
                searchTerms.length === 0 ||
                (pendingAreas.length === 0 && !drawnBbox) ||
                overCellLimit
              }
            >
              {searchMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" /> Start search
                </>
              )}
            </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Map: same height as the form next to it ── */}
        <div className="flex flex-col gap-3">
      <MapGridPicker
        cells={previewCells}
        selectedIndices={selectedCellIndices}
        onToggle={(idx) =>
          setSelectedCellIndices((prev) => {
            const next = new Set(prev);
            if (next.has(idx)) next.delete(idx);
            else next.add(idx);
            return next;
          })
        }
        onSelectAll={() => setSelectedCellIndices(new Set(previewCells.map((_, i) => i)))}
        onDeselectAll={() => setSelectedCellIndices(new Set())}
        onDraw={handleDrawComplete}
        drawnBbox={drawnBbox}
        onClearDraw={handleClearDraw}
        loading={previewLoading}
        placeholder=""
        fill
      />
      {cellSelectionIgnored && (
        <p className="text-xs font-mono text-amber-400">
          Several areas are searched: every cell of each area will be searched. To search only
          some cells, search one area at a time.
        </p>
      )}

        </div>
      </div>

      {/* ── Past searches ── */}
      {jobsData && jobsData.jobs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Your searches</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <ul className="divide-y divide-border">
              {(showAllSearches ? jobsData.jobs : jobsData.jobs.slice(0, 8)).map((job) => (
                <li key={job.jobId}>
                  <button
                    onClick={() => setActiveJobId(job.jobId)}
                    className="group w-full flex items-center gap-4 py-3 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {job.config.label || job.config.searchTerm}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {job.config.scope === "worldwide" ? "Worldwide" : job.config.location}
                        {searchDuration(job) && <> · took {searchDuration(job)}</>}
                      </p>
                    </div>
                    <span className="text-sm tabular-nums text-muted-foreground shrink-0">
                      {(job.shownLeads ?? job.totalLeads).toLocaleString()} {(job.shownLeads ?? job.totalLeads) === 1 ? "place" : "places"}
                    </span>
                    <StatusBadge status={job.status} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
            {jobsData.jobs.length > 8 && (
              <Button variant="ghost" size="sm" className="w-full mt-1 text-muted-foreground" onClick={() => setShowAllSearches((v) => !v)}>
                {showAllSearches ? "Show fewer" : `Show all ${jobsData.jobs.length} searches`}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
