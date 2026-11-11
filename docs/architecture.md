# Architecture

A pnpm workspace in TypeScript. The API also serves the web app, so RECON runs as one process.

```
dashboard (React)  ──/api──▶  api-server (Express)  ──▶  PostgreSQL (Neon)
                                 ├─ Playwright ──▶ Google Maps
                                 ├─ crawler ──▶ lead websites
                                 └─ Claude ──▶ lead scoring
```

| Folder | Content |
|---|---|
| `api-server/src/routes/` | HTTP routes: maps, qualify, icp, crm, config, health |
| `api-server/src/lib/maps/` | Maps search: areas, grid, crawler, relevance, term translation |
| `api-server/src/lib/qualify/` | Qualification: website crawler, AI scoring, batches, AI usage |
| `dashboard/src/pages/` | One page per step: icp, maps, qualify, history, plus home and settings |
| `lib/db/` | Database schema (Drizzle) |
| `scripts/` | Area list rebuild, Maps benchmark |

## Database

| Table | Content |
|---|---|
| `maps_jobs` | Maps searches and their places |
| `qualify_batches` | Qualification batches and results |
| `icp_config` | ICPs |
| `platform_config` | Settings (CRM credentials) |

At startup RECON loads the data once and keeps a local copy (`.db-cache`), so it only downloads rows that changed. This keeps it under the Neon free plan's transfer limit.
