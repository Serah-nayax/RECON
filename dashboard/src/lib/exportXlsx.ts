import ExcelJS from "exceljs";
import type { QualifyBatch, LeadResult } from "./qualifyApi";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  white:  "FFFFFFFF",
  // Group accent colours (row 1 = group header, row 2 = col header)
  g1: { h1: "FF0F172A", h2: "FF1E293B" },  // Lead Identity   — slate
  g2: { h1: "FF064E3B", h2: "FF065F46" },  // Qualification   — emerald
  g3: { h1: "FF78350F", h2: "FF92400E" },  // Signals         — amber
  g4: { h1: "FF3B0764", h2: "FF4C1D95" },  // Outreach Intel  — violet
  g5: { h1: "FF0C4A6E", h2: "FF075985" },  // Venue Profile   — sky
  g6: { h1: "FF1F2937", h2: "FF374151" },  // Metadata        — gray
  // Verdict row fills
  qualifyBg:    "FFD1FAE5", qualifyFg:    "FF065F46",
  borderlineBg: "FFFEF3C7", borderlineFg: "FF92400E",
  disqualifyBg: "FFFEE2E2", disqualifyFg: "FF991B1B",
  failedBg:     "FFF3F4F6", failedFg:     "FF6B7280",
  pendingBg:    "FFFFFFFF", pendingFg:    "FF6B7280",
  // Accents
  accentGreen:  "FF10B981",
  linkBlue:     "FF2563EB",
  rowDivider:   "FFE2E8F0",
  // Summary sheet
  sumTitle:     "FF0F172A",
  sumLabelBg:   "FFF1F5F9",
  sumLabelFg:   "FF374151",
};

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function verdictColors(verdict: string | null, status: string) {
  if (status === "failed")          return { bg: C.failedBg,     fg: C.failedFg };
  if (verdict === "QUALIFY")        return { bg: C.qualifyBg,    fg: C.qualifyFg };
  if (verdict === "BORDERLINE")     return { bg: C.borderlineBg, fg: C.borderlineFg };
  if (verdict === "DISQUALIFY")     return { bg: C.disqualifyBg, fg: C.disqualifyFg };
  return { bg: C.pendingBg, fg: C.pendingFg };
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function scoreBand(score: number | null): string {
  if (score === null) return "";
  if (score >= 70) return "Strong Fit";
  if (score >= 40) return "Borderline";
  return "Poor Fit";
}

function pct(n: number, total: number) {
  return total === 0 ? "—" : `${Math.round((n / total) * 100)}%`;
}

// ── Column definitions (ordered into 6 logical groups) ────────────────────────
type ColDef = { key: string; header: string; width: number; wrap?: true };

const COLS: ColDef[] = [
  // ── Group 1: LEAD IDENTITY (A–E) ──────────────────────────────────────────
  { key: "name",             header: "Company Name",        width: 28 },
  { key: "website",          header: "Website",             width: 32 },
  { key: "category",         header: "Category",            width: 18 },
  { key: "city",             header: "City",                width: 16 },
  { key: "country",          header: "Country",             width: 14 },
  // ── Group 2: QUALIFICATION (F–I) ──────────────────────────────────────────
  { key: "score",            header: "ICP Score (0–100)",   width: 14 },
  { key: "scoreBand",        header: "Band",                width: 14 },
  { key: "verdict",          header: "Verdict",             width: 14 },
  { key: "icpNotes",         header: "Analyst Notes",       width: 52, wrap: true },
  // ── Group 3: SIGNALS & PAIN POINTS (J–L) ─────────────────────────────────
  { key: "keySignals",       header: "Signals Found",       width: 40, wrap: true },
  { key: "missingSignals",   header: "Gaps / Missing",      width: 40, wrap: true },
  { key: "painPoints",       header: "Pain Points",         width: 40, wrap: true },
  // ── Group 4: OUTREACH INTEL (M–P) ─────────────────────────────────────────
  { key: "pitchAngle",       header: "Pitch Angle",         width: 52, wrap: true },
  { key: "openingHook",      header: "Opening Hook",        width: 52, wrap: true },
  { key: "competitorSystem", header: "Competitor System",   width: 22 },
  { key: "decisionMakers",   header: "Decision Makers",     width: 40, wrap: true },
  // ── Group 5: VENUE PROFILE (Q–X) ──────────────────────────────────────────
  { key: "machineCount",     header: "Machines (est.)",     width: 16 },
  { key: "paymentSystem",    header: "Payment System",      width: 22 },
  { key: "venueType",        header: "Venue Type (AI)",     width: 22 },
  { key: "hasRedemption",    header: "Redemption",          width: 14 },
  { key: "hasLoyalty",       header: "Loyalty",             width: 12 },
  { key: "hasFnB",           header: "F&B",                 width: 10 },
  { key: "hasPartyRooms",    header: "Party Rooms",         width: 14 },
  { key: "isChain",          header: "Chain",               width: 18 },
  // ── Group 6: METADATA (Y–AE) ──────────────────────────────────────────────
  { key: "nextAction",       header: "Recommended Action",  width: 44, wrap: true },
  { key: "reviewPlatforms",  header: "Review Platforms",    width: 24 },
  { key: "socialProfiles",   header: "Social Profiles",     width: 24 },
  { key: "pagesCrawled",     header: "Pages Crawled",       width: 14 },
  { key: "leadNotes",        header: "Input Notes",         width: 28 },
  { key: "qualifiedAt",      header: "Qualified At",        width: 22 },
  { key: "batchId",          header: "Batch Reference",     width: 36 },
];

// ── Column groups: [label, startCol (1-indexed), endCol, palette] ─────────────
const GROUPS: { label: string; start: number; end: number; palette: typeof C.g1 }[] = [
  { label: "LEAD IDENTITY",         start:  1, end:  5, palette: C.g1 },
  { label: "QUALIFICATION",         start:  6, end:  9, palette: C.g2 },
  { label: "SIGNALS & PAIN POINTS", start: 10, end: 12, palette: C.g3 },
  { label: "OUTREACH INTEL",        start: 13, end: 16, palette: C.g4 },
  { label: "VENUE PROFILE",         start: 17, end: 24, palette: C.g5 },
  { label: "METADATA",              start: 25, end: 31, palette: C.g6 },
];

function colLetter(n: number): string {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function exportXlsx(batch: QualifyBatch) {
  const wb = new ExcelJS.Workbook();
  wb.creator  = "RECON_ Lead Intelligence";
  wb.created  = new Date();
  wb.modified = new Date();

  const VERDICT_ORDER: Record<string, number> = { QUALIFY: 0, BORDERLINE: 1, DISQUALIFY: 2 };
  const sorted = [...batch.leads].sort((a, b) => {
    const vo = (VERDICT_ORDER[a.verdict ?? ""] ?? 3) - (VERDICT_ORDER[b.verdict ?? ""] ?? 3);
    return vo !== 0 ? vo : (b.score ?? -1) - (a.score ?? -1);
  });

  // ── Sheet 1: Leads ──────────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Leads", {
    views: [{ state: "frozen", ySplit: 2, xSplit: 0, activeCell: "A3" }],
    pageSetup: { fitToPage: true, fitToWidth: 1, orientation: "landscape", paperSize: 9 },
  });

  // Column widths — no headers here (we build header rows manually below)
  ws.columns = COLS.map(c => ({ key: c.key, width: c.width }));

  // ── Row 1: Group header row ──────────────────────────────────────────────────
  const groupRow = ws.getRow(1);
  groupRow.height = 20;

  GROUPS.forEach(({ label, start, end, palette }) => {
    const startLetter = colLetter(start);
    const endLetter   = colLetter(end);
    if (start < end) ws.mergeCells(`${startLetter}1:${endLetter}1`);
    const cell = groupRow.getCell(start);
    cell.value = label;
    cell.fill  = solidFill(palette.h1);
    cell.font  = { bold: true, size: 9, color: { argb: C.white }, name: "Calibri" };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FF10B981" } },
      right:  { style: "medium", color: { argb: "FF10B981" } },
    };
  });

  // ── Row 2: Column header row ─────────────────────────────────────────────────
  const headerRow = ws.getRow(2);
  headerRow.height = 26;

  COLS.forEach((col, i) => {
    const colNum = i + 1;
    const group  = GROUPS.find(g => colNum >= g.start && colNum <= g.end)!;
    const cell   = headerRow.getCell(colNum);
    cell.value   = col.header;
    cell.fill    = solidFill(group.palette.h2);
    cell.font    = { bold: true, size: 9, color: { argb: C.white }, name: "Calibri" };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: false };
    cell.border  = {
      bottom: { style: "medium", color: { argb: C.accentGreen } },
      right:  { style: "thin",   color: { argb: "FF4B5563" } },
    };
  });

  // ── Data rows (start at row 3) ───────────────────────────────────────────────
  sorted.forEach((lead: LeadResult, rowIdx: number) => {
    const { bg, fg } = verdictColors(lead.verdict, lead.status);
    const vi  = lead.venueIntel;
    const oi  = lead.outreachIntel;
    const boolCell = (v: boolean | undefined) => v === undefined ? "" : v ? "Yes" : "No";

    // Slight zebra tint: even rows use a barely-visible overlay via slightly different border
    const isZebra = rowIdx % 2 === 1;
    const zebraFg = isZebra ? { argb: "08000000" } : undefined; // unused, just conceptual

    const row = ws.addRow({
      name:             lead.input.name,
      website:          lead.input.url,
      category:         lead.input.category    ?? "",
      city:             lead.input.city        ?? "",
      country:          lead.input.country     ?? "",
      score:            lead.score             ?? "",
      scoreBand:        scoreBand(lead.score),
      verdict:          lead.verdict           ?? (lead.status === "failed" ? "FAILED" : "—"),
      icpNotes:         lead.icpExplanation    ?? "",
      keySignals:       lead.keySignals.join("\n• ").replace(/^/, lead.keySignals.length ? "• " : ""),
      missingSignals:   lead.missingSignals.join("\n• ").replace(/^/, lead.missingSignals.length ? "• " : ""),
      painPoints:       (lead.painPoints ?? []).join("\n• ").replace(/^/, (lead.painPoints ?? []).length ? "• " : ""),
      pitchAngle:       oi?.pitchAngle         ?? "",
      openingHook:      oi?.openingHook        ?? "",
      competitorSystem: oi?.competitorSystem   ?? "",
      decisionMakers:   (oi?.decisionMakers ?? []).map(d => [d.name, d.title, d.email, d.phone].filter(Boolean).join(" | ")).join("\n") ?? "",
      machineCount:     vi?.estimatedMachineCount ?? "",
      paymentSystem:    vi?.paymentSystem      ?? "",
      venueType:        vi?.venueType          ?? "",
      hasRedemption:    boolCell(vi?.hasRedemption),
      hasLoyalty:       boolCell(vi?.hasLoyalty),
      hasFnB:           boolCell(vi?.hasFoodBeverage),
      hasPartyRooms:    boolCell(vi?.hasPartyRooms),
      isChain:          vi?.isChain && vi.chainName ? `Yes — ${vi.chainName}` : boolCell(vi?.isChain),
      nextAction:       lead.recommendedAction ?? "",
      reviewPlatforms:  (lead.sourceSummary?.reviews ?? []).map(r => r.platform).join(", "),
      socialProfiles:   (lead.sourceSummary?.socials  ?? []).map(s => s.platform).join(", "),
      pagesCrawled:     lead.crawledPages,
      leadNotes:        lead.input.notes       ?? "",
      qualifiedAt:      fmtDate(lead.completedAt),
      batchId:          batch.batchId,
    });

    row.height = 18;

    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      const col = COLS[colNum - 1];
      const isWrap = col?.wrap === true;

      cell.fill = solidFill(isZebra
        ? bg.replace(/^FF/, "F5")   // slightly lighter for zebra rows
        : bg);
      cell.font = { color: { argb: fg }, size: 10, name: "Calibri" };
      cell.alignment = {
        vertical:   isWrap ? "top" : "middle",
        horizontal: colNum === 6 ? "center" : "left",
        wrapText:   isWrap,
        indent:     isWrap ? 1 : 0,
      };
      cell.border = {
        bottom: { style: "thin", color: { argb: C.rowDivider } },
        right:  { style: "thin", color: { argb: C.rowDivider } },
      };
    });

    // Score: bold + centered
    const scoreCell = row.getCell("score");
    scoreCell.font  = { bold: true, size: 11, color: { argb: fg }, name: "Calibri" };
    scoreCell.alignment = { vertical: "middle", horizontal: "center" };

    // Verdict: bold
    const verdictCell = row.getCell("verdict");
    verdictCell.font = { bold: true, size: 10, color: { argb: fg }, name: "Calibri" };
    verdictCell.alignment = { vertical: "middle", horizontal: "center" };

    // Boolean flag columns: center-align
    ["hasRedemption","hasLoyalty","hasFnB","hasPartyRooms","pagesCrawled"].forEach(key => {
      const c = row.getCell(key);
      c.alignment = { vertical: "middle", horizontal: "center" };
    });

    // Website: hyperlink
    if (lead.input.url) {
      const urlCell = row.getCell("website");
      urlCell.value = { text: lead.input.url.replace(/^https?:\/\/(www\.)?/, ""), hyperlink: lead.input.url };
      urlCell.font  = { color: { argb: C.linkBlue }, underline: true, size: 10, name: "Calibri" };
    }
  });

  // ── Sheet 2: Summary ────────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet("Summary", {
    views: [{ state: "normal" }],
  });
  ws2.columns = [
    { key: "label", width: 30 },
    { key: "value", width: 22 },
    { key: "bar",   width: 20 },
  ];

  const qualify    = sorted.filter(l => l.verdict === "QUALIFY").length;
  const borderline = sorted.filter(l => l.verdict === "BORDERLINE").length;
  const disqualify = sorted.filter(l => l.verdict === "DISQUALIFY").length;
  const failed     = sorted.filter(l => l.status  === "failed").length;
  const total      = sorted.length;
  const scored     = sorted.filter(l => l.score !== null);
  const avgScore   = scored.length
    ? Math.round(scored.reduce((s, l) => s + (l.score ?? 0), 0) / scored.length)
    : 0;
  const topLeads   = scored.filter(l => (l.score ?? 0) >= 70).length;

  function addSumRow(label: string, value: string | number, barVal?: string, opts?: {
    titleRow?: boolean; sectionRow?: boolean;
    bgLabel?: string; bgValue?: string; fgLabel?: string; fgValue?: string;
    boldLabel?: boolean; boldValue?: boolean; height?: number;
  }) {
    const row = ws2.addRow({ label, value, bar: barVal ?? "" });
    const o = opts ?? {};

    if (o.titleRow) {
      row.height = 34;
      row.eachCell({ includeEmpty: true }, (cell, n) => {
        cell.fill = solidFill(C.sumTitle);
        cell.font = { bold: true, size: n === 1 ? 15 : 11, color: { argb: C.white }, name: "Calibri" };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      });
    } else if (o.sectionRow) {
      row.height = 20;
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = solidFill("FF334155");
        cell.font = { bold: true, size: 9, color: { argb: "FFCBD5E1" }, name: "Calibri" };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      });
    } else {
      row.height = o.height ?? 18;
      const lCell = row.getCell("label");
      const vCell = row.getCell("value");
      const bCell = row.getCell("bar");

      lCell.fill = solidFill(o.bgLabel ?? C.sumLabelBg);
      lCell.font = { bold: o.boldLabel ?? false, size: 10, color: { argb: o.fgLabel ?? C.sumLabelFg }, name: "Calibri" };
      lCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

      vCell.fill = solidFill(o.bgValue ?? C.white);
      vCell.font = { bold: o.boldValue ?? false, size: 10, color: { argb: o.fgValue ?? "FF111827" }, name: "Calibri" };
      vCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };

      bCell.fill = solidFill(C.white);
      bCell.font = { size: 9, color: { argb: "FF9CA3AF" }, name: "Calibri" };
      bCell.alignment = { vertical: "middle", horizontal: "left" };

      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { bottom: { style: "thin", color: { argb: C.rowDivider } } };
      });
    }
    return row;
  }

  addSumRow("RECON_  Lead Intelligence Report", `Batch: ${batch.batchId.slice(0, 8)}`, "", { titleRow: true });
  addSumRow("", "", "");
  addSumRow("OVERVIEW", "", "", { sectionRow: true });
  addSumRow("Export Date",    fmtDate(new Date().toISOString()), "", { boldLabel: true });
  addSumRow("Total Leads",    total,   "", { boldLabel: true, boldValue: true });
  addSumRow("Scored Leads",   scored.length, `${pct(scored.length, total)} of total`);
  addSumRow("Failed / Error", failed, failed > 0 ? `${pct(failed, total)} of total` : "");
  addSumRow("", "", "");
  addSumRow("RESULTS BREAKDOWN", "", "", { sectionRow: true });
  addSumRow("✓  Qualify",     qualify,     `${pct(qualify, total)} of total`,
    { bgValue: C.qualifyBg, fgValue: C.qualifyFg, boldValue: true, boldLabel: true });
  addSumRow("~  Borderline",  borderline,  `${pct(borderline, total)} of total`,
    { bgValue: C.borderlineBg, fgValue: C.borderlineFg, boldValue: true, boldLabel: true });
  addSumRow("✗  Disqualify",  disqualify,  `${pct(disqualify, total)} of total`,
    { bgValue: C.disqualifyBg, fgValue: C.disqualifyFg, boldValue: true, boldLabel: true });
  addSumRow("", "", "");
  addSumRow("SCORING", "", "", { sectionRow: true });
  addSumRow("Average ICP Score", avgScore,   "", { boldValue: true, boldLabel: true });
  addSumRow("Highest Score",  scored.length ? Math.max(...scored.map(l => l.score!)) : "—", "");
  addSumRow("Lowest Score",   scored.length ? Math.min(...scored.map(l => l.score!)) : "—", "");
  addSumRow("Strong Fit (≥70)", topLeads,   `${pct(topLeads, total)} of total`,
    { boldValue: true, fgValue: C.qualifyFg });
  addSumRow("", "", "");
  addSumRow("Batch ID",       batch.batchId, "", { boldLabel: true });
  addSumRow("", "", "");
  addSumRow("Generated by",  "RECON_ — Lead Intelligence", "", {
    bgLabel: C.sumTitle, bgValue: C.sumTitle,
    fgLabel: "FF94A3B8", fgValue: "FF94A3B8",
  });

  // ── Download ─────────────────────────────────────────────────────────────────
  const buffer = await wb.xlsx.writeBuffer();
  const blob   = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement("a");
  a.href       = url;
  a.download   = `RECON_Leads_${batch.batchId.slice(0, 8)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
