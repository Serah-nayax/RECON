import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { Map, ListChecks, History, BookOpen, ArrowRight, Loader2 } from "lucide-react";
import { mapsApi } from "@/lib/mapsApi";
import { icpApi, qualifyApi } from "@/lib/qualifyApi";
import { Card } from "@/components/ui/card";

const STEPS = [
  {
    step: 1,
    href: "/icp",
    icon: BookOpen,
    title: "ICP",
    text: "Choose who you are looking for: pick a profile or write one. It suggests what to search and scores every lead.",
    action: "Choose the ICP",
  },
  {
    step: 2,
    href: "/maps",
    icon: Map,
    title: "Maps Search",
    text: "Pick what to look for and where. RECON lists every place of that kind found on Google Maps.",
    action: "New search",
  },
  {
    step: 3,
    href: "/qualify",
    icon: ListChecks,
    title: "Lead Qualifier",
    text: "Score the places of a search, or a CSV or Excel list: 0 to 100, a verdict and the reasons.",
    action: "Qualify leads",
  },
  {
    step: 4,
    href: "/history",
    icon: History,
    title: "History",
    text: "Every qualification, kept. Review the leads and download them as Excel or CSV.",
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
      <section className="pt-6">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary/80 mb-3">Prospecting for Tigapo</p>
        <h1 className="text-4xl font-semibold tracking-tight leading-tight">
          Find venues.{" "}
          <span className="bg-gradient-to-r from-sky-300 via-blue-400 to-indigo-400 bg-clip-text text-transparent">
            Keep the ones that fit.
          </span>
        </h1>
        <p className="text-muted-foreground mt-3 max-w-2xl leading-relaxed">
          RECON lists the places of a kind in any area from Google Maps, then scores each one against your ideal
          customer profile.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.href} href={s.href}>
              <Card className="card-lift group h-full p-6 flex flex-col cursor-pointer">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Step {s.step}</span>
                </div>
                <h2 className="text-lg font-semibold">{s.title}</h2>
                <p className="text-sm text-muted-foreground mt-1.5 flex-1 leading-relaxed">{s.text}</p>
                {s.step === 1 && (
                  <p className="mt-4 rounded-lg border border-violet-400/20 bg-violet-400/5 px-3 py-2 text-xs">
                    <span className="text-muted-foreground">Active: </span>
                    <span className="font-medium text-violet-300">{icp?.name ?? "…"}</span>
                  </p>
                )}
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                  {s.action}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Card>
            </Link>
          );
        })}
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
