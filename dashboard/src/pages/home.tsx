import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { Map, ListChecks, History, BookOpen, ArrowRight, Loader2 } from "lucide-react";
import { mapsApi } from "@/lib/mapsApi";
import { icpApi, qualifyApi } from "@/lib/qualifyApi";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const STEPS = [
  {
    step: 1,
    href: "/maps",
    icon: Map,
    title: "Maps Search",
    text: "Pick an area and what you are looking for. RECON lists every place of that kind found on Google Maps.",
    action: "New search",
  },
  {
    step: 2,
    href: "/qualify",
    icon: ListChecks,
    title: "Lead Qualifier",
    text: "Send the places of a search, or upload a CSV or Excel list. Each lead gets a score from 0 to 100, a verdict and the reasons.",
    action: "Qualify leads",
  },
  {
    step: 3,
    href: "/history",
    icon: History,
    title: "History",
    text: "Every qualification, kept. Open one to review the leads and download them as Excel or CSV.",
    action: "See results",
  },
];

function StatusDot({ status }: { status: string }) {
  if (status === "running" || status === "pending") return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />;
  const color =
    status === "done" ? "bg-emerald-400" : status === "failed" ? "bg-rose-400" : "bg-amber-400";
  return <span className={`h-2 w-2 rounded-full shrink-0 ${color}`} />;
}

export default function Home() {
  const { data: icp } = useQuery({ queryKey: ["active-icp"], queryFn: () => icpApi.getActive(), staleTime: 60_000 });
  const { data: jobs } = useQuery({ queryKey: ["maps-jobs"], queryFn: () => mapsApi.listJobs() });
  const { data: batches } = useQuery({ queryKey: ["qualify-batches"], queryFn: qualifyApi.listBatches });

  const recentJobs = (jobs?.jobs ?? []).slice(0, 4);
  const recentBatches = (batches?.batches ?? []).slice(0, 4);

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <section className="pt-4">
        <h1 className="text-3xl font-semibold tracking-tight">Find venues. Keep the ones that fit.</h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          RECON lists the places of a kind in any area from Google Maps, then scores each one against your ideal
          customer profile.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href}>
              <Card className="group h-full p-6 flex flex-col cursor-pointer transition-colors hover:border-primary/50 hover:bg-card/80">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Step {s.step}</span>
                </div>
                <h2 className="text-lg font-semibold">{s.title}</h2>
                <p className="text-sm text-muted-foreground mt-1.5 flex-1">{s.text}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  {s.action}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Card>
            </Link>
          );
        })}
      </section>

      <section className="rounded-xl border bg-card p-5 flex flex-wrap items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400 shrink-0">
          <BookOpen className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-[240px]">
          <p className="text-xs text-muted-foreground">Leads are scored against the active ICP (ideal customer profile)</p>
          <p className="font-medium mt-0.5">{icp?.name ?? "…"}</p>
        </div>
        <Link href="/icp">
          <Button variant="outline" size="sm">Change ICP</Button>
        </Link>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Recent searches</h3>
            <Link href="/maps" className="text-xs text-muted-foreground hover:text-foreground">All searches</Link>
          </div>
          {recentJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No search yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recentJobs.map((j) => (
                <li key={j.jobId}>
                  <Link href={`/maps?job=${j.jobId}`} className="flex items-center gap-3 py-2.5 hover:text-primary transition-colors">
                    <StatusDot status={j.status} />
                    <span className="text-sm truncate flex-1">{j.config.label || `${j.config.searchTerm} · ${j.config.location}`}</span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {(j.shownLeads ?? j.totalLeads).toLocaleString()} {(j.shownLeads ?? j.totalLeads) === 1 ? "place" : "places"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Recent qualifications</h3>
            <Link href="/history" className="text-xs text-muted-foreground hover:text-foreground">History</Link>
          </div>
          {recentBatches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No qualification yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recentBatches.map((b) => (
                <li key={b.batchId}>
                  <Link href={`/qualify?batch=${b.batchId}`} className="flex items-center gap-3 py-2.5 hover:text-primary transition-colors">
                    <StatusDot status={b.status} />
                    <span className="text-sm truncate flex-1">{format(new Date(b.createdAt), "MMM d, HH:mm")}</span>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {b.completedCount}/{b.totalCount} leads
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}
