# Setup

## Requirements

- **Node.js 20+** and **pnpm** (`npm i -g pnpm`)
- **Git for Windows**
- **PostgreSQL** (the team uses Neon)

## First run

1. Write the database URL in `.env.local` at the repo root:
   ```
   DATABASE_URL=postgres://user:password@host/db?sslmode=require
   ```
2. For a new database, create the tables: `pnpm --filter @workspace/db run push`.
3. Double-click `start-recon.cmd`. It installs everything, builds the app, starts RECON on `http://localhost:8080` and opens the browser. Close the window to stop it.

`start-recon.cmd rebuild` rebuilds before starting. Use it after pulling new code.

### Without the launcher

```bash
pnpm install
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/dashboard run build
pnpm --filter @workspace/api-server run build
PORT=8080 RECON_LOCAL=1 pnpm --filter @workspace/api-server run start
```

Dashboard dev server: `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/dashboard run dev` (forwards `/api` to `localhost:8080`).

Typecheck: `pnpm run typecheck`.

## Configuration

Settings go in `.env.local` at the repo root. Never commit it.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `PORT` | Port of RECON (launcher: 8080) |
| `RECON_LOCAL` | `1`: local use, no access key needed (launcher default) |
| `CRAWLER_API_KEY` | Access key for a shared server. Users enter it in Settings |
| `LOG_LEVEL` | `info` by default, `debug` for more detail |

### AI for Qualify (Claude)

| Variable | Purpose |
|---|---|
| `RECON_ENABLE_CLAUDE` | `1` to use Claude |
| `ANTHROPIC_API_KEY` | API key from the Claude Console |
| `CLAUDE_MODEL` | Default `claude-haiku-5-5` |

### AI with Gemini (alternative)

| Variable | Purpose |
|---|---|
| `RECON_ENABLE_GEMINI` | `1` to use Gemini |
| `AI_INTEGRATIONS_GEMINI_API_KEY` | Gemini API key |
| `AI_INTEGRATIONS_GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` |
| `GEMINI_MODEL` | Default `gemini-2.5-flash` |

### Advanced

| Variable | Purpose |
|---|---|
| `MAPS_CONCURRENCY` | Browser pages searching at once (set automatically from the machine) |
| `MAPS_PROXY_URL` | Proxy for the Maps browser |
| `QUALIFY_CONCURRENCY` | Leads qualified at once |
| `DASHBOARD_DIST` | Location of the built dashboard |

## Settings page

- **Crawler API Key**: the access key of a shared RECON server.
- **CRM Integrations**: HubSpot token or Salesforce credentials, used to push qualified leads. A push updates the existing company (same website domain, or same name) or creates it. The RECON fields (`recon_score`, `recon_verdict`… in HubSpot, `RECON_Score__c`… in Salesforce) must exist in the CRM.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Certificate errors on the office network | Start Node with `--use-system-ca` (the launcher does) |
| `.env.local is missing` | Create it with `DATABASE_URL` |
| Maps search does not start | `cd api-server && npx playwright install chromium` |
| Dashboard shows an old version | `start-recon.cmd rebuild` |
