import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { qualifyApi } from "@/lib/qualifyApi";
import { useListCrawlJobs, getListCrawlJobsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Globe, Target, ArrowRight, CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "done":
      return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border font-mono text-[11px]">DONE</Badge>;
    case "running":
      return <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 border font-mono text-[11px] animate-pulse">RUNNING</Badge>;
    case "failed":
      return <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30 border font-mono text-[11px]">FAILED</Badge>;
    case "pending":
    default:
      return <Badge variant="outline" className="text-muted-foreground font-mono text-[11px]">PENDING</Badge>;
  }
}

function BatchStatusIcon({ status }: { status: string }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-rose-400 shrink-0" />;
  if (status === "running") return <Loader2 className="h-4 w-4 text-blue-400 shrink-0 animate-spin" />;
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
}

type Tab = "crawls" | "batches";

export default function History() {
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<Tab>("crawls");

  const { data: crawlData, isLoading: crawlLoading, error: crawlError } = useListCrawlJobs({
    query: { queryKey: getListCrawlJobsQueryKey() }
  });

  const { data: batchData, isLoading: batchLoading, error: batchError } = useQuery({
    queryKey: ["qualify-batches"],
    queryFn: qualifyApi.listBatches,
  });

  const crawlJobs = crawlData?.jobs ?? [];
  const batches = batchData?.batches ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-mono font-bold tracking-tight mb-2">HISTORY</h1>
        <p className="text-muted-foreground">All past crawls and qualification batches, persisted across sessions.</p>
      </div>

      <div className="flex gap-1 border-b border-muted">
        {([
          { id: "crawls" as Tab, label: "Crawl Intel", icon: Globe, count: crawlJobs.length },
          { id: "batches" as Tab, label: "Qual Batches", icon: Target, count: batches.length },
        ]).map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-mono font-medium border-b-2 transition-colors -mb-px ${
              tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
            {count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${tab === id ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "crawls" && (
        <Card className="border-muted/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Crawl Intel Reports
            </CardTitle>
          </CardHeader>
          <CardContent>
            {crawlLoading ? (
              <div className="flex items-center justify-center p-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="font-mono text-sm">LOADING...</span>
              </div>
            ) : crawlError ? (
              <div className="flex items-center justify-center p-8 text-destructive gap-2">
                <AlertCircle className="h-5 w-5" />
                <span className="text-sm">Failed to load crawl history</span>
              </div>
            ) : crawlJobs.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground border border-dashed border-muted rounded-lg">
                <Globe className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="font-mono text-sm">NO_CRAWLS_YET</p>
                <p className="text-xs mt-1">Start a crawl from the Dashboard to see history here.</p>
              </div>
            ) : (
              <div className="divide-y divide-muted/30">
                {crawlJobs.map((job) => (
                  <div
                    key={job.jobId}
                    className="flex items-center gap-4 py-3 group cursor-pointer hover:bg-muted/10 rounded-md px-2 -mx-2 transition-colors"
                    onClick={() => setLocation(`/report/${job.jobId}`)}
                  >
                    <StatusBadge status={job.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" title={job.url}>{job.url}</p>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {format(new Date(job.createdAt), "MMM d, yyyy · HH:mm")}
                        <span className="ml-2 opacity-50">ID: {job.jobId.substring(0, 8)}...</span>
                      </p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors shrink-0" asChild>
                      <Link href={`/report/${job.jobId}`}>
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "batches" && (
        <Card className="border-muted/50 bg-card/50">
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
                <span className="font-mono text-sm">LOADING...</span>
              </div>
            ) : batchError ? (
              <div className="flex items-center justify-center p-8 text-destructive gap-2">
                <AlertCircle className="h-5 w-5" />
                <span className="text-sm">Failed to load batch history</span>
              </div>
            ) : batches.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground border border-dashed border-muted rounded-lg">
                <Target className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="font-mono text-sm">NO_BATCHES_YET</p>
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
      )}
    </div>
  );
}
