# History

The History page is the permanent, searchable archive of everything Recon has ever produced. Every batch from the Lead Qualifier, every enrichment from Maps Search, every re-enrichment, and every Intel Report is stored here indefinitely and is fully accessible at any time.

History is not just an audit log. It is a live operational tool for ongoing campaigns: tracking territory coverage, retrieving leads on demand, comparing results across ICP versions, auditing disqualify decisions, and re-qualifying old leads after ICP changes.

---

## What History Stores — Complete Data Inventory

For every batch ever run, History stores:

**Batch-level data:**
```
- Batch name (auto-generated or custom)
- Batch creation timestamp (exact date and time, UTC)
- Batch completion timestamp
- ICP snapshot: the exact ICP configuration at time of run
  (system prompt, qualify signals, disqualify criteria, score bands — all captured verbatim)
- ICP name and version identifier
- Lead count (total, completed, failed, partial)
- Verdict distribution (QUALIFY / BORDERLINE / DISQUALIFY counts)
- Average score for completed leads
- Source type (imported CSV, Maps Search, manual entry)
```

**Per-lead data (within each batch):**
```
- Business name
- Website URL
- Category (if provided in import)
- City and state (if provided)
- Phone (from import or crawl extraction)
- Email (from import or crawl extraction)
- Enrichment status (Completed / Partial / Failed)
- Failure reason (if Failed)
- Crawl timestamp
- Full Intel Report (if Completed or Partial):
  - Score and verdict
  - ICP Explanation
  - Key Signals list
  - Missing Signals list
  - Recommended Action
  - Overview synthesis paragraph
  - Outreach hook
  - Contacts (all returned by Seamless.AI)
  - Reviews data (all returned by Apify)
  - Competitors data (all identified systems and narratives)
```

**What is NOT stored:**
- Raw crawled HTML (only extracted text is stored)
- Intermediate API responses (only final assembled data)
- ICP configuration changes history (tracked in ICP Library, not History)
- User activity logs (who viewed which report)

---

## Navigating the History Interface

### Batch List View

Batches appear in reverse chronological order (most recent first). Each batch card displays:
- Batch name
- Date and time run
- ICP used (name + version)
- Lead count
- Verdict distribution bar (green/amber/red proportional bar)
- Completion status (In Progress / Completed / Partially completed / All failed)

### Expanding a Batch

Click a batch card to expand it. The expanded view shows:
- Summary statistics (score distribution, average score, time to complete)
- Individual lead list with score arc and verdict for each lead

### Opening an Intel Report

Click any individual lead to open its full Intel Report. The report opens in a side panel or full view (depending on your browser width). All four tabs are accessible exactly as they appeared when enrichment completed.

---

## The ICP Snapshot — Critical Concept

Each batch in History is permanently associated with an **ICP snapshot** — the exact, verbatim copy of the ICP configuration that was active when the batch ran.

This snapshot includes:
- The complete system prompt (every word, every instruction)
- The full qualify signals list
- The full disqualify criteria list
- All score bands with their exact descriptions

### Why Snapshots Matter

**Scenario: You change the ICP between batches**

If you run Batch A in June under ICP v1, then update the ICP to v2 in July, then run Batch B:
- Batch A's reports in History still reflect ICP v1 scoring criteria
- Batch B's reports reflect ICP v2 scoring criteria
- The same business in Batch A and Batch B may have different scores — because different instructions were given to the AI

This is correct behaviour. It means historical results are reliable representations of what the AI determined under the criteria in effect at the time.

**Scenario: Auditing a scoring decision**

A rep disputes a DISQUALIFY score on a lead they believe should qualify. Open the lead's Intel Report in History, then check the ICP Explanation. It will tell you which specific criterion triggered the disqualify. The ICP snapshot lets you see exactly what that criterion said — useful for understanding whether it was correctly applied or whether the ICP had a flaw.

**Scenario: Comparing results across time**

You ran Dallas territory in Q1 and want to run it again in Q3 after updating the ICP. Results will not be directly comparable because different ICP versions were used. To make a fair comparison:
1. Check the ICP version on the Q1 batch (shown in batch header)
2. If a different ICP was used, re-enrich a sample of Q1 leads under the current ICP
3. Compare the re-enriched sample to the Q3 batch

---

## Searching and Finding Leads

### Search Capabilities

The History search bar searches across all batches simultaneously:

| Search Type | Example Query | Returns |
|---|---|---|
| Business name | `Main Event` | All leads named "Main Event..." across all batches |
| Domain / URL | `mainevent.com` | All enrichments of mainevent.com |
| Partial domain | `mainevent` | All leads with "mainevent" in the URL |
| City | `Dallas` | All leads with city "Dallas" |
| State | `TX` | All leads in Texas |
| Batch name | `Chicago Sweep` | Batches matching that name |
| Verdict | `QUALIFY` | Filter by verdict type |

**Practical search scenarios:**

*Rep asks: "Did we already enrich Dave & Buster's in Houston?"*
Search: `bustersentertainment.com` or `Dave & Buster's Houston`
If a result appears, click through to see score, when it was run, and which ICP was active.

*You want all QUALIFY leads from July:*
Filter by verdict: QUALIFY; filter by date range: July 2026.

*You want all leads in a specific state that scored above 80:*
Filter by state: TX; filter by score: 80+.

### Batch Search

Search specifically within a batch using the batch's own filter bar (visible when a batch is expanded):
- Filter by verdict
- Filter by score range
- Sort by score (high to low or low to high)
- Filter by city
- Filter by enrichment status (completed / partial / failed)

---

## Re-Enrichment from History — Decision Framework

Re-enrichment reruns the full 8-stage pipeline for a lead. It always uses the **current active ICP**, not the ICP snapshot from the original batch.

### When Re-Enrichment Makes Sense

**Case 1: ICP was updated after the lead was enriched**
If you updated your ICP and want to see how a high-priority lead scores under the new criteria, re-enrich it. The new score reflects your current ICP.

**Case 2: Original enrichment was partial**
If the original enrichment ran without an Apify or Seamless.AI key, the report has empty tabs. After adding the missing keys, re-enrichment will populate those tabs.

**Case 3: Business significantly updated their website**
If you know the business added a major new attraction, renovated, or otherwise updated their web presence, re-enrichment will crawl the updated site.

**Case 4: Original enrichment failed**
If the lead failed due to a transient error (API timeout, temporary website outage), re-enrichment may succeed.

### When Re-Enrichment Does Not Help

**Case: Score seems wrong but ICP hasn't changed and website hasn't changed**
Re-enriching with the same ICP and the same website will produce the same score (±2-3 points for model temperature). The issue is with the ICP, not a transient error. Investigate the ICP instead.

**Case: Wanting to bulk re-enrich an entire historical batch**
Technically possible but expensive. For a 200-lead batch, bulk re-enrichment consumes the same API credits as a new 200-lead batch. Only do this if you have a strong reason to apply the updated ICP across the entire historical dataset.

### Re-Enrichment Data Impact

**What changes after re-enrichment:**
- All report tabs are regenerated from scratch
- The previous report is replaced (not versioned)
- Contacts data is refreshed from Seamless.AI (may differ if personnel changed)
- Reviews are re-scraped (may differ if new reviews were posted)
- Score and signals reflect the current active ICP

**What is lost after re-enrichment:**
- The original score and verdict (overwritten)
- The original key/missing signals (overwritten)
- The original ICP explanation (overwritten)
- The previous contacts (overwritten with fresh Seamless.AI data)

**Before re-enriching a high-priority lead:**
If the original report contains data you want to preserve (e.g. specific contacts that may have since left the business), copy that information out before triggering re-enrichment.

---

## Exporting from History

### Export Format

CSV export from any batch in History. The export contains one row per lead.

**Export column reference:**

| Column | Content | Notes |
|---|---|---|
| business_name | Business name | From import file or Maps listing |
| url | Website URL | The URL that was enriched |
| category | Business category | From import file or Maps listing |
| city | City | From import file or Maps listing |
| state | State/region | From import file or Maps listing |
| score | Numerical score | 0–100 |
| verdict | Verdict | QUALIFY / BORDERLINE / DISQUALIFY |
| icp_explanation | Full explanation text | AI-generated rationale |
| key_signals | Signals list | Comma-separated in one cell |
| missing_signals | Missing signals list | Comma-separated in one cell |
| recommended_action | Action text | AI-generated recommendation |
| contact_1_name | First contact name | If contacts available |
| contact_1_title | First contact title | |
| contact_1_email | First contact email | |
| contact_1_phone | First contact phone | |
| contact_2_name | Second contact name | If contacts available |
| contact_2_title | Second contact title | |
| contact_2_email | Second contact email | |
| contact_2_phone | Second contact phone | |
| enriched_at | Enrichment timestamp | ISO 8601 format |
| icp_name | ICP name used | From ICP snapshot |

**What is not included in exports:**
- Reviews data (too large for CSV; view in platform)
- Competitors narrative (too long for CSV; view in platform)
- Social profile data
- Contacts beyond the first two

### Export Use Cases

**Use Case 1: Sharing leads with a rep without Recon access**
Export the QUALIFY leads from a batch. The rep receives a spreadsheet with score, verdict, explanation, signals, and contact details. No Recon access required to use this list for outreach.

**Use Case 2: Pipeline reporting**
Export all batches from a quarter. Import into Excel or Google Sheets. Create pivot tables by verdict, score band, territory, and ICP version to report on pipeline coverage and qualification rates.

**Use Case 3: CRM manual import**
If the CRM integration is not configured, use the export as an intermediate step. Import the CSV into HubSpot, Salesforce, or another CRM using the CRM's standard CSV import function. Map columns accordingly.

**Use Case 4: ICP audit**
Export all DISQUALIFY leads from a batch. Review them in a spreadsheet. Look for patterns that indicate ICP false negatives (strong leads that were incorrectly disqualified). Feed this analysis back into ICP calibration.

**Use Case 5: Territory coverage analysis**
Export all batches from a territory. Create a pivot table by city or state. Identify gaps: cities with few QUALIFY leads may need additional search terms; cities with high QUALIFY rates may warrant prioritised outreach campaigns.

---

## Batch Management Best Practices

### Naming Conventions

A consistent naming convention makes History navigable months later.

**Recommended format:**
`[YYYY-MM] [Territory] [Search Type/Source]`

**Examples:**
```
2026-07 Dallas FEC — Maps "family entertainment"
2026-07 Dallas Barcades — Maps "barcade"
2026-07 Chicago Priority List — Uploaded CSV
2026-Q3 National Chains — Manual Entry
2026-07 Re-enrich: Dallas BORDERLINE leads
```

**For re-enrichments:**
Always include "Re-enrich" and the date to distinguish from original batches. This prevents confusion when reviewing History months later.

### Archiving vs. Deleting

**Archiving (preferred):** Batches can be marked as archived to remove them from the default History view without deleting the data. Archived batches can be retrieved by toggling "Show archived" in the filter bar. Use this for:
- Batches from territories you are no longer targeting
- Test batches run during setup
- Duplicate batches from search term overlaps

**Deleting (permanent):** Deleting a batch removes all leads and Intel Reports permanently. This cannot be undone. Before deleting:
- Export the CSV if you want to retain any data
- Confirm no rep is currently referencing reports from the batch

**Recommendation:** Default to archiving rather than deleting. Storage is inexpensive; recovered intelligence from months-old data has real value.

### Monthly History Review

At the end of each month, conduct a brief History review:
1. What percentage of leads across all batches were QUALIFY? (Track over time — should improve as ICP is calibrated)
2. Are there geographic areas with consistently low QUALIFY rates? (May indicate ICP mismatch for that market or a poor search term)
3. Are any DISQUALIFY patterns recurring that should be reviewed? (ICP false negative identification)
4. Were any batches left with high Failed counts? (Technical issues to resolve before next batch)
