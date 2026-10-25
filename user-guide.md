# Recon Platform — User Guide

**Version:** July 2026

---

## Table of Contents

1. [What is Recon?](#1-what-is-recon)
2. [Getting Started — The Big Picture](#2-getting-started--the-big-picture)
3. [Setting Up Your ICP](#3-setting-up-your-icp)
4. [Finding Leads with Maps Search](#4-finding-leads-with-maps-search)
5. [Qualifying Leads with AI](#5-qualifying-leads-with-ai)
6. [Reading Qualification Reports](#6-reading-qualification-reports)
7. [Uploading Your Own Lead Lists](#7-uploading-your-own-lead-lists)
8. [Viewing History](#8-viewing-history)
9. [Tips & Best Practices](#9-tips--best-practices)
10. [Glossary](#10-glossary)

---

## 1. What is Recon?

Recon is an AI-powered sales intelligence platform. It finds businesses that match your ideal customer, crawls their websites, and scores them — so your reps only spend time on leads that are actually worth calling.

### The problem it solves

Imagine you sell cashless payment terminals to family entertainment venues. Without Recon, a typical day looks like this:

1. Search "trampoline park Manchester" on Google Maps
2. Open 30 business websites one by one
3. Try to figure out if they already have a payment system, how many locations they have, whether they're owner-operated or a chain…
4. Copy names, websites, and phone numbers into a spreadsheet
5. Pass it to a rep and say "good luck"

**With Recon**, you type your search terms and city, click Search, then let the AI read every website and score each lead against your criteria. In 20 minutes you have a ranked list with explanations and personalised opening lines — ready to dial.

### What Recon does step by step

```
You define your ideal customer (ICP)
        ↓
Recon searches Google Maps for matching businesses
        ↓
Recon crawls each business's website
        ↓
AI scores each lead 0–100 against your ICP
        ↓
You get a report: who to call, why, and how to open
```

---

## 2. Getting Started — The Big Picture

### The four sections of the dashboard

| Section | What you do here |
|---|---|
| **ICP** | Tell the AI what your perfect customer looks like |
| **Maps** | Search Google Maps for businesses in any city |
| **Qualify** | Upload your own CSV/spreadsheet of leads to score |
| **History** | See all your past searches and scoring runs |

### First-time setup (do this in order)

**Step 1 — Set up your ICP.** Before the AI can score anything, it needs to know what "good" looks like for your product. Go to **ICP** first.

**Step 2 — Run a Maps search.** Once your ICP is set, go to **Maps**, type in your search terms and a city, and let Recon find businesses.

**Step 3 — Qualify the results.** After the search, run qualification on the results. The AI will read each website and return scores, verdicts, and outreach suggestions.

---

## 3. Setting Up Your ICP

> **ICP = Ideal Customer Profile.** It's the description of the type of business you most want to sell to. The AI uses this as its scoring rulebook.

Navigate to **ICP** in the sidebar and click **New ICP**.

---

### Field-by-field guide with examples

---

#### Name
A short label so you can tell profiles apart. You might have several — one per product, campaign, or region.

> **Example:** `FEC UK — Cashless Terminals Q3 2026`

---

#### Description
A plain-English paragraph describing your ideal customer. Write it as if you're briefing a new rep on who to target.

> **Example:**
> *"We're looking for family entertainment centres (FECs) in the UK with at least one physical site. The ideal customer is owner-operated or a small regional chain (2–10 locations), generates revenue through admissions and F&B, and doesn't yet have a unified cashless payment system across their venue. They're likely frustrated with handling cash and are open to technology upgrades."*

---

#### Qualify Signals
These are green flags — things the AI should look for on the website that indicate a good fit. Be specific. Vague signals produce vague scores.

> **Good examples:**
> - "Website mentions multiple revenue streams (admissions, F&B, birthday parties, memberships)"
> - "Has an online booking system — indicates tech-forward operation"
> - "Mentions 2 or more locations"
> - "No mention of existing cashless or EPOS system"
> - "Owner or family-run — suggests decision-maker is reachable"

> **Vague examples to avoid:**
> - "Uses technology" ← too broad, almost every business qualifies
> - "Has a website" ← not a useful signal

---

#### Disqualify Criteria
Red flags — things that rule a lead out entirely, regardless of other signals.

> **Examples:**
> - "Part of a large national chain (10+ locations) — procurement will be centralised and slow"
> - "Government-owned or council-run facility"
> - "Website is clearly inactive or under construction"
> - "Business appears to be permanently closed"

---

#### Score Bands
Define what the score numbers actually mean for your team.

> **Example:**
> | Score | Band | What it means |
> |---|---|---|
> | 80–100 | Strong Fit | Call today — high priority |
> | 50–79 | Borderline | Review the AI notes, may be worth a call |
> | 0–49 | Poor Fit | Skip for now |

---

#### System Prompt *(advanced)*
Custom instructions that change how the AI reasons. Most users don't need this. Use it if you find the AI consistently misses something specific to your niche.

> **Example:** *"If the website mentions 'tokens' or 'arcade tokens', this is a strong signal they are operating legacy cash-based systems and are a high-priority target. Weight this heavily."*

---

### Activating an ICP

You can have many ICP profiles saved, but only **one is active at a time**. The active ICP is the one the AI uses for all scoring.

Click **Set as Active** on the profile you want to use. You'll see a green indicator next to the active profile.

> **Tip:** If you're running a new campaign or targeting a different segment, create a brand new ICP rather than editing your existing one. This keeps your old reports accurate and consistent.

---

## 4. Finding Leads with Maps Search

Navigate to **Maps** in the sidebar.

This is your lead generation engine. You give it search terms and a location — it returns a structured list of real businesses pulled directly from Google Maps.

---

### How to run a search — step by step

#### Step 1: Enter your search terms

Type the kinds of businesses you're looking for. You can enter multiple terms — the system searches for each one.

> **Example search terms for a cashless payments product targeting entertainment venues:**
> ```
> trampoline park
> indoor play centre
> bowling alley
> laser tag
> escape room
> arcade
> family entertainment centre
> soft play
> ```

> **Why multiple terms?** The same business type gets listed differently on Maps. "Soft play" and "indoor play centre" can return completely different results even in the same city. Cast a wide net.

---

#### Step 2: Enter a location

Type a city, region, or postcode area.

> **Examples:**
> - `Manchester, UK`
> - `Birmingham`
> - `Texas, USA`
> - `Sydney, Australia`

---

#### Step 3: Use the grid picker (optional, for large cities)

Google Maps only returns ~20 results per search per area. To cover an entire city comprehensively, Recon divides the area into a **geo-grid** of smaller zones and searches each one separately.

For a large city like London, the grid might have 20–30 zones. The grid picker lets you **select which zones to include** — useful if you only care about certain parts of the city (e.g. North London or Zone 2).

> **Example:** If your rep covers Greater Manchester but not the city centre (already worked), you could deselect the central grid squares and only search the suburbs.

If you're not sure, leave all zones selected — Recon handles it automatically.

---

#### Step 4: Click Search

Recon begins scraping. Results populate the table **in real time** as businesses are found — you don't have to wait for the whole search to finish.

> **Note:** Searches in large cities with many grid zones can take 5–15 minutes. You can leave the page and come back — the job runs in the background and is saved in History.

---

### Understanding the results table

| Column | What it shows |
|---|---|
| Business Name | The name as listed on Google Maps |
| Category | Maps category (e.g. "Amusement park", "Bowling alley") |
| Rating | Star rating and number of reviews |
| Website | The business's website (used for qualification crawl) |
| Address | Full address |
| Phone | Phone number if listed on Maps |

> **Example row:**
> | Funzone Adventure Park | Indoor playground | ⭐ 4.6 (312 reviews) | funzoneadventure.co.uk | 14 Trafford Way, Manchester | 0161 834 2200 |

---

### After the search

Once the search is complete, you can:
- **Qualify All** — send every result to AI scoring
- **Qualify Selected** — tick specific rows first, then qualify only those
- Find the results again anytime under **History**

---

## 5. Qualifying Leads with AI

Qualification is where the AI does its work. It reads each business's website and scores it against your active ICP.

---

### What happens behind the scenes (plain English)

For each lead, Recon:

1. **Visits the website** — not just the homepage, but follows links to About pages, pricing pages, services, contact pages, etc. (up to 3 levels deep)
2. **Reads the content** — extracts text, looks for your qualify signals and disqualify criteria
3. **Scores the lead** — 0 to 100 based on how well the signals match your ICP
4. **Assigns a verdict** — QUALIFY, BORDERLINE, or DISQUALIFY
5. **Writes an explanation** — tells you exactly what it found (or didn't find) and why
6. **Generates outreach intel** — a personalised opening line for a cold call or email

> **Example — what the AI might find on Funzone Adventure Park's website:**
>
> *"Website mentions party bookings, F&B (café on site), and seasonal events. Has an online booking system. No mention of cashless payment tech or EPOS systems. 2 locations referenced (Manchester and Stockport). Owner name visible in About page: 'Funzone was started by Dave and Sarah in 2014…'"*
>
> **Score: 84 — QUALIFY**
>
> *"Strong fit. Multiple revenue streams, 2 locations, tech-forward (online booking), and no existing cashless system detected. Owner-operated — decision-maker likely reachable directly."*

---

### Starting qualification

**From a Maps search:** After your search, click **Qualify All** or select specific rows and click **Qualify Selected**.

**From a CSV upload:** See [Section 7](#7-uploading-your-own-lead-lists).

Qualification runs in the background. You'll see progress update in real time. You can safely close the tab and return later — everything is saved.

---

## 6. Reading Qualification Reports

Navigate to **History**, then click on any completed qualification job.

---

### The summary bar

At the top of the report you'll see a quick breakdown:

> **Example:**
> - ✅ 14 Qualified
> - ⚠️ 9 Borderline
> - ❌ 31 Disqualified
> - ICP used: FEC UK — Cashless Terminals Q3 2026
> - Run: 9 July 2026 at 14:32

---

### Each lead card

Every lead in the report has a card. Here's what each part means:

---

**Score & Verdict**
> `84 — QUALIFY`
> Green = strong fit. Yellow = borderline. Red = disqualify.

---

**AI Explanation**
The AI's reasoning in plain English. This is the most important part — it tells you *why* the lead got the score it did.

> **Example explanation:**
> *"Funzone Adventure Park operates two locations and offers admissions, party packages, and a café. An online booking system is in place, suggesting they are open to tech. No cashless payment solution was detected on the site. The About page names the founders as direct contacts. Disqualify criteria not met. Strong ICP match."*

---

**Outreach Intel**
A suggested personalised opening for your first contact. Use it as a starting point — not a word-for-word script.

> **Example outreach intel:**
> *"I noticed Funzone runs a busy café alongside your play centre across two sites — coordinating payments across food, admissions, and parties with cash must be a headache. We help venues like yours unify that with a single cashless system..."*

---

**Contact Info**
Phone, email, and address extracted from the website and Google Maps listing.

---

### Filtering the report

Use the filter buttons to narrow the view:

- **Show only: QUALIFY** → your call list for today
- **Show only: BORDERLINE** → leads that need a human second look
- **Show only: DISQUALIFY** → leads to archive

> **Tip:** Always check BORDERLINE leads. The AI flags them because something is genuinely ambiguous. A 30-second glance at the AI explanation usually tells you whether it's worth a call.

---

## 7. Uploading Your Own Lead Lists

Navigate to **Qualify** in the sidebar.

If you already have a list of businesses — from a CRM export, a purchased database, a LinkedIn scrape, etc. — you can upload it directly for AI scoring without running a Maps search.

---

### Supported file formats

- `.csv` (comma-separated)
- `.xlsx` or `.xls` (Excel)

---

### What your file needs

At minimum, each row needs either a **company name** or a **website URL**. A website URL produces the best results because the AI can crawl the actual site.

> **Example spreadsheet layout:**
>
> | Company Name | Website | Phone | City |
> |---|---|---|---|
> | Funzone Adventure Park | funzoneadventure.co.uk | 0161 834 2200 | Manchester |
> | Laserzone UK | laserzone.co.uk | 0207 123 4567 | London |
> | Bounce World | bounceworld.co.uk | | Birmingham |

Column names don't need to be exact — Recon's column mapper will auto-detect them.

---

### Column mapping

After uploading, Recon shows you a mapping screen where it guesses which column is which:

> **Example auto-detection:**
> - "Company Name" → ✅ Detected as: Business Name
> - "Website" → ✅ Detected as: Website URL
> - "Phone" → ✅ Detected as: Phone Number
> - "City" → ⚠️ Not mapped (that's fine, it's optional)

Check the mappings and correct any that look wrong, then click **Start Qualification**.

---

## 8. Viewing History

Navigate to **History** in the sidebar.

History is a log of everything Recon has done. It shows two types of entries:

---

### Maps Jobs

> **Example entry:**
> - Search terms: `trampoline park, indoor play, soft play`
> - Location: `Manchester, UK`
> - Results found: 54 businesses
> - Run: 8 July 2026
> - Status: Complete

Click to re-open the full results table.

---

### Qualification Batches

> **Example entry:**
> - Source: Maps search — Manchester July 8
> - ICP used: FEC UK — Cashless Terminals Q3 2026
> - Results: 14 Qualified / 9 Borderline / 31 Disqualified
> - Run: 9 July 2026
> - Status: Complete

Click to open the full qualification report.

All jobs are saved indefinitely. You can go back weeks or months to revisit results.

---

## 9. Tips & Best Practices

---

**Be specific in your Qualify Signals — not general.**

❌ `"Uses technology"` — nearly every business has a website, so this is useless.

✅ `"Mentions EPOS, POS, or payment terminals on their website"` — a real, falsifiable signal.

✅ `"Has an online booking or ticketing system"` — indicates tech readiness.

---

**Use many search terms, not just one.**

The same venue type has dozens of names. Running all of them ensures you don't miss a good lead just because they used a different word.

> Trampoline park, jump park, aerial park, bounce park, urban air → all the same thing.

---

**For large cities, use the grid picker strategically.**

If your rep only covers South London, there's no point running the search across all 30 zones. Select only the relevant zones — the search will be faster and results will be more targeted.

---

**Don't ignore BORDERLINE leads.**

The AI scores leads BORDERLINE when there's not enough information on the website to be sure. This often means the site is basic or outdated — not that the business is a bad fit. A quick look at the AI explanation and 30 seconds on the site tells you which way to call it.

---

**Create a new ICP profile instead of editing the active one mid-campaign.**

If you change your ICP halfway through a campaign, your old reports will be inconsistent with your new criteria. Keep old ICPs as-is and create a fresh one for new campaigns.

---

**Treat Outreach Intel as a first draft.**

The AI's suggested opening is based on what it found on the website. It's a solid starting point but it's not personalised to you or your tone. Edit it before using it.

> AI suggestion: *"I noticed Funzone runs a café alongside your play centre — coordinating cash payments across food, admissions, and parties must be complex."*

> Rep's version: *"Hi Dave, I was looking at Funzone's site — love what you've built across Manchester and Stockport. Quick question: how are you currently handling payments across the café and the admissions desk?"*

---

**If a lead has no website, it will score low — that's expected.**

The AI can only score what it can read. A business with no website or a broken website will come back with low confidence. These are worth a manual check if the Maps listing itself looks promising (high reviews, right category).

---

## 10. Glossary

| Term | Plain-English meaning |
|---|---|
| **ICP** | Ideal Customer Profile. Your description of the perfect prospect. The AI uses this as its scoring rulebook. |
| **Qualify Signal** | A positive sign the AI looks for on a website (e.g. "has multiple locations"). |
| **Disqualify Criterion** | A dealbreaker that rules a lead out regardless of other signals (e.g. "government-owned"). |
| **Score** | A number from 0–100. Higher = better match to your ICP. |
| **Verdict** | The AI's overall call: QUALIFY (good fit), BORDERLINE (uncertain), or DISQUALIFY (poor fit). |
| **Geo-Grid** | The way Recon divides a city into smaller zones to ensure full coverage when searching Maps. Google limits results per search, so Recon runs many smaller searches instead of one big one. |
| **Crawl** | The process of the AI reading a business's website — following links to gather as much information as possible. |
| **Outreach Intel** | A personalised opening line suggested by the AI for a cold call or email, based on what it found on the website. |
| **Batch** | A group of leads that were scored together in a single qualification run. |
| **Qualification** | The process of scoring leads against your ICP using AI. |
| **Column Mapping** | When uploading a CSV, this is where you confirm which column in your file corresponds to which field (website, company name, phone, etc.). |

---

*For technical issues or feature requests, use the feedback inbox in the platform.*
