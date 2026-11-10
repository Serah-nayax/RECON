import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageHeader } from "@/components/page-header";
import { format } from "date-fns";
import { qualifyApi } from "@/lib/qualifyApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { History as HistoryIcon, Loader2, Target, ArrowRight, CheckCircle2, XCircle, Clock, AlertCircle, Square } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "done":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border font-mono text-[11px]">DONE</Badge>;
    case "running":
      return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 border font-mono text-[11px] animate-pulse">RUNNING</Badge>;
    case "failed":
      return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30 border font-mono text-[11px]">FAILED</Badge>;
    case "cancelled":
      return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 border font-mono text-[11px]">STOPPED</Badge>;
    case "pending":
    default:
      return <Badge variant="outline" className="text-muted-foreground font-mono text-[11px]">PENDING</Badge>;
  }
}

function BatchStatusIcon({ status }: { status: string }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-rose-400 shrink-0" />;
  if (status === "cancelled") return <Square className="h-4 w-4 text-amber-400 shrink-0" />;
  if (status === "running") return <Loader2 className="h-4 w-4 text-blue-400 shrink-0 animate-spin" />;
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
}

export default function History() {
  const [, setLocation] = useLocation();
  const { data: batchData, isLoading: batchLoading, error: batchError } = useQuery({
    queryKey: ["qualify-batches"],
    queryFn: qualifyApi.listBatches,
  });

  const batches = batchData?.batches ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        icon={HistoryIcon}
        step={3}
        title="History"
        description="Every qualification, kept. Open one to review its leads and download them. Past searches are on the Maps Search page."
      />

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              Qualification Batches
            </CardTitle>
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
                <span className="text-sm">Failed to load batch history</span>
              </div>
            ) : batches.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground border border-dashed border-muted rounded-lg">
                <Target className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm font-medium">No qualification yet</p>
                <p className="text-xs mt-1">Run a lead qualification batch to see history here.</p>
              </div>
            ) : (
              <div className="divide-y divide-muted/30">
                {batches.map((batch) => {
                  const pct = batch.totalCount > 0
                    ? Math.round((batch.completedCount / batch.totalCount) * 100)
                    : 0;
                  return (
                    <div
                      key={batch.batchId}
                      className="flex items-center gap-4 py-3 group cursor-pointer hover:bg-muted/10 rounded-md px-2 -mx-2 transition-colors"
                      onClick={() => setLocation(`/qualify?batch=${batch.batchId}`)}
                    >
                      <BatchStatusIcon status={batch.status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium truncate">{batch.icpSnapshot}</p>
                          <StatusBadge status={batch.status} />
                        </div>
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">
                          {format(new Date(batch.createdAt), "MMM d, yyyy · HH:mm")}
                          <span className="ml-3">{batch.completedCount}/{batch.totalCount} leads</span>
                          {batch.status !== "done" && <span className="ml-2">{pct}%</span>}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors shrink-0">
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
    </div>
  );
}
