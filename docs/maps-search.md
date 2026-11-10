# Maps search

Find every place of a kind in an area on Google Maps. The goal is completeness: no relevant venue should be missed.

## Running a search

1. **Area.** Type a country, region, département, city or district and pick a suggestion. RECON searches inside its exact outline (from OpenStreetMap), not a rough box. You can add several areas, or **Draw Area** on the map. "France" is offered twice: **France (mainland)** (with Corsica, 103 cells) and **France (with overseas territories)** (333 cells, two thirds of them in Polynesia, New Caledonia, the Indian Ocean…).
2. **Grid.** The map shows the cells RECON will search. Click cells to leave some out. This works for one area at a time: with several areas (or an area plus a drawn box), every cell of each area is searched, and the page says so.
3. **Search terms.** One or more terms ("arcade", "salle d'arcade", "bowling"). The active ICP suggests terms: click one to add it, click again to remove it. None is selected by default, because each term adds a full pass over the area. With translations and Google's categories, 7 terms became 17 searches in Jerusalem (19 min).
4. **Data fields.** The *Instant* fields come from the result list. **Phone, website and hours** need a visit to each place's page (*deep mode*): the data is richer, but each cell takes longer.
5. **Start Search.** Places appear as they are found. You can pause and resume. A search interrupted by a restart resumes on its own.

Areas and terms run as one combined search, up to 2,000 cells.

## How it finds places

- **Grid.** The area is cut into cells sized to the area. Each cell is searched on Google Maps with a headless browser.
- **Full cells are cut.** Google lists a limited number of places per search. When a cell's list is full, the cell is cut into quarters and searched again until each list is complete. RECON first searches every cell once (a quick pass), then cuts the full ones. The full list arrives in minutes, and the extra pass only adds places. The progress bar shows both steps: step 1 (every area once) fills the first 30%, step 2 (busy areas in detail) the rest. Step 2 can cut cells again while it runs, so its time left is a minimum (`~3m+`), and the bar never moves back nor reaches 100% before the end.
- **Empty quarters are not cut again.** A quarter that found no new place lists what its parent already listed, and its own quarters almost never do better. Over 63 searches (Nov 2026), cutting them took 23% of the search time for 1.5% of the places, most of them public playgrounds the list now hides. `MAPS_SPLIT_EMPTY_QUARTERS=1` cuts them anyway.
- **Google's own categories.** Each term is first searched in the middle of the area to learn which Google categories it means. The main categories are then searched too. For example, "boulangerie" also searches "bakery", which found 45 more places in Lyon. Categories shared by many kinds of places, or public places (bar, park, playground, beach, shopping mall, hotel), are never searched this way: in Tel Aviv, "playground" took 39% of a search for outdoor play areas.
- **Translations.** Terms are searched in the area's language as well (built-in dictionary, or Gemini when it is on).
- **Outline filter.** Only places inside the chosen outline are kept.

## What is listed

Every place found is stored. The list shows them all in one list, the best-known places (most reviews) first. It includes places Google files under another category (an escape room, a bar with games…), suppliers (Megazone, "Laser equipment supplier"), and places filed only as "Building" ("Magic City Amusement Arcade", but also shopping arcades): the qualifier sorts them out.

Places that are clearly unrelated are hidden: shops, offices, trades, clinics, schools, bus stops, holiday lets, public parks, playgrounds and beaches, and street addresses found because of a word in their name or category ("Laser Team AG", sheet metal, or a laser cutting workshop for "laser tag"; "Arcade Taxis", "16, St Georges Arcade" for "arcade"). A shop or a supplier counts as a match only when the term itself names one ("amusement machine supplier"). The Lead Qualifier is the real filter: send it the whole list.

## Limits and speed

- **Google's limited view.** Without a Google account, Maps sometimes shows a limited view with fewer places per cell. This is the main limit on coverage. RECON detects it and cuts busy cells once more, but cannot fully get around it.
- **Coverage.** Repeated runs differ by a few places, because Google's lists vary. Cutting full cells is worth it even when it seems to add only bars and restaurants. On Paris "arcade", it found Bowling Mouffetard, Playin, game bars, escape rooms and pool halls that the quick pass had missed.
- **Duration (Nov 2026).** City searches take 7 to 20 minutes: Paris "arcade" 6.9 min (was 13–32), Berlin "bowling alley" 8 min (was 13.5), Jerusalem with 7 terms 19 min. The quick pass, about 60% of the places, is ready in 1.5–2 min for one term.
- **Big areas.** A whole country can take several hours. Leads appear as they are found, and the search can be paused at any time. For very large searches, set `MAPS_PROXY_URL`.
- **What each term brings.** Each place records the term that found it first (`foundBy`). A finished search reports, per term, its minutes of search, the places it found first and how many of them are listed (`termYield` in `GET /api/maps/:id`, and the "Maps job complete" log line). A term with many minutes and few listed places is not worth searching.
- To measure a change, run `node scripts/maps-benchmark.mjs "<term>" "<area>"` (see [architecture](architecture.md#scripts)).

## After the search

- **Excel** and **CSV** download the places: name, the fields chosen, and whether each one is a match or probable. The CSV opens directly in Excel (UTF-8 with BOM, quoted fields).
- **Qualify all** sends every listed place to the Lead Qualifier, matches first. Single places can be sent one by one.
- Past searches stay listed on the Maps Search page. **Delete** removes a finished, paused or failed search for everyone (a running search must be paused first).

A place is a **match** when its name or category contains a term searched (as typed, translated, or one of Google's categories RECON added). The name you give the search is not a term: a search named "Lyon arcades" used to make every place with "Lyon" in its name a match.
