# Business Intel Crawler API

A Crawlee-powered business intelligence API. POST a company URL, get back structured signal intel: hiring signals, pricing, tech stack, news, contact info — all synthesized by Claude.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## API Usage

All crawl endpoints require the `x-api-key` header. The key is stored as `CRAWLER_API_KEY` in environment variables.

### Start a crawl

```bash
curl -X POST https://YOUR_DOMAIN/api/crawl \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_CRAWLER_API_KEY" \
  -d '{ "url": "https://stripe.com", "depth": 2, "maxPages": 20 }'
```

Response (202):
```json
{
  "jobId": "uuid-here",
  "status": "pending",
  "message": "Crawl started. Poll GET /api/crawl/{jobId} for results."
}
```

### Poll for results

```bash
curl https://YOUR_DOMAIN/api/crawl/{jobId} \
  -H "x-api-key: YOUR_CRAWLER_API_KEY"
```

Response when `status: "done"`:
```json
{
  "jobId": "...",
  "url": "https://stripe.com",
  "status": "done",
  "createdAt": "...",
  "updatedAt": "...",
  "result": {
    "url": "https://stripe.com",
    "crawledPages": 18,
    "summary": "Stripe is a payment infrastructure company...",
    "signals": {
      "company": { "name": "Stripe", "description": "...", "location": "San Francisco, CA", "employees": "7000+", "founded": "2010" },
      "hiring": { "isHiring": true, "roles": ["Senior Engineer", "Product Manager"], "signals": ["..."] },
      "pricing": { "tiers": ["Starter", "Growth", "Enterprise"], "recentChanges": [] },
      "techStack": ["React", "Go", "Ruby"],
      "news": { "announcements": ["..."], "pressReleases": ["..."] },
      "contact": { "emails": [], "phones": [], "socialLinks": ["https://twitter.com/stripe"] }
    },
    "rawPages": [{ "url": "...", "title": "...", "text": "..." }]
  }
}
```

### List all jobs

```bash
curl https://YOUR_DOMAIN/api/crawl \
  -H "x-api-key: YOUR_CRAWLER_API_KEY"
```

## Parameters

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | required | Business website URL |
| `depth` | 1–3 | 2 | Link-follow depth (1=homepage only) |
| `maxPages` | 1–50 | 20 | Max pages to crawl |

## Job States

| Status | Meaning |
|--------|---------|
| `pending` | Queued, not started |
| `running` | Actively crawling |
| `done` | Complete, `result` is populated |
| `failed` | Error, `error` field has details |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CRAWLER_API_KEY` | API key for authenticating all crawl endpoints |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | Auto-set by Replit AI Integrations |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | Auto-set by Replit AI Integrations |
| `DATABASE_URL` | Postgres connection string |

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Crawler: Crawlee (`@crawlee/cheerio`) — lightweight Cheerio-based crawler
- AI Synthesis: Anthropic Claude (via Replit AI Integrations — no API key needed)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild

## Where things live

- `artifacts/api-server/src/routes/crawl.ts` — crawl routes (POST/GET)
- `artifacts/api-server/src/lib/crawler.ts` — Crawlee crawler implementation
- `artifacts/api-server/src/lib/synthesize.ts` — Claude synthesis logic
- `artifacts/api-server/src/lib/jobStore.ts` — in-memory job store
- `artifacts/api-server/src/lib/apiKeyMiddleware.ts` — API key auth
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)

## Architecture decisions

- **In-memory job store**: Results live in RAM, not a DB. Jobs are lost on server restart. Good for now; swap to DB if persistence is needed.
- **CheerioCrawler (no browser)**: Uses HTTP + Cheerio (not Playwright). Fast, lightweight, works on most public sites. Sites that require JavaScript rendering may return sparse results.
- **Async jobs**: Crawls are kicked off async and polled — a typical crawl takes 15–90 seconds depending on site size and depth.
- **Claude synthesis**: Crawled text is fed to `claude-sonnet-4-6` which extracts structured signals in one call. Structured JSON is requested directly in the prompt.

## Gotchas

- Run `pnpm install --no-frozen-lockfile` after any `package.json` change
- Run `pnpm --filter @workspace/api-spec run codegen` after any OpenAPI spec change
- Some sites block automated crawlers (Cloudflare, robots.txt). The crawler will collect what it can and return partial data.
- `depth: 3` + `maxPages: 50` can take 2–3 minutes on large sites

## User preferences

- Pure API — no frontend, connect from anywhere
