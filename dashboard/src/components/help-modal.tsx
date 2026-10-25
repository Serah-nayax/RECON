import { useState } from "react";
import { HelpCircle, Map, Target, History, Settings, BookOpen, ArrowRight, Layers, FileSpreadsheet, Brain, Users } from "lucide-react";
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
    label: "Configure your ICP",
    page: "ICP Library",
    href: "/icp",
    icon: BookOpen,
    color: "text-violet-400",
    bg: "bg-violet-400/10",
    description:
      "Define who your ideal customer is. Set the signals that qualify or disqualify a lead and tune the AI scoring prompt. Activate one ICP to use across all searches.",
  },
  {
    step: 2,
    label: "Find leads on Maps",
    page: "Maps Search",
    href: "/maps",
    icon: Map,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    description:
      "Search Google Maps for any business type in any city or region. Recon extracts name, rating, reviews, phone, and website — then lets you enrich each lead with full AI intel.",
  },
  {
    step: 3,
    label: "Score your leads",
    page: "Lead Qualifier",
    href: "/qualify",
    icon: Target,
    color: "text-sky-400",
    bg: "bg-sky-400/10",
    description:
      "Upload a CSV/Excel file or send leads over from Maps. Recon crawls each website and scores them against your active ICP, returning a 0-100 score, a verdict, and the exact signals it found.",
  },
  {
    step: 4,
    label: "Review & export",
    page: "Lead Qualifier",
    href: "/qualify",
    icon: FileSpreadsheet,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    description:
      "Expand any lead to read the AI summary, review signals, see decision-maker contacts, and check competitor intel. Export qualified leads to HubSpot, Salesforce, or a spreadsheet.",
  },
];

const pages = [
  {
    icon: Map,
    label: "Maps Search",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    description: "Discover businesses by type and location. Enrich results with AI-powered intel and pipe them directly into the Lead Qualifier.",
  },
  {
    icon: Target,
    label: "Lead Qualifier",
    color: "text-sky-400",
    bg: "bg-sky-400/10",
    description: "Bulk-score leads from a CSV or Maps. Each lead gets crawled, analysed, and given a verdict — QUALIFY, BORDERLINE, or DISQUALIFY.",
  },
  {
    icon: History,
    label: "History",
    color: "text-orange-400",
    bg: "bg-orange-400/10",
    description: "Browse past crawls and qualification batches. Revisit reports and re-export at any time.",
  },
  {
    icon: BookOpen,
    label: "ICP Library",
    color: "text-violet-400",
    bg: "bg-violet-400/10",
    description: "Create and manage Ideal Customer Profiles. Each profile controls the scoring logic and AI prompt used when qualifying leads.",
  },
  {
    icon: Settings,
    label: "Settings",
    color: "text-zinc-400",
    bg: "bg-zinc-400/10",
    description: "Store your API keys for the crawler, AI providers (Anthropic, OpenAI, Gemini), Apify, Seamless.AI contact lookups, and CRM integrations.",
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
          <DialogTitle className="flex items-center gap-2 font-mono text-primary">
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
              Follow these steps to go from zero to a list of qualified, enriched leads ready for outreach.
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
                  <p className="text-sm font-semibold text-primary mb-1">Tip: enrich before qualifying</p>
                  <p className="text-sm text-muted-foreground">
                    Maps Search enrichment gives Recon more data to score against. Leads with a website URL score more accurately than those without.
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

            <div className="rounded-lg border border-border/50 p-3 mt-2">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 bg-rose-400/10">
                  <Users className="h-4 w-4 text-rose-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold mb-0.5">Contact Intel</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Available inside enriched leads in both Maps Search and Lead Qualifier. Requires a Seamless.AI key in Settings to look up decision-maker contacts.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
