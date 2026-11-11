import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { qualifyApi } from "@/lib/qualifyApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Target, Search, MapPin, FileText, ArrowRight, CheckCircle2, XCircle, Clock, AlertCircle, Square } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "done":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border rounded-full font-medium text-xs">Done</Badge>;
    case "running":
      return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 border rounded-full font-medium text-xs animate-pulse">Running</Badge>;
    case "failed":
      return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30 border rounded-full font-medium text-xs">Failed</Badge>;
    case "cancelled":
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 border rounded-full font-medium text-xs">Stopped</Badge>;
    case "pending":
    default:
      return <Badge variant="outline" className="text-muted-foreground rounded-full font-medium text-xs">Pending</Badge>;
  }
}

function BatchStatusIcon({ status }: { status: string }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-rose-400 shrink-0" />;
  if (status === "cancelled") return <Square className="h-4 w-4 text-amber-400 shrink-0" />;
  if (status === "running") return <Loader2 className="h-4 w-4 text-blue-400 shrink-0 animate-spin" />;
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
}

/** Past qualifications, under the Lead Qualifier (like "Your searches" under Maps Search). */
export function QualificationHistory({ onOpen }: { onOpen: (batchId: string) => void }) {
  const { data: batchData, isLoading: batchLoading, error: batchError } = useQuery({
    queryKey: ["qualify-batches"],
    queryFn: qualifyApi.listBatches,
  });

  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const PAGE = 10;
  const all = batchData?.batches ?? [];
  // Search by place, search term, ICP, lead name or date, all at once.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const batches = words.length === 0 ? all : all.filter((b) => {
    const text = [b.source, b.icpSnapshot, ...b.firstLeads, format(new Date(b.createdAt), "MMM d yyyy")]
      .join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });

  return (
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-blue-300" />
            Your qualifications
            {all.length > 0 && <span className="text-xs font-normal text-muted-foreground">({batches.length === all.length ? all.length : `${batches.length} of ${all.length}`})</span>}
          </CardTitle>
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a place, term, ICP or lead…"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {batchLoading ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              <span className="text-sm">Loading…</span>
            </div>
          ) : batchError ? (
            <div className="flex items-center justify-center p-8 text-destructive gap-2">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm">Failed to load past qualifications</span>
            </div>
          ) : all.length > 0 && batches.length === 0 ? (
            <p className="text-center p-8 text-sm text-muted-foreground">No qualification matches “{query}”.</p>
          ) : batches.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground border border-dashed border-muted rounded-lg">
              <Target className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No qualification yet</p>
              <p className="text-xs mt-1">Every batch you run is kept here.</p>
            </div>
          ) : (
            <div className="divide-y divide-muted/30">
              {(showAll ? batches : batches.slice(0, PAGE)).map((batch) => {
                const pct = batch.totalCount > 0
                  ? Math.round((batch.completedCount / batch.totalCount) * 100)
                  : 0;
                return (
                  <div
                    key={batch.batchId}
                    className="flex items-center gap-4 py-3 group cursor-pointer hover:bg-muted/10 rounded-md px-2 -mx-2 transition-colors"
                    onClick={() => onOpen(batch.batchId)}
                  >
                    <BatchStatusIcon status={batch.status} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {batch.source ? (
                          <MapPin className="h-3.5 w-3.5 text-cyan-300 shrink-0" />
                        ) : (
                          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <p className="text-sm font-medium truncate">
                          {batch.source ?? `List: ${batch.firstLeads.join(", ")}${batch.totalCount > batch.firstLeads.length ? "…" : ""}`}
                        </p>
                        <StatusBadge status={batch.status} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        {format(new Date(batch.createdAt), "MMM d, yyyy · HH:mm")}
                        <span className="mx-2">·</span>{batch.icpSnapshot}
                        <span className="mx-2">·</span>{batch.completedCount}/{batch.totalCount} leads
                        {batch.status !== "done" && <span className="ml-2">{pct}%</span>}
                      </p>
                    </div>
                    <div className="hidden md:flex items-center gap-1.5 shrink-0 text-xs tabular-nums">
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-300" title="QUALIFY">{batch.verdicts.qualify} fit</span>
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300" title="BORDERLINE">{batch.verdicts.borderline} maybe</span>
                      <span className="rounded-full bg-white/5 px-2 py-0.5 text-muted-foreground" title="DISQUALIFY">{batch.verdicts.disqualify} no</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors shrink-0">
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              {batches.length > PAGE && (
                <Button variant="ghost" size="sm" className="w-full mt-1 text-muted-foreground" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Show fewer" : `Show all ${batches.length} qualifications`}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
  );
}
