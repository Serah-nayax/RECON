import { useState } from "react";
import { HelpCircle, Map, ListChecks, History, Settings, BookOpen, Layers, FileSpreadsheet, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

const steps = [
  {
    step: 1,
    label: "Choose who you are looking for",
    page: "ICP",
    href: "/icp",
    icon: BookOpen,
    color: "text-violet-400",
    bg: "bg-violet-400/10",
    description:
      "Pick a profile (ICP: ideal customer profile) and set it active, or write a new one. It suggests the Maps search terms and is what every lead is scored against.",
  },
  {
    step: 2,
    label: "Find places",
    page: "Maps Search",
    href: "/maps",
    icon: Map,
    color: "text-sky-400",
    bg: "bg-sky-400/10",
    description:
      "Choose an area and what to look for. RECON searches Google Maps across the whole area and lists every place of that kind, with its category, address, rating, phone and website.",
  },
  {
    step: 3,
    label: "Score the leads",
    page: "Lead Qualifier",
    href: "/qualify",
    icon: ListChecks,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    description:
      "Send the places of a search, or upload a CSV or Excel list. RECON reads each website and scores the lead from 0 to 100 against the active ICP, with a verdict and the reasons.",
  },
  {
    step: 4,
    label: "Review and export",
    page: "History",
    href: "/history",
    icon: FileSpreadsheet,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    description:
      "Open a qualification to review its leads, then download them as Excel or CSV, or push them to HubSpot or Salesforce.",
  },
];

const pages = [
  {
    icon: BookOpen,
    label: "ICP",
    color: "text-violet-400",
    bg: "bg-violet-400/10",
    description: "Choose the active profile or create one. A profile describes the venues you want, the signals for and against, and the score bands.",
  },
  {
    icon: Map,
    label: "Maps Search",
    color: "text-sky-400",
    bg: "bg-sky-400/10",
    description: "List every place of a kind in an area, then send them to the Lead Qualifier (one by one or all at once).",
  },
  {
    icon: ListChecks,
    label: "Lead Qualifier",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    description: "Score leads from a Maps search, a CSV or Excel file, or a pasted list. Each lead gets a score and a verdict: Qualify, Borderline or Disqualify.",
  },
  {
    icon: History,
    label: "History",
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    description: "Browse past qualification batches and re-export them at any time.",
  },
  {
    icon: Settings,
    label: "Settings",
    color: "text-zinc-400",
    bg: "bg-zinc-400/10",
    description: "Access to a shared RECON server, AI status, and your HubSpot / Salesforce account.",
  },
];

export function HelpModal() {
  const [tab, setTab] = useState<"workflow" | "pages">("workflow");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          aria-label="Help"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            How Recon works
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 mt-1 mb-4 border-b pb-3">
          <button
            onClick={() => setTab("workflow")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === "workflow"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Recommended workflow
          </button>
          <button
            onClick={() => setTab("pages")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === "pages"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Page guide
          </button>
        </div>

        {tab === "workflow" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground mb-4">
              The four steps of the menu, in order. Start with the ICP: everything after depends on it.
            </p>
            {steps.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={s.step} className="flex gap-4 items-start">
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold font-mono ${s.bg} ${s.color}`}>
                      {s.step}
                    </div>
                    {i < steps.length - 1 && (
                      <div className="w-px h-6 bg-border" />
                    )}
                  </div>
                  <div className="pb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`h-4 w-4 ${s.color}`} />
                      <span className="font-semibold text-sm">{s.label}</span>
                      <Badge variant="outline" className={`text-xs ${s.color} border-current/30`}>
                        {s.page}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {s.description}
                    </p>
                  </div>
                </div>
              );
            })}

            <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <Brain className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-primary mb-1">Tip: places without a website are qualified too</p>
                  <p className="text-sm text-muted-foreground">
                    They are scored from their name, category and Google Maps data. Leads with a website score more accurately, since Recon can read their pages.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "pages" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground mb-4">
              A quick reference for every page in the app.
            </p>
            {pages.map((p) => {
              const Icon = p.icon;
              return (
                <div key={p.label} className="flex gap-3 p-3 rounded-lg border border-border/50 hover:border-border transition-colors">
                  <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${p.bg}`}>
                    <Icon className={`h-4 w-4 ${p.color}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-0.5">{p.label}</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
