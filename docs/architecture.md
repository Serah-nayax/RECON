# How RECON is built

RECON is one program that runs on a PC (or a server) and opens in the browser.

## The parts

- **The web app** (`dashboard/`): the pages the team uses (ICP, Maps Search, Lead Qualifier, Settings).
- **The engine** (`api-server/`): does the work behind the pages.
  - It opens Google Maps in a hidden browser and reads the results, like a person would.
  - It visits each lead's website and reads the useful pages.
  - It sends what it read to the AI (Claude), which gives the score and verdict.
- **The database** (Neon, online): keeps the ICPs, every search and every qualification, so the whole team sees the same data.

## Where to look in the code

| To change… | Look in |
|---|---|
| A page of the app | `dashboard/src/pages/` |
| How Maps is searched, translations of search terms | `api-server/src/lib/maps/` |
| How a lead is scored | `api-server/src/lib/qualify/` |
| The ICPs | `api-server/src/lib/icpStore.ts` |
| The database tables | `lib/db/src/schema/` |
