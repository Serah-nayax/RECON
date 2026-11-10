<div align="center">

# RECON

### Find the venues. Keep the ones that fit.

**Search Google Maps for every business of a kind in any area, then score each one against your ideal customer profile.**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)

</div>

---

## What it does

1. **ICP.** Choose who you are looking for: pick an ideal customer profile or write one.
2. **Maps Search.** Type what you are looking for and pick an area. RECON searches Google Maps across the whole area and lists every place it finds.
3. **Lead Qualifier.** Send the places found, or upload a list. RECON reads each website and scores the lead 0–100 against the active ICP, with a verdict and the evidence behind it.
4. **History and export.** Download the results as Excel or CSV once a batch is finished, or push qualified leads to HubSpot or Salesforce.

## Quick start (Windows)

You need [Node.js](https://nodejs.org) 20+, `pnpm` (`npm i -g pnpm`), [Git for Windows](https://git-scm.com) and a PostgreSQL database.

1. Put the database URL in `.env.local` at the repo root: `DATABASE_URL=postgres://...`
2. Double-click **`start-recon.cmd`**. It opens RECON on `http://localhost:8080`.

After pulling new code, run `start-recon.cmd rebuild`.

## Documentation

| Guide | Content |
|---|---|
| [Setup](docs/setup.md) | Install, configuration, troubleshooting |
| [Maps search](docs/maps-search.md) | Running a search and reading the results |
| [Qualify and ICPs](docs/qualify.md) | Scoring leads and managing ICPs |
| [Architecture](docs/architecture.md) | Code layout and database |

## Project structure

```
RECON/
├── api-server/          API, Maps and Qualify engines (also serves the dashboard)
├── dashboard/           Web app (React + Vite)
├── lib/db/              Database schema (Drizzle, PostgreSQL)
├── scripts/             Maintenance scripts
├── docs/                Guides
└── start-recon.cmd      Windows launcher
```

## License

RECON is built on an open-source project by Salomon Sverdlov, under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). Commercial use needs a commercial license: see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

Area data: [GeoNames](https://www.geonames.org) (CC BY 4.0) and [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
