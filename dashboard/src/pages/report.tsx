import { useState } from "react";
import { useParams, Link } from "wouter";
import { useGetCrawlJob, getGetCrawlJobQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { 
  ArrowLeft, 
  Loader2, 
  AlertTriangle, 
  Building2, 
  Users, 
  MapPin, 
  Calendar, 
  Briefcase, 
  DollarSign, 
  Terminal, 
  Newspaper, 
  Mail, 
  Phone, 
  Link as LinkIcon,
  UserCheck,
  User,
  Copy,
  Check,
  Star,
  TrendingUp,
  TrendingDown,
  Swords,
  ExternalLink,
} from "lucide-react";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="ml-auto shrink-0 text-muted-foreground/40 hover:text-primary transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function Report() {
  const { jobId } = useParams<{ jobId: string }>();
  const [activeTab, setActiveTab] = useState<"overview" | "contacts" | "reviews" | "competitors">("overview");

  const { data: job, isLoading, error } = useGetCrawlJob(jobId, {
    query: {
      enabled: !!jobId,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return (status === "done" || status === "failed") ? false : 2000;
      }
    }
  });

  if (isLoading || !job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="font-mono text-sm text-muted-foreground animate-pulse">ESTABLISHING_CONNECTION...</p>
      </div>
    );
  }

  if (error || job.status === "failed") {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild className="mb-4">
          <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" /> BACK_TO_COMMAND</Link>
        </Button>
        <Card className="border-destructive/50 bg-destructive/10">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4">
            <AlertTriangle className="h-12 w-12 text-destructive" />
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-destructive font-mono">OPERATION_FAILED</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {job.error || "The crawler encountered an unrecoverable error during execution."}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (job.status === "pending" || job.status === "running") {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <Button variant="ghost" asChild className="mb-4">
          <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" /> BACK_TO_COMMAND</Link>
        </Button>
        <Card className="border-muted/50 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="font-mono text-primary flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              OPERATION_IN_PROGRESS
            </CardTitle>
            <CardDescription className="font-mono text-xs uppercase">Target: {job.url}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm font-mono text-muted-foreground">
                <span>STATUS: {job.status.toUpperCase()}</span>
                <span className="animate-pulse">EXTRACTING_SIGNALS...</span>
              </div>
              <Progress value={job.status === "running" ? 65 : 20} className="h-1" />
            </div>
            
            <div className="bg-muted/20 border border-muted p-4 rounded-md font-mono text-xs text-muted-foreground space-y-2 h-32 overflow-hidden flex flex-col justify-end">
              <p>{'>'} INITIALIZING CRAWLER AGENT...</p>
              <p>{'>'} TARGET LOCKED: {job.url}</p>
              {job.status === "running" && <p>{'>'} ANALYZING DOM STRUCTURE...</p>}
              {job.status === "running" && <p>{'>'} WAITING FOR CLAUDE SYNTHESIS...</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const report = job.result;
  if (!report) return null;

  const { signals } = report;

  const decisionMakers = signals.contact?.decisionMakers ?? [];
  const hasContacts = !!(
    decisionMakers.length ||
    (signals.contact?.emails?.length) ||
    (signals.contact?.phones?.length) ||
    (signals.contact?.socialLinks?.length)
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-6">
        <div>
          <Button variant="ghost" asChild className="mb-4 px-0 hover:bg-transparent text-muted-foreground hover:text-primary transition-colors">
            <Link href="/"><ArrowLeft className="mr-2 h-4 w-4" /> BACK_TO_COMMAND</Link>
          </Button>
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-3">
            {signals.company?.name || report.url.replace(/^https?:\/\//, '')}
            <Badge variant="outline" className="font-mono text-xs border-primary text-primary bg-primary/10">INTEL_ACQUIRED</Badge>
          </h1>
          <a href={report.url} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground font-mono hover:text-primary flex items-center gap-1 mt-1 transition-colors">
            {report.url} <LinkIcon className="h-3 w-3" />
          </a>
        </div>
        <div className="flex items-center gap-4 text-sm font-mono text-muted-foreground bg-muted/20 px-4 py-2 rounded-md border border-muted/50">
          <div className="flex flex-col">
            <span className="text-xs">PAGES_CRAWLED</span>
            <span className="text-foreground font-bold">{report.crawledPages}</span>
          </div>
          <Separator orientation="vertical" className="h-8" />
          <div className="flex flex-col">
            <span className="text-xs">DEPTH_LEVEL</span>
            <span className="text-foreground font-bold">{job.depth || 1}</span>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 border-b border-muted/30 pb-0">
        {(["overview", "contacts", "reviews", "competitors"] as const).map((tab) => {
          const icons = { overview: Terminal, contacts: UserCheck, reviews: Star, competitors: Swords };
          const Icon = icons[tab];
          const labels = { overview: "Intel Overview", contacts: "Contacts", reviews: "Reviews", competitors: "Competitors" };
          const isActive = activeTab === tab;
          const reviewAnalysis = report.reviewAnalysis;
          const hasReviews = !!(reviewAnalysis?.platformSummaries?.length || reviewAnalysis?.strengths?.length);
          const competitorAnalysis = report.competitorAnalysis;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-mono border-b-2 transition-colors ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {labels[tab].toUpperCase()}
              {tab === "contacts" && hasContacts && (
                <span className="ml-1 text-[10px] font-mono bg-primary/15 text-primary border border-primary/25 px-1.5 py-0.5 rounded-full">
                  {(signals.contact?.emails?.length ?? 0) + (signals.contact?.phones?.length ?? 0) + (signals.contact?.socialLinks?.length ?? 0)}
                </span>
              )}
              {tab === "reviews" && hasReviews && reviewAnalysis?.sentiment && (
                <span className={`ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full border ${
                  reviewAnalysis.sentiment === "Excellent" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" :
                  reviewAnalysis.sentiment === "Good" ? "bg-sky-500/15 text-sky-400 border-sky-500/25" :
                  reviewAnalysis.sentiment === "Mixed" ? "bg-amber-500/15 text-amber-400 border-amber-500/25" :
                  "bg-rose-500/15 text-rose-400 border-rose-500/25"
                }`}>
                  {reviewAnalysis.sentiment}
                </span>
              )}
              {tab === "competitors" && competitorAnalysis && (
                <span className="ml-1 text-[10px] font-mono bg-rose-500/15 text-rose-400 border border-rose-500/25 px-1.5 py-0.5 rounded-full">
                  {competitorAnalysis.vendorName}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Contacts tab ─────────────────────────────────────────────────────── */}
      {activeTab === "contacts" && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {!hasContacts ? (
            <Card className="border-muted/30 bg-card/50">
              <CardContent className="pt-8 pb-8 flex flex-col items-center justify-center text-center space-y-3">
                <UserCheck className="h-10 w-10 text-muted-foreground/30" />
                <div>
                  <p className="font-mono text-sm text-muted-foreground">NO_CONTACTS_FOUND</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">No emails, phones, or social profiles were extracted from this site.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {decisionMakers.length > 0 && (
                <Card className="border-emerald-500/20 bg-emerald-500/5 shadow-none md:col-span-2">
                  <CardHeader className="pb-3 border-b border-muted/20 mb-4">
                    <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
                      <User className="h-4 w-4 text-emerald-400/70" /> Decision Makers
                      <Badge variant="secondary" className="ml-auto font-mono text-xs">{decisionMakers.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {decisionMakers.map((dm, i) => (
                        <div key={i} className="rounded-md border border-emerald-500/15 bg-emerald-500/5 p-3 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 shrink-0 text-emerald-400/60" />
                            <span className="text-sm font-semibold text-foreground/85 truncate">{dm.name}</span>
                          </div>
                          {dm.title && (
                            <p className="text-xs text-muted-foreground/60 font-mono pl-5 truncate">{dm.title}</p>
                          )}
                          {dm.email && (
                            <div className="flex items-center gap-1.5 pl-5">
                              <Mail className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                              <a href={`mailto:${dm.email}`} className="text-xs text-sky-400/80 hover:text-sky-400 truncate transition-colors flex-1">{dm.email}</a>
                              <CopyButton text={dm.email} />
                            </div>
                          )}
                          {dm.phone && (
                            <div className="flex items-center gap-1.5 pl-5">
                              <Phone className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                              <span className="text-xs font-mono text-muted-foreground/70 flex-1">{dm.phone}</span>
                              <CopyButton text={dm.phone} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {signals.contact?.emails && signals.contact.emails.length > 0 && (
                <Card className="border-muted/50 bg-card/50 shadow-none">
                  <CardHeader className="pb-3 border-b border-muted/20 mb-4">
                    <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
                      <Mail className="h-4 w-4" /> Email Addresses
                      <Badge variant="secondary" className="ml-auto font-mono text-xs">{signals.contact.emails.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {signals.contact.emails.map((email, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/10 border border-muted/20 hover:border-primary/30 transition-colors group">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                        <a href={`mailto:${email}`} className="text-sm font-mono text-foreground/80 hover:text-primary transition-colors truncate flex-1">
                          {email}
                        </a>
                        <CopyButton text={email} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {signals.contact?.phones && signals.contact.phones.length > 0 && (
                <Card className="border-muted/50 bg-card/50 shadow-none">
                  <CardHeader className="pb-3 border-b border-muted/20 mb-4">
                    <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
                      <Phone className="h-4 w-4" /> Phone Numbers
                      <Badge variant="secondary" className="ml-auto font-mono text-xs">{signals.contact.phones.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {signals.contact.phones.map((phone, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/10 border border-muted/20 hover:border-primary/30 transition-colors">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                        <span className="text-sm font-mono text-foreground/80 flex-1">{phone}</span>
                        <CopyButton text={phone} />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {(() => {
                const enrichedProfiles = signals.contact?.socialProfiles ?? [];
                const rawLinks = signals.contact?.socialLinks ?? [];
                const enrichedUrls = new Set(enrichedProfiles.map((p) => p.url));
                const fallbackLinks = rawLinks.filter((l) => !enrichedUrls.has(l));
                const hasAny = enrichedProfiles.length > 0 || fallbackLinks.length > 0;
                if (!hasAny) return null;
                const totalCount = enrichedProfiles.length + fallbackLinks.length;
                const getPlatformFromUrl = (link: string) => {
                  try {
                    const h = new URL(link).hostname.replace("www.", "").toLowerCase();
                    if (h.includes("facebook")) return "Facebook";
                    if (h.includes("instagram")) return "Instagram";
                    if (h.includes("linkedin")) return "LinkedIn";
                    if (h.includes("twitter") || h.includes("x.com")) return "X / Twitter";
                    if (h.includes("youtube")) return "YouTube";
                    if (h.includes("tiktok")) return "TikTok";
                    return h;
                  } catch { return "Web"; }
                };
                return (
                  <Card className="border-muted/50 bg-card/50 shadow-none md:col-span-2">
                    <CardHeader className="pb-3 border-b border-muted/20 mb-4">
                      <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
                        <LinkIcon className="h-4 w-4" /> Social Profiles
                        <Badge variant="secondary" className="ml-auto font-mono text-xs">{totalCount}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {enrichedProfiles.map((sp, i) => (
                          <a
                            key={i}
                            href={sp.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex flex-col gap-1.5 p-3 rounded-md bg-muted/10 border border-muted/20 hover:border-primary/30 hover:bg-primary/5 transition-colors group"
                          >
                            <div className="flex items-center gap-2">
                              <LinkIcon className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary/60 shrink-0 transition-colors" />
                              <span className="text-sm font-medium text-foreground/80 group-hover:text-primary transition-colors">{sp.platform}</span>
                              {sp.followers && (
                                <span className="ml-auto text-[10px] font-mono text-muted-foreground/50 tabular-nums shrink-0">{sp.followers}</span>
                              )}
                            </div>
                            {sp.bio && (
                              <p className="text-xs text-muted-foreground/60 leading-relaxed line-clamp-2 italic pl-5">"{sp.bio}"</p>
                            )}
                            <div className="flex flex-wrap items-center gap-1.5 pl-5">
                              {sp.postTone && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-violet-500/10 border border-violet-500/20 text-violet-400/70">{sp.postTone}</span>
                              )}
                              {sp.categoryTags?.slice(0, 2).map((tag, j) => (
                                <span key={j} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-muted/20 border border-muted/30 text-muted-foreground/60">{tag}</span>
                              ))}
                            </div>
                          </a>
                        ))}
                        {fallbackLinks.map((link, i) => {
                          const platform = getPlatformFromUrl(link);
                          let hostname = link;
                          try { hostname = new URL(link).hostname.replace("www.", ""); } catch { /* ignore */ }
                          return (
                            <a
                              key={`fb-${i}`}
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2.5 p-3 rounded-md bg-muted/10 border border-muted/20 hover:border-primary/30 hover:bg-primary/5 transition-colors group"
                            >
                              <LinkIcon className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary/60 shrink-0 transition-colors" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground/80 group-hover:text-primary transition-colors">{platform}</p>
                                <p className="text-xs text-muted-foreground/50 truncate font-mono">{hostname}</p>
                              </div>
                            </a>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ── Reviews tab ──────────────────────────────────────────────────────── */}
      {activeTab === "reviews" && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {!report.reviewAnalysis ? (
            <Card className="border-muted/30 bg-card/50">
              <CardContent className="pt-8 pb-8 flex flex-col items-center justify-center text-center space-y-3">
                <Star className="h-10 w-10 text-muted-foreground/30" />
                <div>
                  <p className="font-mono text-sm text-muted-foreground">NO_REVIEW_DATA</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">No review platforms were found or accessible for this site.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Sentiment + platform row */}
              <div className="flex flex-wrap items-center gap-3">
                {report.reviewAnalysis.sentiment && (() => {
                  const s = report.reviewAnalysis!.sentiment;
                  const cls =
                    s === "Excellent" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" :
                    s === "Good"      ? "bg-sky-500/10 border-sky-500/30 text-sky-400" :
                    s === "Mixed"     ? "bg-amber-500/10 border-amber-500/30 text-amber-400" :
                                        "bg-rose-500/10 border-rose-500/30 text-rose-400";
                  return (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-mono font-semibold text-sm ${cls}`}>
                      <Star className="h-3.5 w-3.5" />
                      Overall: {s}
                    </span>
                  );
                })()}
                {report.reviewAnalysis.platformSummaries.map((ps, i) => (
                  <a
                    key={i}
                    href={ps.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-muted/30 bg-muted/10 hover:border-primary/30 transition-colors text-sm font-mono"
                  >
                    <span className="text-foreground/80">{ps.platform}</span>
                    {ps.rating != null && (
                      <span className="text-amber-400 font-semibold">{ps.rating}★</span>
                    )}
                    {ps.reviewCount != null && (
                      <span className="text-muted-foreground/50 text-xs">· {ps.reviewCount.toLocaleString()}</span>
                    )}
                  </a>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Strengths */}
                {report.reviewAnalysis.strengths.length > 0 && (
                  <Card className="border-emerald-500/20 bg-emerald-500/5 shadow-none">
                    <CardHeader className="pb-3 border-b border-muted/20 mb-4">
                      <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-400/70" /> Strengths
                        <Badge variant="secondary" className="ml-auto font-mono text-xs">{report.reviewAnalysis.strengths.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {report.reviewAnalysis.strengths.map((s, i) => (
                        <div key={i} className="border-l-2 border-emerald-500/40 pl-3 space-y-1">
                          <p className="text-sm font-medium text-foreground/85">{s.summary}</p>
                          {s.quote && (
                            <p className="text-xs text-muted-foreground/60 italic">"{s.quote}"</p>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Weaknesses */}
                {report.reviewAnalysis.weaknesses.length > 0 && (
                  <Card className="border-rose-500/20 bg-rose-500/5 shadow-none">
                    <CardHeader className="pb-3 border-b border-muted/20 mb-4">
                      <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-rose-400/70" /> Watch-outs
                        <Badge variant="secondary" className="ml-auto font-mono text-xs">{report.reviewAnalysis.weaknesses.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {report.reviewAnalysis.weaknesses.map((w, i) => (
                        <div key={i} className="border-l-2 border-rose-500/40 pl-3 space-y-1">
                          <p className="text-sm font-medium text-foreground/85">{w.summary}</p>
                          {w.quote && (
                            <p className="text-xs text-muted-foreground/60 italic">"{w.quote}"</p>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Aspect breakdown */}
              {report.reviewAnalysis.aspects.length > 0 && (
                <Card className="border-muted/50 bg-card/50 shadow-none">
                  <CardHeader className="pb-3 border-b border-muted/20 mb-4">
                    <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
                      <Star className="h-4 w-4" /> Aspect Breakdown
                      <Badge variant="secondary" className="ml-auto font-mono text-xs">{report.reviewAnalysis.aspects.length} aspects</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {report.reviewAnalysis.aspects.map((a, i) => (
                        <div key={i} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-foreground/80">{a.name}</span>
                            <span className={`text-sm font-bold font-mono tabular-nums ${
                              a.score >= 4.5 ? "text-emerald-400" :
                              a.score >= 3.5 ? "text-sky-400" :
                              a.score >= 2.5 ? "text-amber-400" : "text-rose-400"
                            }`}>{a.score.toFixed(1)}★</span>
                          </div>
                          <div className="w-full h-1.5 bg-muted/30 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                a.score >= 4.5 ? "bg-emerald-500/70" :
                                a.score >= 3.5 ? "bg-sky-500/70" :
                                a.score >= 2.5 ? "bg-amber-500/70" : "bg-rose-500/70"
                              }`}
                              style={{ width: `${(a.score / 5) * 100}%` }}
                            />
                          </div>
                          {a.quote && (
                            <p className="text-[11px] text-muted-foreground/55 italic line-clamp-1">"{a.quote}"</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Competitors tab ──────────────────────────────────────────────────── */}
      {activeTab === "competitors" && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {!report.competitorAnalysis ? (
            <Card className="border-muted/30 bg-card/50">
              <CardContent className="pt-8 pb-8 flex flex-col items-center justify-center text-center space-y-3">
                <Swords className="h-10 w-10 text-muted-foreground/30" />
                <div>
                  <p className="font-mono text-sm text-muted-foreground">NO_INCUMBENT_DETECTED</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">No existing cashless/payment system was identified for this venue.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Vendor header */}
              <Card className="border-rose-500/20 bg-rose-500/5 shadow-none">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Swords className="h-4 w-4 text-rose-400/80" />
                        <span className="font-mono font-semibold text-rose-400 text-sm uppercase tracking-wide">Incumbent Detected</span>
                      </div>
                      <p className="text-xl font-semibold">{report.competitorAnalysis.vendorName}</p>
                      {report.competitorAnalysis.productCategory && (
                        <p className="text-xs font-mono text-muted-foreground/60">{report.competitorAnalysis.productCategory}</p>
                      )}
                      {report.competitorAnalysis.description && (
                        <p className="text-sm text-muted-foreground/80 pt-1">{report.competitorAnalysis.description}</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Comparison table */}
              {report.competitorAnalysis.comparisonTable.length > 0 && (
                <Card className="border-muted/30 bg-card/50 shadow-none">
                  <CardHeader className="pb-3 border-b border-muted/20 mb-0">
                    <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
                      <Swords className="h-4 w-4" /> Head-to-Head Comparison
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-muted/20">
                          <th className="text-left px-4 py-2.5 text-xs font-mono text-muted-foreground/60 uppercase w-[30%]">Aspect</th>
                          <th className="text-left px-4 py-2.5 text-xs font-mono text-rose-400/60 uppercase w-[35%]">
                            {report.competitorAnalysis.vendorName}
                          </th>
                          <th className="text-left px-4 py-2.5 text-xs font-mono text-emerald-400/60 uppercase w-[35%]">Us</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.competitorAnalysis.comparisonTable.map((row, i) => (
                          <tr key={i} className={`border-b border-muted/10 ${i % 2 === 0 ? "" : "bg-muted/5"}`}>
                            <td className="px-4 py-3 text-xs font-mono text-muted-foreground/70">{row.aspect}</td>
                            <td className="px-4 py-3 text-xs text-rose-300/70">{row.them}</td>
                            <td className="px-4 py-3 text-xs text-emerald-300/70">{row.us}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}

              {/* Social intel */}
              {report.competitorAnalysis.socialIntel.length > 0 && (
                <Card className="border-muted/30 bg-card/50 shadow-none">
                  <CardHeader className="pb-3 border-b border-muted/20 mb-4">
                    <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
                      Social Presence
                      <Badge variant="secondary" className="ml-auto font-mono text-xs">{report.competitorAnalysis.socialIntel.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {report.competitorAnalysis.socialIntel.map((s, i) => (
                      <div key={i} className="rounded-lg border border-muted/20 bg-muted/10 p-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono text-muted-foreground/70 uppercase">{s.platform}</span>
                          {s.url && (
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground/40 hover:text-primary transition-colors">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        {s.followers && <p className="text-xs text-foreground/80 font-semibold">{s.followers} followers</p>}
                        {s.bio && <p className="text-xs text-muted-foreground/60 line-clamp-2">{s.bio}</p>}
                        {s.postTone && <p className="text-xs text-muted-foreground/50 italic">{s.postTone}</p>}
                        {s.categoryTags && s.categoryTags.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {s.categoryTags.map((tag, j) => (
                              <span key={j} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted/20 border border-muted/25 text-muted-foreground/60">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Strategic overview + competitive angle */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {report.competitorAnalysis.strategicOverview && (
                  <Card className="border-muted/30 bg-card/50 shadow-none">
                    <CardHeader className="pb-3 border-b border-muted/20 mb-4">
                      <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
                        <TrendingUp className="h-4 w-4" /> Strategic Overview
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground/80 leading-relaxed">{report.competitorAnalysis.strategicOverview}</p>
                    </CardContent>
                  </Card>
                )}
                {report.competitorAnalysis.competitiveAngle && (
                  <Card className="border-primary/20 bg-primary/5 shadow-none">
                    <CardHeader className="pb-3 border-b border-muted/20 mb-4">
                      <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
                        <Swords className="h-4 w-4 text-primary/70" /> Competitive Angle
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-foreground/80 leading-relaxed">{report.competitorAnalysis.competitiveAngle}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Overview tab ─────────────────────────────────────────────────────── */}
      {activeTab === "overview" && <>
      <Card className="border-muted/50 bg-card/50 backdrop-blur shadow-none">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
            <Terminal className="h-4 w-4" /> Executive Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg leading-relaxed">{report.summary}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-muted/50 bg-card/50 backdrop-blur shadow-none">
          <CardHeader className="pb-3 border-b border-muted/20 mb-4">
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Entity Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {signals.company?.description && (
              <p className="text-sm text-muted-foreground mb-4">{signals.company.description}</p>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-sm">
              <div className="space-y-1">
                <dt className="text-xs font-mono text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3"/> LOCATION</dt>
                <dd className="font-medium">{signals.company?.location || "Unknown"}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs font-mono text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3"/> HEADCOUNT</dt>
                <dd className="font-medium">{signals.company?.employees || "Unknown"}</dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs font-mono text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3"/> FOUNDED</dt>
                <dd className="font-medium">{signals.company?.founded || "Unknown"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card className="border-muted/50 bg-card/50 backdrop-blur shadow-none">
          <CardHeader className="pb-3 border-b border-muted/20 mb-4">
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
              <Briefcase className="h-4 w-4" /> Hiring Signals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium">Active Hiring</span>
              {signals.hiring?.isHiring ? (
                <Badge className="bg-primary text-primary-foreground">CONFIRMED</Badge>
              ) : (
                <Badge variant="secondary">INACTIVE</Badge>
              )}
            </div>
            
            {signals.hiring?.roles && signals.hiring.roles.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-mono text-muted-foreground">OPEN_ROLES</h4>
                <div className="flex flex-wrap gap-2">
                  {signals.hiring.roles.map((role, i) => (
                    <Badge key={i} variant="outline" className="border-muted-foreground/30 font-normal">{role}</Badge>
                  ))}
                </div>
              </div>
            )}
            
            {signals.hiring?.signals && signals.hiring.signals.length > 0 && (
              <div className="space-y-2 mt-4">
                <h4 className="text-xs font-mono text-muted-foreground">ADDITIONAL_SIGNALS</h4>
                <ul className="text-sm space-y-1 text-muted-foreground list-disc list-inside pl-1">
                  {signals.hiring.signals.map((sig, i) => <li key={i}>{sig}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-muted/50 bg-card/50 backdrop-blur shadow-none md:col-span-2">
          <CardHeader className="pb-3 border-b border-muted/20 mb-4">
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
              <Terminal className="h-4 w-4" /> Tech Stack
            </CardTitle>
          </CardHeader>
          <CardContent>
            {signals.techStack && signals.techStack.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {signals.techStack.map((tech, i) => (
                  <Badge key={i} variant="secondary" className="bg-muted/40 hover:bg-primary/20 hover:text-primary transition-colors cursor-default font-mono text-xs px-2 py-1">
                    {tech}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No definitive technology signals detected.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-muted/50 bg-card/50 backdrop-blur shadow-none">
          <CardHeader className="pb-3 border-b border-muted/20 mb-4">
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
              <DollarSign className="h-4 w-4" /> Pricing & Commercial
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {signals.pricing?.tiers && signals.pricing.tiers.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-mono text-muted-foreground">IDENTIFIED_TIERS</h4>
                <ul className="text-sm space-y-2">
                  {signals.pricing.tiers.map((tier, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <div className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      <span>{tier}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {signals.pricing?.recentChanges && signals.pricing.recentChanges.length > 0 && (
              <div className="space-y-2 mt-4 pt-4 border-t border-muted/20">
                <h4 className="text-xs font-mono text-muted-foreground">RECENT_CHANGES</h4>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  {signals.pricing.recentChanges.map((change, i) => (
                    <li key={i}>- {change}</li>
                  ))}
                </ul>
              </div>
            )}
            {(!signals.pricing?.tiers?.length && !signals.pricing?.recentChanges?.length) && (
              <p className="text-sm text-muted-foreground">No public pricing information extracted.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-muted/50 bg-card/50 backdrop-blur shadow-none">
          <CardHeader className="pb-3 border-b border-muted/20 mb-4">
            <CardTitle className="text-sm font-mono text-muted-foreground uppercase flex items-center gap-2">
              <Newspaper className="h-4 w-4" /> News & Signals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {signals.news?.announcements && signals.news.announcements.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-mono text-muted-foreground">ANNOUNCEMENTS</h4>
                <ul className="text-sm space-y-2">
                  {signals.news.announcements.map((news, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">»</span>
                      <span className="text-muted-foreground">{news}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(!signals.news?.announcements?.length && !signals.news?.pressReleases?.length) && (
              <p className="text-sm text-muted-foreground">No recent news or announcements detected.</p>
            )}
          </CardContent>
        </Card>

        {hasContacts && (
          <Card className="border-primary/20 bg-primary/5 shadow-none md:col-span-2">
            <CardContent className="pt-4 pb-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <UserCheck className="h-4 w-4 text-primary/70" />
                <p className="text-sm font-mono text-foreground/70">
                  <span className="text-primary font-semibold">
                    {(signals.contact?.emails?.length ?? 0) + (signals.contact?.phones?.length ?? 0) + (signals.contact?.socialLinks?.length ?? 0)}
                  </span> contact signal{((signals.contact?.emails?.length ?? 0) + (signals.contact?.phones?.length ?? 0) + (signals.contact?.socialLinks?.length ?? 0)) !== 1 ? "s" : ""} extracted
                  {signals.contact?.emails?.length ? ` · ${signals.contact.emails.length} email${signals.contact.emails.length !== 1 ? "s" : ""}` : ""}
                  {signals.contact?.phones?.length ? ` · ${signals.contact.phones.length} phone${signals.contact.phones.length !== 1 ? "s" : ""}` : ""}
                  {signals.contact?.socialLinks?.length ? ` · ${signals.contact.socialLinks.length} social profile${signals.contact.socialLinks.length !== 1 ? "s" : ""}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-primary/30 text-primary hover:bg-primary/10 shrink-0"
                onClick={() => setActiveTab("contacts")}
              >
                <UserCheck className="h-3.5 w-3.5 mr-1.5" /> View Contacts
              </Button>
            </CardContent>
          </Card>
        )}

      </div>
      </>}
    </div>
  );
}
