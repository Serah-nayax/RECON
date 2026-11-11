# Setup

## Install

You need **Node.js 20+**, **pnpm** (`npm i -g pnpm`), **Git for Windows** and a PostgreSQL database (the team uses Neon).

1. Create `.env.local` at the repo root:
   ```
   DATABASE_URL=postgres://user:password@host/db?sslmode=require
   ```
2. New database only: `pnpm --filter @workspace/db run push` creates the tables.
3. Double-click `start-recon.cmd`. It installs, builds, starts RECON on `http://localhost:8080` and opens the browser.

After pulling new code: `start-recon.cmd rebuild`.

## Configuration (`.env.local`, never commit it)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Database (required) |
| `RECON_ENABLE_CLAUDE=1` + `ANTHROPIC_API_KEY` | AI qualification with Claude. Without it, a basic local scorer is used |
| `CLAUDE_MODEL` | Default `claude-haiku-5-5` |
| `CRAWLER_API_KEY` | Access key when RECON runs on a shared server (entered in Settings) |
| `PORT` | Default 8080 |

Advanced: `MAPS_CONCURRENCY`, `QUALIFY_CONCURRENCY`, `MAPS_PROXY_URL`, `LOG_LEVEL`.

**Tigapo locations:** put the Tigapo exports in `data/tigapo/` (`Locations.xlsx`, `Customers.xlsx`, `Locations*.csv`). This folder is never committed. A new export is picked up without a restart.

## Without the launcher

```bash
pnpm install
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/dashboard run build
pnpm --filter @workspace/api-server run build
PORT=8080 RECON_LOCAL=1 pnpm --filter @workspace/api-server run start
```

## Troubleshooting

| Problem | Fix |
|---|---|
| Certificate errors on the office network | Start Node with `--use-system-ca` (the launcher does) |
| Maps search does not start | `cd api-server && npx playwright install chromium` |
| Dashboard shows an old version | `start-recon.cmd rebuild` |
