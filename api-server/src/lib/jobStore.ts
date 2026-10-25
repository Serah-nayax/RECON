import { randomUUID } from "crypto";
import { db, crawlHistory } from "@workspace/db";
import { logger } from "./logger.js";
import type { ReviewAnalysis } from "./analyzeReviews.js";
import type { CompetitorAnalysis } from "./analyzeCompetitor.js";

export type JobStatus = "pending" | "running" | "done" | "failed";

export interface PageData {
  url: string;
  title: string;
  description: string;
  headings: string[];
  bodyText: string;
  links: string[];
  jsonLd: string[];
  socialMeta: string[];
  phones: string[];
  emails: string[];
  imageAlts: string[];
}

export interface IntelSignals {
  company: {
    name: string | null;
    description: string | null;
    location: string | null;
    employees: string | null;
    founded: string | null;
  };
  hiring: {
    isHiring: boolean;
    roles: string[];
    signals: string[];
  };
  pricing: {
    tiers: string[];
    recentChanges: string[];
  };
  techStack: string[];
  news: {
    announcements: string[];
    pressReleases: string[];
  };
  contact: {
    emails: string[];
    phones: string[];
    socialLinks: string[];
    decisionMakers: Array<{ name: string; title: string | null; email: string | null; phone: string | null; }>;
    socialProfiles: Array<{ platform: string; url: string; bio: string | null; followers: string | null; postTone: string | null; categoryTags: string[]; }>;
  };
}

export interface IntelReport {
  url: string;
  crawledPages: number;
  summary: string;
  signals: IntelSignals;
  rawPages: PageData[];
  reviewAnalysis?: ReviewAnalysis | null;
  competitorAnalysis?: CompetitorAnalysis | null;
}

export interface CrawlJob {
  jobId: string;
  url: string;
  depth: number;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  result: IntelReport | null;
  error: string | null;
}

const store = new Map<string, CrawlJob>();

async function persistJob(job: CrawlJob): Promise<void> {
  try {
    await db
      .insert(crawlHistory)
      .values({
        jobId: job.jobId,
        url: job.url,
        depth: job.depth,
        status: job.status,
        result: job.result as unknown as Record<string, unknown> | null,
        error: job.error,
        createdAt: new Date(job.createdAt),
        updatedAt: new Date(job.updatedAt),
      })
      .onConflictDoUpdate({
        target: crawlHistory.jobId,
        set: {
          status: job.status,
          result: job.result as unknown as Record<string, unknown> | null,
          error: job.error,
          updatedAt: new Date(job.updatedAt),
        },
      });
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, "Failed to persist crawl job to DB");
  }
}

export async function initJobStore(): Promise<void> {
  try {
    const rows = await db.select().from(crawlHistory);
    for (const row of rows) {
      store.set(row.jobId, {
        jobId: row.jobId,
        url: row.url,
        depth: row.depth,
        status: row.status as JobStatus,
        result: row.result as IntelReport | null,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    }
    logger.info({ count: rows.length }, "Crawl history loaded from database");
  } catch (err) {
    logger.error({ err }, "Failed to load crawl history from DB");
  }
}

export function createJob(url: string, depth: number): CrawlJob {
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const job: CrawlJob = {
    jobId,
    url,
    depth,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    result: null,
    error: null,
  };
  store.set(jobId, job);
  void persistJob(job);
  return job;
}

export function getJob(jobId: string): CrawlJob | undefined {
  return store.get(jobId);
}

export function updateJob(jobId: string, updates: Partial<CrawlJob>): void {
  const job = store.get(jobId);
  if (!job) return;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  void persistJob(job);
}

export function listJobs(): CrawlJob[] {
  return Array.from(store.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}
