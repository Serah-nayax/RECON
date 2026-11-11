# Maps search

Lists every place of a kind in an area, from Google Maps.

## Running a search

1. **What:** type one or more search terms (the active ICP suggests some).
2. **Where:** type a country, region, city or district, or **Draw area** on the map.
3. **Start search.** Places appear as they are found. A search can be paused, and resumes on its own after a restart.

## How it works: 2 steps

RECON cuts the area into squares and searches each one on Google Maps. Google shows at most about 120 results per search, so a busy square can hide places.

- **Step 1** searches every square once. At the end, the list is already usable: **Excel**, **CSV** and **Qualify All** open.
- **Step 2** takes the busy squares, cuts them into smaller ones and searches them again. That is what takes time in big cities, and it only adds places to the list.

Each term is also searched in the country's language (e.g. "salle d'arcade" in France). Only places inside the area are kept.

The time depends on the size of the area and the number of terms: Paris with one term takes about 7 minutes.

## Results

Every place found is stored. The list hides only places clearly unrelated to the search (a lawyer named "Arcade", for example). Sorting the rest is the qualification's job.

- **Excel / CSV:** download the list.
- **Qualify All:** asks which ICP to use, then sends the list to the Lead Qualifier.
- Past searches stay on the page, with how long they took.
