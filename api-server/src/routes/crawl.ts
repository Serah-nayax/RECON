import { Router, type IRouter } from "express";
import { apiKeyMiddleware } from "../lib/apiKeyMiddleware.js";
import { createJob, getJob, listJobs, updateJob } from "../lib/jobStore.js";
import { crawlSite } from "../lib/crawler.js";
import { synthesizeIntel } from "../lib/synthesize.js";
import { extractReviewLinks, crawlReviewPages } from "../lib/reviewCrawler.js";
import { analyzeReviews } from "../lib/analyzeReviews.js";
import { analyzeCompetitor } from "../lib/analyzeCompetitor.js";
import { detectCompetitorFromText, lookupCompetitor } from "../lib/competitorMap.js";
import { crawlSocialProfiles } from "../lib/socialCrawler.js";
import { getIcp } from "../lib/icpStore.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.use(apiKeyMiddleware);

function validateCrawlRequest(body: unknown): { url: string; depth: number; maxPages: number } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Request body must be a JSON object" };
  const b = body as Record<string, unknown>;

  if (!b.url || typeof b.url !== "string" || b.url.trim() === "") {
    return { error: "url is required and must be a non-empty string" };
  }
  const depth = b.depth === undefined ? 2 : Number(b.depth);
  if (!Number.isInteger(depth) || depth < 1 || depth > 3) {
    return { error: "depth must be an integer between 1 and 3" };
  }
  const maxPages = b.maxPages === undefined ? 20 : Number(b.maxPages);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 50) {
    return { error: "maxPages must be an integer between 1 and 50" };
  }
  return { url: b.url.trim(), depth, maxPages };
}

router.post("/crawl", (req, res) => {
  const validated = validateCrawlRequest(req.body);
  if ("error" in validated) {
    res.status(400).json({ error: validated.error });
    return;
  }

  const { url, depth, maxPages } = validated;
  const job = createJob(url, depth);

  setImmediate(() => {
    runCrawl(job.jobId, url, depth, maxPages);
  });

  res.status(202).json({
    jobId: job.jobId,
    status: "pending",
    message: `Crawl started. Poll GET /api/crawl/${job.jobId} for results.`,
  });
});

router.get("/crawl", (_req, res) => {
  const jobs = listJobs().map(({ result: _r, ...rest }) => rest);
  res.json({ jobs });
});

router.get("/crawl/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

async function runCrawl(
  jobId: string,
  url: string,
  depth: number,
  maxPages: number,
): Promise<void> {
  updateJob(jobId, { status: "running" });
  try {
    logger.info({ jobId, url, depth, maxPages }, "Starting crawl");
    const pages = await crawlSite(url, depth, maxPages);
    logger.info({ jobId, pagesFound: pages.length }, "Crawl complete, synthesizing");

    const reviewLinks = extractReviewLinks(pages);
    const [report, reviewSignals] = await Promise.all([
      synthesizeIntel(url, pages),
      crawlReviewPages(reviewLinks),
    ]);

    // Detect competitor from page text + run analysis in parallel with reviews
    const allText = pages.map((p) => `${p.title} ${p.bodyText}`).join(" ");
    const competitorName = detectCompetitorFromText(allText);
    const icp = getIcp();

    const [reviewAnalysis, competitorAnalysis] = await Promise.all([
      analyzeReviews(reviewSignals),
      (async () => {
        if (!competitorName) return null;
        const profile = lookupCompetitor(competitorName);
        const socialUrls = profile?.social ?? [];
        const competitorSocial = await crawlSocialProfiles(socialUrls);
        return analyzeCompetitor(competitorName, profile, [], competitorSocial, icp.name);
      })(),
    ]);

    report.reviewAnalysis = reviewAnalysis;
    report.competitorAnalysis = competitorAnalysis;
    updateJob(jobId, { status: "done", result: report });
    logger.info({ jobId }, "Job complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, err: message }, "Crawl job failed");
    updateJob(jobId, { status: "failed", error: message });
  }
}

export default router;
