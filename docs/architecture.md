# Architecture

A pnpm workspace in TypeScript: one API, one web app and shared libraries.

```
dashboard (React, Vite)  ──/api──▶  api-server (Express 5)  ──▶  PostgreSQL (lib/db, Drizzle)
                                       │
                                       ├─ Playwright ──▶ Google Maps
                                       ├─ website crawler ──▶ lead websites
                                       ├─ OpenStreetMap ──▶ area outlines
                                       └─ Claude ──▶ lead scoring
```

The API also serves the built dashboard, so RECON runs as a single process.

## api-server/src

| Path | Role |
|---|---|
| `index.ts` | Startup: loads data from the database and resumes interrupted searches and batches |
| `app.ts` | Express app and `/api` routes |
| `routes/` | HTTP routes: `maps`, `qualify`, `icp`, `crm`, `config`, `health` |
| `lib/maps/` | Maps search: areas, grid, crawler, job runner, relevance of places, term translation |
| `lib/qualify/` | Qualify: website crawler, AI scoring, local scoring, batches, AI usage |
| `lib/icpStore.ts`, `lib/configStore.ts` | ICPs and settings |
| `lib/apiKeyMiddleware.ts` | Access key check on a shared server |

## dashboard/src

| Path | Role |
|---|---|
| `pages/home.tsx` | Home: the three steps, active ICP, recent work |
| `pages/maps.tsx` | Maps search |
| `pages/qualify.tsx` | Lead Qualifier |
| `pages/icp.tsx`, `history.tsx`, `settings.tsx` | ICPs, history, settings |
| `components/MapGridPicker.tsx` | Map with the search grid |
| `components/layout.tsx` | Menu: the three steps in order, then ICP Library and Settings |
| `lib/` | API calls and Excel export |

## Database

Schema in `lib/db/src/schema`. `pnpm --filter @workspace/db run push` creates the tables.

| Table | Content |
|---|---|
| `maps_jobs` | Maps searches and their places |
| `qualify_batches` | Qualify batches and their results |
| `icp_config` | ICPs |
| `platform_config` | Settings (CRM credentials) |

## Scripts

| Script | Purpose |
|---|---|
| `scripts/build-gazetteer.mjs` | Rebuilds the area suggestion list |
| `scripts/maps-benchmark.mjs` | Measures the time and places found of a Maps search |
