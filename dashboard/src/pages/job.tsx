import { useParams, Link } from "wouter";
import { useGetCrawlJob, getGetCrawlJobQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Building2, Users, DollarSign, Newspaper, Link as LinkIcon, Code2, AlertCircle } from "lucide-react";
import { format } from "date-fns";

export default function Job() {
  const params = useParams();
  const jobId = params.jobId!;

  const { data: job, isLoading, isError, error } = useGetCrawlJob(jobId, {
    query: {
      enabled: !!jobId,
      queryKey: getGetCrawlJobQueryKey(jobId),
      refetchInterval: (query) => {
        // Type narrowing for the query state shape in v5
        const data = query.state?.data as any;
        return (data?.status === "done" || data?.status === "failed") ? false : 3000;
      }
    }
  });

  if (isLoading && !job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="font-mono text-sm text-muted-foreground animate-pulse">Retrieving intel report...</p>
      </div>
    );
  }

  if (isError || !job) {
    return (
      <div className="bg-destructive/10 text-destructive p-6 rounded-lg border border-destructive/20 flex flex-col items-center justify-center text-center space-y-4">
        <AlertCircle className="w-10 h-10" />
        <div>
          <h2 className="font-bold text-lg">Failed to retrieve job</h2>
          <p className="text-sm opacity-90">{error?.message || "Unknown error occurred"}</p>
        </div>
        <Link href="/" className="underline font-mono text-sm">Return to dashboard</Link>
      </div>
    );
  }

  const isRunning = job.status === "running" || job.status === "pending";

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex items-center justify-between border-b pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-muted-foreground hover:text-primary transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-2xl font-bold font-mono truncate max-w-xl" title={job.url}>
              {job.url}
            </h1>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground font-mono ml-8">
            <span>ID: {job.jobId.slice(0, 8)}</span>
            <span>Started: {format(new Date(job.createdAt), "MMM d, yyyy HH:mm")}</span>
          </div>
        </div>
        <div>
          <JobStatusBadge status={job.status} />
        </div>
      </div>

      {isRunning && (
        <Card className="border-2 border-primary/20 bg-primary/5">
          <CardContent className="pt-6 flex flex-col items-center justify-center text-center space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <div className="space-y-1">
              <h3 className="font-bold font-mono text-lg">Reconnaissance in progress</h3>
              <p className="text-sm text-muted-foreground font-mono">Crawling pages and extracting signals. This may take a minute...</p>
            </div>
          </CardContent>
        </Card>
      )}

      {job.status === "failed" && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="pt-6 space-y-2 text-destructive">
            <div className="flex items-center gap-2 font-bold font-mono">
              <AlertCircle className="w-5 h-5" /> Operation Failed
            </div>
            <p className="font-mono text-sm">{job.error || "Unknown error during crawl process."}</p>
          </CardContent>
        </Card>
      )}

      {job.status === "done" && job.result && (
        <div className="space-y-8">
          <section className="bg-card border rounded-lg p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-4 font-mono">Executive Summary</h2>
            <p className="text-lg leading-relaxed text-foreground font-medium">
              {job.result.summary}
            </p>
            <div className="mt-4 pt-4 border-t flex gap-6 text-sm font-mono text-muted-foreground">
              <div>Pages Crawled: <strong className="text-foreground">{job.result.crawledPages}</strong></div>
              <div>Depth: <strong className="text-foreground">{job.depth || 1}</strong></div>
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Company Info */}
            <SignalCard title="Company Profile" icon={<Building2 className="w-5 h-5" />} data={job.result.signals?.company}>
              {(data) => (
                <div className="space-y-3 text-sm">
                  {data.name && <div className="grid grid-cols-[100px_1fr]"><span className="text-muted-foreground font-mono">Name</span><strong className="font-medium">{data.name}</strong></div>}
                  {data.location && <div className="grid grid-cols-[100px_1fr]"><span className="text-muted-foreground font-mono">Location</span><span>{data.location}</span></div>}
                  {data.founded && <div className="grid grid-cols-[100px_1fr]"><span className="text-muted-foreground font-mono">Founded</span><span>{data.founded}</span></div>}
                  {data.employees && <div className="grid grid-cols-[100px_1fr]"><span className="text-muted-foreground font-mono">Size</span><span>{data.employees}</span></div>}
                  {data.description && (
                    <div className="mt-4 pt-3 border-t">
                      <p className="text-muted-foreground">{data.description}</p>
                    </div>
                  )}
                </div>
              )}
            </SignalCard>

            {/* Hiring */}
            <SignalCard title="Hiring Signals" icon={<Users className="w-5 h-5" />} data={job.result.signals?.hiring}>
              {(data) => (
                <div className="space-y-4 text-sm">
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-muted-foreground">Status:</span> 
                    {data.isHiring ? (
                      <Badge variant="default" className="bg-green-600">Actively Hiring</Badge>
                    ) : (
                      <Badge variant="secondary">No obvious signals</Badge>
                    )}
                  </div>
                  
                  {data.roles && data.roles.length > 0 && (
                    <div>
                      <div className="font-mono text-xs text-muted-foreground mb-2">Key Roles</div>
                      <ul className="list-disc pl-4 space-y-1 text-foreground/80">
                        {data.roles.map((role, i) => <li key={i}>{role}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </SignalCard>

            {/* Pricing */}
            <SignalCard title="Pricing & Monetization" icon={<DollarSign className="w-5 h-5" />} data={job.result.signals?.pricing}>
              {(data) => (
                <div className="space-y-4 text-sm">
                  {data.tiers && data.tiers.length > 0 && (
                    <div>
                      <div className="font-mono text-xs text-muted-foreground mb-2">Identified Tiers</div>
                      <div className="flex flex-wrap gap-2">
                        {data.tiers.map((tier, i) => <Badge key={i} variant="outline" className="font-mono">{tier}</Badge>)}
                      </div>
                    </div>
                  )}
                  {data.recentChanges && data.recentChanges.length > 0 && (
                    <div>
                      <div className="font-mono text-xs text-muted-foreground mb-2">Notes</div>
                      <ul className="list-disc pl-4 space-y-1 text-foreground/80">
                        {data.recentChanges.map((change, i) => <li key={i}>{change}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </SignalCard>

            {/* Tech Stack */}
            <SignalCard title="Tech Stack" icon={<Code2 className="w-5 h-5" />} data={job.result.signals?.techStack && job.result.signals.techStack.length > 0 ? job.result.signals.techStack : undefined}>
              {(stack) => (
                <div className="flex flex-wrap gap-2">
                  {stack.map((tech, i) => (
                    <Badge key={i} variant="secondary" className="font-mono rounded-sm">{tech}</Badge>
                  ))}
                </div>
              )}
            </SignalCard>

            {/* News */}
            <SignalCard title="Recent Intel / News" icon={<Newspaper className="w-5 h-5" />} data={job.result.signals?.news}>
              {(data) => (
                <div className="space-y-4 text-sm">
                  {data.announcements && data.announcements.length > 0 && (
                    <div>
                      <div className="font-mono text-xs text-muted-foreground mb-2">Announcements</div>
                      <ul className="space-y-2">
                        {data.announcements.map((item, i) => (
                          <li key={i} className="pl-3 border-l-2 border-primary/20 text-foreground/80">{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </SignalCard>

            {/* Contact */}
            <SignalCard title="Contact Surface" icon={<LinkIcon className="w-5 h-5" />} data={job.result.signals?.contact}>
              {(data) => (
                <div className="space-y-3 text-sm">
                  {data.emails && data.emails.length > 0 && (
                    <div className="grid grid-cols-[80px_1fr]">
                      <span className="text-muted-foreground font-mono">Emails</span>
                      <div className="flex flex-wrap gap-1">
                        {data.emails.map(e => <span key={e} className="bg-muted px-1.5 py-0.5 rounded text-xs">{e}</span>)}
                      </div>
                    </div>
                  )}
                  {data.socialLinks && data.socialLinks.length > 0 && (
                    <div className="grid grid-cols-[80px_1fr]">
                      <span className="text-muted-foreground font-mono">Socials</span>
                      <div className="flex flex-wrap gap-2">
                        {data.socialLinks.map(l => (
                          <a key={l} href={l} target="_blank" rel="noreferrer" className="text-primary hover:underline max-w-[200px] truncate block text-xs">
                            {l.replace(/^https?:\/\/(www\.)?/, '')}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </SignalCard>
          </div>
        </div>
      )}
    </div>
  );
}

function SignalCard<T>({ 
  title, 
  icon, 
  data, 
  children 
}: { 
  title: string, 
  icon: React.ReactNode, 
  data: T | undefined | null,
  children: (data: NonNullable<T>) => React.ReactNode 
}) {
  const isEmpty = !data || (Array.isArray(data) && data.length === 0) || (typeof data === 'object' && Object.values(data).every(v => !v || (Array.isArray(v) && v.length === 0)));

  return (
    <Card className={`border-border ${isEmpty ? 'opacity-50' : ''}`}>
      <CardHeader className="bg-muted/30 border-b py-3 px-4 flex flex-row items-center gap-3 space-y-0">
        <div className="text-primary">{icon}</div>
        <CardTitle className="font-mono text-sm tracking-wide uppercase">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {isEmpty ? (
          <span className="font-mono text-xs text-muted-foreground">NO SIGNAL DETECTED</span>
        ) : (
          children(data as NonNullable<T>)
        )}
      </CardContent>
    </Card>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  if (status === "done") {
    return <Badge className="bg-green-600 hover:bg-green-700 font-mono text-xs px-3 py-1 uppercase rounded-sm">Operation Complete</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive" className="font-mono text-xs px-3 py-1 uppercase rounded-sm">Operation Failed</Badge>;
  }
  if (status === "running") {
    return (
      <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200 font-mono text-xs px-3 py-1 uppercase rounded-sm flex items-center">
        <Loader2 className="w-3 h-3 mr-2 animate-spin" /> In Progress
      </Badge>
    );
  }
  return <Badge variant="outline" className="font-mono text-xs px-3 py-1 uppercase rounded-sm">Pending</Badge>;
}
