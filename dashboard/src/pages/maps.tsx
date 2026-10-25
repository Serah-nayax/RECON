import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
} from "@/lib/mapsApi";
import { MapGridPicker } from "@/components/MapGridPicker";
import { qualifyApi, icpApi, type IcpConfig } from "@/lib/qualifyApi";
import { type EnrichResult } from "@/lib/mapsApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Map, Play, Pause, Globe, Building2, ExternalLink,
  Star, MessageSquare, Phone, MapPin, Tag, Clock, Link, Target,
  ChevronRight, ChevronDown, ChevronUp, Loader2, AlertTriangle, CheckCircle2, Download,
  Zap, Swords, Send, TrendingUp, Users, Mail, User, X,
} from "lucide-react";

const ALL_FIELDS: MapsField[] = [
  "address", "phone", "website", "mapsUrl",
  "rating", "reviewCount", "category", "hours",
];

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

function estimateTimeLeft(job: MapsJob): string {
  const remaining = job.totalCells - job.completedCells;
  if (remaining <= 0) return "finishing...";
  const mins = Math.ceil(remaining * 1.5);
  if (mins < 60) return `~${mins}m remaining`;
  const hrs = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `~${hrs}h ${m}m remaining` : `~${hrs}h remaining`;
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
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-semibold ${v.className}`}>
      {v.label}
    </span>
  );
}

function exportToCsv(job: MapsJob) {
  const fields = job.config.selectedFields;
  const headers = ["name", ...fields].join(",");
  const rows = job.results.map((lead) => {
    const cols = [
      JSON.stringify(lead.name ?? ""),
      ...fields.map((f) => {
        const v = lead[f as keyof MapsLead];
        return JSON.stringify(v !== undefined && v !== null ? String(v) : "");
      }),
    ];
    return cols.join(",");
  });
  const csv = [headers, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${job.config.searchTerm.replace(/\s+/g, "-")}-${job.config.location || job.config.scope}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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

function extractIcpSearchTerms(icp: IcpConfig): string[] {
  const text = [icp.description, ...icp.qualifySignals].join(" ");
  const patterns: [RegExp, string][] = [
    [/\bFEC[s]?\b|family entertainment center/i, "family entertainment center"],
    [/\barcade[s]?\b/i, "arcade"],
    [/\bbarcade[s]?\b/i, "barcade"],
    [/\bbeercade[s]?\b/i, "beercade"],
    [/\bbowling/i, "bowling alley"],
    [/\blaser.?tag/i, "laser tag"],
    [/\bgo.kart/i, "go-kart track"],
    [/\bescape.?room/i, "escape room"],
    [/\btrampoline/i, "trampoline park"],
    [/\bgame.?room/i, "game room"],
    [/\bentertainment.?restaurant|entertainment dining/i, "entertainment restaurant"],
    [/\bpinball/i, "pinball arcade"],
    [/\bamusement/i, "amusement center"],
  ];
  const terms: string[] = [];
  for (const [regex, term] of patterns) {
    if (regex.test(text) && !terms.includes(term)) terms.push(term);
  }
  return terms.slice(0, 7);
}

function sigIcon(s: string): string {
  if (/machine|game|cabinet|pinball|arcade/i.test(s)) return "🎮";
  if (/redemption|prize|ticket/i.test(s)) return "🏆";
  if (/cashless|contactless|tap|kiosk|card system/i.test(s)) return "💳";
  if (/birthday|party|event|corporate/i.test(s)) return "🎂";
  if (/loyalty|member|reward|vip/i.test(s)) return "⭐";
  if (/laser/i.test(s)) return "🎯";
  if (/bowling/i.test(s)) return "🎳";
  if (/escape/i.test(s)) return "🔐";
  if (/opportunity|no cashless|upgrade/i.test(s)) return "💡";
  if (/token|coin/i.test(s)) return "🪙";
  if (/food|restaurant|dining/i.test(s)) return "🍔";
  return "·";
}

type EnrichTab = "overview" | "contacts" | "reviews" | "socials" | "venue";

const SOCIAL_ICONS_MAPS: Record<string, string> = {
  Facebook: "f", Instagram: "ig", LinkedIn: "in", Twitter: "𝕏",
  YouTube: "▶", TikTok: "tt",
};

function EnrichPanel({
  result,
  onSendToQualify,
  onClose,
}: {
  result: EnrichResult;
  onSendToQualify: () => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<EnrichTab>("overview");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const scoreColor =
    result.verdict === "QUALIFY" ? "text-emerald-400" :
    result.verdict === "DISQUALIFY" ? "text-rose-400" : "text-amber-400";
  const scoreBg =
    result.verdict === "QUALIFY" ? "bg-emerald-500/10 border-emerald-500/30" :
    result.verdict === "DISQUALIFY" ? "bg-rose-500/10 border-rose-500/30" :
    "bg-amber-500/10 border-amber-500/30";

  const dmCount = result.outreachIntel?.decisionMakers?.length ?? 0;
  const hasReviews = !!(result.reviewAnalysis && (
    result.reviewAnalysis.strengths.length > 0 ||
    result.reviewAnalysis.weaknesses.length > 0 ||
    (result.reviewAnalysis.platformSummaries?.length ?? 0) > 0
  ));
  const socialCount = (result.socialProfiles ?? []).length;
  const hasVenue = !!result.venueIntel;

  const tabs = ([
    { key: "overview" as EnrichTab,  label: "Overview",  show: true },
    { key: "contacts" as EnrichTab,  label: "Contacts",  count: dmCount,     show: dmCount > 0 },
    { key: "reviews"  as EnrichTab,  label: "Reviews",   show: hasReviews },
    { key: "socials"  as EnrichTab,  label: "Socials",   count: socialCount, show: socialCount > 0 },
    { key: "venue"    as EnrichTab,  label: "Venue",     show: hasVenue },
  ] as { key: EnrichTab; label: string; count?: number; show: boolean }[]).filter((t) => t.show);

  const validTab: EnrichTab = tabs.some((t) => t.key === activeTab) ? activeTab : "overview";

  return (
    <div className="bg-muted/5 border-t border-muted/20">
      {/* Tab bar */}
      <div className="flex items-center border-b border-muted/20 px-4 pt-1.5">
        <div className="flex items-center gap-0 flex-1 min-w-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-3 py-2 text-[11px] font-mono font-semibold border-b-2 transition-colors mr-0.5 whitespace-nowrap ${
                validTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground/50 hover:text-muted-foreground hover:border-muted/40"
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={`inline-flex items-center justify-center min-w-[15px] h-[15px] rounded-full text-[9px] font-bold px-1 ${
                  validTab === tab.key
                    ? "bg-primary/20 text-primary"
                    : "bg-muted/30 text-muted-foreground/40"
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0 pb-1 pl-3">
          <Button
            size="sm"
            variant="outline"
            onClick={onSendToQualify}
            className="h-6 text-[11px] border-primary/30 text-primary hover:bg-primary/10"
          >
            <Send className="h-3 w-3 mr-1" /> Send to Qualifier
          </Button>
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div className="px-4 py-3">

        {/* ── Overview ─────────────────────────────────────────────────────── */}
        {validTab === "overview" && (
          <div className="space-y-3.5">
            {/* Score + verdict */}
            <div className="flex items-start gap-4">
              <div className={`shrink-0 rounded-lg border px-4 py-2 text-center ${scoreBg}`}>
                <div className={`text-2xl font-bold font-mono leading-none ${scoreColor}`}>
                  {result.score ?? "—"}
                </div>
                <div className="text-[9px] text-muted-foreground/50 font-mono mt-0.5">/100</div>
              </div>
              <div className="flex-1 min-w-0 space-y-1 pt-0.5">
                <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded border ${scoreBg} ${scoreColor}`}>
                  {result.verdict ?? "PENDING"}
                </span>
                {result.icpExplanation && (
                  <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    {result.icpExplanation}
                  </p>
                )}
                {result.recommendedAction && (
                  <p className="text-[11px] text-primary/70 flex items-center gap-1 pt-0.5">
                    <TrendingUp className="h-3 w-3 shrink-0" /> {result.recommendedAction}
                  </p>
                )}
              </div>
            </div>

            {/* Signals */}
            {(result.keySignals.length > 0 || result.missingSignals.length > 0) && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-mono text-muted-foreground/45 uppercase tracking-wider">Signals</p>
                <div className="flex flex-wrap gap-1">
                  {result.keySignals.map((s) => (
                    <span key={s}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] bg-emerald-500/8 border-emerald-500/20 text-emerald-400 max-w-[220px]"
                      title={s}
                    >
                      <span className="shrink-0">{sigIcon(s)}</span>
                      <span className="truncate">{s}</span>
                    </span>
                  ))}
                  {result.missingSignals.map((s) => (
                    <span key={s}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[11px] bg-rose-500/8 border-rose-500/20 text-rose-400 max-w-[220px]"
                      title={s}
                    >
                      <span className="shrink-0 text-[12px]">✗</span>
                      <span className="truncate">{s}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Outreach intel */}
            {result.outreachIntel && (result.outreachIntel.pitchAngle || result.outreachIntel.openingHook || result.outreachIntel.competitorSystem) && (
              <div className="space-y-1.5 border-t border-muted/20 pt-3">
                <p className="text-[10px] font-mono text-muted-foreground/45 uppercase tracking-wider flex items-center gap-1">
                  <Zap className="h-2.5 w-2.5" /> Outreach Intel
                </p>
                {result.outreachIntel.pitchAngle && (
                  <p className="text-xs text-muted-foreground/90 leading-relaxed">{result.outreachIntel.pitchAngle}</p>
                )}
                {result.outreachIntel.openingHook && (
                  <p className="text-[11px] text-primary/60 italic">"{result.outreachIntel.openingHook}"</p>
                )}
                {result.outreachIntel.competitorSystem && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-400/80">
                    <Swords className="h-3 w-3 shrink-0" />
                    Current system: <strong>{result.outreachIntel.competitorSystem}</strong>
                  </span>
                )}
              </div>
            )}

            {/* Competitor analysis */}
            {result.competitorAnalysis && (
              <div className="flex items-start gap-2 border-t border-muted/20 pt-2.5">
                <Swords className="h-3 w-3 text-violet-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="text-[11px] text-violet-400 font-semibold">
                    {result.competitorAnalysis.vendorName}
                  </span>
                  {result.competitorAnalysis.competitiveAngle && (
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5 leading-snug">
                      {result.competitorAnalysis.competitiveAngle}
                    </p>
                  )}
                  {result.competitorAnalysis.strategicOverview && (
                    <p className="text-[10px] text-muted-foreground/45 mt-1 leading-snug italic">
                      {result.competitorAnalysis.strategicOverview}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Contacts ─────────────────────────────────────────────────────── */}
        {validTab === "contacts" && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono text-muted-foreground/45 uppercase tracking-wider flex items-center gap-1 mb-3">
              <Users className="h-2.5 w-2.5" /> Decision Makers ({dmCount})
            </p>
            {(result.outreachIntel?.decisionMakers ?? []).map((dm, i) => (
              <div key={i} className="rounded-md border border-emerald-500/15 bg-emerald-500/5 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 shrink-0 text-emerald-400/60" />
                  <span className="text-[12px] font-semibold text-foreground/85">{dm.name}</span>
                  {dm.title && (
                    <span className="text-[10px] text-muted-foreground/50 font-mono truncate">· {dm.title}</span>
                  )}
                </div>
                <div className="pl-[22px] space-y-1">
                  {dm.email && (
                    <div className="flex items-center gap-1.5">
                      <Mail className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
                      <a href={`mailto:${dm.email}`}
                        className="text-[11px] text-sky-400/80 hover:text-sky-400 transition-colors">
                        {dm.email}
                      </a>
                    </div>
                  )}
                  {dm.phone && (
                    <div className="flex items-center gap-1.5">
                      <Phone className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
                      <span className="text-[11px] font-mono text-muted-foreground/70">{dm.phone}</span>
                    </div>
                  )}
                  {!dm.email && !dm.phone && (
                    <p className="text-[10px] text-muted-foreground/35 italic">No contact details found</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Reviews ──────────────────────────────────────────────────────── */}
        {validTab === "reviews" && result.reviewAnalysis && (
          <div className="space-y-3">
            {/* Sentiment + platform summaries */}
            <div className="flex items-center gap-2 flex-wrap">
              {result.reviewAnalysis.sentiment && (() => {
                const s = result.reviewAnalysis!.sentiment;
                const cls =
                  s === "Excellent" ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" :
                  s === "Good"      ? "bg-sky-500/10 border-sky-500/25 text-sky-400" :
                  s === "Mixed"     ? "bg-amber-500/10 border-amber-500/25 text-amber-400" :
                                      "bg-rose-500/10 border-rose-500/25 text-rose-400";
                return (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono font-semibold ${cls}`}>
                    <Star className="h-2.5 w-2.5" /> {s}
                  </span>
                );
              })()}
            </div>

            {/* Platform summaries */}
            {(result.reviewAnalysis.platformSummaries ?? []).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-mono text-muted-foreground/45 uppercase tracking-wider">Platforms</p>
                <div className="flex flex-col gap-1">
                  {result.reviewAnalysis.platformSummaries!.map((p) => (
                    <div key={p.platform}
                      className="flex items-center gap-2 text-[11px] rounded-md bg-muted/10 px-2.5 py-1.5 border border-muted/15">
                      <span className="text-muted-foreground/60 font-mono min-w-[80px] shrink-0">{p.platform}</span>
                      {p.rating != null && (
                        <span className="text-amber-400 flex items-center gap-0.5">
                          <Star className="h-2.5 w-2.5 fill-current" /> {p.rating}
                        </span>
                      )}
                      {p.reviewCount != null && (
                        <span className="text-muted-foreground/45">({p.reviewCount.toLocaleString()} reviews)</span>
                      )}
                      {p.url && (
                        <a href={p.url} target="_blank" rel="noopener noreferrer"
                          className="ml-auto text-muted-foreground/30 hover:text-primary transition-colors">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Strengths */}
            {result.reviewAnalysis.strengths.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-mono text-emerald-500/70 uppercase tracking-wider">Strengths ({result.reviewAnalysis.strengths.length})</p>
                <div className="space-y-1">
                  {result.reviewAnalysis.strengths.map((s, i) => (
                    <div key={i} className="border-l-[3px] border-l-emerald-500/40 bg-emerald-500/5 px-2.5 py-1.5 rounded-r-md">
                      <p className="text-[11px] font-medium text-emerald-300/80" title={s.summary}>✓ {s.summary}</p>
                      {s.quote && (
                        <p className="text-[10px] text-muted-foreground/50 italic mt-0.5">"{s.quote}"</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Weaknesses */}
            {result.reviewAnalysis.weaknesses.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-mono text-rose-400/70 uppercase tracking-wider">Weaknesses ({result.reviewAnalysis.weaknesses.length})</p>
                <div className="space-y-1">
                  {result.reviewAnalysis.weaknesses.map((w, i) => (
                    <div key={i} className="border-l-[3px] border-l-rose-500/40 bg-rose-500/5 px-2.5 py-1.5 rounded-r-md">
                      <p className="text-[11px] font-medium text-rose-400/80" title={w.summary}>⚠ {w.summary}</p>
                      {w.quote && (
                        <p className="text-[10px] text-muted-foreground/50 italic mt-0.5">"{w.quote}"</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Aspect scores */}
            {(result.reviewAnalysis.aspects ?? []).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-mono text-muted-foreground/45 uppercase tracking-wider">Aspect Scores</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.reviewAnalysis.aspects!.map((a, i) => (
                    <div key={i}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-muted/20 bg-muted/10"
                      title={a.quote ?? a.name}>
                      <span className="text-[10px] text-muted-foreground/60 font-mono">{a.name}</span>
                      <span className={`text-[11px] font-bold font-mono ${
                        a.score >= 4 ? "text-emerald-400" :
                        a.score >= 3 ? "text-amber-400" : "text-rose-400"
                      }`}>{a.score}/5</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Socials ──────────────────────────────────────────────────────── */}
        {validTab === "socials" && (
          <div className="space-y-2">
            <p className="text-[10px] font-mono text-muted-foreground/45 uppercase tracking-wider flex items-center gap-1 mb-3">
              Social Profiles ({socialCount})
            </p>
            {(result.socialProfiles ?? []).map((sp, i) => (
              <div key={i} className="rounded-md border border-violet-500/15 bg-violet-500/5 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono font-bold text-violet-400/80">
                      {SOCIAL_ICONS_MAPS[sp.platform] ?? sp.platform.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="text-[12px] font-semibold text-foreground/80">{sp.platform}</span>
                    {sp.followers && (
                      <span className="text-[10px] text-muted-foreground/50 font-mono">{sp.followers} followers</span>
                    )}
                  </div>
                  {sp.url && (
                    <a href={sp.url} target="_blank" rel="noopener noreferrer"
                      className="text-muted-foreground/30 hover:text-violet-400/70 transition-colors shrink-0">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {sp.bio && (
                  <p className="text-[11px] text-muted-foreground/65 leading-relaxed italic">"{sp.bio}"</p>
                )}
                {sp.postTone && (
                  <p className="text-[10px] text-muted-foreground/40 font-mono">tone: {sp.postTone}</p>
                )}
                {(sp.categoryTags ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {sp.categoryTags!.map((tag, j) => (
                      <span key={j}
                        className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-violet-500/10 border border-violet-500/20 text-violet-400/70">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Venue ────────────────────────────────────────────────────────── */}
        {validTab === "venue" && result.venueIntel && (
          <div className="space-y-3">
            <p className="text-[10px] font-mono text-muted-foreground/45 uppercase tracking-wider flex items-center gap-1">
              <Building2 className="h-2.5 w-2.5" /> Venue Intelligence
            </p>

            {/* Key facts */}
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {result.venueIntel.estimatedMachineCount && result.venueIntel.estimatedMachineCount !== "unknown" && (
                <div>
                  <p className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-wider mb-0.5">Machines</p>
                  <p className="text-[13px] font-semibold font-mono text-foreground/80">{result.venueIntel.estimatedMachineCount}</p>
                </div>
              )}
              {result.venueIntel.paymentSystem && result.venueIntel.paymentSystem !== "unknown" && (
                <div>
                  <p className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-wider mb-0.5">Payment System</p>
                  <p className="text-[13px] font-semibold font-mono text-foreground/80">{result.venueIntel.paymentSystem}</p>
                </div>
              )}
              {result.venueIntel.venueType && result.venueIntel.venueType !== "unknown" && (
                <div>
                  <p className="text-[9px] font-mono text-muted-foreground/40 uppercase tracking-wider mb-0.5">Venue Type</p>
                  <p className="text-[13px] font-semibold font-mono text-foreground/80">{result.venueIntel.venueType}</p>
                </div>
              )}
            </div>

            {/* Feature flags */}
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {([
                { k: "Redemption",   v: result.venueIntel.hasRedemption },
                { k: "Loyalty",      v: result.venueIntel.hasLoyalty },
                { k: "Food & Bev",   v: result.venueIntel.hasFoodBeverage },
                { k: "Party Rooms",  v: result.venueIntel.hasPartyRooms },
                {
                  k: result.venueIntel.isChain && result.venueIntel.chainName
                    ? `Chain: ${result.venueIntel.chainName}`
                    : "Chain",
                  v: result.venueIntel.isChain,
                },
              ] as const).map(({ k, v }) => (
                <div key={k}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${
                    v
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-muted/15 bg-muted/5"
                  }`}>
                  <span className={`text-[12px] font-bold leading-none ${v ? "text-emerald-400" : "text-muted-foreground/25"}`}>
                    {v ? "✓" : "✗"}
                  </span>
                  <span className={`text-[11px] font-mono truncate ${v ? "text-foreground/70" : "text-muted-foreground/30"}`}>
                    {k}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

type ScoreFilter = "all" | "QUALIFY" | "BORDERLINE" | "DISQUALIFY";

function LeadsTable({
  leads,
  selectedFields,
  expandedLeadId,
  onToggleExpand,
  onEnrich,
  onSendToQualify,
  scoreFilter = "all",
}: {
  leads: MapsLead[];
  selectedFields: MapsField[];
  expandedLeadId: string | null;
  onToggleExpand: (id: string) => void;
  onEnrich: (lead: MapsLead) => void;
  onSendToQualify: (lead: MapsLead) => void;
  scoreFilter?: ScoreFilter;
}) {
  const filteredLeads =
    scoreFilter === "all"
      ? leads
      : leads.filter((l) => l.enrichResult?.verdict === scoreFilter);
  const cols = selectedFields;
  const totalCols = cols.length + 2;

  return (
    <div>
      {filteredLeads.length === 0 && scoreFilter !== "all" && (
        <div className="py-8 text-center text-sm text-muted-foreground font-mono">
          No {scoreFilter.toLowerCase()} leads yet — enrich some leads first.
        </div>
      )}
      {(filteredLeads.length > 0 || scoreFilter === "all") && (
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-muted/30 bg-muted/10">
            <th className="text-left py-2 px-3 font-mono text-muted-foreground whitespace-nowrap">
              Name
            </th>
            {cols.map((f) => (
              <th key={f} className="text-left py-2 px-3 font-mono text-muted-foreground whitespace-nowrap">
                <span className="flex items-center gap-1">
                  {FIELD_ICONS[f]}
                  {FIELD_LABELS[f]}
                </span>
              </th>
            ))}
            <th className="py-2 px-3 font-mono text-muted-foreground text-right whitespace-nowrap">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredLeads.map((lead, leadIndex) => {
            const isExpanded = expandedLeadId === lead.id;
            const status = lead.enrichStatus;
            const detailStatus = lead.detailStatus;
            const isDone = status === "done";
            const isRunning = status === "running";
            const isFailed = status === "failed";

            return (
              <React.Fragment key={`${lead.id || lead.name}-${leadIndex}`}>
                <tr
                  className={`border-b border-muted/15 transition-colors ${
                    isDone ? "bg-emerald-500/3 hover:bg-emerald-500/6" : "hover:bg-muted/5"
                  } ${isExpanded ? "border-b-0" : ""}`}
                >
                  <td className="py-2 px-3 font-medium whitespace-nowrap max-w-[220px] truncate">
                    <div className="flex items-center gap-1.5">
                      {detailStatus === "running" && (
                        <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono text-blue-400 bg-blue-500/10 border border-blue-500/20">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" /> details
                        </span>
                      )}
                      {detailStatus === "failed" && (
                        <span
                          title={lead.detailError ?? "Detail extraction failed"}
                          className="shrink-0 inline-flex px-1.5 py-0.5 rounded text-[9px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/20"
                        >
                          partial
                        </span>
                      )}
                      {isDone && lead.enrichResult && (
                        <span className={`shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border ${
                          lead.enrichResult.verdict === "QUALIFY"
                            ? "bg-emerald-500/12 border-emerald-500/25 text-emerald-400"
                            : lead.enrichResult.verdict === "DISQUALIFY"
                            ? "bg-rose-500/12 border-rose-500/25 text-rose-400"
                            : "bg-amber-500/12 border-amber-500/25 text-amber-400"
                        }`}>
                          {lead.enrichResult.score}
                        </span>
                      )}
                      {isDone && !lead.enrichResult && (
                        <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-emerald-500/12 border border-emerald-500/25 text-emerald-400">
                          enriched
                        </span>
                      )}
                      <span className="truncate">{lead.name}</span>
                    </div>
                  </td>
                  {cols.map((f) => (
                    <td key={f} className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                      {renderCell(f, lead) ?? <span className="text-muted-foreground/30">—</span>}
                    </td>
                  ))}
                  <td className="py-2 px-3 whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Enrich-state controls */}
                      {isRunning && (
                        <span className="flex items-center gap-1.5 text-[11px] text-primary font-mono">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enriching…
                        </span>
                      )}
                      {isFailed && (
                        <>
                          <span className="text-[10px] text-rose-400 font-mono">failed</span>
                          {lead.website && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[10px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                              onClick={() => onEnrich(lead)}
                            >
                              Retry
                            </Button>
                          )}
                        </>
                      )}
                      {isDone && (
                        <button
                          onClick={() => onToggleExpand(lead.id)}
                          className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors text-[11px] font-mono"
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {isExpanded ? "Close" : "View"}
                        </button>
                      )}
                      {!isRunning && !isDone && !isFailed && lead.website && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px] border-primary/30 text-primary hover:bg-primary/10"
                          onClick={() => onEnrich(lead)}
                        >
                          <Zap className="h-3 w-3 mr-1" /> Enrich
                        </Button>
                      )}
                      {!lead.website && !isRunning && !isDone && !isFailed && (
                        <span className="text-[10px] text-muted-foreground/30">no URL</span>
                      )}
                      {/* Qualify button — always visible for leads with a website */}
                      {lead.website && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted/20 border border-muted/30"
                          onClick={() => onSendToQualify(lead)}
                        >
                          <Target className="h-3 w-3 mr-1" /> Qualify
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
                {isExpanded && isDone && lead.enrichResult && (
                  <tr key={`${lead.id}-panel`} className="border-b border-muted/15">
                    <td colSpan={totalCols} className="p-0">
                      <EnrichPanel
                        result={lead.enrichResult}
                        onSendToQualify={() => onSendToQualify(lead)}
                        onClose={() => onToggleExpand(lead.id)}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      )}
    </div>
  );
}

function JobProgress({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [expandedLeadId, setExpandedLeadId] = useState<string | null>(null);
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");

  const { data: job } = useQuery({
    queryKey: ["maps-job", jobId],
    queryFn: () => mapsApi.getJob(jobId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      const hasEnriching = q.state.data?.results?.some((r) => r.enrichStatus === "running");
      const hasDetailWork = q.state.data?.results?.some((r) => r.detailStatus === "running");
      return s === "running" || s === "pending" || hasEnriching || hasDetailWork ? 2000 : false;
    },
  });

  // Keep one long-held request open while the job has background work, so the
  // published (Autoscale) server keeps full CPU for the headless browser.
  const jobHasActiveWork =
    job?.status === "running" ||
    job?.status === "pending" ||
    !!job?.results?.some((r) => r.enrichStatus === "running" || r.detailStatus === "running");
  useEffect(() => {
    if (!jobHasActiveWork) return;
    const controller = new AbortController();
    let stopped = false;
    (async () => {
      while (!stopped) {
        try {
          const r = await mapsApi.keepAlive(jobId, controller.signal);
          if (!r.active) break;
        } catch {
          if (stopped) break;
          await new Promise((res) => setTimeout(res, 2000));
        }
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [jobId, jobHasActiveWork]);

  const pauseMut = useMutation({
    mutationFn: () => mapsApi.pause(jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maps-job", jobId] }),
  });

  const resumeMut = useMutation({
    mutationFn: () => mapsApi.resume(jobId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maps-job", jobId] }),
  });

  const [, setLocation] = useLocation();

  const enrichMut = useMutation({
    mutationFn: (lead: MapsLead) => mapsApi.enrichLead(jobId, lead.id),
    onSuccess: (_res, lead) => {
      toast({ title: "Enrichment started", description: `Crawling ${lead.name}...` });
      queryClient.invalidateQueries({ queryKey: ["maps-job", jobId] });
    },
    onError: (e) => toast({ title: "Enrich failed", description: e.message, variant: "destructive" }),
  });

  const enrichAllMut = useMutation({
    mutationFn: () => mapsApi.enrichAll(jobId),
    onSuccess: (res) => {
      toast({ title: "Bulk enrichment started", description: res.message });
      queryClient.invalidateQueries({ queryKey: ["maps-job", jobId] });
    },
    onError: (e) => toast({ title: "Enrich All failed", description: e.message, variant: "destructive" }),
  });

  const qualifyAllMut = useMutation({
    mutationFn: () => mapsApi.qualifyAll(jobId),
    onSuccess: (res) => {
      toast({ title: `${res.count} lead(s) sent to Qualifier`, description: "Opening Lead Qualifier…" });
      setTimeout(() => setLocation(`/qualify?batch=${res.batchId}`), 600);
    },
    onError: (e) => toast({ title: "Bulk qualify failed", description: e.message, variant: "destructive" }),
  });

  const qualifyMut = useMutation({
    mutationFn: (lead: MapsLead) =>
      qualifyApi.submit([{
        name: lead.name,
        url: lead.website!,
        category: lead.category,
        city: lead.address,
      }]),
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

  const pct = job.totalCells > 0 ? Math.round((job.completedCells / job.totalCells) * 100) : 0;
  const selectedFields = job.config.selectedFields;
  const hasDetailFields = selectedFields.some((f) => DETAIL_FIELDS.includes(f));
  const detailTotal = job.results.filter((lead) => lead.detailStatus != null).length;
  const detailDone = job.results.filter((lead) => lead.detailStatus === "done").length;
  const detailFailed = job.results.filter((lead) => lead.detailStatus === "failed").length;
  const detailRunning = job.results.filter((lead) => lead.detailStatus === "running").length;

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
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <StatusBadge status={job.status} />
            <span className="text-xs text-muted-foreground font-mono">
              {job.completedCells}/{job.totalCells} cells · {job.totalLeads.toLocaleString()} leads found
            </span>
            {hasDetailFields && (
              <span className="text-[10px] font-mono text-blue-400/70 bg-blue-500/8 border border-blue-500/20 px-1.5 py-0.5 rounded">
                deep mode
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {job.results.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => exportToCsv(job)}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
            </Button>
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
        </div>
      </div>

      {/* Progress bar */}
      {(job.status === "running" || job.status === "paused") && (
        <div className="space-y-1.5">
          <Progress value={pct} className="h-2" />
          <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
            <span>{pct}% complete</span>
            {job.status === "running" && <span>{estimateTimeLeft(job)}</span>}
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
          <p className="text-[11px] text-muted-foreground">
            Leads are available now. Phone, website, and hours continue filling in without blocking the search.
          </p>
        </div>
      )}

      {job.status === "done" && (
        <div className="flex items-center gap-2 text-emerald-400 text-sm">
          <CheckCircle2 className="h-4 w-4" />
          <span>Search complete — {job.totalLeads.toLocaleString()} businesses found</span>
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
      {job.results.length > 0 && (() => {
        const leadsWithWebsite = job.results.filter((l) => l.website);
        const unenrichedCount = leadsWithWebsite.filter(
          (l) => !l.enrichStatus || l.enrichStatus === "idle" || l.enrichStatus === "failed",
        ).length;
        const enrichingCount = job.results.filter((l) => l.enrichStatus === "running").length;
        const completedCount = leadsWithWebsite.filter(
          (l) => l.enrichStatus === "done" || l.enrichStatus === "failed",
        ).length;
        const totalEnrichable = leadsWithWebsite.length;
        const showEnrichAll = unenrichedCount > 0 && enrichingCount === 0;
        const showProgress = enrichingCount > 0;
        const enrichedLeads = job.results.filter((l) => l.enrichStatus === "done" && l.enrichResult);
        const qualifyCount = enrichedLeads.filter((l) => l.enrichResult?.verdict === "QUALIFY").length;
        const borderlineCount = enrichedLeads.filter((l) => l.enrichResult?.verdict === "BORDERLINE").length;
        const disqualifyCount = enrichedLeads.filter((l) => l.enrichResult?.verdict === "DISQUALIFY").length;
        const hasEnriched = enrichedLeads.length > 0;

        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider font-mono">
                Leads ({job.results.length.toLocaleString()})
              </h3>
              <div className="flex items-center gap-3 shrink-0">
                {showProgress && (
                  <span className="flex items-center gap-1.5 text-[11px] font-mono text-primary/80">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Enriching {completedCount}/{totalEnrichable}
                  </span>
                )}
                {showEnrichAll && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-[11px] border-primary/30 text-primary hover:bg-primary/10"
                    onClick={() => enrichAllMut.mutate()}
                    disabled={enrichAllMut.isPending}
                  >
                    {enrichAllMut.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    ) : (
                      <Zap className="h-3 w-3 mr-1.5" />
                    )}
                    Enrich All ({unenrichedCount})
                  </Button>
                )}
                {job.results.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-3 text-[11px] border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
                    onClick={() => qualifyAllMut.mutate()}
                    disabled={qualifyAllMut.isPending || leadsWithWebsite.length === 0}
                    title={
                      leadsWithWebsite.length === 0
                        ? hasDetailFields
                          ? "Waiting for Deep Search to find website URLs"
                          : "Start a new search with Website URL selected"
                        : `Qualify ${leadsWithWebsite.length} lead(s) using their websites`
                    }
                  >
                    {qualifyAllMut.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    ) : (
                      <Target className="h-3 w-3 mr-1.5" />
                    )}
                    {leadsWithWebsite.length > 0
                      ? `Qualify All (${leadsWithWebsite.length})`
                      : hasDetailFields
                      ? "Qualify All (waiting)"
                      : "Qualify All (no websites)"}
                  </Button>
                )}
                {!showEnrichAll && !showProgress && !job.results.some((l) => l.website) && (
                  <span className="text-xs text-muted-foreground">
                    {hasDetailFields
                      ? "Deep Search is still looking for website URLs"
                      : 'Website URL was not selected for this search'}
                  </span>
                )}
              </div>
            </div>

            {/* ICP score filter chips — only visible once enrichment has run */}
            {hasEnriched && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-wider">ICP Filter:</span>
                {(["all", "QUALIFY", "BORDERLINE", "DISQUALIFY"] as ScoreFilter[]).map((f) => {
                  const label = f === "all" ? `All (${enrichedLeads.length})` : f === "QUALIFY" ? `✓ Qualify (${qualifyCount})` : f === "BORDERLINE" ? `~ Borderline (${borderlineCount})` : `✕ Disqualify (${disqualifyCount})`;
                  const activeClass =
                    f === "QUALIFY" ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" :
                    f === "BORDERLINE" ? "bg-amber-500/15 border-amber-500/40 text-amber-400" :
                    f === "DISQUALIFY" ? "bg-rose-500/15 border-rose-500/40 text-rose-400" :
                    "bg-primary/15 border-primary/40 text-primary";
                  return (
                    <button
                      key={f}
                      onClick={() => setScoreFilter(f)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                        scoreFilter === f
                          ? activeClass
                          : "border-muted/30 text-muted-foreground hover:border-muted/60 hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="max-h-[600px] overflow-auto rounded-lg border border-muted/25">
              <LeadsTable
                leads={job.results}
                selectedFields={selectedFields}
                expandedLeadId={expandedLeadId}
                onToggleExpand={(id) => setExpandedLeadId((prev) => (prev === id ? null : id))}
                onEnrich={(l) => enrichMut.mutate(l)}
                onSendToQualify={(l) => qualifyMut.mutate(l)}
                scoreFilter={scoreFilter}
              />
            </div>
          </div>
        );
      })()}

      {job.status === "running" && job.results.length === 0 && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Searching Google Maps...</span>
        </div>
      )}
    </div>
  );
}

export function MapsSearch() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [termInput, setTermInput] = useState("");
  const [label, setLabel] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [areaInput, setAreaInput] = useState("");
  const [drawnBbox, setDrawnBbox] = useState<import("@/lib/mapsApi").DrawnBbox | null>(null);
  const [selectedFields, setSelectedFields] = useState<Set<MapsField>>(
    new Set(["address", "phone", "website", "rating", "reviewCount", "category"]),
  );
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

  // Auto-populate search terms from the active ICP on first load.
  // Only fires once (guarded by ref so manual edits are never overwritten).
  const icpInitialized = useRef(false);
  useEffect(() => {
    if (icpInitialized.current || !activeIcp || searchTerms.length > 0) return;
    const terms = extractIcpSearchTerms(activeIcp);
    if (terms.length > 0) {
      setSearchTerms(terms);
      icpInitialized.current = true;
    }
  }, [activeIcp]);

  const searchMut = useMutation({
    mutationFn: () =>
      mapsApi.search({
        searchTerms,
        areas: areas.length > 0 ? areas : undefined,
        ...(drawnBbox ? { bbox: drawnBbox } : {}),
        selectedFields: Array.from(selectedFields),
        selectedCellIndices:
          selectedCellIndices.size > 0 && selectedCellIndices.size < previewCells.length
            ? Array.from(selectedCellIndices)
            : undefined,
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

  function addArea(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || areas.includes(trimmed)) return;
    setAreas((prev) => [...prev, trimmed]);
    setAreaInput("");
  }

  function removeArea(a: string) {
    setAreas((prev) => prev.filter((x) => x !== a));
  }

  function handleAreaKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addArea(areaInput);
    } else if (e.key === "Backspace" && !areaInput && areas.length > 0) {
      setAreas((prev) => prev.slice(0, -1));
    }
  }

  // Auto-load grid preview for whatever's being typed (debounced).
  useEffect(() => {
    if (drawnBbox) return;
    if (!areaInput.trim()) {
      setPreviewCells([]);
      setSelectedCellIndices(new Set());
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await mapsApi.previewGrid({ area: areaInput });
        setPreviewCells(result.cells);
        setSelectedCellIndices(new Set(result.cells.map((_, i) => i)));
      } catch {
        setPreviewCells([]);
        setSelectedCellIndices(new Set());
      } finally {
        setPreviewLoading(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [areaInput, drawnBbox]);

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

  function toggleField(f: MapsField) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }

  const hasDetailFields = [...selectedFields].some((f) => DETAIL_FIELDS.includes(f));
  const isWorldwide = areas.some((a) => a.toLowerCase() === "worldwide" || a.toLowerCase() === "world") ||
    areaInput.toLowerCase() === "worldwide" || areaInput.toLowerCase() === "world";
  const totalJobs = 1;
  const MAX_CELLS = 300;
  // Estimate cell count: use actual preview cells if available (single area), otherwise ~16 cells/area
  const cellsPerArea = previewCells.length > 0 && areas.length <= 1 ? previewCells.length : 16;
  const estimatedCells = (areas.length + (drawnBbox ? 1 : 0)) * cellsPerArea * Math.max(searchTerms.length, 1);
  const overCellLimit = estimatedCells > MAX_CELLS;

  if (activeJobId) {
    return (
      <div className="space-y-6">
        <JobProgress jobId={activeJobId} onBack={() => setActiveJobId(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Map className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold font-mono">Maps Search</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Scrape Google Maps for any type of business, anywhere in the world.
        </p>
        {activeIcp && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/20 bg-primary/5 text-xs font-mono">
            <Target className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-muted-foreground">ICP:</span>
            <span className="text-primary font-semibold truncate">{activeIcp.name}</span>
            <span className="text-muted-foreground/40 ml-auto shrink-0 hidden sm:inline">Search terms &amp; scoring pre-loaded from ICP</span>
          </div>
        )}
      </div>

      {/* ── Step 1: Area(s) ──────────────────────────────────────────── */}
      <Card className="border-muted/30 bg-background/50">
        <CardContent className="pt-5 pb-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              Areas
              <span className="text-muted-foreground/40 normal-case font-sans font-normal text-[10px]">
                press Enter or comma to add multiple
              </span>
              {previewLoading && <Loader2 className="h-2.5 w-2.5 animate-spin text-primary ml-1" />}
              {!previewLoading && previewCells.length > 0 && (
                <span className="text-primary ml-1">→ {previewCells.length} cells</span>
              )}
            </label>

            {/* Pills + input */}
            <div
              className="min-h-[38px] w-full rounded-md border border-muted/40 bg-muted/10 px-2 py-1.5 flex flex-wrap gap-1.5 cursor-text focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30 transition-colors"
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
                  key={a}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/15 border border-primary/30 text-primary text-xs font-mono"
                >
                  {a}
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
                onBlur={() => addArea(areaInput)}
                placeholder={
                  areas.length === 0 && !drawnBbox
                    ? 'City, neighborhood, state, country, continent…'
                    : 'Add another area…'
                }
                className="flex-1 min-w-[180px] bg-transparent text-sm placeholder:text-muted-foreground/40 focus:outline-none"
              />
            </div>
            <p className="text-[10px] font-mono text-muted-foreground/40">
              {drawnBbox
                ? `Drawn: ${drawnBbox.minLat.toFixed(2)}°,${drawnBbox.minLng.toFixed(2)}° → ${drawnBbox.maxLat.toFixed(2)}°,${drawnBbox.maxLng.toFixed(2)}°`
                : 'e.g. "Adelaide" · "Melbourne" · "Texas" · "France"'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Step 2: Map ──────────────────────────────────────────────── */}
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
        placeholder="Type an area above — or click Draw Area to select on the map"
      />

      {/* ── Step 3: Search term + Fields + Launch ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_290px] gap-6">
        {/* Search term + warnings + submit */}
        <Card className="border-muted/30 bg-background/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-mono">What to Search</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search terms tag-input */}
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                Search Terms
                <span className="text-muted-foreground/40 normal-case font-sans font-normal text-[10px]">
                  press Enter or comma to add multiple
                </span>
              </label>

              {/* Pills + input */}
              <div
                className="min-h-[38px] w-full rounded-md border border-muted/40 bg-muted/10 px-2 py-1.5 flex flex-wrap gap-1.5 cursor-text focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/30 transition-colors"
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
                  placeholder={searchTerms.length === 0 ? "e.g. dental clinic, bowling alley…" : "Add another…"}
                  className="flex-1 min-w-[140px] bg-transparent text-sm placeholder:text-muted-foreground/40 focus:outline-none"
                />
              </div>

              {/* ICP suggestions */}
              {activeIcp && extractIcpSearchTerms(activeIcp).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="text-[10px] font-mono text-muted-foreground/50">ICP suggests:</span>
                  {extractIcpSearchTerms(activeIcp).map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => addTerm(term)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                        searchTerms.includes(term)
                          ? "bg-primary/15 border-primary/40 text-primary"
                          : "border-muted/30 text-muted-foreground hover:border-primary/30 hover:text-primary/80"
                      }`}
                    >
                      {searchTerms.includes(term) ? "✓ " : "+ "}{term}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Optional label */}
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                Job Label
                <span className="text-muted-foreground/40 normal-case font-sans font-normal text-[10px]">optional</span>
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Q3 Vegas Outreach"
                className="w-full rounded-md border border-muted/40 bg-muted/10 px-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {/* Deep mode notice */}
            {hasDetailFields && (
              <div className="flex items-start gap-2 text-blue-400/80 text-xs bg-blue-500/8 border border-blue-500/20 rounded-md p-3">
                <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>Deep mode active</strong> — Phone, Website, and/or Hours require visiting
                  each business's detail page. Richer data but slower per cell.
                </span>
              </div>
            )}

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

            <Button
              className="w-full"
              onClick={() => searchMut.mutate()}
              disabled={
                searchMut.isPending ||
                searchTerms.length === 0 ||
                (areas.length === 0 && !drawnBbox) ||
                overCellLimit
              }
            >
              {searchMut.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" /> Start Search
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Field selector */}
        <div className="space-y-4">
          <Card className="border-muted/30 bg-background/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-mono">Data Fields</CardTitle>
              <CardDescription className="text-xs">
                Choose which fields to extract
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Fast fields — scraped from feed, no extra page visits */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono font-semibold uppercase tracking-widest text-emerald-400/80">
                    Instant
                  </span>
                  <span className="text-[9px] text-muted-foreground/40 font-mono">
                    — scraped from feed, no extra page visits
                  </span>
                </div>
                {ALL_FIELDS.filter((f) => !DETAIL_FIELDS.includes(f)).map((f) => (
                  <label
                    key={f}
                    className={`flex items-center gap-2.5 p-2 rounded-md cursor-pointer transition-colors ${
                      selectedFields.has(f)
                        ? "bg-primary/10 border border-primary/20"
                        : "border border-muted/20 hover:border-muted/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFields.has(f)}
                      onChange={() => toggleField(f)}
                      className="accent-primary"
                    />
                    <span
                      className={`text-xs flex items-center gap-1.5 font-mono flex-1 ${
                        selectedFields.has(f) ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {FIELD_ICONS[f]}
                      {FIELD_LABELS[f]}
                    </span>
                  </label>
                ))}
              </div>

              {/* Divider */}
              <div className="border-t border-muted/20" />

              {/* Deep fields — require visiting each business's place page */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-mono font-semibold uppercase tracking-widest text-amber-400/80">
                    Deep
                  </span>
                  <span className="text-[9px] text-muted-foreground/40 font-mono">
                    — visits each place page, slower but richer
                  </span>
                </div>
                {ALL_FIELDS.filter((f) => DETAIL_FIELDS.includes(f)).map((f) => (
                  <label
                    key={f}
                    className={`flex items-center gap-2.5 p-2 rounded-md cursor-pointer transition-colors ${
                      selectedFields.has(f)
                        ? "bg-amber-500/10 border border-amber-500/25"
                        : "border border-muted/20 hover:border-amber-500/20"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFields.has(f)}
                      onChange={() => toggleField(f)}
                      className="accent-amber-500"
                    />
                    <span
                      className={`text-xs flex items-center gap-1.5 font-mono flex-1 ${
                        selectedFields.has(f) ? "text-amber-400" : "text-muted-foreground"
                      }`}
                    >
                      {FIELD_ICONS[f]}
                      {FIELD_LABELS[f]}
                    </span>
                  </label>
                ))}
                <p className="text-[10px] text-muted-foreground/40 pt-0.5 font-mono">
                  Business name always included. Deep fields add ~1–2 min per cell.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent jobs */}
      {jobsData && jobsData.jobs.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-mono text-muted-foreground uppercase tracking-wider">
            Recent Searches
          </h3>
          <div className="space-y-2">
            {jobsData.jobs.slice(0, 8).map((job) => (
              <button
                key={job.jobId}
                onClick={() => setActiveJobId(job.jobId)}
                className="w-full flex items-center justify-between gap-4 p-3 rounded-lg border border-muted/25 bg-background/40 hover:bg-background/70 transition-colors text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">"{job.config.label || job.config.searchTerm}"</p>
                  <p className="text-xs text-muted-foreground">
                    {job.config.scope === "city"
                      ? job.config.location
                      : job.config.scope === "country"
                      ? job.config.location
                      : job.config.scope === "continent"
                      ? job.config.location
                      : "Worldwide"}
                    {" · "}
                    {job.totalLeads.toLocaleString()} leads
                    {" · "}
                    {job.completedCells}/{job.totalCells} cells
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={job.status} />
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
