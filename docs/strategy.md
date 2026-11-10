# Strategy and decisions

What RECON does, what we chose and why, what we measured, and what is left to do. Details are in [Maps search](maps-search.md) and [Qualify](qualify.md).

## Goal

Give the Tigapo sales team **every** venue of a target kind in an area (arcades, FECs, bowlings, laser tag…), sorted by how well it fits a customer profile (ICP). In the longer term, map the whole market: for example "Germany: 1,000 FECs, 950 cash, 50 cashless".

## Principles

| Principle | In practice |
|---|---|
| **Complete before fast** | A change that saves time but loses venues is rejected. Every Maps change is measured with `scripts/maps-benchmark.mjs` |
| **Search broad, then filter** | Maps keeps every place it finds. Sorting hides the obvious noise, and the Lead Qualifier is the real filter |
| **Free to run** | No paid service is required. Google Maps is read by a local browser, and areas come from OpenStreetMap and GeoNames. AI (Gemini) is optional |
| **Reliable for a team** | Searches resume after a restart, pause when the network drops, and never stop silently |
| **Explainable** | Every score shows the evidence behind it |

## 1. Maps search

| Decision | Why |
|---|---|
| **Grid of cells**, each searched on Google Maps | Google shows a limited number of places per search. Small cells get past that limit |
| **Full cells are cut into quarters** | A full list means places are missing. Quarters are searched until each list is complete |
| **Quick pass first, cuts after** | The full list arrives in minutes. The cuts only add places. Paris "arcade": first list in about 3 min |
| **Exact area outline** (OpenStreetMap), not a box | No time lost on cells outside the area, and no places from the neighbouring country |
| **France offered twice**: mainland (103 cells) or with overseas territories (333 cells) | 228 of the 333 cells are overseas. Typing "France" used to search mostly the Pacific |
| **Google's own categories are searched too** | Some places are listed only under their category. "boulangerie" Lyon + "bakery": +45 places. "coiffeur" Marseille + "hair salon": +33 |
| **Terms translated into the area's language** | Local people use local words: "laser game" in France, "ゲームセンター" in Japan. The typed term is always searched too |
| **Deep cuts kept even when they find little** | The rare venues come from there. Virtual Planet (Paris VR arcade) was found by 1 run out of 18 |

**Rejected:** stopping cuts early (lost about 90 venues on Paris), more browser tabs (no gain), "Search again" (+1 place in 10 min on Lyon).

**Measured:** Paris "arcade" covers about 95% of the known Paris venues in 13–15 min. A mid-size city (Lyon) is fully covered in 9 min. France "laser tag" took about 1 h: 2,246 places, 707 matches, every Megazone found.

## 2. Sorting the places found

Every place is stored and then put in one of three groups. Only "Hidden" changes what the team sees: Match and Probable are shown as one list and both go to the qualifier (Match first).

| Group | Rule | Example |
|---|---|---|
| **Match** | The Google category or the name says what was searched | "Laser tag center", "Bowling Megazone Laser Games" (filed by Google as a gym) |
| **Probable** | Found by the search but unclear: a supplier, a place Google files only as "Building", or another category | Megazone "Laser equipment supplier", UK shopping arcades |
| **Hidden** | Clearly unrelated: a shop, an office, a trade, a clinic, a bus stop, a holiday let, a street address | Laser cutting workshop, "Laser Team AG" (sheet metal), "16, St Georges Arcade" |

**How we made it reliable:** we checked the sorting against all 81 past searches (about 23,000 places). We fixed each kind of error at once instead of case by case, and reviewed every newly hidden place by hand. No real venue was hidden. The rules apply to old searches too: they are recomputed when a search is opened.

**Safeguards:**
- A word alone is not enough when it is too common. "laser game" names a laser tag venue, but "game" alone does not, or every escape game would match.
- A shop or a supplier is a match only when the search names one ("amusement machine supplier").

## 3. Lead Qualifier

| Decision | Why |
|---|---|
| **Read the website** (homepage + useful pages) | A site gives the evidence: number of machines, payment system, redemption counter |
| **Score against the active ICP** | One tool for every target profile (FEC, Street route, barcade…) |
| **AI with proof** (Gemini, optional and free tier) | Keyword rules were not reliable: on Lyon, toy shops scored 75–95 and real arcades 20–35. The AI must quote the site for each signal. RECON checks that each quote really is on the site, then computes the score itself |
| **Same evidence, same score** | The score is computed in code from the verified facts, not chosen by the AI |

**Status:** the AI scorer is built but not yet tested on a real batch. The next step is to compare it with a reference list of 20–30 known Lyon venues.

## 4. What is left

| Topic | Next step |
|---|---|
| **Tigapo database** | Connect to it so the qualifier can flag existing customers and known prospects. Asked Ofir (R&D) which way he recommends |
| **More ICPs** | Street route (5–15 machines in bars, cinemas, bowlings), barcade, cashless. Each needs search terms and its own score bands |
| **Hosting** | Run RECON on a shared server so the whole team can use it |
| **Qualifier test** | Measure the AI scorer on the Lyon reference list |
| **Known limits** | Google sometimes shows a "limited view" with fewer places. RECON works around part of it, not all. A drawn area has no country, so its terms are not translated: pick a country from the suggestions instead |
