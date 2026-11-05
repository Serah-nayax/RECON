# Architecture

A pnpm workspace with one API, one web app and two shared libraries. Everything is TypeScript.

```
dashboard (React, Vite)  ──/api──▶  api-server (Express 5)  ──▶  PostgreSQL (lib/db, Drizzle)
                                       │
                                       ├─ Playwright + Crawlee ──▶ Google Maps
                                       ├─ fetch + Cheerio      ──▶ lead websites
                                       ├─ OpenStreetMap (Nominatim, Photon) ──▶ area outlines
                                       ├─ local model (transformers.js) ──▶ lead scoring
                                       └─ Gemini (optional, lib/integrations-gemini-ai)
```

In production the API serves the built dashboard on the same port, so there is one process to run.

## api-server/src

| Path | Role |
|---|---|
| `index.ts` | Startup: loads stores from the database, resumes interrupted searches and batches, saves pending data on exit |
| `app.ts` | Express app: JSON, logs, `/api` routes, static dashboard |
| `routes/` | HTTP only, no business logic: `maps`, `qualify`, `icp`, `crm`, `config`, `health` |
| `lib/maps/areas.ts` | Area suggestions and outlines (OpenStreetMap, rate-limited to Nominatim's 1 request/s) |
| `lib/maps/gazetteer.ts` | Instant suggestions from `api-server/data/places.json.gz` |
| `lib/maps/geoGrid.ts` | Cuts an area into cells that touch its outline |
| `lib/maps/mapsJobRunner.ts` | The search engine: runs cells in the browser, cuts full cells, learns categories, pauses when the network drops |
| `lib/maps/googleMapsCrawler.ts` | Reads one cell: result list, place pages, limited-view detection |
| `lib/maps/searchProfile.ts` | Google categories to add per term; which places are listed, probable or hidden |
| `lib/maps/translateTerms.ts` | Local-language terms (dictionary, plus Gemini when on) |
| `lib/maps/mapsStore.ts` | Search jobs in memory, saved to `maps_jobs` (debounced) |
| `lib/maps/keepAwake.ts` | Keeps Windows awake while a search runs |
| `lib/qualify/qualifyRunner.ts` | Runs a batch: leads in parallel, progress, stop/retry |
| `lib/qualify/qualifyLead.ts` | One lead: crawl, then Gemini or the free scorers, with a 6-hour cache |
| `lib/qualify/websiteCrawler.ts` | Fetches a site's most useful pages |
| `lib/qualify/icpScoring.ts` | Local model scoring against any ICP |
| `lib/qualify/ruleScoring.ts` | Keyword rules (arcade ICP), fallback scorer |
| `lib/qualify/qualifyStore.ts` | Batches in memory, saved to `qualify_batches` |
| `lib/qualify/leadIdentity.ts`, `reviewLinks.ts`, `socialLinks.ts` | Website URL normalisation (cache key), review and social links found on sites |
| `lib/icpStore.ts`, `configStore.ts` | ICPs and Settings values (database) |
| `lib/geminiLimiter.ts` | Keeps Gemini calls within the free-tier quota |
| `lib/apiKeyMiddleware.ts` | `x-api-key` check, skipped in local mode |

## dashboard/src

| Path | Role |
|---|---|
| `pages/maps.tsx` | Area picker, grid, search form, live results |
| `pages/qualify.tsx` | File upload, batches, lead details, export, CRM push |
| `pages/icp.tsx`, `history.tsx`, `settings.tsx` | ICP library, past batches, settings |
| `components/MapGridPicker.tsx` | Leaflet map with the grid and area drawing |
| `lib/mapsApi.ts`, `lib/qualifyApi.ts` | Typed API calls |
| `lib/exportXlsx.ts` | Excel export |
| `components/ui/` | The few UI primitives used (button, card, dialog, toast…) |

## Database

Defined in `lib/db/src/schema`. Run `pnpm --filter @workspace/db run push` to create or update the tables.

| Table | Content |
|---|---|
| `maps_jobs` | Maps searches with their cells and places |
| `qualify_batches` | Qualify batches with their results |
| `icp_config` | ICPs and which one is active |
| `platform_config` | Settings values (CRM credentials) |
| `crawl_history`, `conversations`, `messages` | Left by earlier versions, no longer used. Kept so that no data is lost |

## Scripts

| Script | Purpose |
|---|---|
| `scripts/build-gazetteer.mjs` | Rebuilds `api-server/data/places.json.gz` from GeoNames (countries, regions, towns of 5,000+) |
| `scripts/maps-benchmark.mjs` | `node scripts/maps-benchmark.mjs "arcade" "Paris"`: runs a search on the local RECON and compares time and places found with earlier runs. Use it before keeping a change that is meant to make Maps faster |

## Conventions

- RECON must stay free to run: no paid service is required. AI stays opt-in (`RECON_ENABLE_GEMINI=1`).
- Completeness first: a change to Maps must not lose places. Check with the benchmark.
- UI and code are in English.
