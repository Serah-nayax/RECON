# What Is Recon?

Recon is an AI-powered lead intelligence and qualification platform built to automate the research phase of outbound B2B sales. It replaces the manual process of visiting websites, reading reviews, hunting for contact details, and assessing competitive positioning — compressing hours of analyst work into a structured, scored report produced in minutes.

This document explains what Recon is, how it works at a technical and conceptual level, what it can and cannot do, and the key concepts every user needs to understand before working with the platform.

---

## The Problem Recon Solves

### The Research Tax on Sales Teams

In most outbound sales organisations, a significant portion of each rep's time is consumed not by selling but by research:

- Visiting 10–20 websites to identify which businesses match the product's target profile
- Searching LinkedIn, Google, and company sites to find a decision-maker's name, title, and contact details
- Reading customer reviews to understand pain points before a cold call
- Manually checking whether a prospect already uses a competitor's product
- Compiling findings into a spreadsheet for team visibility
- Repeating this entire process for every new territory or lead list

This is often called the "research tax" — a necessary cost that produces no revenue directly and scales linearly with the number of leads in the pipeline.

Recon eliminates this tax. A business that would require 25–40 minutes of manual research is profiled fully in 3–5 minutes, with a scored qualification report, decision-maker contacts, sentiment analysis, and competitive intelligence ready for the rep to use immediately.

### The Qualification Gap

Even teams that invest in research tools face a second problem: inconsistency. Different reps apply different thresholds. What one rep considers a borderline lead, another pursues aggressively. What one rep disqualifies immediately, another spends a week chasing.

Recon introduces a consistent, configurable qualification standard through the **ICP (Ideal Customer Profile)** system. Once configured, every lead is assessed against the same criteria, by the same AI, producing comparable scores that allow the team to triage a list of 500 leads in the same time it previously took to research 20.

---

## How Recon Works — Complete Technical Overview

### Phase 1: Discovery

Before enrichment can happen, you need leads. Recon supports two discovery methods:

#### Method A: Lead List Upload

You supply a CSV or Excel file containing businesses you already have. The file must include website URLs — everything else (name, category, city, state) is optional but improves report quality.

Sources for lead lists:
- Data brokers (ZoomInfo, Apollo, D&B)
- Trade show attendance lists
- CRM exports (accounts without recent activity)
- Manual Google Maps exports
- Industry association member directories
- Event sponsor lists
- Franchise location finders

The quality of the input list directly affects enrichment quality. A clean, well-formatted list with accurate URLs will produce accurate reports. A list with broken URLs, blank fields, and inconsistent formatting will produce partial or failed enrichments.

#### Method B: Maps Search

You define a location and a search keyword. Recon uses Apify to scrape Google Maps, returning all matching businesses in that area with their name, address, phone, rating, review count, website URL, and Google Maps category.

This allows you to build a prospect list from scratch for any territory in the world, without needing a pre-existing data source. See `04-maps-search.md` for the complete guide.

---

### Phase 2: Enrichment Pipeline

Enrichment is the core of the platform. For each lead with a URL, Recon runs a multi-stage pipeline:

```
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 1: WEBSITE CRAWL                                              │
│ Cheerio-based crawler visits the domain                             │
│ Follows internal links up to 12 pages deep                          │
│ Extracts: all page text, titles, meta descriptions                  │
│ Extracts: embedded phone numbers, email addresses                   │
│ Identifies: outbound links to social platforms and review sites     │
│ Respects: robots.txt exclusions                                     │
│ Timeout: 30 seconds per page, max 12 pages                          │
└───────────────────────────┬─────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 2: LINK EXTRACTION                                            │
│ Parses all outbound links from the crawled pages                    │
│ Identifies review platform links:                                   │
│   - Google Maps business listing                                    │
│   - Yelp business page                                              │
│   - TripAdvisor listing                                             │
│ Identifies social profile links:                                    │
│   - LinkedIn company page                                           │
│   - Facebook page                                                   │
│   - X (Twitter) profile                                             │
│   - Instagram profile                                               │
└───────────────────────────┬─────────────────────────────────────────┘
                            ↓
        ┌───────────────────┴───────────────────┐
        ↓                                       ↓
┌───────────────────────┐         ┌─────────────────────────────────┐
│ STAGE 3: REVIEW       │         │ STAGE 4: SOCIAL INTELLIGENCE    │
│ SCRAPING (Apify)      │         │ (Apify)                         │
│                       │         │                                 │
│ Visits each review    │         │ Visits each social profile      │
│ platform link         │         │ Extracts:                       │
│ Extracts:             │         │ - Follower counts               │
│ - Overall rating      │         │ - Bio / About text              │
│ - Total review count  │         │ - Recent post themes            │
│ - Top review snippets │         │ - Business category tags        │
│ - Reviewer sentiment  │         │                                 │
│                       │         │ Used for: Contacts tab social   │
│ Used for: Reviews tab │         │ data, AI context enrichment     │
└───────────┬───────────┘         └──────────────┬──────────────────┘
            └──────────────┬────────────────────-┘
                           ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 5: CONTACT ENRICHMENT (Seamless.AI)                           │
│ Queries Seamless.AI with the business domain                        │
│ Returns up to 5 decision-makers per business:                       │
│   - Full name                                                       │
│   - Job title                                                       │
│   - Verified direct email                                           │
│   - Direct phone / mobile                                           │
│   - LinkedIn URL                                                    │
│ Consumes Seamless.AI credits per lookup                             │
└───────────────────────────┬─────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 6: AI SCORING (Google Gemini 2.5 Flash)                       │
│ Assembles all crawled data into a structured context block:         │
│   - Website text (paginated by page, labelled)                      │
│   - Extracted metadata (phone, email, address)                      │
│   - Review snippets with platform labels                            │
│   - Social profile bios and follower data                           │
│ Prepends your active ICP system prompt as instructions              │
│ Sends full combined prompt (~6,000–18,000 tokens) to Gemini         │
│                                                                     │
│ Gemini returns structured JSON:                                     │
│   {                                                                 │
│     "score": 84,                                                    │
│     "verdict": "QUALIFY",                                           │
│     "icpExplanation": "...",                                        │
│     "keySignals": [...],                                            │
│     "missingSignals": [...],                                        │
│     "recommendedAction": "..."                                      │
│   }                                                                 │
└───────────────────────────┬─────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 7: AI SYNTHESIS (Anthropic Claude Sonnet)                     │
│ Reads the assembled data (crawl + contacts + reviews + score)       │
│ Generates:                                                          │
│   - Company overview summary paragraph                              │
│   - Outreach hook (personalised opening line for cold outreach)     │
│   - General signal extraction beyond ICP-specific scoring           │
│   - Competitive systems identification                              │
│   - Strategic positioning guidance                                  │
└───────────────────────────┬─────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 8: REPORT ASSEMBLY AND STORAGE                                │
│ All outputs merged into structured Intel Report object              │
│ Stored permanently in PostgreSQL database                           │
│ Lead status updated to "Completed" in the batch panel               │
│ Report available immediately for viewing in the dashboard           │
└─────────────────────────────────────────────────────────────────────┘
```

**Stage dependencies:** Each stage feeds into subsequent stages. If Stage 1 (crawl) produces minimal content, Stages 6 and 7 will have less evidence to work with and will produce more conservative, less specific output. If Stage 5 (Seamless.AI) is unavailable, Stage 8 will assemble a report with an empty Contacts tab but all other sections intact.

---

## The ICP: The Central Concept

The ICP (Ideal Customer Profile) is the scoring brain of the platform. It is a saved configuration that defines — with precision — what a good lead looks like for your specific product, market, and qualification criteria.

Every score Recon produces is relative to an ICP. The same business will receive a different score under different ICPs. An ICP calibrated for enterprise software buyers will score a small family arcade at 5. An ICP calibrated for arcade cashless systems will score the same business at 85.

This is not a bug — it is the feature. Recon is not trying to produce an objective measure of business quality. It is measuring fit against a specific set of criteria that you define.

### ICP Components

| Component | Role | Impact on Scoring |
|---|---|---|
| **System Prompt** | Full instruction set for the AI | Primary driver of all scoring decisions |
| **Qualify Signals** | Enumerated positive traits | Injected into prompt; AI checks for each |
| **Disqualify Criteria** | Hard-stop rules | Injected into prompt; triggers score 0–20 override |
| **Score Bands** | Labelled thresholds | Read by AI to calibrate score placement |

### The ICP as a Living Document

A common mistake is treating the ICP as a one-time setup. Teams that configure the ICP once and never revisit it will see accuracy degrade over time as the market shifts, as edge cases emerge, and as the team's understanding of what makes a good customer deepens.

The ICP should be reviewed after every major batch. Leads that were scored incorrectly — either false positives (poor leads that scored high) or false negatives (strong leads that scored low) — are diagnostic data about the ICP's weaknesses. See `02-icp-library.md` for the full calibration process.

---

## The Five Sections of the Platform

### Lead Qualifier

The primary workflow for processing lead lists. Supports bulk CSV/Excel import with intelligent column mapping, parallel enrichment of all leads in a batch, and per-lead Intel Reports with all four tabs.

**Primary use case:** Process a list of prospects to identify which ones to prioritise for outreach.

### Maps Search

Geographic discovery engine powered by Apify + Google Maps. Define a location and keyword, receive a list of matching businesses with their Maps data, and send selected results directly to the Lead Qualifier for full enrichment.

**Primary use case:** Build a prospect list from scratch for a new territory.

### History

Permanent, searchable archive of all batches and Intel Reports. Browse by date, search by business name or domain, re-open any past report, re-enrich leads with updated settings, and export batch results to CSV.

**Primary use case:** Retrieve past research, monitor campaign coverage, re-qualify old leads after an ICP update.

### ICP Library

Configuration centre for all scoring profiles. Create, edit, activate, and version-control your ICP configurations. Supports multiple profiles for different products, segments, or markets.

**Primary use case:** Configure and refine the scoring criteria that drive all enrichment output.

### Settings

Integration management panel. Add and manage API keys for all external services: Gemini, Anthropic, Apify, Seamless.AI, OpenAI, HubSpot, Salesforce. All keys are stored securely and applied automatically during enrichment.

**Primary use case:** Connect external services on first setup; troubleshoot integration issues.

---

## System Architecture — Complete Data Flow

```
USER INTERFACE (React Dashboard)
         │
         │ HTTP/REST
         ↓
API SERVER (Node.js / Express)
├── Enrichment Pipeline Orchestrator
│   ├── Crawl Engine (Cheerio, built-in)
│   ├── Apify Client (reviews + social + Maps)
│   ├── Seamless.AI Client (contacts)
│   ├── Gemini Client (AI scoring)
│   └── Claude Client (AI synthesis)
│
├── ICP Store (in-memory + PostgreSQL)
├── Batch Manager
├── History API
└── Settings API
         │
         ↓
POSTGRESQL DATABASE
├── icpConfig table — ICP configurations
├── batches table — batch metadata
├── leads table — per-lead enrichment results
├── intelReports table — full Intel Report data
└── settings table — API key storage (encrypted)
         │
         ↓
EXTERNAL SERVICES
├── Google Gemini API — AI scoring
├── Anthropic Claude API — AI synthesis
├── Apify Platform — web scraping infrastructure
├── Seamless.AI API — contact enrichment
└── CRM APIs (HubSpot / Salesforce) — optional push
```

---

## Capabilities and Limitations

### What Recon Does Well

- **High-volume research compression** — processes 50+ leads in the time it would take to manually research 2–3
- **Consistent qualification standards** — every lead assessed against the same ICP criteria, eliminating rep-to-rep variation
- **Signal discovery** — surfaces evidence from websites that most reps would miss or not have time to find
- **Contact enrichment** — delivers verified decision-maker contacts without manual LinkedIn searching
- **Review sentiment** — aggregates and analyses customer feedback that would take hours to read manually
- **Competitive intelligence** — identifies incumbent systems from website content, job listings, and review mentions

### What Recon Cannot Do

- **Score businesses with no website** — the crawl engine requires a URL. No URL = no enrichment.
- **Score accurately with minimal website content** — a 1-page website provides little evidence. Conservative scores result.
- **Verify information in real time** — scores reflect the website as it was when crawled. Recent changes (new equipment, ownership change) may not be reflected.
- **Replace domain expertise in ICP configuration** — the AI is only as good as the ICP. Someone with deep knowledge of the target market must write and maintain the ICP.
- **Guarantee contact data accuracy** — Seamless.AI data has lag. Job titles and contact details change. Always verify before calling.
- **Overcome anti-bot website protection** — some websites (Cloudflare Enterprise, JavaScript-only SPAs) cannot be crawled. Results for these leads will be partial.
- **Interpret images** — the crawl engine extracts text. Visual signals (a photo of a packed arcade floor) are not directly analysed by the scoring AI.

### Known Edge Cases

| Situation | Recon Behaviour | Workaround |
|---|---|---|
| Business has no website | Enrichment fails — no URL to crawl | Manually research; or find website via Maps listing |
| Website requires login | Crawler cannot access gated content | Only public pages are scored |
| Website is a redirect to social media | Minimal text content extracted | Social profile content is included if link identified |
| PDF or non-HTML content at URL | Crawler cannot parse PDF | Skip or manually note |
| Website under construction | "Coming soon" page only; score unreliable | Re-enrich when site launches |
| Business changed ownership recently | Old content may not reflect new owner | Verify via phone call |
| Large franchise with thin local page | Local page scored, not national brand | Score reflects local presence, not chain quality |
| Multi-location business with one URL | Corporate site scored, not specific location | Use location-specific URL if available |

---

## Complete Glossary

| Term | Definition |
|---|---|
| **ICP** | Ideal Customer Profile — the saved configuration of scoring criteria |
| **Active ICP** | The ICP currently used for all new enrichments |
| **Enrichment** | The full 8-stage pipeline that produces an Intel Report |
| **Batch** | A group of leads processed together under one ICP at one point in time |
| **Intel Report** | The per-lead output: Overview, Contacts, Reviews, Competitors |
| **Score** | 0–100 continuous measure of fit against the active ICP |
| **Verdict** | Top-level qualification decision: QUALIFY, BORDERLINE, or DISQUALIFY |
| **Score Band** | A labelled score range (e.g. 80–89 = "Strong Fit") |
| **Key Signal** | Evidence found on the website that positively supports the score |
| **Missing Signal** | Expected qualifying trait not found on the website |
| **ICP Explanation** | AI-generated 2–3 sentence narrative explaining the score |
| **System Prompt** | The full instruction set given to Gemini during scoring |
| **Qualify Signals** | Enumerated list of positive traits in the ICP |
| **Disqualify Criteria** | Hard-stop rules that trigger score 0–20 override |
| **Re-enrichment** | Running the pipeline again on an already-processed lead |
| **ICP Snapshot** | The exact ICP configuration stored with each batch at time of run |
| **Lead Context** | The formatted crawled content block sent to Gemini |
| **Token** | Unit of text processed by the AI; typically 1 token ≈ 0.75 words |
| **Conservative fallback zone** | Scores 55–65 indicating AI had insufficient evidence to score confidently |
| **False positive** | A lead that scored QUALIFY but is not actually a good fit |
| **False negative** | A lead that scored DISQUALIFY/BORDERLINE but is actually a good fit |
| **Decision Maker** | A contact at the target business with verified name, title, email, phone |
| **Apify** | Web scraping infrastructure service used for Maps, reviews, and social data |
| **Seamless.AI** | B2B contact enrichment service providing decision-maker data |
| **Gemini 2.5 Flash** | Google's AI model used for lead scoring in Recon |
| **Claude Sonnet** | Anthropic's AI model used for synthesis and summary generation |
| **Crawl depth** | Number of pages the crawler visits per domain (up to 12) |
| **Grid mode** | Maps Search setting that divides a geographic area into cells, one query per cell |
| **Grid density** | Number of cells in a Maps Search grid (e.g. 4×4 = 16 cells) |
| **CRM push** | Action that sends a lead's data to HubSpot or Salesforce |
| **ICP calibration** | The ongoing process of reviewing and refining ICP configuration based on batch results |
