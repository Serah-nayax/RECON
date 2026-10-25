# Maps Search

Maps Search is Recon's geographic discovery engine. It builds prospect lists from scratch by scraping Google Maps for businesses matching a keyword and location you define. Instead of relying on a pre-existing data source, you can prospect any territory in the world, using any relevant search term, and return to the Lead Qualifier with a vetted, URL-backed list of candidates within minutes.

This document covers the complete Maps Search workflow: how it works technically, how to configure searches for maximum coverage, how to select and filter results before enrichment, advanced multi-search territory strategies, known limitations, and operational best practices.

---

## Technical Foundation

### How Maps Search Works

Maps Search is powered by Apify's Google Maps Scraper actor. When you run a search, Recon:

1. Sends your search term and geographic parameters to Apify
2. Apify's scraper queries Google Maps from cloud infrastructure (avoiding personal IP blocks)
3. Google Maps returns up to 20 business listings per query, each with:
   - Business name
   - Full address (street, city, state, ZIP)
   - Phone number
   - Website URL (if listed on Maps)
   - Google Maps star rating (1.0–5.0)
   - Total review count
   - Google Maps business category
   - Business hours (if listed)
4. Apify returns all results to Recon
5. Recon displays results in the Maps panel

### The 20-Result Cap — The Most Important Constraint

**Google Maps returns a maximum of 20 results per search query.** This is a hard limit enforced by Google, not by Recon or Apify. In any major city, there may be 50, 100, or 300+ businesses matching your search term. A single query will only return 20 of them.

This is why Maps Search uses a **grid system**. By dividing your target area into smaller cells and running a separate Google Maps query per cell, Recon multiplies the number of results. Each cell returns up to 20 results, so a 4×4 grid (16 cells) can return up to 320 results before deduplication.

**Mathematical relationship:**
```
Maximum possible results = Grid cells × 20
2×2 grid = 4 cells = up to 80 results
3×3 grid = 9 cells = up to 180 results
4×4 grid = 16 cells = up to 320 results
5×5 grid = 25 cells = up to 500 results
6×6 grid = 36 cells = up to 720 results
```

In practice, most cells return fewer than 20 results because business density is not uniform across a grid. Real-world yields are typically 40–70% of the theoretical maximum.

### Result Deduplication

When cells overlap (which they do at the edges of each cell in the grid), the same business may appear in multiple cells' results. Recon performs basic deduplication by URL and business name before displaying results. However:

- Businesses with slightly different name formats across listings may slip through
- Businesses without a website URL cannot be deduplicated reliably
- Manual review is recommended before sending to the Qualifier

---

## Requirements

Before running a Maps Search:

```
☐ Apify API key configured in Settings (required — Maps Search will not function without it)
☐ Apify account has sufficient credits (see credit estimates below)
☐ Active ICP configured (used when you send results to the Qualifier for enrichment)
☐ Search term prepared (specific, relevant, tested)
☐ Geographic area defined (city + radius OR bounding box for grid)
```

---

## Search Term Strategy

Search terms are sent directly to Google Maps. The quality of your search terms directly determines the quality of your results. Poor search terms waste Apify credits on irrelevant results; excellent search terms surface high-density relevant leads efficiently.

### Search Term Design Principles

**Principle 1: Use the language your target customers use**

Think about how a business owner or a potential customer would describe the venue. "Family entertainment center" is how FEC operators describe their businesses. "Arcade" is how customers describe what they visit. Both work; using multiple terms per territory maximises coverage.

**Principle 2: Be specific enough to filter, broad enough to cover**

Too specific: "Dave & Buster's" → Returns only that chain
Too broad: "entertainment" → Returns theatres, sports facilities, event spaces, anything
Good: "family entertainment center" → Returns FECs, arcades, entertainment complexes

**Principle 3: Map your ICP's inclusion categories to search terms**

Every sub-type of customer in your ICP should have at least one search term that will surface it. Example:

| ICP Inclusion Category | Search Terms to Use |
|---|---|
| Family Entertainment Centres | "family entertainment center", "FEC", "family fun center" |
| Arcades | "arcade", "arcade games", "video arcade" |
| Barcades | "barcade", "beercade", "arcade bar", "bar arcade" |
| Bowling + Arcade | "bowling arcade", "bowling entertainment", "bowling games" |
| Trampoline + Arcade | "trampoline park", "jump park" |
| Laser Tag + Arcade | "laser tag entertainment", "laser tag arena" |
| Go-Kart + Arcade | "go kart entertainment", "go kart racing", "karting entertainment" |
| Super Arcades | "super arcade", "amusement arcade", "entertainment arcade" |

Running all of these for a major metro will surface substantially more relevant leads than running just "family entertainment center."

### Search Terms to Avoid

| Term | Why to Avoid |
|---|---|
| Specific brand names ("Chuck E. Cheese") | Returns only that brand — misses independents |
| Very generic terms ("fun", "games", "entertainment") | Returns massive off-target results |
| Supplier or product names | Returns suppliers, not venue operators |
| Category adjectives ("best arcade") | Inconsistent Google Maps interpretation |

### Search Term Testing Protocol

Before running a full grid search for a new term, test it:
1. Set up a 2×2 grid (4 cells, low cost)
2. Run the search
3. Review the first 20–30 results: are they relevant to your ICP?
4. If relevant: scale to full grid
5. If not relevant: refine the term and test again

---

## Geographic Configuration

### City + Radius Mode

Enter a city name and a search radius in miles or kilometres. Recon runs a single query centred on the city with the specified radius.

**When to use:**
- Prospecting a single city with clear geographic boundaries
- Supplementary search for a specific suburb or district
- Quick scan of a low-density rural area

**Radius selection guide:**

| Area Type | Recommended Radius | Rationale |
|---|---|---|
| Dense urban core (Manhattan, Chicago Loop) | 2–5 miles | High density; small radius returns many results |
| Suburban city | 10–15 miles | Moderate density; covers metro area |
| Mid-size city (Nashville, Austin) | 15–25 miles | Covers city and near suburbs |
| Rural area | 30–50 miles | Low density; large radius needed |

**Limitation:** City + radius mode runs a single Google Maps query → maximum 20 results, regardless of radius size. For any city where you expect more than 20 relevant businesses, use grid mode instead.

### Grid Mode

Draw a bounding box on the map and select a grid density. Recon divides the bounding box into equal-sized cells and runs one Google Maps query per cell.

**How to draw the bounding box:**
1. Click the map to place the first corner of the bounding box
2. Drag to define the box area
3. The box should tightly enclose your target area — do not include large amounts of empty rural space, as this wastes cells on empty geography

**Grid density selection:**

| Grid | Cells | Apify Credit Cost | Best For |
|---|---|---|---|
| 2×2 | 4 | $0.20–$0.60 | Small city, town, suburban district |
| 3×3 | 9 | $0.45–$1.35 | Mid-size city or large suburban area |
| 4×4 | 16 | $0.80–$2.50 | Major city |
| 5×5 | 25 | $1.25–$3.75 | Very dense major city |
| 6×6 | 36 | $1.80–$5.40 | Extremely dense metro (NYC, LA, Chicago) |

**Grid placement best practices:**

**Tight box, not wide box:**
A bounding box that tightly encloses the urban area is more credit-efficient than one that covers a large surrounding region. Each cell in a large box represents the same credit cost whether it returns 20 results or 0.

```
Good: Box covers the city limits tightly
Bad: Box covers the city + 50 miles of surrounding countryside
```

**Separate searches for satellites:**
For cities with distinct satellite towns (e.g. Dallas + Fort Worth + Arlington), run separate grid searches for each rather than one enormous grid covering all three. This:
- Uses credits only on populated areas
- Produces cleaner, territory-separated results
- Allows different search terms per area if relevant

**Overlap at grid boundaries:**
Businesses at the exact boundary between two cells may appear in both cells' results. This is expected and handled by Recon's deduplication. Do not attempt to configure grids to avoid boundary overlap — it is not possible and not necessary.

---

## Running the Search

### Pre-Search Checklist

```
☐ Search term is tested and produces relevant results on google.com/maps directly
☐ Bounding box tightly encloses target area (no excessive empty space)
☐ Grid density appropriate for the area's business density
☐ Apify account has sufficient credits for the expected cost
☐ Active ICP configured for when results are sent to Qualifier
```

### During the Search

Click **Search** to start. The search runs as an Apify background job.

**What you will see:**
- A progress indicator showing cells completed vs. total
- Results appearing progressively as each cell completes
- Running total of results found

**During the search:**
- Do not close or hard-refresh the browser tab
- You can navigate away and return — the search continues server-side
- If you return after a search completes, results will still be displayed

**Estimated completion times:**

| Grid Size | Typical Time | Peak Hours (+ latency) |
|---|---|---|
| 2×2 | 1–3 min | 3–5 min |
| 3×3 | 2–5 min | 5–10 min |
| 4×4 | 4–8 min | 8–15 min |
| 5×5 | 8–15 min | 15–25 min |
| 6×6 | 15–25 min | 25–40 min |

Peak hours for Apify infrastructure: typically US Eastern morning (9 AM–12 PM ET) and EU business hours (9 AM–5 PM CET).

---

## Reviewing and Filtering Results

### Result Fields

Each Maps result shows:

| Field | Source | Notes |
|---|---|---|
| **Name** | Google Maps listing | As the business listed itself on Google |
| **Address** | Google Maps listing | Full address including ZIP |
| **Phone** | Google Maps listing | May differ from website phone |
| **Website URL** | Google Maps listing | Not always present — critical for enrichment |
| **Rating** | Google Reviews | 1.0–5.0 stars, updated in near real-time |
| **Review Count** | Google Reviews | Total number of Google reviews |
| **Category** | Google Maps | Google's own category assignment |

### Quick Enrichment Panel

Click any Maps result to open a lightweight quick-enrichment panel. This runs a partial, low-cost analysis using the Maps listing data only (no website crawl). It returns:

- Estimated score range (±15 points typically)
- 2–3 inferred signals from the Maps data (category, review count, business name)
- A recommendation: "likely worth full enrichment" / "may not meet criteria" / "likely disqualify"

Use the quick panel to:
- Pre-screen results before spending full enrichment credits on low-probability leads
- Quickly identify obvious mismatches (hardware stores, non-venue businesses)
- Identify high-priority leads to move to the top of the enrichment queue

### Filtering Results Before Sending to Qualifier

Apply filters before selecting leads for enrichment. Each filter reduces the number of leads you send, reducing costs and improving batch quality.

**Critical filter — Has Website:**
Always apply this filter first. Leads without a website URL on their Google Maps listing cannot be crawled and will fail enrichment immediately. Filtering these out before selecting saves credits and prevents failed leads.

**Secondary filters and their use cases:**

| Filter | Setting | Why |
|---|---|---|
| **Has website** | On (always) | Eliminate un-enrichable leads |
| **Min rating** | 3.5+ stars | Very low-rated venues may be struggling or closed |
| **Min review count** | 10+ reviews | Higher review counts indicate more established businesses |
| **Category includes** | "arcade", "entertainment" | Include only certain category types |
| **Category excludes** | "hardware", "retail" | Exclude obvious non-venue categories |
| **Name excludes** | Known non-targets | Exclude chains you already have or don't target |

### Manual Curation Before Sending

After applying filters, review the remaining list visually. Even excellent search terms return some irrelevant results:

**Common false positives in entertainment/arcade searches:**
- Arcade game rental companies (they rent machines, don't operate venues)
- Arcade game repair shops
- "Arcade" as a street name or shopping arcade
- Escape rooms without any arcade component (some don't qualify)
- Children's play centres with minimal games (2-5 machines only)
- Coin-operated laundromats (coin-op = unrelated context)

Remove these manually before selecting for enrichment. Identify them by:
- Reviewing the business name (e.g. "Arcade Machine Repair Dallas")
- Clicking through to the Maps listing and checking the business description

---

## Selecting Leads and Sending to Qualifier

### Selection Methods

- **Individual checkbox:** Select specific leads from the filtered list
- **Select All Visible:** Selects all leads currently shown (after filters applied)
- **Select by Score (Quick Enrich results):** If you've run quick enrichment, select only those above a quick-score threshold

### Batch Naming

When you click **Send to Qualifier**, Recon creates a new batch with an auto-generated name. You can rename it in the Lead Qualifier or History. Use a naming convention that captures:

- Territory
- Search term
- Date

Example: `2026-07 Dallas — "family entertainment center" — 4x4 grid`

---

## Advanced Territory Coverage Strategy

### The Multi-Term Method

Running multiple search terms for the same territory multiplies coverage. Each search term surfaces a different subset of relevant businesses.

**Step-by-step multi-term territory approach:**

```
TERRITORY: Chicago Metropolitan Area

Round 1: "family entertainment center" — 5x5 grid
  → Results: 140 businesses
  → Filter: Has website, min 10 reviews
  → Selected for enrichment: 92 leads

Round 2: "barcade" — 4x4 grid (smaller grid, more specific term)
  → Results: 45 businesses
  → Filter: Has website
  → Remove duplicates from Round 1 results (check URLs)
  → Selected: 31 unique leads

Round 3: "bowling arcade" — 4x4 grid
  → Results: 88 businesses
  → Filter: Has website, min 15 reviews (bowling alleys tend to have many reviews)
  → Remove duplicates from Rounds 1 and 2
  → Selected: 22 unique leads

Round 4: "trampoline park" — 3x3 grid
  → Results: 32 businesses
  → Filter: Has website
  → Remove duplicates
  → Selected: 18 unique leads

Total unique leads for enrichment: 163
Batch approach: Split into 3 batches of ~55 each (stay under 100 per batch)
```

### Deduplication Workflow

After running multiple searches for the same territory, deduplicate before sending to the Qualifier:

**Method 1 — URL-based deduplication (most reliable):**
Export the selected leads from each search as a temporary list. Compare URLs across lists. Remove any URL that appears in more than one list.

**Method 2 — Visual review:**
After filtering, visually scan for duplicate business names. Most duplicates are obvious (same name, same address appearing twice).

**Method 3 — Post-enrichment deduplication:**
Send all results without deduplication. In the batch view after enrichment, filter by URL or name to identify duplicates. Archive duplicates in History.

### Territory Coverage Tracking

Maintain a territory coverage log to prevent running the same search twice months later and to track which areas have been fully prospected:

```
TERRITORY COVERAGE LOG

Territory: Dallas–Fort Worth Metroplex
Last updated: 2026-07-11

Search Term          | Grid | Date       | Results | Enriched | Notes
---------------------|------|------------|---------|----------|------------------
family entertainment | 5x5  | 2026-07-01 | 187     | 124      | Strong yield
barcade              | 4x4  | 2026-07-01 | 28      | 21       | 
bowling arcade       | 4x4  | 2026-07-08 | 63      | 44       | 
trampoline park      | 3x3  | 2026-07-08 | 41      | 29       | 
go kart entertainment| 3x3  | 2026-07-11 | 19      | 16       | 

TOTAL UNIQUE ENRICHED: 234 leads
COVERAGE ASSESSMENT: High — all major sub-types searched
NEXT SEARCH DUE: Q4 2026 (refresh for new venues)
```

### Refresh Cadence

Markets change. New venues open, existing ones close, businesses expand or contract. A territory covered in Q1 may have meaningful new prospects by Q3.

**Recommended refresh cadence:**
- **High-growth markets (major metro areas):** Re-search every 4–6 months
- **Stable markets (secondary cities):** Re-search every 8–12 months
- **Low-growth markets (small towns):** Re-search annually

When re-searching, compare new results against your History to identify genuinely new businesses vs. ones you have already enriched. New businesses will have no record in Recon's History; use the URL search in History to check before enriching.

---

## Maps Search Limitations — Complete Reference

### The 20-Result Cap (Core Limitation)

Already detailed above. The grid system is the primary workaround. Key points:
- No grid size guarantees 100% coverage
- In extremely dense areas (Times Square block radius), even a fine grid will miss some businesses
- Accept this as a structural limitation: Maps Search maximises coverage, it does not guarantee it

### Google Maps Data Freshness

Google Maps business data is updated by:
- Business owners editing their own listings
- Google's automated data crawls
- User suggestions and edits (flagged and reviewed by Google)

Lag between real-world changes and Google Maps data: typically 2–8 weeks.

**Implications:**
- Newly opened venues (last 2–3 months) may not appear
- Recently closed venues may still appear
- Recently updated website URLs may not be reflected

### Website URL Not Present

30–50% of Google Maps listings do not include a website URL. These businesses cannot be enriched. Possible reasons:
- The business never added their website to their Google Maps listing
- The business does not have a website
- The listing was created by a user or Google, not the business owner

**For high-priority businesses without a URL:**
Search for the business name directly on Google to find their website. Add the URL manually via the Lead Qualifier's single-lead entry option.

### International Coverage Variation

Google Maps coverage quality varies significantly by country:

| Region | Coverage Quality | Notes |
|---|---|---|
| USA | Excellent | Near-comprehensive in urban areas |
| UK | Excellent | Very high coverage |
| Canada | Very Good | High coverage, minor rural gaps |
| Australia / NZ | Very Good | High coverage |
| Western Europe | Good | Varies by country; strong in major markets |
| Eastern Europe | Moderate | Coverage improving but less comprehensive |
| Southeast Asia | Moderate | Strong in major cities, weaker rural |
| South America | Variable | Brazil and Argentina better than others |
| Africa | Limited | Good in SA, Nigeria, Egypt; limited elsewhere |

**For lower-coverage regions:** Supplement Maps Search with local business directories, industry association databases, or LinkedIn company searches.

### Google Maps Anti-Bot Measures

Google periodically adjusts its anti-scraping measures. Apify maintains its scraper to work within these constraints, but occasional failures occur:

- Some searches return fewer results than expected without explanation
- Very competitive search terms may trigger additional verification steps
- Results may vary between runs of the same search (normal variation)

These are infrastructure-level factors outside Recon's control. If a search returns significantly fewer results than expected, try re-running it 30–60 minutes later.
