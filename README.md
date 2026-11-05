<div align="center">

# RECON

### Find the venues. Keep the ones that fit.

**Search Google Maps for every business of a kind in any area, then score each one against your ideal customer profile.**

[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-blue)](LICENSE.md)
[![Commercial license available](https://img.shields.io/badge/commercial-license%20available-success)](COMMERCIAL-LICENSE.md)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-2EAD33?logo=playwright&logoColor=white)

</div>

---

## What it does

1. **Maps Search.** Pick an area (a city, a département, a whole country, or draw a box) and type what you look for ("arcade", "bowling alley"). RECON cuts the area into cells, searches Google Maps in each one and collects every place: name, category, address, rating, reviews, and optionally phone, website and hours.
2. **Lead Qualifier.** Send the places found (or upload a CSV / Excel list). RECON reads each website and scores the lead 0–100 against the active ICP, with a verdict (QUALIFY, BORDERLINE, DISQUALIFY) and the evidence it found.
3. **Export.** Download the leads as CSV / Excel, or push qualified leads to HubSpot or Salesforce.

RECON is **free to run**: no paid API is needed. Google Maps is read with a local headless browser, area outlines come from OpenStreetMap and GeoNames, and leads are scored by a small model that runs on your machine. Gemini can be switched on for qualification and term translation, but it is optional.

## Quick start (Windows)

You need [Node.js](https://nodejs.org) 20+, `pnpm` (`npm i -g pnpm`), [Git for Windows](https://git-scm.com) and a PostgreSQL database (the team uses [Neon](https://neon.com)).

1. Put the database URL in `.env.local` at the repo root (`DATABASE_URL=postgres://...`). `neon env pull` writes it for you.
2. Double-click **`start-recon.cmd`**.

The first run installs the dependencies and the browser used for Google Maps, builds the app and opens `http://localhost:8080`. After a code change, run `start-recon.cmd rebuild`.

Full setup, configuration and troubleshooting: [docs/setup.md](docs/setup.md).

## Documentation

| Guide | What it covers |
|---|---|
| [Setup](docs/setup.md) | Install, configuration variables, shared server, troubleshooting |
| [Maps search](docs/maps-search.md) | How a search works, what is listed or hidden, limits and speed |
| [Qualify and ICPs](docs/qualify.md) | How leads are scored, ICP library, current limits |
| [Architecture](docs/architecture.md) | Code layout, data flow, database tables, scripts |

## Project structure

```
RECON/
├── api-server/          Express API + the Maps and Qualify engines (also serves the built dashboard)
│   ├── data/            places.json.gz: the area list used for instant suggestions
│   └── src/
│       ├── routes/      HTTP routes (/api/maps, /api/qualify, /api/icp, /api/crm, /api/config)
│       └── lib/
│           ├── maps/    Google Maps search: areas, grid, crawler, job runner
│           └── qualify/ Website crawler, scoring (local model, rules, Gemini), batches
├── dashboard/           React + Vite web app
├── lib/
│   ├── db/              Database schema (Drizzle ORM, PostgreSQL)
│   └── integrations-gemini-ai/  Optional Gemini client
├── scripts/             build-gazetteer.mjs (area list), maps-benchmark.mjs (search speed/coverage)
├── docs/                Guides
└── start-recon.cmd      One-click launcher for Windows
```

## License

**Copyright © 2026 Salomon Sverdlov.** Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).

| Use | Allowed? |
|---|---|
| Personal projects, learning, research | Free, with credit to Salomon Sverdlov |
| Nonprofit and educational use | Free, with credit to Salomon Sverdlov |
| Selling Recon or any modified version | Requires a paid commercial license |
| Using Recon to make money | Requires a paid commercial license |

Any copy or modified version must keep the copyright notice and credit **Salomon Sverdlov** as the original author. For commercial terms, see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

Area data: [GeoNames](https://www.geonames.org) (CC BY 4.0) and [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).

<div align="center">

### Built by Salomon Sverdlov

For enquiries: **[sal.sverdlov@gmail.com](mailto:sal.sverdlov@gmail.com)**

</div>
