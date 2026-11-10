# Maps search

Lists every place of a given kind in an area, from Google Maps.

## Running a search

1. **What to look for.** Type one or more search terms. The active ICP suggests terms: click one to add it.
2. **Where.** Type a country, region, city or district and pick a suggestion, or **Draw area** on the map. You can add several areas. The map shows the cells that will be searched; with a single area, click a cell to leave it out.
3. **Start search.** Places appear as they are found. A search can be paused and resumed, and resumes on its own after a restart.

Every place comes with its name, category, address, rating, reviews, phone, website and Google Maps link. Phone and website are read from each place page and keep filling in while the search runs.

## How it works

- The area is cut into cells, and each cell is searched on Google Maps.
- Busy cells are cut into smaller ones and searched again, so that no place is missed.
- The progress bar has two steps: step 1 searches every cell once, step 2 searches the busy areas again in smaller pieces. The list is ready when step 1 ends: Excel, CSV and Qualify All open then; step 2 only adds places.
- Each term is also searched in the area's language and under the matching Google categories.
- Only places inside the area's outline are kept.

## Results

Every place found is stored. The list shows them in one list, best-known first.

Places found only because of a word in their name, with nothing to do with the search, are not listed: a lawyer's office named "Arcade" in an "arcade" search, for example. A place of the kind searched is always listed: a search for clinics lists clinics.

## After the search

- **Excel** and **CSV** download the places listed.
- **Qualify All** sends the listed places to the Lead Qualifier. The **Qualify** button on a row sends that place only.
- Past searches stay on the Maps Search page. **Delete** removes a search that is not running.
