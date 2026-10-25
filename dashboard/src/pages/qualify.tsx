import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import * as XLSX from "xlsx";
import { useToast } from "@/hooks/use-toast";
import { qualifyApi, icpApi, crmApi, type LeadInput, type QualifyBatch, type LeadResult, type CrmTarget } from "@/lib/qualifyApi";
import { exportXlsx } from "@/lib/exportXlsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2, Upload, Play, Download, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, Globe, Settings, FileSpreadsheet, Info, Send,
  ArrowRight, FileText, Square, RotateCcw, PlusCircle,
  User, Mail, Phone, ExternalLink, Users, Copy, Check, Star,
} from "lucide-react";

// ── Inline copy button ────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); }); }}
      className="shrink-0 text-muted-foreground/30 hover:text-primary transition-colors"
      title="Copy"
    >
      {done ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5" />}
    </button>
  );
}

// ── Column alias map ──────────────────────────────────────────────────────────
const ALIASES: Record<string, string[]> = {
  name: [
    "name","company","venuename","businessname","venue","locationname","propertyname",
    "organization","brand","title","companyname","storename","placename","accountname",
    "contactname","firmname","entityname","tradingname","legalname","operator",
    // German / DACH
    "unternehmen","unternehmensname","firmenname","betrieb","name","bezeichnung",
    // Dutch
    "bedrijf","bedrijfsnaam",
    // French
    "entreprise","societe","nom",
  ],
  url: [
    "url","website","web","site","homepage","link","domain","websiteurl","siteurl",
    "webaddress","internetaddress","onlineaddress","www","urlwebsite","weburl",
    "companyweb","companywebsite","venuewebsite","businesswebsite",
    // German
    "webseite","internetseite","internetadresse",
    // Dutch
    "website","webpagina",
    // French
    "siteweb","siteinternet",
  ],
  category: [
    "category","type","venuetype","typeofvenue","industry","segment","businesstype",
    "verticale","niche","sector","vertical","businesscategory","venucategory",
    // German
    "kategorie","branche","typ",
  ],
  city: [
    "city","town","location","citylocation","municipality","locality","suburb",
    "district","area","place","metro",
    // German
    "stadt","ort","gemeinde",
    // Dutch
    "stad","plaats",
  ],
  state: ["state","province","stateprovince","region","county","territory","bundesland"],
  country: [
    "country","nation","countrycode","land",
    // German
    "land",
    // Dutch
    "land",
  ],
  notes: [
    "notes","note","comments","comment","remarks","description","details",
    "info","additional","extras","other","misc","observations","summary",
  ],
};

function norm(s: string) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ── Column mapping result ─────────────────────────────────────────────────────
interface ColMap {
  name: number;
  url: number;
  category: number;
  city: number;
  state: number;
  country: number;
  notes: number;       // first recognised notes col
  extraNotes: number[]; // all other unmapped cols
}

interface MappingSummary {
  colMap: ColMap;
  headers: string[];
  mappedFields: { field: string; header: string }[];
  notesHeaders: string[];
  unmappedCount: number;
}

function detectColumns(headers: string[], rows: string[][]): MappingSummary {
  const normed = headers.map(norm);
  const used = new Set<number>();

  // Step 1: alias match
  const colMap: ColMap = { name: -1, url: -1, category: -1, city: -1, state: -1, country: -1, notes: -1, extraNotes: [] };
  for (const field of Object.keys(ALIASES) as (keyof typeof ALIASES)[]) {
    for (const alias of ALIASES[field]) {
      const idx = normed.indexOf(alias);
      if (idx !== -1 && !used.has(idx)) {
        (colMap as Record<string, number>)[field] = idx;
        used.add(idx);
        break;
      }
    }
  }

  // Step 2: infer URL column by scoring every column — pick the one with the most URL-like cells
  if (colMap.url === -1) {
    const sample = rows.slice(0, 30);
    // Score: 3pts for http(s):// prefix, 2pts for www. prefix or obvious domain (x.tld), 1pt for URL-like substring
    const urlScore = (v: string) => {
      const s = v.trim();
      if (!s) return 0;
      if (/^https?:\/\//i.test(s)) return 3;
      if (/^www\./i.test(s)) return 2;
      if (/^[\w-]+\.(com|net|org|de|nl|fr|co\.uk|io|app|store|eu|at|ch|be|info|biz|online|shop|site|web)\b/i.test(s)) return 2;
      if (/https?:\/\//i.test(s)) return 1;   // URL embedded in longer text
      if (/\.\w{2,4}(\/|$)/.test(s) && !/^[\d.]+$/.test(s)) return 1; // loose domain guess
      return 0;
    };
    let bestCol = -1, bestScore = 0;
    for (let c = 0; c < headers.length; c++) {
      if (used.has(c)) continue;
      const score = sample.reduce((acc, r) => acc + urlScore(String(r[c] ?? "")), 0);
      if (score > bestScore) { bestScore = score; bestCol = c; }
    }
    if (bestCol !== -1 && bestScore >= 1) {
      colMap.url = bestCol;
      used.add(bestCol);
    }
  }

  // Step 3: infer name column — first non-numeric, non-url, non-empty text column
  if (colMap.name === -1) {
    for (let c = 0; c < headers.length; c++) {
      if (used.has(c)) continue;
      const sample = rows.slice(0, 10).map((r) => String(r[c] ?? "").trim()).filter(Boolean);
      const isText = sample.length > 0 && sample.every((v) => isNaN(Number(v)) && !(/^https?:\/\//i.test(v)));
      if (isText) {
        colMap.name = c;
        used.add(c);
        break;
      }
    }
  }

  // Step 4: remaining unmapped cols → notes
  const unmapped: number[] = [];
  for (let c = 0; c < headers.length; c++) {
    if (!used.has(c)) unmapped.push(c);
  }
  if (colMap.notes === -1 && unmapped.length > 0) {
    colMap.notes = unmapped.shift()!;
  }
  colMap.extraNotes = unmapped;

  // Build human-readable summary
  const fieldLabels: Record<string, string> = { name: "Name", url: "URL", category: "Category", city: "City", state: "State", country: "Country", notes: "Notes" };
  const mappedFields: { field: string; header: string }[] = [];
  for (const field of ["name", "url", "category", "city", "state", "country", "notes"] as const) {
    const idx = colMap[field];
    if (idx >= 0) mappedFields.push({ field: fieldLabels[field], header: headers[idx] || `Col ${idx + 1}` });
  }
  const notesHeaders = colMap.extraNotes.map((i) => headers[i] || `Col ${i + 1}`);

  return { colMap, headers, mappedFields, notesHeaders, unmappedCount: colMap.extraNotes.length };
}

// ── Row → LeadInput ───────────────────────────────────────────────────────────
function rowToLead(cols: string[], { colMap, headers }: MappingSummary): LeadInput | null {
  const get = (idx: number) => (idx >= 0 ? (cols[idx] ?? "").trim() : "");

  let url = get(colMap.url);
  if (url && !url.startsWith("http")) url = "https://" + url;

  // If a URL column was detected but this row has no value in it, skip the row —
  // the backend requires every lead to have a URL
  if (colMap.url !== -1 && !url) return null;

  const name = get(colMap.name) || url;
  if (!name && !url) return null;

  // Merge extra note columns
  const extraNotesParts = colMap.extraNotes.map((i) => {
    const h = headers[i] || `Col ${i + 1}`;
    const v = (cols[i] ?? "").trim();
    return v ? `${h}: ${v}` : "";
  }).filter(Boolean);

  const baseNotes = get(colMap.notes);
  const allNotes = [baseNotes, ...extraNotesParts].filter(Boolean).join(" | ");

  const state = get(colMap.state);
  const city = get(colMap.city);
  const cityFull = state ? (city ? `${city}, ${state}` : state) : city;

  return {
    name,
    url,
    category: get(colMap.category) || undefined,
    city: cityFull || undefined,
    country: get(colMap.country) || undefined,
    notes: allNotes || undefined,
  };
}

// ── Parsed file result ────────────────────────────────────────────────────────
interface ParsedFile {
  sheetNames: string[];
  activeSheet: string;
  rows: string[][];        // raw data rows (excluding header)
  headers: string[];
  summary: MappingSummary;
  leads: LeadInput[];
}

function buildParsedFile(wb: XLSX.WorkBook, sheetName: string): ParsedFile {
  const ws = wb.Sheets[sheetName];
  const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as string[][];
  if (raw.length < 2) return { sheetNames: wb.SheetNames, activeSheet: sheetName, rows: [], headers: [], summary: { colMap: { name: -1, url: -1, category: -1, city: -1, state: -1, country: -1, notes: -1, extraNotes: [] }, headers: [], mappedFields: [], notesHeaders: [], unmappedCount: 0 }, leads: [] };

  const headers = raw[0].map((h) => String(h ?? "").trim());
  const rows = raw.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== "")).map((r) => r.map((c) => String(c ?? "").trim()));
  const summary = detectColumns(headers, rows);
  const leads = rows.map((r) => rowToLead(r, summary)).filter(Boolean) as LeadInput[];

  return { sheetNames: wb.SheetNames, activeSheet: sheetName, rows, headers, summary, leads };
}

function parseCSVText(text: string): ParsedFile {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { sheetNames: [], activeSheet: "", rows: [], headers: [], summary: { colMap: { name: -1, url: -1, category: -1, city: -1, state: -1, country: -1, notes: -1, extraNotes: [] }, headers: [], mappedFields: [], notesHeaders: [], unmappedCount: 0 }, leads: [] };

  // Auto-detect delimiter: tab-separated if tabs outnumber commas in header line
  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delim = tabCount > commaCount ? "\t" : ",";

  const splitLine = (line: string): string[] => {
    if (delim === "\t") return line.split("\t").map((c) => c.trim().replace(/^"|"$/g, ""));
    const result: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        result.push(cur.trim()); cur = "";
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  };

  const headers = splitLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map(splitLine).filter((r) => r.some((c) => c.trim() !== ""));
  const summary = detectColumns(headers, rows);
  const leads = rows.map((r) => rowToLead(r, summary)).filter(Boolean) as LeadInput[];

  return { sheetNames: [], activeSheet: "", rows, headers, summary, leads };
}

// ── Column Mapping Preview ────────────────────────────────────────────────────
function ColMappingPreview({ summary }: {
  summary: MappingSummary;
}) {
  return (
    <div className="rounded-md border border-muted/40 bg-muted/5 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-mono text-muted-foreground flex items-center gap-1.5">
          <Info className="h-3 w-3" /> DETECTED COLUMNS
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {summary.mappedFields.map(({ field, header }) => (
          <span key={field} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-xs font-mono">
            <span className="text-primary">{field}</span>
            <span className="text-muted-foreground">← {header}</span>
          </span>
        ))}
        {summary.notesHeaders.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/30 border border-muted/40 text-xs font-mono text-muted-foreground">
            notes ← {summary.notesHeaders.join(", ")}
          </span>
        )}
      </div>
      {summary.colMap.url === -1 && (
        <p className="text-xs text-rose-400 flex items-center gap-1.5 mt-1">
          ✕ No URL column detected — each lead needs a website URL to be crawled and scored. Please check your file headers.
        </p>
      )}
    </div>
  );
}

// ── Score / Verdict / Status helpers ─────────────────────────────────────────
function ScoreBadge({ score, verdict }: { score: number | null; verdict: string | null }) {
  if (score === null) return <span className="text-muted-foreground font-mono text-xs">—</span>;
  const color =
    verdict === "QUALIFY"    ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
    verdict === "DISQUALIFY" ? "bg-rose-500/15 text-rose-400 border-rose-500/30" :
                               "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return (
    <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-mono font-bold text-sm ${color}`}>
      <span className="text-base">{score}</span>
      <span className="text-[10px] opacity-70">/100</span>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return null;
  const map: Record<string, { label: string; class: string }> = {
    QUALIFY:    { label: "QUALIFY",    class: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" },
    BORDERLINE: { label: "BORDERLINE", class: "bg-amber-500/10 text-amber-400 border-amber-500/25" },
    DISQUALIFY: { label: "DISQUALIFY", class: "bg-rose-500/10 text-rose-400 border-rose-500/25" },
  };
  const v = map[verdict] ?? { label: verdict, class: "bg-muted text-muted-foreground border-muted" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-mono font-semibold ${v.class}`}>{v.label}</span>;
}

// ── Signal helpers ────────────────────────────────────────────────────────────
function sigIcon(s: string): string {
  if (/machine|games?|cabinet|pinball|arcade/i.test(s)) return "🎮";
  if (/redemption|prize|ticket|skee/i.test(s)) return "🏆";
  if (/cashless|contactless|tap|kiosk|card system/i.test(s)) return "💳";
  if (/birthday|party|event|corporate|private/i.test(s)) return "🎂";
  if (/loyalty|member|reward|vip|points/i.test(s)) return "⭐";
  if (/laser/i.test(s)) return "🎯";
  if (/trampoline|jump/i.test(s)) return "🦘";
  if (/kart/i.test(s)) return "🏎";
  if (/bowling/i.test(s)) return "🎳";
  if (/escape/i.test(s)) return "🔐";
  if (/family|kids|children|all.?age/i.test(s)) return "👨‍👩‍👧";
  if (/multi.attract|attraction|entertainment/i.test(s)) return "🎪";
  if (/opportunity|no cashless|upgrade/i.test(s)) return "💡";
  if (/review|rating|star|★/i.test(s)) return "💬";
  if (/linkedin|employee|staff/i.test(s)) return "💼";
  if (/⚠|bar.*primary|verify|unconfirmed/i.test(s)) return "⚠️";
  if (/token|coin|quarter/i.test(s)) return "🪙";
  if (/largest|regional|national|chain/i.test(s)) return "🏆";
  if (/food|restaurant|dining/i.test(s)) return "🍔";
  if (/confirmed|present|active/i.test(s)) return "✓";
  return "·";
}

const SOCIAL_ICONS: Record<string, string> = {
  Facebook: "f", Instagram: "ig", LinkedIn: "in", Twitter: "𝕏",
  YouTube: "▶", TikTok: "tt",
};

const REVIEW_ICONS: Record<string, string> = {
  "Google Maps": "G", TripAdvisor: "TA", Yelp: "Y", Facebook: "f",
  Trustpilot: "★", Foursquare: "4SQ", "Booking.com": "B", "Google Play": "GP",
  Zomato: "Z",
};

function SigChip({ sig, variant = "auto" }: { sig: string; variant?: "auto" | "missing" }) {
  const isMissing = variant === "missing";
  const isWarn = !isMissing && /⚠|verify before|bar.*primary|unconfirmed/i.test(sig);
  const isOpportunity = !isMissing && !isWarn && /opportunity|no cashless|token|coin|upgrade/i.test(sig);
  const isPositive = !isMissing && !isWarn && !isOpportunity &&
    /machine|redemption|prize|cashless|loyalty|reward|confirmed|present|active|largest|★/i.test(sig);

  const styles = isMissing
    ? "bg-rose-500/8 border-rose-500/20 text-rose-400"
    : isWarn
    ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
    : isOpportunity
    ? "bg-violet-500/10 border-violet-500/20 text-violet-400"
    : isPositive
    ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-400"
    : "bg-muted/30 border-muted/40 text-muted-foreground";

  const icon = isMissing ? "✗" : sigIcon(sig);
  const label = sig.replace(/^⚠\s*/, "");

  return (
    <span
      title={label}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium max-w-[220px] ${styles}`}
    >
      <span className="text-[12px] leading-none shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </span>
  );
}

// ── Score arc (SVG circular gauge) ───────────────────────────────────────────
function ScoreArc({ score, verdict }: { score: number; verdict: string | null }) {
  const R = 38;
  const circ = 2 * Math.PI * R;
  const filled = circ * Math.min(Math.max(score, 0), 100) / 100;
  const color =
    verdict === "QUALIFY"    ? "#10b981" :
    verdict === "DISQUALIFY" ? "#f43f5e" : "#f59e0b";

  return (
    <svg viewBox="0 0 100 100" className="w-[88px] h-[88px] shrink-0">
      <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
      <circle
        cx="50" cy="50" r={R} fill="none"
        stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${filled} ${circ - filled}`}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="46" textAnchor="middle" dominantBaseline="middle"
        fill={color} style={{ fontSize: "22px", fontWeight: 700, fontFamily: "monospace" }}>
        {score}
      </text>
      <text x="50" y="62" textAnchor="middle" dominantBaseline="middle"
        fill="rgba(255,255,255,0.28)" style={{ fontSize: "8px", fontFamily: "monospace" }}>
        /100
      </text>
    </svg>
  );
}

// ── Signal row (replaces flat chips) ─────────────────────────────────────────
type SigVariant = "positive" | "opportunity" | "warn" | "missing" | "neutral";

function classifySignal(sig: string, isMissing: boolean): SigVariant {
  if (isMissing) return "missing";
  if (/⚠|verify before|bar.*primary|unconfirmed/i.test(sig)) return "warn";
  if (/opportunity|no cashless|token|coin|upgrade/i.test(sig)) return "opportunity";
  if (/machine|redemption|prize|cashless|loyalty|reward|confirmed|present|active|largest|★/i.test(sig)) return "positive";
  return "neutral";
}

const VARIANT_STYLES: Record<SigVariant, { border: string; text: string; bg: string }> = {
  positive:    { border: "border-l-emerald-500/60", text: "text-emerald-300/90",      bg: "bg-emerald-500/5"  },
  opportunity: { border: "border-l-violet-500/60",  text: "text-violet-300/90",       bg: "bg-violet-500/5"   },
  warn:        { border: "border-l-amber-500/60",   text: "text-amber-300/90",        bg: "bg-amber-500/5"    },
  missing:     { border: "border-l-rose-500/50",    text: "text-rose-400/80",         bg: "bg-rose-500/5"     },
  neutral:     { border: "border-l-muted/40",       text: "text-muted-foreground/80", bg: "bg-muted/10"       },
};

function SignalRow({ sig, isMissing = false }: { sig: string; isMissing?: boolean }) {
  const variant = classifySignal(sig, isMissing);
  const { border, text, bg } = VARIANT_STYLES[variant];
  const icon = isMissing ? "✗" : sigIcon(sig);
  const label = sig.replace(/^⚠\s*/, "");

  return (
    <div className={`flex items-center gap-2 border-l-[3px] ${border} ${bg} px-2.5 py-1.5 rounded-r-md`}>
      <span className="text-[13px] leading-none shrink-0 w-4 text-center">{icon}</span>
      <span className={`text-[11px] font-medium truncate ${text}`} title={label}>{label}</span>
    </div>
  );
}

// ── Collapsible section wrapper ───────────────────────────────────────────────
function CollapsibleSection({
  label,
  defaultOpen = true,
  count,
  children,
  labelColor = "text-muted-foreground/45",
}: {
  label: string;
  defaultOpen?: boolean;
  count?: number;
  children: React.ReactNode;
  labelColor?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-muted/20 pt-3 space-y-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full group"
      >
        <p className={`text-[10px] font-mono uppercase tracking-wider ${labelColor}`}>{label}</p>
        <div className="flex items-center gap-1.5">
          {count !== undefined && <span className="text-[10px] font-mono text-muted-foreground/35 tabular-nums">{count}</span>}
          {open
            ? <ChevronUp className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
            : <ChevronDown className="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />}
        </div>
      </button>
      {open && children}
    </div>
  );
}

// ── Lead intel panel (full dashboard card) ────────────────────────────────────
function LeadIntelPanel({ lead }: { lead: LeadResult }) {
  const hasScore = lead.score !== null;

  const verdictBorder =
    lead.verdict === "QUALIFY"    ? "border-emerald-500/40 bg-emerald-500/5" :
    lead.verdict === "DISQUALIFY" ? "border-rose-500/40 bg-rose-500/5" :
                                    "border-amber-500/40 bg-amber-500/5";
  const verdictText =
    lead.verdict === "QUALIFY"    ? "text-emerald-400" :
    lead.verdict === "DISQUALIFY" ? "text-rose-400" : "text-amber-400";
  const verdictChip =
    lead.verdict === "QUALIFY"    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
    lead.verdict === "DISQUALIFY" ? "bg-rose-500/10 border-rose-500/30 text-rose-400" :
                                    "bg-amber-500/10 border-amber-500/30 text-amber-400";

  const ss = lead.sourceSummary;
  const totalSigs = lead.keySignals.length + lead.missingSignals.length;
  const coveragePct = totalSigs > 0 ? Math.round((lead.keySignals.length / totalSigs) * 100) : 0;
  const coverageBar =
    lead.verdict === "QUALIFY" ? "bg-emerald-500/60" :
    lead.verdict === "DISQUALIFY" ? "bg-rose-500/60" : "bg-amber-500/60";

  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_260px] gap-px bg-muted/20 rounded-lg overflow-hidden border border-muted/25">

      {/* ── Left: Score + profile + analyst note + intel sources ─────────── */}
      <div className="bg-background/70 p-4 flex flex-col gap-3">

        {/* Score arc + verdict + venue meta */}
        <div className="flex items-start gap-3">
          {hasScore && <ScoreArc score={lead.score!} verdict={lead.verdict} />}
          <div className="flex flex-col gap-1.5 pt-1 min-w-0">
            {lead.verdict && (
              <span className={`inline-flex items-center self-start px-2 py-0.5 rounded border text-[10px] font-mono font-bold tracking-widest ${verdictChip}`}>
                {lead.verdict}
              </span>
            )}
            {lead.input.category && (
              <span className="text-[11px] text-muted-foreground font-medium truncate">{lead.input.category}</span>
            )}
            {(lead.input.city || lead.input.country) && (
              <span className="text-[11px] text-muted-foreground/60 truncate">
                {[lead.input.city, lead.input.country].filter(Boolean).join(", ")}
              </span>
            )}
          </div>
        </div>

        {/* Analyst note */}
        {lead.icpExplanation && (
          <div className="border-t border-muted/20 pt-3">
            <p className="text-[10px] font-mono text-muted-foreground/45 uppercase tracking-wider mb-1.5">Analyst note</p>
            <p className="text-[11px] text-muted-foreground/75 leading-relaxed italic line-clamp-5">
              "{lead.icpExplanation}"
            </p>
          </div>
        )}

        {/* Venue intel — collapsible */}
        {lead.venueIntel && (
          <CollapsibleSection label="Venue intel" defaultOpen={true}>
            <div className="space-y-1.5">
              {lead.venueIntel.estimatedMachineCount && lead.venueIntel.estimatedMachineCount !== "unknown" && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground/40 font-mono w-[52px] shrink-0">machines</span>
                  <span className="text-[11px] font-semibold text-foreground/80">{lead.venueIntel.estimatedMachineCount}</span>
                </div>
              )}
              {lead.venueIntel.paymentSystem && lead.venueIntel.paymentSystem !== "unknown" && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground/40 font-mono w-[52px] shrink-0">payment</span>
                  <span className="text-[11px] font-semibold text-foreground/80">{lead.venueIntel.paymentSystem}</span>
                </div>
              )}
              {lead.venueIntel.venueType && lead.venueIntel.venueType !== "unknown" && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground/40 font-mono w-[52px] shrink-0">type</span>
                  <span className="text-[11px] font-semibold text-foreground/80">{lead.venueIntel.venueType}</span>
                </div>
              )}
            </div>
            {/* Explicit ✓/✗ grid for all 5 boolean flags */}
            <div className="grid grid-cols-1 gap-0.5 mt-1">
              {([ 
                { key: "Redemption",  val: lead.venueIntel.hasRedemption },
                { key: "Loyalty",     val: lead.venueIntel.hasLoyalty },
                { key: "F&B",         val: lead.venueIntel.hasFoodBeverage },
                { key: "Party rooms", val: lead.venueIntel.hasPartyRooms },
                { key: "Chain",       val: lead.venueIntel.isChain },
              ] as const).map(({ key, val }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className={`text-[11px] font-mono font-bold leading-none ${val ? "text-emerald-400" : "text-muted-foreground/30"}`}>{val ? "✓" : "✗"}</span>
                  <span className={`text-[10px] font-mono ${val ? "text-foreground/70" : "text-muted-foreground/30"}`}>
                    {key}{key === "Chain" && val && lead.venueIntel!.chainName ? `: ${lead.venueIntel!.chainName}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Intel sources */}
        {ss && (
          <div className="border-t border-muted/20 pt-3 mt-auto">
            <p className="text-[10px] font-mono text-muted-foreground/45 uppercase tracking-wider mb-2">Intel sources</p>
            <div className="flex items-center gap-1.5 mb-2 text-[11px] text-muted-foreground/60 font-mono">
              <FileText className="h-3 w-3 shrink-0" />
              <span>{ss.pages} page{ss.pages !== 1 ? "s" : ""} crawled</span>
            </div>
            {ss.reviews.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {ss.reviews.map((r) => {
                  const label = REVIEW_ICONS[r.platform] ?? r.platform.slice(0, 3).toUpperCase();
                  const cls = "px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border bg-blue-500/10 border-blue-500/25 text-blue-400";
                  return r.url ? (
                    <a key={r.platform} href={r.url} title={r.platform} target="_blank" rel="noopener noreferrer"
                      className={`${cls} cursor-pointer hover:bg-blue-500/20 hover:border-blue-500/40 transition-colors`}>
                      {label}
                    </a>
                  ) : (
                    <span key={r.platform} title={r.platform} className={cls}>
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
            {ss.socials.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {ss.socials.map((s) => {
                  const label = SOCIAL_ICONS[s.platform] ?? s.platform.slice(0, 2).toUpperCase();
                  const cls = "px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border bg-violet-500/10 border-violet-500/25 text-violet-400";
                  return s.url ? (
                    <a key={s.platform} href={s.url} title={s.platform} target="_blank" rel="noopener noreferrer"
                      className={`${cls} cursor-pointer hover:bg-violet-500/20 hover:border-violet-500/40 transition-colors`}>
                      {label}
                    </a>
                  ) : (
                    <span key={s.platform} title={s.platform} className={cls}>
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Centre: Signal evidence ───────────────────────────────────────── */}
      <div className="bg-background/40 p-4">
        {lead.keySignals.length > 0 && (
          <div className={lead.missingSignals.length > 0 ? "mb-4" : ""}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono text-emerald-500/80 uppercase tracking-wider">Signals found</p>
              <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums">{lead.keySignals.length}</span>
            </div>
            <div className="flex flex-col gap-1">
              {lead.keySignals.map((s, i) => <SignalRow key={i} sig={s} />)}
            </div>
          </div>
        )}

        {lead.missingSignals.length > 0 && (
          <div className={lead.keySignals.length > 0 ? "border-t border-muted/15 pt-4" : ""}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono text-rose-400/70 uppercase tracking-wider">Gaps identified</p>
              <span className="text-[10px] font-mono text-muted-foreground/40 tabular-nums">{lead.missingSignals.length}</span>
            </div>
            <div className="flex flex-col gap-1">
              {lead.missingSignals.map((s, i) => <SignalRow key={i} sig={s} isMissing />)}
            </div>
          </div>
        )}

        {lead.keySignals.length === 0 && lead.missingSignals.length === 0 && (
          <p className="text-xs text-muted-foreground/40 italic">No signals extracted.</p>
        )}

        {/* Pain points — collapsible */}
        {(lead.painPoints ?? []).length > 0 && (
          <CollapsibleSection
            label="Pain points"
            defaultOpen={true}
            count={(lead.painPoints ?? []).length}
            labelColor="text-orange-400/70"
          >
            <div className="flex flex-col gap-1">
              {(lead.painPoints ?? []).map((pp, i) => (
                <div key={i} className="flex items-center gap-2 border-l-[3px] border-l-orange-500/50 bg-orange-500/5 px-2.5 py-1.5 rounded-r-md">
                  <span className="text-[13px] leading-none shrink-0 w-4 text-center">⚡</span>
                  <span className="text-[11px] font-medium truncate text-orange-300/80" title={pp}>{pp}</span>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Coverage summary */}
        {totalSigs > 0 && (
          <div className="mt-4 pt-3 border-t border-muted/15">
            <p className="text-[10px] font-mono text-muted-foreground/35 tabular-nums">
              {lead.keySignals.length} signals found · {lead.missingSignals.length} gap{lead.missingSignals.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>

      {/* ── Right: Next action + coverage bar ────────────────────────────── */}
      <div className="bg-background/70 p-4 flex flex-col gap-4">

        {/* Next action card */}
        <div className={`rounded-md border p-3 flex flex-col gap-2.5 flex-1 ${lead.recommendedAction ? verdictBorder : "border-muted/20 bg-muted/5"}`}>
          <div className="flex items-center gap-1.5">
            <ArrowRight className={`h-3.5 w-3.5 shrink-0 ${lead.recommendedAction ? verdictText : "text-muted-foreground/40"}`} />
            <p className="text-[10px] font-mono uppercase tracking-wider font-semibold text-muted-foreground/50">Next action</p>
          </div>
          <p className={`text-[12px] font-medium leading-relaxed ${lead.recommendedAction ? verdictText : "text-muted-foreground/40 italic"}`}>
            {lead.recommendedAction || "No action available."}
          </p>
        </div>

        {/* Outreach intel — collapsible */}
        {lead.outreachIntel && (lead.outreachIntel.pitchAngle || lead.outreachIntel.openingHook || lead.outreachIntel.competitorSystem) && (
          <CollapsibleSection label="Outreach intel" defaultOpen={true}>
            <div className="space-y-2.5">
              {lead.outreachIntel.pitchAngle && (
                <div>
                  <p className="text-[9px] font-mono text-muted-foreground/35 uppercase tracking-wider mb-1">Pitch angle</p>
                  <p className="text-[11px] text-sky-300/80 leading-relaxed">{lead.outreachIntel.pitchAngle}</p>
                </div>
              )}
              {lead.outreachIntel.openingHook && (
                <div>
                  <p className="text-[9px] font-mono text-muted-foreground/35 uppercase tracking-wider mb-1">Opening hook</p>
                  <p className="text-[11px] text-violet-300/80 leading-relaxed italic">"{lead.outreachIntel.openingHook}"</p>
                </div>
              )}
              {lead.outreachIntel.competitorSystem && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono text-muted-foreground/35 w-[56px] shrink-0">competitor</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-rose-500/10 border border-rose-500/20 text-rose-400">{lead.outreachIntel.competitorSystem}</span>
                </div>
              )}
              {lead.competitorAnalysis?.competitiveAngle && (
                <div className="flex items-start gap-1.5">
                  <span className="text-[9px] font-mono text-muted-foreground/35 w-[56px] shrink-0 pt-0.5">angle</span>
                  <p className="text-[10px] text-rose-300/70 leading-relaxed italic">{lead.competitorAnalysis.competitiveAngle}</p>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Decision makers — collapsible */}
        {lead.outreachIntel && (lead.outreachIntel.decisionMakers?.length > 0) && (
          <CollapsibleSection
            label="Decision makers"
            defaultOpen={true}
            count={lead.outreachIntel.decisionMakers.length}
            labelColor="text-emerald-400/60"
          >
            <div className="flex flex-col gap-2">
              {lead.outreachIntel.decisionMakers.map((dm, i) => (
                <div key={i} className="rounded-md border border-emerald-500/15 bg-emerald-500/5 px-2.5 py-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <User className="h-3 w-3 shrink-0 text-emerald-400/60" />
                    <span className="text-[11px] font-semibold text-foreground/85 truncate">{dm.name}</span>
                  </div>
                  {dm.title && (
                    <p className="text-[10px] text-muted-foreground/60 font-mono pl-[18px] truncate">{dm.title}</p>
                  )}
                  {dm.email && (
                    <div className="flex items-center gap-1 pl-[18px]">
                      <Mail className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
                      <a href={`mailto:${dm.email}`} className="text-[10px] text-sky-400/80 hover:text-sky-400 truncate transition-colors flex-1">{dm.email}</a>
                      <CopyBtn text={dm.email} />
                    </div>
                  )}
                  {dm.phone && (
                    <div className="flex items-center gap-1 pl-[18px]">
                      <Phone className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
                      <span className="text-[10px] font-mono text-muted-foreground/70 flex-1">{dm.phone}</span>
                      <CopyBtn text={dm.phone} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Social profiles — collapsible */}
        {(lead.socialProfiles ?? []).some((sp) => sp.bio || sp.followers || sp.postTone) && (
          <CollapsibleSection
            label="Social profiles"
            defaultOpen={false}
            count={(lead.socialProfiles ?? []).length}
            labelColor="text-violet-400/60"
          >
            <div className="flex flex-col gap-2">
              {(lead.socialProfiles ?? []).map((sp, i) => (
                <div key={i} className="rounded-md border border-violet-500/15 bg-violet-500/5 px-2.5 py-2 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono font-semibold text-violet-400/80">{SOCIAL_ICONS[sp.platform] ?? sp.platform.slice(0, 2).toUpperCase()}</span>
                      <span className="text-[10px] font-medium text-foreground/70">{sp.platform}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {sp.followers && (
                        <span className="text-[9px] font-mono text-muted-foreground/50 tabular-nums">{sp.followers}</span>
                      )}
                      {sp.url && (
                        <a href={sp.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground/30 hover:text-violet-400/70 transition-colors">
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  </div>
                  {sp.bio && (
                    <p className="text-[10px] text-muted-foreground/60 leading-relaxed line-clamp-2 italic">"{sp.bio}"</p>
                  )}
                  {sp.postTone && (
                    <p className="text-[9px] text-muted-foreground/40 font-mono">tone: {sp.postTone}</p>
                  )}
                  {sp.categoryTags && sp.categoryTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {sp.categoryTags.slice(0, 3).map((tag, j) => (
                        <span key={j} className="px-1 py-0.5 rounded text-[9px] font-mono bg-violet-500/10 border border-violet-500/20 text-violet-400/70">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Review intelligence — compact block */}
        {lead.reviewAnalysis && (lead.reviewAnalysis.strengths.length > 0 || lead.reviewAnalysis.weaknesses.length > 0) && (
          <CollapsibleSection
            label="Customer reviews"
            defaultOpen={true}
            labelColor="text-amber-400/60"
          >
            <div className="space-y-2">
              {/* Sentiment badge */}
              {lead.reviewAnalysis.sentiment && (() => {
                const s = lead.reviewAnalysis!.sentiment;
                const cls =
                  s === "Excellent" ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400" :
                  s === "Good"      ? "bg-sky-500/10 border-sky-500/25 text-sky-400" :
                  s === "Mixed"     ? "bg-amber-500/10 border-amber-500/25 text-amber-400" :
                                      "bg-rose-500/10 border-rose-500/25 text-rose-400";
                return (
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono font-semibold ${cls}`}>
                    <Star className="h-2.5 w-2.5" /> {s}
                  </span>
                );
              })()}
              {/* Top 2 strengths */}
              {lead.reviewAnalysis.strengths.slice(0, 2).map((s, i) => (
                <div key={i} className="border-l-[3px] border-l-emerald-500/40 bg-emerald-500/5 px-2 py-1 rounded-r-md">
                  <p className="text-[10px] font-medium text-emerald-300/80 truncate" title={s.summary}>✓ {s.summary}</p>
                  {s.quote && (
                    <p className="text-[9px] text-muted-foreground/50 italic truncate">"{s.quote}"</p>
                  )}
                </div>
              ))}
              {/* Top 1 weakness */}
              {lead.reviewAnalysis.weaknesses.slice(0, 1).map((w, i) => (
                <div key={i} className="border-l-[3px] border-l-rose-500/40 bg-rose-500/5 px-2 py-1 rounded-r-md">
                  <p className="text-[10px] font-medium text-rose-400/80 truncate" title={w.summary}>⚠ {w.summary}</p>
                  {w.quote && (
                    <p className="text-[9px] text-muted-foreground/50 italic truncate">"{w.quote}"</p>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Signal coverage bar */}
        {totalSigs > 0 && (
          <div className="border-t border-muted/20 pt-3 mt-auto">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-mono text-muted-foreground/45 uppercase tracking-wider">Signal coverage</p>
              <span className="text-[10px] font-mono text-muted-foreground/45 tabular-nums">{coveragePct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted/20 overflow-hidden mb-2">
              <div className={`h-full rounded-full ${coverageBar}`} style={{ width: `${coveragePct}%` }} />
            </div>
            <div className="flex justify-between">
              <span className="text-[9px] text-muted-foreground/35 font-mono">{lead.keySignals.length} found</span>
              <span className="text-[9px] text-muted-foreground/35 font-mono">{lead.missingSignals.length} gaps</span>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}

function StatusIcon({ status }: { status: LeadResult["status"] }) {
  switch (status) {
    case "done":    return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
    case "failed":  return <XCircle className="h-4 w-4 text-rose-500 shrink-0" />;
    case "crawling":return <Globe className="h-4 w-4 text-blue-400 animate-pulse shrink-0" />;
    case "scoring": return <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />;
    default:        return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

// ── CRM push status per lead ──────────────────────────────────────────────────
type LeadPushStatus = "idle" | "pushing" | "done" | "error";

// ── Lead row ──────────────────────────────────────────────────────────────────
function LeadRow({
  lead,
  selectedCrm,
  onPushLead,
  autoExpand = false,
}: {
  lead: LeadResult;
  selectedCrm: CrmTarget;
  onPushLead: (lead: LeadResult) => Promise<void>;
  autoExpand?: boolean;
}) {
  const [expanded, setExpanded] = useState(autoExpand);
  const [pushStatus, setPushStatus] = useState<LeadPushStatus>("idle");
  const isProcessing = lead.status === "crawling" || lead.status === "scoring" || lead.status === "pending";
  const isDone = lead.status === "done";
  const previewSigs = lead.keySignals.slice(0, 2);
  const extraCount = lead.keySignals.length - previewSigs.length;

  const handlePush = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setPushStatus("pushing");
    try {
      await onPushLead(lead);
      setPushStatus("done");
    } catch {
      setPushStatus("error");
    }
  };

  const crmLabel = selectedCrm === "hubspot" ? "HubSpot" : "Salesforce";

  return (
    <>
      <tr className="border-b border-muted/40 hover:bg-muted/10 cursor-pointer transition-colors" onClick={() => setExpanded(!expanded)}>
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            <StatusIcon status={lead.status} />
            <div className="min-w-0">
              <p className="font-medium text-sm">{lead.input.name}</p>
              {lead.input.url && (
                <a href={lead.input.url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-primary truncate block max-w-[220px]"
                  onClick={(e) => e.stopPropagation()}>
                  {lead.input.url.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              )}
              {!isProcessing && previewSigs.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {previewSigs.map((s, i) => <SigChip key={i} sig={s} />)}
                  {extraCount > 0 && (
                    <span className="text-[11px] text-muted-foreground self-center">+{extraCount} more</span>
                  )}
                </div>
              )}
              {/* Intel preview row — pain points + social + review badges */}
              {isDone && (
                <div className="flex flex-wrap items-center gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                  {(lead.painPoints ?? []).length > 0 && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono bg-orange-500/10 border border-orange-500/20 text-orange-400">
                      ⚡ {(lead.painPoints ?? []).length} pain point{(lead.painPoints ?? []).length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {(lead.sourceSummary?.reviews ?? []).map((r) => (
                    r.url
                      ? <a key={r.platform} href={r.url} target="_blank" rel="noopener noreferrer"
                          title={r.platform}
                          className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border bg-blue-500/10 border-blue-500/25 text-blue-400 hover:bg-blue-500/20 transition-colors">
                          {REVIEW_ICONS[r.platform] ?? r.platform.slice(0,3).toUpperCase()}
                        </a>
                      : <span key={r.platform} title={r.platform}
                          className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border bg-blue-500/10 border-blue-500/25 text-blue-400">
                          {REVIEW_ICONS[r.platform] ?? r.platform.slice(0,3).toUpperCase()}
                        </span>
                  ))}
                  {(lead.sourceSummary?.socials ?? []).map((s) => (
                    s.url
                      ? <a key={s.platform} href={s.url} target="_blank" rel="noopener noreferrer"
                          title={s.platform}
                          className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border bg-violet-500/10 border-violet-500/25 text-violet-400 hover:bg-violet-500/20 transition-colors">
                          {SOCIAL_ICONS[s.platform] ?? s.platform.slice(0,2).toUpperCase()}
                        </a>
                      : <span key={s.platform} title={s.platform}
                          className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border bg-violet-500/10 border-violet-500/25 text-violet-400">
                          {SOCIAL_ICONS[s.platform] ?? s.platform.slice(0,2).toUpperCase()}
                        </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </td>
        <td className="py-3 px-4 text-xs text-muted-foreground">
          {lead.input.category && <span className="block">{lead.input.category}</span>}
          {lead.input.city && <span>{lead.input.city}{lead.input.country ? `, ${lead.input.country}` : ""}</span>}
        </td>
        <td className="py-3 px-4"><ScoreBadge score={lead.score} verdict={lead.verdict} /></td>
        <td className="py-3 px-4"><VerdictBadge verdict={lead.verdict} /></td>
        <td className="py-3 px-4 text-xs text-muted-foreground max-w-[240px]">
          <p className="line-clamp-2">{lead.icpExplanation || (lead.error ? `Error: ${lead.error}` : "Processing...")}</p>
        </td>
        <td className="py-3 px-4 text-right">
          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
            {isDone && (
              <button
                onClick={handlePush}
                disabled={pushStatus === "pushing" || pushStatus === "done"}
                title={pushStatus === "done" ? `Pushed to ${crmLabel}` : `Push to ${crmLabel}`}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono transition-colors
                  ${pushStatus === "done"
                    ? "bg-emerald-500/15 text-emerald-400 cursor-default"
                    : pushStatus === "error"
                    ? "bg-rose-500/15 text-rose-400 hover:bg-rose-500/25"
                    : pushStatus === "pushing"
                    ? "bg-muted/30 text-muted-foreground cursor-wait"
                    : "bg-muted/20 text-muted-foreground hover:bg-primary/15 hover:text-primary"
                  }`}
              >
                {pushStatus === "pushing" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : pushStatus === "done" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                {pushStatus === "done" ? "PUSHED" : pushStatus === "error" ? "RETRY" : "PUSH"}
              </button>
            )}
            {isDone && (
              <button
                onClick={() => setExpanded(!expanded)}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono transition-colors
                  ${expanded
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "bg-muted/20 text-muted-foreground hover:bg-primary/10 hover:text-primary border border-transparent"
                  }`}
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                INTEL
              </button>
            )}
            {!isDone && (
              expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-muted/40">
          <td colSpan={6} className="px-4 py-3 bg-muted/5">
            <LeadIntelPanel lead={lead} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Export ────────────────────────────────────────────────────────────────────

// ── Main component ────────────────────────────────────────────────────────────
export function Qualify() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const search = useSearch();
  const fileRef = useRef<HTMLInputElement>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(() => {
    const params = new URLSearchParams(search);
    return params.get("batch");
  });
  const [fromDeepLink] = useState<boolean>(() => {
    const params = new URLSearchParams(search);
    return !!params.get("batch");
  });
  const [leads, setLeads] = useState<LeadInput[]>([]);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "paste">("file");
  const [selectedCrm, setSelectedCrm] = useState<CrmTarget>("hubspot");
  const [bulkPushStatus, setBulkPushStatus] = useState<"idle" | "pushing" | "done" | "error">("idle");
  const [verdictTab, setVerdictTab] = useState<"ALL" | "QUALIFY" | "BORDERLINE" | "DISQUALIFY">("ALL");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const { data: icp } = useQuery({ queryKey: ["icp-active"], queryFn: icpApi.getActive });

  const { data: batch } = useQuery({
    queryKey: ["qualify-batch", activeBatchId],
    queryFn: () => qualifyApi.getBatch(activeBatchId!),
    enabled: !!activeBatchId,
    refetchInterval: (query) => {
      const d = query.state.data;
      return !d || d.status === "done" || d.status === "failed" ? false : 2000;
    },
  });

  const submitMutation = useMutation({
    mutationFn: (l: LeadInput[]) => qualifyApi.submit(l),
    onSuccess: (res) => {
      setActiveBatchId(res.batchId);
      toast({ title: "Batch submitted", description: `Qualifying ${res.totalCount} leads…` });
    },
    onError: (err: Error) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => qualifyApi.stopBatch(activeBatchId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qualify-batch", activeBatchId] });
      toast({ title: "Batch stopped", description: "The qualification job was cancelled." });
    },
    onError: (err: Error) => {
      toast({ title: "Stop failed", description: err.message, variant: "destructive" });
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => qualifyApi.retryBatch(activeBatchId!),
    onSuccess: (res) => {
      setActiveBatchId(res.batchId);
      setElapsedSeconds(0);
      setBulkPushStatus("idle");
      setVerdictTab("ALL");
      toast({ title: "Retrying", description: `Re-queued ${res.totalCount} incomplete leads.` });
    },
    onError: (err: Error) => {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    },
  });

  const applyParsed = (p: ParsedFile) => {
    if (p.leads.length === 0) {
      toast({ title: "No leads found", description: "Could not find any rows with a name or URL. Check the mapping below.", variant: "destructive" });
    }
    setParsed(p);
    setLeads(p.leads);
  };

  const handleFile = useCallback((file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls" || ext === "ods") {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        setWorkbook(wb);
        applyParsed(buildParsedFile(wb, wb.SheetNames[0]));
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setWorkbook(null);
        applyParsed(parseCSVText(text));
      };
      reader.readAsText(file);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleSheetChange = (sheetName: string) => {
    if (!workbook) return;
    applyParsed(buildParsedFile(workbook, sheetName));
  };

  const handlePaste = () => {
    setWorkbook(null);
    applyParsed(parseCSVText(pasteText));
  };

  const leadToPayload = (lead: LeadResult) => ({
    name: lead.input.name,
    url: lead.input.url,
    category: lead.input.category,
    city: lead.input.city,
    country: lead.input.country,
    score: lead.score,
    verdict: lead.verdict,
    keySignals: lead.keySignals,
    missingSignals: lead.missingSignals,
    icpExplanation: lead.icpExplanation,
    recommendedAction: lead.recommendedAction,
  });

  const pushLead = async (lead: LeadResult) => {
    const result = await crmApi.push({ crm: selectedCrm, leads: [leadToPayload(lead)] });
    if (result.failed > 0) throw new Error(result.errors[0] ?? "Push failed");
  };

  const pushBulkQualified = async () => {
    if (!batch) return;
    const qualified = batch.leads.filter((l) => l.verdict === "QUALIFY" && l.status === "done");
    if (qualified.length === 0) return;
    setBulkPushStatus("pushing");
    try {
      const result = await crmApi.push({ crm: selectedCrm, leads: qualified.map(leadToPayload) });
      setBulkPushStatus(result.failed === 0 ? "done" : "error");
      const crmLabel = selectedCrm === "hubspot" ? "HubSpot" : "Salesforce";
      if (result.pushed > 0) {
        toast({
          title: `Pushed to ${crmLabel}`,
          description: `${result.pushed} lead${result.pushed !== 1 ? "s" : ""} sent${result.failed > 0 ? `, ${result.failed} failed` : ""}`,
        });
      }
      if (result.failed > 0) {
        toast({ title: "Some pushes failed", description: result.errors.slice(0, 3).join(" · "), variant: "destructive" });
      }
    } catch (err) {
      setBulkPushStatus("error");
      toast({ title: "CRM push failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const isDone = batch?.status === "done" || batch?.status === "failed";
  const progress = batch ? Math.round((batch.completedCount / batch.totalCount) * 100) : 0;
  const qualifyCount    = batch?.leads.filter((l) => l.verdict === "QUALIFY").length    ?? 0;
  const borderlineCount = batch?.leads.filter((l) => l.verdict === "BORDERLINE").length ?? 0;
  const disqualifyCount = batch?.leads.filter((l) => l.verdict === "DISQUALIFY").length ?? 0;

  useEffect(() => {
    if (!batch || isDone) return;
    const start = new Date(batch.createdAt).getTime();
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [batch?.batchId, isDone]);

  useEffect(() => {
    if (isDone && qualifyCount > 0) {
      setVerdictTab("QUALIFY");
    }
  }, [isDone, qualifyCount]);

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-mono font-bold tracking-tight mb-2">LEAD_QUALIFIER</h1>
          <p className="text-muted-foreground">
            Upload any CSV or Excel file — we detect columns automatically and crawl each lead.
            {icp && <span className="text-primary ml-1 font-mono text-sm">[ {icp.name} ]</span>}
          </p>
        </div>
        <Link href="/icp">
          <Button variant="outline" size="sm" className="font-mono text-xs">
            <Settings className="h-3 w-3 mr-1" /> ICP SETTINGS
          </Button>
        </Link>
      </div>

      {!activeBatchId && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Upload panel */}
          <Card className="border-muted/50 bg-card/50">
            <CardHeader>
              <div className="flex gap-2 mb-1">
                <button
                  className={`text-xs font-mono px-3 py-1 rounded ${inputMode === "file" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  onClick={() => setInputMode("file")}
                >FILE UPLOAD</button>
                <button
                  className={`text-xs font-mono px-3 py-1 rounded ${inputMode === "paste" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                  onClick={() => setInputMode("paste")}
                >PASTE CSV</button>
              </div>
              <CardDescription>
                Any column layout — headers are detected automatically. Supports CSV, Excel (.xlsx/.xls), and tab-separated files.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {inputMode === "file" ? (
                <div
                  className="border-2 border-dashed border-muted rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileRef.current?.click()}
                >
                  <FileSpreadsheet className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Drop a CSV or Excel file here, or click to browse</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">.csv · .xlsx · .xls · .ods · .txt — any column layout</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.txt,.xlsx,.xls,.ods"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={"name,url,category,city\nAcme Arcade,https://acmearcade.com,FEC,Chicago\nFun Zone,https://funzone.com,Barcade,Austin"}
                    className="w-full h-36 bg-background/50 border border-muted rounded-md px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:border-primary"
                  />
                  <Button variant="outline" size="sm" className="w-full font-mono text-xs" onClick={handlePaste}>
                    PARSE CSV
                  </Button>
                </div>
              )}

              {/* Sheet picker — shown prominently when file has multiple sheets */}
              {parsed && parsed.sheetNames.length > 1 && (
                <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
                  <FileSpreadsheet className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                  <span className="text-xs font-mono text-muted-foreground shrink-0">Sheet</span>
                  <select
                    value={parsed.activeSheet}
                    onChange={(e) => handleSheetChange(e.target.value)}
                    className="flex-1 text-xs bg-background border border-muted rounded px-2 py-1 font-mono focus:outline-none focus:border-primary cursor-pointer"
                  >
                    {parsed.sheetNames.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0">{parsed.sheetNames.length} sheets</span>
                </div>
              )}

              {/* Column mapping preview */}
              {parsed && (
                <ColMappingPreview summary={parsed.summary} />
              )}
            </CardContent>
          </Card>

          {/* Loaded leads panel */}
          <Card className="border-muted/50 bg-card/50">
            <CardHeader>
              <CardTitle className="text-base">Loaded Leads</CardTitle>
              <CardDescription>{leads.length} lead{leads.length !== 1 ? "s" : ""} ready for qualification</CardDescription>
            </CardHeader>
            <CardContent>
              {leads.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border border-dashed border-muted rounded-lg">
                  <Upload className="h-6 w-6 mx-auto mb-2 opacity-40" />
                  <p className="font-mono text-sm">NO_LEADS_LOADED</p>
                  <p className="text-xs mt-1">Upload a CSV or Excel file to get started</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border border-muted/50 overflow-hidden max-h-[220px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/20 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 font-mono text-muted-foreground">NAME</th>
                          <th className="text-left px-3 py-2 font-mono text-muted-foreground">URL</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leads.map((l, i) => (
                          <tr key={i} className="border-t border-muted/30">
                            <td className="px-3 py-2">{l.name}</td>
                            <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]">
                              {l.url ? l.url.replace(/^https?:\/\/(www\.)?/, "") : <span className="text-muted-foreground/40 italic">no url</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parsed?.summary.colMap.url === -1 && (
                    <p className="text-xs text-rose-400 text-center font-mono">
                      ✕ Cannot qualify — no URL column found. Check file headers or try a different sheet.
                    </p>
                  )}
                  <Button
                    className="w-full font-mono font-bold"
                    onClick={() => submitMutation.mutate(leads)}
                    disabled={submitMutation.isPending || parsed?.summary.colMap.url === -1}
                  >
                    {submitMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                    QUALIFY {leads.length} LEADS
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Results */}
      {activeBatchId && batch && (
        <div className="space-y-4">
          <Card className="border-muted/50 bg-card/50">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  {!isDone ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                  <div>
                    <p className="font-mono font-bold text-sm">{isDone ? "QUALIFICATION COMPLETE" : "QUALIFYING LEADS..."}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>{batch.completedCount} / {batch.totalCount} processed</span>
                      {batch.icpSnapshot && <span className="text-primary">[ {batch.icpSnapshot} ]</span>}
                      {!isDone && (
                        <span className="font-mono tabular-nums text-amber-400/80 flex items-center gap-1">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                          {formatElapsed(elapsedSeconds)}
                        </span>
                      )}
                      {isDone && elapsedSeconds > 0 && (
                        <span className="font-mono tabular-nums text-muted-foreground/50">
                          in {formatElapsed(elapsedSeconds)}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {/* Stop button — only while running */}
                  {!isDone && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-mono text-xs border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                      onClick={() => stopMutation.mutate()}
                      disabled={stopMutation.isPending}
                    >
                      {stopMutation.isPending
                        ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        : <Square className="h-3 w-3 mr-1 fill-current" />}
                      STOP
                    </Button>
                  )}
                  {/* CRM picker */}
                  <div className="flex rounded-md border border-muted/50 overflow-hidden text-xs font-mono">
                    <button
                      onClick={() => { setSelectedCrm("hubspot"); setBulkPushStatus("idle"); }}
                      className={`px-2.5 py-1 transition-colors ${selectedCrm === "hubspot" ? "bg-orange-500/20 text-orange-300 border-r border-muted/50" : "text-muted-foreground hover:bg-muted/20 border-r border-muted/50"}`}
                    >
                      HubSpot
                    </button>
                    <button
                      onClick={() => { setSelectedCrm("salesforce"); setBulkPushStatus("idle"); }}
                      className={`px-2.5 py-1 transition-colors ${selectedCrm === "salesforce" ? "bg-blue-500/20 text-blue-300" : "text-muted-foreground hover:bg-muted/20"}`}
                    >
                      Salesforce
                    </button>
                  </div>
                  {/* Bulk push — qualified leads */}
                  {isDone && qualifyCount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      className={`font-mono text-xs ${bulkPushStatus === "done" ? "border-emerald-500/40 text-emerald-400" : bulkPushStatus === "error" ? "border-rose-500/40 text-rose-400" : ""}`}
                      onClick={pushBulkQualified}
                      disabled={bulkPushStatus === "pushing" || bulkPushStatus === "done"}
                    >
                      {bulkPushStatus === "pushing" ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : bulkPushStatus === "done" ? (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      ) : (
                        <Send className="h-3 w-3 mr-1" />
                      )}
                      {bulkPushStatus === "done"
                        ? "PUSHED"
                        : bulkPushStatus === "pushing"
                        ? "PUSHING..."
                        : `PUSH ${qualifyCount} QUALIFIED`}
                    </Button>
                  )}
                  {isDone && (
                    <Button size="sm" variant="outline" className="font-mono text-xs" onClick={() => exportXlsx(batch)}>
                      <Download className="h-3 w-3 mr-1" /> EXPORT XLSX
                    </Button>
                  )}
                  {isDone && batch.leads.some((l) => l.status !== "done") && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="font-mono text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                      onClick={() => retryMutation.mutate()}
                      disabled={retryMutation.isPending}
                    >
                      {retryMutation.isPending
                        ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        : <RotateCcw className="h-3 w-3 mr-1" />}
                      RETRY INCOMPLETE
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="font-mono text-xs text-muted-foreground"
                    onClick={() => { setActiveBatchId(null); setLeads([]); setParsed(null); setBulkPushStatus("idle"); setVerdictTab("ALL"); setElapsedSeconds(0); }}
                  >
                    <PlusCircle className="h-3 w-3 mr-1" /> NEW BATCH
                  </Button>
                </div>
              </div>
              <Progress value={progress} className="h-1.5" />
              {/* Proportional qualify/disqualify bar — mint=qualified, rose=disqualified */}
              {batch.completedCount > 0 && (
                <div className="flex h-1.5 rounded-full overflow-hidden bg-muted/30 mt-1.5">
                  {qualifyCount > 0 && (
                    <div
                      className="h-full bg-emerald-500 transition-all duration-700 ease-out"
                      style={{ width: `${(qualifyCount / batch.completedCount) * 100}%` }}
                    />
                  )}
                  {disqualifyCount > 0 && (
                    <div
                      className="h-full bg-rose-500 transition-all duration-700 ease-out ml-px"
                      style={{ width: `${(disqualifyCount / batch.completedCount) * 100}%` }}
                    />
                  )}
                </div>
              )}
              {/* Live 4-tile stats: Total / Qualified / Disqualified / Processed — visible during running AND done */}
              <div className="grid grid-cols-4 gap-2 mt-3">
                <div className="rounded-lg bg-muted/20 border border-muted/30 p-3 text-center">
                  <p className="text-2xl font-mono font-bold text-foreground">{batch.totalCount}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">Total</p>
                </div>
                <div className={`rounded-lg border p-3 text-center transition-colors ${qualifyCount > 0 ? "bg-emerald-500/10 border-emerald-500/20" : "bg-muted/20 border-muted/30"}`}>
                  <p className={`text-2xl font-mono font-bold ${qualifyCount > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>{qualifyCount}</p>
                  <p className={`text-[10px] mt-0.5 uppercase tracking-wider ${qualifyCount > 0 ? "text-emerald-400/70" : "text-muted-foreground"}`}>Qualified</p>
                </div>
                <div className={`rounded-lg border p-3 text-center transition-colors ${disqualifyCount > 0 ? "bg-rose-500/10 border-rose-500/20" : "bg-muted/20 border-muted/30"}`}>
                  <p className={`text-2xl font-mono font-bold ${disqualifyCount > 0 ? "text-rose-400" : "text-muted-foreground"}`}>{disqualifyCount}</p>
                  <p className={`text-[10px] mt-0.5 uppercase tracking-wider ${disqualifyCount > 0 ? "text-rose-400/70" : "text-muted-foreground"}`}>Disqualified</p>
                </div>
                <div className={`rounded-lg border p-3 text-center transition-colors ${batch.completedCount > 0 ? "bg-violet-500/10 border-violet-500/20" : "bg-muted/20 border-muted/30"}`}>
                  <p className={`text-2xl font-mono font-bold ${batch.completedCount > 0 ? "text-violet-400" : "text-muted-foreground"}`}>{batch.completedCount}</p>
                  <p className={`text-[10px] mt-0.5 uppercase tracking-wider ${batch.completedCount > 0 ? "text-violet-400/70" : "text-muted-foreground"}`}>Processed</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {batch.leads.length > 0 && (() => {
            const allCount = batch.leads.length;
            const sortedLeads = batch.leads.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
            const filteredLeads = verdictTab === "ALL"
              ? sortedLeads
              : sortedLeads.filter((l) => l.verdict === verdictTab);

            const tabs: { label: string; value: typeof verdictTab; count: number; activeClass: string }[] = [
              { label: "ALL", value: "ALL", count: allCount, activeClass: "bg-muted/60 text-foreground border-muted" },
              { label: "QUALIFY", value: "QUALIFY", count: qualifyCount, activeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
              { label: "BORDERLINE", value: "BORDERLINE", count: borderlineCount, activeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
              { label: "DISQUALIFY", value: "DISQUALIFY", count: disqualifyCount, activeClass: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
            ];

            return (
              <Card className="border-muted/50 bg-card/50 overflow-hidden">
                <CardHeader className="pb-0">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Results</CardTitle>
                  </div>
                  {/* Verdict filter tabs */}
                  <div className="flex gap-1.5 mt-3 flex-wrap">
                    {tabs.map((tab) => (
                      <button
                        key={tab.value}
                        onClick={() => setVerdictTab(tab.value)}
                        className={`px-3 py-1 rounded-md border text-xs font-mono transition-colors ${
                          verdictTab === tab.value
                            ? tab.activeClass
                            : "bg-transparent text-muted-foreground border-muted/40 hover:border-muted hover:text-foreground"
                        }`}
                      >
                        {tab.label} ({tab.count})
                      </button>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className="p-0 mt-3">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/20 border-y border-muted/40">
                        <tr>
                          <th className="text-left px-4 py-2.5 font-mono text-xs text-muted-foreground">COMPANY</th>
                          <th className="text-left px-4 py-2.5 font-mono text-xs text-muted-foreground">LOCATION</th>
                          <th className="text-left px-4 py-2.5 font-mono text-xs text-muted-foreground">SCORE</th>
                          <th className="text-left px-4 py-2.5 font-mono text-xs text-muted-foreground">VERDICT</th>
                          <th className="text-left px-4 py-2.5 font-mono text-xs text-muted-foreground">EXPLANATION</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredLeads.map((lead, i) => (
                          <LeadRow key={lead.leadId} lead={lead} selectedCrm={selectedCrm} onPushLead={pushLead} autoExpand={fromDeepLink && i === 0} />
                        ))}
                        {filteredLeads.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-xs font-mono">
                              NO_{verdictTab}_LEADS
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      )}
    </div>
  );
}
