# RECON

**Find every venue of a kind in an area on Google Maps, then score each one against your ideal customer profile (ICP).**

## What it does

1. **ICP.** Pick the customer profile you are looking for. Four Tigapo ICPs are ready: FEC & large arcades, Barcades, Street Route, Operators & multi-site.
2. **Maps search.** RECON scans Google Maps square by square across the area, so no place is missed, and collects every result: name, address, website, phone, rating, category. Each search term is also searched in the country's language.
3. **Qualification.** The AI (Claude Haiku) reads each place's website and Maps info, like a sales rep doing research, and gives a score from 0 to 100 with a verdict: QUALIFY, BORDERLINE or DISQUALIFY.
4. **Excel export for sales.** Score, verdict, venue type, estimated machines, payment system, competitor, contacts.

## Quick start (Windows)

You need [Node.js](https://nodejs.org) 20+, `pnpm` (`npm i -g pnpm`) and [Git for Windows](https://git-scm.com).

1. Create `.env.local` at the repo root with `DATABASE_URL=postgres://...`
2. Double-click **`start-recon.cmd`**. RECON opens on `http://localhost:8080`.

After pulling new code: `start-recon.cmd rebuild`.

## Cost

- Google Maps: $0 (RECON reads the public pages, no paid API).
- Database: Neon free plan.
- AI: about $2 per 1,000 leads.

## Limits

- Machine count and payment system are rarely shown on websites, so they are often estimated.
- Reading Google Maps automatically goes against Google's terms of use. Google could block it or show captchas (none so far). The fallback is Google's official API, which is paid.
- Neon free plan: 5 GB of data transfer a month. RECON stays well below it, but watch it with more users.

## Documentation

- [Setup](docs/setup.md): install, configuration, troubleshooting
- [Maps search](docs/maps-search.md)
- [Qualification and ICPs](docs/qualify.md)
- [Architecture](docs/architecture.md): code layout and database

## License

Built on an open-source project by Salomon Sverdlov, under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). Commercial use needs a commercial license: see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

Area data: [GeoNames](https://www.geonames.org) (CC BY 4.0) and [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL).
