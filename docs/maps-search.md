# Maps search

Find every place of a kind in an area on Google Maps. The goal is completeness: no relevant venue should be missed.

## Running a search

1. **Area.** Type a country, region, département, city or district and pick a suggestion. RECON searches inside its exact outline (from OpenStreetMap), not a rough box. You can add several areas, or **Draw Area** on the map.
2. **Grid.** The map shows the cells RECON will search. Click cells to leave some out.
3. **Search terms.** One or more terms ("arcade", "salle d'arcade", "bowling"). The active ICP suggests terms.
4. **Data fields.** The *Instant* fields come from the result list. **Phone, website and hours** need a visit to each place's page (*deep mode*): the data is richer, but each cell takes longer.
5. **Start Search.** Places appear as they are found. You can pause and resume. A search interrupted by a restart resumes on its own.

Areas and terms run as one combined search, up to 2,000 cells.

## How it finds places

- **Grid.** The area is cut into cells sized to the area. Each cell is searched on Google Maps with a headless browser.
- **Full cells are cut.** Google lists a limited number of places per search. When a cell's list is full, the cell is cut into quarters and searched again until each list is complete. RECON first searches every cell once (a quick pass), then cuts the full ones. The full list arrives in minutes, and the extra pass only adds places.
- **Google's own categories.** Each term is first searched in the middle of the area to learn which Google categories it means. The main categories are then searched too. For example, "boulangerie" also searches "bakery", which found 45 more places in Lyon.
- **Translations.** Terms are searched in the area's language as well (built-in dictionary, or Gemini when it is on).
- **Outline filter.** Only places inside the chosen outline are kept.

## What is listed

Every place found is stored. The list shows two groups:

| Group | Meaning |
|---|---|
| **Match your search** | The Google category or the name says what you searched |
| **Probable** | Found by the search under another category (an escape room, a bar with games…): worth a look |

Places that are clearly unrelated (shops, offices, clinics, schools found because of a word in their name, such as a laser hair removal clinic for "laser tag") are hidden. The Lead Qualifier is the real filter: send it the whole list.

## Limits and speed

- **Google's limited view.** Without a Google account, Maps sometimes shows a limited view with fewer places per cell. This is the main limit on coverage. RECON detects it and cuts busy cells once more, but cannot fully get around it.
- **Coverage.** On Paris "arcade" (Nov 2026), the quick pass took about 3 minutes and found as many on-topic places as 20-minute runs. Repeated runs differ by a few places, because Google's lists vary.
- **Big areas.** A whole country can take several hours. Leads appear as they are found, and the search can be paused at any time. For very large searches, set `MAPS_PROXY_URL`.
- To measure a change, run `node scripts/maps-benchmark.mjs "<term>" "<area>"` (see [architecture](architecture.md#scripts)).

## After the search

- **CSV** downloads the places.
- **Qualify all** sends every listed place to the Lead Qualifier, matches first. Single places can be sent one by one.
- Past searches stay listed on the Maps Search page.
