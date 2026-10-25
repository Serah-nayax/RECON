# Lead Qualifier

The Lead Qualifier is the primary workflow for processing a list of businesses and generating full Intel Reports for each one. It handles file imports, column mapping, parallel enrichment, batch management, and per-lead report viewing. Everything from uploading a raw CSV to reviewing a decision-maker's contact details and pushing a lead to your CRM happens here.

This document covers every step of the workflow in depth, including file preparation requirements, column mapping logic, enrichment mechanics, result interpretation, re-enrichment decisions, and the full catalogue of import and enrichment failure modes.

---

## Before You Start — Pre-Import Checklist

The most common causes of enrichment failures and empty reports are problems introduced before the file is even uploaded. Address these before importing:

```
FILE FORMAT:
☐ File is .csv, .xlsx, or .xls (no .numbers, .ods, or Google Sheets direct export)
☐ If Excel: no merged cells across any row
☐ If Excel: no formula columns — values only (copy/paste as values if needed)
☐ If Excel: no multiple sheets used (data must be on Sheet 1)
☐ Headers are in row 1 — no blank rows before headers
☐ No blank rows in the middle of the data
☐ File is under 5,000 rows (split larger files)

URL COLUMN:
☐ Every row has a URL (rows without URLs will fail enrichment)
☐ All URLs include https:// or http://
☐ No URLs pointing to social media profiles instead of websites
☐ No URLs pointing to Google Maps listings
☐ No URLs that are obviously dead domains or parking pages
☐ No trailing spaces in URL cells

DATA QUALITY:
☐ Business names are in a single column (not split across first/last)
☐ Category column uses consistent terminology (not a mix of formats)
☐ No rows where the URL contains the business name or other non-URL text
☐ No rows where the name column contains a URL
```

---

## File Format Deep Dive

### CSV Requirements

CSV is the most reliable format. When exporting from spreadsheet tools:

**From Excel:** File → Save As → CSV (Comma delimited) (.csv)
**From Google Sheets:** File → Download → Comma-separated values (.csv)
**From CRM:** Most CRM export functions produce clean CSV automatically

**Encoding:** UTF-8 is recommended. If your business names include accented characters (é, ü, ñ) or non-Latin scripts, ensure UTF-8 encoding when saving to avoid garbled text in reports.

**Delimiter:** Comma-delimited only. Tab-delimited or pipe-delimited files are not supported directly — convert to comma-delimited first.

### Excel Requirements

Excel files are supported but introduce additional failure risks:

**Formula columns:** If any column contains Excel formulas (=CONCATENATE, =VLOOKUP, etc.), export to CSV first. Formulas may not render as expected when read by Recon's parser.

**Merged cells:** Merged cells in any header row will cause column mapping to fail unpredictably. Unmerge all cells before uploading.

**Multiple sheets:** Only the first sheet is read. Ensure your data is on Sheet 1.

**Data validation dropdowns:** These are stripped during import. Values are read as their displayed text.

**Date columns:** Dates in Excel format (numeric date serial) will appear as numbers. If your file includes dates, format them as text strings before importing.

---

## URL Quality Guide

URLs are the foundation of every enrichment. A bad URL produces a failed enrichment.

### URL Format Requirements

| Format | Status | Notes |
|---|---|---|
| `https://mainevent.com` | ✅ Correct | Full URL with protocol |
| `https://www.mainevent.com` | ✅ Correct | www subdomain is fine |
| `https://mainevent.com/about` | ✅ Acceptable | Deep link — home page may not be crawled first |
| `http://mainevent.com` | ⚠️ Acceptable | HTTP works but HTTPS is preferred |
| `mainevent.com` | ❌ Will fail | Missing protocol — crawler cannot resolve |
| `www.mainevent.com` | ❌ Will fail | Missing protocol |
| `https://facebook.com/mainevent` | ❌ Wrong type | Social media profile, not a website |
| `https://google.com/maps/place/...` | ❌ Wrong type | Google Maps link, not a website |
| `https://yelp.com/biz/mainevent` | ❌ Wrong type | Review platform link |

### URL Quality Patterns to Fix Before Import

**Bulk-fix missing protocols in Excel:**
```
=IF(LEFT(A2,4)="http", A2, "https://"&A2)
```

**Identify non-website URLs in Google Sheets:**
```
=OR(CONTAINS(A2,"facebook.com"), CONTAINS(A2,"yelp.com"), CONTAINS(A2,"google.com/maps"))
```

Flag these rows and either find the actual website or remove the lead from the batch.

### What Happens to Leads Without URLs

Leads without a URL column value will fail immediately at the crawl stage with the error "No URL provided." They appear in the batch as Failed leads. They cannot be re-enriched without adding a URL.

---

## The Import Process — Step by Step

### Step 1: Upload

On the Lead Qualifier page, either:
- Click the **Upload** button and select your file
- Drag and drop the file onto the upload zone

Maximum file size: 50MB. Files larger than this should be split.

Recon reads the file and moves to the column mapping screen.

### Step 2: Column Mapping

This is the most important and most misunderstood step. Getting the mapping wrong means your data will be attached to the wrong fields in the report — names appearing where URLs should be, categories appearing as names, etc.

**How auto-mapping works:**
Recon reads your column headers and attempts to match them to its internal fields by comparing against a dictionary of known variations. The mapping is case-insensitive and ignores extra whitespace.

**Auto-map dictionary (partial):**

| Recon Field | Recognised Column Headers |
|---|---|
| **URL** | url, website, web, site, link, homepage, domain, webpage, web address, website url, company url |
| **Name** | name, business name, company, company name, account, account name, organisation, organization |
| **Category** | category, type, business type, industry, niche, segment, vertical, sector |
| **City** | city, town, municipality, locality, location, city name |
| **State** | state, province, region, territory, state/province |
| **Phone** | phone, phone number, telephone, tel, mobile, contact number, main phone |
| **Email** | email, email address, contact email, main email |

**When auto-mapping fails:**
If your column header is not in the dictionary (e.g. "Web Presence" for URLs), the field will show "Not mapped." The dropdown allows you to manually select which of your columns maps to that field.

**Critical mapping verification steps:**

1. **Verify the URL mapping.** The most important field. Confirm that the dropdown shows a column that actually contains website URLs. Click through a few rows in the preview to verify.

2. **Verify the Name mapping.** Confirm it shows business names, not addresses or categories.

3. **Check the preview.** Before confirming, look at the 5-row preview at the bottom. Do the values in each column make sense for that field?

4. **Identify unmapped columns.** Any column in your file not mapped to a Recon field is silently ignored. If you have a "Notes" column with information you want in reports, there is no Notes field — this data will not appear anywhere in the report.

### Step 3: Confirmation and Batch Creation

After verifying the mapping, click **Import**. Recon:
1. Creates a new batch with an auto-generated name (date + ICP name)
2. Creates a lead record for every row in the file
3. Begins the enrichment pipeline for all leads in parallel

The batch appears immediately in the Lead Qualifier panel. Leads show in "Pending" state initially, transitioning to "Processing" as they begin, and "Completed" or "Failed" as they finish.

---

## Enrichment Mechanics — What Happens After Import

### Parallel Processing

All leads in a batch begin enrichment simultaneously (subject to API rate limits). The parallelism means:

- Lead 1 and Lead 500 start at approximately the same time
- Completion order is non-deterministic — slower websites complete later
- A single slow or failing lead does not block the rest of the batch
- Total batch completion time ≈ slowest single lead + API processing overhead

### Per-Lead Enrichment Timeline

A typical lead moves through these stages:

```
0:00 — Crawl begins (crawler fetches home page)
0:05 — Home page extracted; crawler follows internal links
0:30 — Up to 12 pages crawled (or timeout reached)
0:35 — Link extraction: review and social profile URLs identified
0:40 — Apify job submitted for review and social scraping
1:30 — Apify returns review and social data
1:35 — Seamless.AI contact lookup submitted
2:00 — Seamless.AI returns contacts
2:05 — Gemini scoring prompt assembled and sent
2:30 — Gemini returns scoring JSON
2:35 — Claude synthesis prompt assembled and sent
3:00 — Claude returns synthesis text
3:05 — Report assembled and stored in database
3:05 — Lead status updated to "Completed"
```

**Variables that affect this timeline:**
- Website complexity: sites with many pages or slow servers add 30–90 seconds
- Apify load: during peak hours, Apify jobs may queue, adding 1–3 minutes
- Seamless.AI response: typically 15–30 seconds but can be slower
- Gemini response: typically 10–20 seconds for a standard enrichment
- Claude response: typically 5–15 seconds

**Maximum expected time per lead:** 8–10 minutes in worst case (slow website + API delays)

### Enrichment Lead States

| State | Description | What It Means |
|---|---|---|
| **Pending** | Queued, not yet started | Waiting for parallel pipeline slot |
| **Processing** | Active enrichment in progress | Crawling, extracting, querying APIs |
| **Completed** | Full report available | Click to open Intel Report |
| **Partial** | Report generated with some gaps | Missing Contacts, Reviews, or other tab — check Settings |
| **Failed** | Enrichment could not complete | Click for error details |

**Partial enrichments:** A lead shows as Partial when the core scoring completed (score, verdict, signals) but one or more secondary stages failed. Common causes:
- Apify timed out → Reviews and social data absent
- Seamless.AI returned no contacts → Contacts tab empty (not a failure)
- Claude synthesis error → Overview tab synthesis absent

Partial enrichments are not re-run automatically. To get a full report, re-enrich the lead manually.

### Batch Size Recommendations

| Batch Size | Risk Level | Notes |
|---|---|---|
| 1–25 leads | Low | No rate limit concerns; fastest completion |
| 26–100 leads | Low-Medium | Monitor for Gemini rate limit on free tier |
| 101–250 leads | Medium | Use paid Gemini tier; expect 20–45 min total |
| 251–500 leads | Medium-High | Split into two batches 30 min apart |
| 500+ leads | High | Always split; run maximum 250 per batch |

**Why split large batches?**
Running 500 leads simultaneously floods the API queues. Rate limit errors cascade through the batch, causing failures that would not have occurred if the same leads were run in two smaller batches. Splitting also makes troubleshooting easier — if one batch has problems, the other is unaffected.

---

## Reading Batch Results

### Score Arc

The circular gauge (0–100) is the first visual indicator. Colour codes:
- **Green (QUALIFY):** Lead meets ICP criteria — pursue
- **Amber (BORDERLINE):** Partial fit or uncertainty — review before pursuing
- **Red (DISQUALIFY):** Lead does not meet ICP criteria — do not pursue

The number inside the arc is the exact score. Two leads can both be green but one may be 94 and one 71 — these represent very different confidence levels and should be prioritised accordingly.

### Batch Statistics Panel

At the top of a completed batch, statistics show:
- Total leads
- QUALIFY count and percentage
- BORDERLINE count and percentage
- DISQUALIFY count and percentage
- Failed enrichments count
- Average score for QUALIFY leads

Use these statistics to quickly assess the batch quality:
- A batch where 80%+ are QUALIFY suggests the ICP may be too permissive, OR the lead list was already well-curated
- A batch where 80%+ are DISQUALIFY suggests the ICP may be too restrictive, OR the lead source was not a good match for your ICP
- A healthy batch typically shows 20–40% QUALIFY, 30–40% BORDERLINE, 20–40% DISQUALIFY (ratios vary significantly by lead source and ICP quality)

### Sort and Filter Options

The batch results panel supports:

| Sort Option | Use Case |
|---|---|
| Score (High to Low) | Work through best leads first |
| Score (Low to High) | Review disqualify decisions |
| Name A-Z | Alphabetical review |
| Verdict | Group by QUALIFY / BORDERLINE / DISQUALIFY |
| Date Enriched | Find most recently completed leads |

| Filter Option | Use Case |
|---|---|
| QUALIFY only | Focus on actionable leads |
| BORDERLINE only | Manual review queue |
| DISQUALIFY only | Audit disqualify decisions |
| Score > 80 | Premium prospects only |
| Score 60-79 | Good fit prospects |
| Failed only | Troubleshoot failed enrichments |

---

## The Intel Report — Full Tab Reference

### Overview Tab — Primary Qualification View

**Score Arc and Verdict**
Already described above. The arc is colour-coded; the exact number matters.

**ICP Explanation**
The most important text in any Intel Report. Read this before every call. It is the AI's chain of reasoning — not just a summary but a specific explanation of what the AI found, what it weighted, and why the lead landed at its score.

**Signs the ICP Explanation reveals a scoring problem (not a lead quality problem):**
- "Category 'bar' typically associated with lower machine counts" → category bias, not evidence
- "Website provides limited information about arcade operations" → conservative fallback due to thin content
- "Unable to confirm machine count from available content" → inference rules insufficient

In each of these cases, the correct response is to investigate the lead manually, not to trust the score. The explanation is telling you the AI scored conservatively due to missing evidence, not that the lead is weak.

**Key Signals — Call Preparation Guide**

Each key signal is a conversation opener. Use them naturally — reference the specific thing you found without indicating you used automated research:

| Key Signal | Natural Call Reference |
|---|---|
| "Redemption counter present on homepage" | "I see you've got a redemption setup — how are you managing prize inventory currently?" |
| "40+ arcade games mentioned" | "With that many machines on the floor, how are you currently handling the payment side?" |
| "Token vending machines referenced" | "Are you still running on tokens, or have you made the move to cards yet?" |
| "Birthday party packages listed" | "Your birthday package business looks strong — do you find regulars tend to come back for those?" |
| "Existing [Vendor] card system" | "I noticed you're running [Vendor] — when did you switch from tokens, and has it done what you hoped?" |

**Missing Signals — Discovery Question Guide**

| Missing Signal | Discovery Question |
|---|---|
| "Machine count not stated" | "How many machines do you have running on the floor at the moment?" |
| "No existing cashless system confirmed" | "Are you currently running on tokens, coins, or have you moved to a card-based system?" |
| "No loyalty programme referenced" | "Do you run any kind of loyalty or membership for your regulars?" |
| "No multi-attraction confirmation" | "Is it purely arcade, or do you have other attractions as well?" |

### Contacts Tab — Using the Data Effectively

**Contact prioritisation for entertainment venues:**

| Title Keywords | Priority | Notes |
|---|---|---|
| Owner, Co-Owner, Proprietor | 1st | Ultimate decision-maker and budget holder |
| General Manager, GM | 2nd | Day-to-day operational decisions, vendor relationships |
| Director of Operations, VP Operations | 3rd | Multi-site operational control |
| Director of Entertainment, Entertainment Manager | 4th | Strong influencer on gaming/arcade vendor selection |
| Marketing Manager, Marketing Director | 5th | Relevant for loyalty/CRM angle |
| F&B Manager, Food & Beverage | Skip | Not relevant for cashless/arcade systems |
| HR Manager | Skip | Not a decision-maker for your product |

**Pre-call verification workflow:**
1. Take the contact's name and company
2. Search on LinkedIn (name + company name)
3. Verify: still employed there? Same title?
4. If LinkedIn shows a different company or "no longer at [company]", the data is stale
5. Call the main business line and ask for the decision-maker directly if contact data is unreliable

### Reviews Tab — Strategic Application

**Using review intelligence in outreach:**

The Reviews tab gives you advance knowledge of the business's pain points. The most effective use is framing your product as the solution to a problem you "happened to hear about" rather than revealing you analysed their reviews.

**Reframe review data as market intelligence:**

If reviews show: "Queues at token machines on weekends"
You say: "We work with a lot of entertainment venues, and one of the most common things we hear from GMs is that peak-time queues at token or payment points frustrate customers — is that something you deal with?"

This positions you as a market expert, not a surveillance tool. The business owner will often validate the pain point enthusiastically because it is a real problem they experience.

**Review data quality indicators:**
- 3+ reviews per sentiment theme: strong signal, reliable conclusion
- 1-2 reviews per theme: weaker signal, mention cautiously
- 0 reviews on all platforms: either new business, private venue, or Apify coverage gap

### Competitors Tab — The Displacement Playbook

The Competitors tab identifies what systems the business currently uses and gives you positioning guidance. There are three distinct competitive situations:

**Situation 1: Greenfield (no existing system)**
The business has no cashless system, no loyalty programme, and no identified incumbent.
Approach: Lead with ROI and operational benefits. Position as adding capability, not replacing something.
Tone: Educational — they may not know what they're missing.

**Situation 2: Direct Displacement (competitor product confirmed)**
A named competitor is confirmed.
Approach: Lead with specific advantages over the identified system. Avoid bad-mouthing — focus on what your product does that theirs doesn't.
Tone: Comparative but respectful. "Most venues moving from [competitor] to us tell us the main thing they gained was..."

**Situation 3: Upgrade Path (older or partial system)**
The business has a token system or a basic cashless system without loyalty features.
Approach: Lead with the upgrade narrative. Acknowledge what they have and position as the natural next step.
Tone: Consultative. "Sounds like you got the cashless infrastructure sorted — the next piece is usually the loyalty layer..."

---

## Re-Enrichment Decision Guide

| Situation | Re-Enrich? | Reason |
|---|---|---|
| ICP changed significantly | Yes, for priority leads | Want updated scoring under new ICP |
| Business updated website (major changes) | Yes | Fresh crawl will find new content |
| First enrichment returned Partial (missing contacts/reviews) | Yes | May get fuller data on retry |
| Contacts tab empty | Only if key was recently added | If Seamless.AI key was missing on first run |
| Score seems wrong | Review ICP first | Re-enriching with same ICP → same score |
| Enrichment failed (crawl error) | Yes | Transient failure may resolve |
| Just wanting a higher score | No | Score reflects the evidence; changing the ICP changes the criteria, not the business |

---

## Troubleshooting — Comprehensive Matrix

| Problem | Diagnosis Path | Resolution |
|---|---|---|
| All leads fail immediately | Check URL column mapping; test 1 URL in browser | Re-map; add https:// to URLs |
| Specific lead fails repeatedly | Test URL directly in browser — is it accessible? | Site may be down, gated, or uncrawlable |
| Lead scores 0 despite strong website | Check ICP prompt output format section | Restore exact JSON output block |
| Lead scores conservatively (60-65) | Check website content depth | Add inference rules to ICP; verify manually |
| All leads scoring identically | ICP bands too similar | Differentiate band descriptions |
| Good leads scoring low | ICP disqualify criteria too broad | Review and narrow disqualify criteria |
| Poor leads scoring high | Qualify signals too broad | Tighten signals with specific criteria |
| Import succeeds but no enrichment starts | Check active ICP configuration | Ensure at least one ICP is set as Active |
| Column mapping looks correct but data is wrong | Multiple columns with similar names | Manually set all columns; check preview |
| File upload rejected | File too large (>50MB) or wrong format | Split file; export as CSV |
| Batch shows 0% completion after 10 min | Gemini API error | Check Settings; check Gemini quota |
| Large batch stalls at ~15% | Gemini rate limit hit | Upgrade Gemini tier; split batch |
| Re-enrichment produces identical score | ICP not changed; website not changed | Expected — change ICP to change scoring criteria |
