# Setup

## Requirements

- **Node.js 20+** and **pnpm** (`npm i -g pnpm`). `start-recon.cmd` also finds a portable Node in `%USERPROFILE%\tools\node\node-v26.13.0-win-x64` (no admin rights needed).
- **Git for Windows**: pnpm scripts need its `sh`.
- **PostgreSQL**. The team uses Neon; any PostgreSQL works.
- **Chromium for Playwright**. `start-recon.cmd` installs it on first run (`npx playwright install chromium` in `api-server/`).

## First run

1. Write the database URL in `.env.local` at the repo root:
   ```
   DATABASE_URL=postgres://user:password@host/db?sslmode=require
   ```
   With the Neon CLI, `neon env pull` writes this file.
2. If the database is new, create the tables: `pnpm --filter @workspace/db run push`.
3. Double-click `start-recon.cmd`. It installs dependencies, builds the dashboard and the API, starts RECON on `http://localhost:8080` and opens your browser. Close the window to stop it.

`start-recon.cmd rebuild` rebuilds before starting. Use it after pulling new code.

### Without the launcher

```bash
pnpm install
# Build the dashboard (served by the API afterwards)
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/dashboard run build
# Build and start the API on port 8080, local mode
pnpm --filter @workspace/api-server run build
PORT=8080 RECON_LOCAL=1 pnpm --filter @workspace/api-server run start
```

For live UI work, run the dashboard dev server next to the API: `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/dashboard run dev`. It forwards `/api` to `localhost:8080` (or to `API_PORT`).

Typecheck everything with `pnpm run typecheck`.

## Configuration

The API reads `.env` and `.env.local` at the repo root. Never commit them.

### Main settings

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `PORT` | required (launcher: 8080) | API port. The API also serves the dashboard |
| `RECON_LOCAL` | launcher: `1` | `1` listens on 127.0.0.1 only and needs no access key |
| `CRAWLER_API_KEY` | none | Access key required when `RECON_LOCAL` is not `1` (shared server). Users enter it in Settings |
| `DASHBOARD_DIST` | `dashboard/dist/public` | Where the built dashboard is |
| `LOG_LEVEL` | `info` | `debug` for more detail |

### Optional AI (Gemini)

RECON runs without AI. To let Gemini score leads and translate search terms, set all three:

| Variable | Purpose |
|---|---|
| `RECON_ENABLE_GEMINI` | `1` to switch Gemini on. Without it, Gemini is never called, even with a key |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Gemini API key (Google AI Studio has a free tier) |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` for an AI Studio key |
| `GEMINI_REQUESTS_PER_MINUTE` | Default 10, sized for the free tier |
| `GEMINI_CONCURRENCY` | Default 2 calls at once |
| `GEMINI_THINKING_BUDGET` | `0` turns Gemini's thinking off (faster) |

### Maps search tuning

The defaults were measured on real searches. Change them only when you investigate a problem.

| Variable | Default | Purpose |
|---|---|---|
| `MAPS_CONCURRENCY` | 4 | Browser pages searching cells at once |
| `MAPS_PROBE_CONCURRENCY` | 5 | Terms probed at once to learn Google's categories. Lower it if Google blocks |
| `MAPS_PROBE_TIMEOUT_MS` | 120000 | Longest a probe may take before the search goes on without it |
| `MAPS_DEFER_SPLITS` | on | Search every cell once before cutting full cells. `0` cuts as it goes |
| `MAPS_REPLAY` | on | Fetch the next result pages directly instead of scrolling. `0` scrolls |
| `MAPS_REPLAY_PARALLEL` | 3 | Result pages fetched at once |
| `MAPS_SCROLL_WAIT_MS` | 6000 | How long a scroll waits for more places |
| `MAPS_PROXY_URL` | none | Proxy for the Maps browser (very large searches) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` | Playwright's Chromium | Use another Chromium |

### Qualify tuning

| Variable | Default | Purpose |
|---|---|---|
| `QUALIFY_CONCURRENCY` | 8 | Leads qualified at once |
| `RECON_MODELS_DIR` | `.models/` at the repo root | Where the local scoring model is stored (~120 MB, downloaded once) |

## Settings page

- **Platform › Crawler API Key**: the `CRAWLER_API_KEY` of a shared RECON server. The browser keeps it and sends it with each request. It is not needed locally.
- **CRM Integrations**: a HubSpot access token, or Salesforce credentials, used to push qualified leads. They are stored in the database, and the same names also work as environment variables.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `fetch failed`, certificate errors (corporate network) | Start Node with `--use-system-ca`. The launcher and `pnpm start` already do. For curl, add `--ssl-no-revoke` |
| `.env.local is missing` | Create it with `DATABASE_URL` (see First run) |
| `PORT environment variable is required` | Set `PORT`, or use the launcher |
| Maps search does not start, browser errors | `cd api-server && npx playwright install chromium` |
| Dashboard shows an old version | `start-recon.cmd rebuild` |
| The PC sleeps during a long search | RECON keeps Windows awake while a search runs. The screen may still turn off |
