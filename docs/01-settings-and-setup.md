# Settings & Initial Setup

Every feature in Recon depends on at least one external service. The Settings page is where you connect those services via API keys. Getting this right on first setup is critical — misconfigured or missing integrations are the single most common cause of empty report tabs, failed enrichments, incomplete contact data, and non-functional Maps Search.

This document covers every integration in depth: what it does at a technical level, exactly how to obtain and configure the key, what the quota and cost implications are, how to verify it is working, and how to diagnose every known failure mode.

---

## Integration Dependency Map

Understanding which features depend on which integrations prevents confusion when something is not working.

```
ENRICHMENT PIPELINE DEPENDENCIES:
─────────────────────────────────────────────────────────────────────
Feature / Section              Required Integration(s)
─────────────────────────────────────────────────────────────────────
Any enrichment at all          Google Gemini (mandatory)
Score + Verdict + Signals      Google Gemini (mandatory)
ICP Explanation                Google Gemini (mandatory)
Overview synthesis / hook      Anthropic Claude
Contacts tab                   Seamless.AI
Reviews tab                    Apify
Social profile data            Apify
Competitive intel (partial)    Anthropic Claude
Maps Search (any results)      Apify
CRM push button (HubSpot)      HubSpot OAuth
CRM push button (Salesforce)   Salesforce API credentials
─────────────────────────────────────────────────────────────────────

FAILURE CASCADES:
─────────────────────────────────────────────────────────────────────
If Gemini key is missing:
  → Enrichment fails entirely. No report generated. Batch stalls.

If Anthropic key is missing:
  → Scoring runs. Overview tab is partial. No outreach hook.
  → Reviews, Contacts, Competitors tabs unaffected.

If Apify key is missing:
  → Maps Search: non-functional (returns nothing).
  → Reviews tab: empty on all new enrichments.
  → Social data: absent from all reports.
  → Scoring and contacts are unaffected.

If Seamless.AI key is missing:
  → Contacts tab: empty on all reports.
  → All other report sections unaffected.

If HubSpot/Salesforce not connected:
  → Push to CRM button absent on all reports.
  → No other functionality affected.
─────────────────────────────────────────────────────────────────────
```

---

## Google Gemini

### Role in the Platform

Gemini 2.5 Flash is the primary AI model responsible for lead scoring. It is the most critical integration — every enrichment depends on it. Without a valid Gemini key, no lead can be scored, no batch will complete, and no Intel Report will be generated.

Gemini receives:
- The full text of the business's website (up to ~50,000 tokens from up to 12 pages)
- Metadata extracted from the crawl (phone, email, address)
- Review snippets from Apify (if available)
- Social profile data from Apify (if available)
- Your active ICP system prompt with injected signals, criteria, and score bands

It returns structured JSON containing score, verdict, ICP explanation, key signals, missing signals, and recommended action.

### Obtaining a Key

1. Go to [https://aistudio.google.com](https://aistudio.google.com)
2. Sign in with a Google account (personal or Workspace)
3. Click **Get API Key** in the left sidebar
4. Click **Create API Key**
5. Select an existing Google Cloud project or create a new one
6. Copy the generated key (begins with `AIza`)

> **Important:** The key is shown only once at creation time. Copy it immediately and store it securely before closing the dialog.

### Configuring in Recon

1. Go to **Settings** in the top navigation
2. Find the **Google Gemini** section
3. Paste the key into the field
4. Click **Save**
5. Verify by enriching a single test lead

### Rate Limits — Free Tier vs. Paid Tier

This is the most important operational consideration for Gemini. Free tier limits are inadequate for any production use.

| Tier | Requests Per Minute (RPM) | Tokens Per Day (TPD) | Cost |
|---|---|---|---|
| Free | 15 RPM | 1,000,000 TPD | Free |
| Tier 1 (Pay-as-you-go) | 1,000 RPM | No daily cap | ~$0.075 / 1M input tokens |
| Tier 2+ | Higher | Higher | Volume discounts |

**Practical implication for batch processing:**

At 15 RPM (free tier), a batch of 50 leads will hit the rate limit after approximately 3–4 minutes of processing, causing failures for the remaining leads. At 1,000 RPM (paid tier), the same batch processes without rate limit interference.

**Recommendation:** For any batch larger than 10 leads, use a paid Gemini API account with Tier 1 access.

### Cost Calculation

Each lead enrichment consumes approximately 6,000–18,000 input tokens (website content + ICP prompt) and 200–500 output tokens (the JSON response).

At Gemini 2.5 Flash pricing:
- Input: ~$0.075 per 1M tokens → ~$0.001–$0.0014 per lead enrichment
- Output: ~$0.30 per 1M tokens → ~$0.00006–$0.00015 per lead enrichment
- **Total per lead:** approximately $0.001–$0.002

For a batch of 500 leads: approximately $0.50–$1.00 in Gemini API costs.

### Diagnosing Gemini Issues

**Symptom: All leads in a batch show "enrichment failed"**
Possible causes:
1. Key is invalid or expired → Check the key in Settings; re-enter if needed
2. Key has no billing enabled (free tier quota exhausted) → Enable billing in Google Cloud Console
3. Selected Google Cloud project does not have the Gemini API enabled → Enable the API in Google Cloud Console → APIs & Services

**Symptom: Batch starts but fails after 10–15 leads**
Possible cause: Free tier rate limit (15 RPM) hit.
Fix: Upgrade to paid Gemini API tier.

**Symptom: Enrichment completes but score shows "0" or blank**
Possible cause: JSON parse error — the output format section of your ICP prompt was modified.
Fix: Restore the exact output format block. See `02-icp-library.md`.

**Symptom: Enrichment is slow (5–8 minutes per lead)**
Possible cause: Gemini API is experiencing elevated latency (check Google Cloud Status dashboard).
Or: Your ICP prompt is very long (>5,000 tokens), increasing processing time.
Fix: Monitor Google Status page; consider shortening ICP prompt if excessively long.

---

## Anthropic (Claude)

### Role in the Platform

Claude Sonnet handles the synthesis and summary generation tasks that require nuanced, human-readable narrative output:

- **Company overview** — a 2–3 paragraph summary of the business, its market position, and what the crawled data reveals
- **Outreach hook** — a personalised opening sentence for cold outreach, derived from the most compelling signals found
- **Competitive intelligence narrative** — the Strategic Overview and Competitive Angle sections of the Competitors tab
- **General signal extraction** — signals beyond the ICP-specific scoring, such as business health indicators, growth signals, and risk flags

Removing the Anthropic key does not affect Gemini scoring. The Overview tab will show partial content (score, signals, and ICP explanation are generated by Gemini), but the synthesis sections will be absent.

### Obtaining a Key

1. Go to [https://console.anthropic.com](https://console.anthropic.com)
2. Create an account or sign in
3. Navigate to **API Keys** in the left sidebar
4. Click **Create Key**, enter a descriptive name
5. Copy the key (begins with `sk-ant-`)

### Credit Management

Anthropic uses prepaid credits. New accounts receive a small trial credit balance. For production use, add a payment method and purchase credit balance.

**Estimated Claude usage per enrichment:**
- Input: ~2,000–5,000 tokens (assembled enrichment data)
- Output: ~300–600 tokens (synthesis paragraphs)
- Cost at Claude Sonnet rates: ~$0.003–$0.008 per enrichment

**Monitoring:** Check your Anthropic console dashboard for remaining balance. If credits run out mid-batch, synthesis sections will fail for remaining leads.

### Diagnosing Anthropic Issues

**Symptom: Overview tab missing synthesis paragraphs and outreach hook**
Cause: Anthropic key missing or invalid.
Fix: Verify key in Settings; check Anthropic console for account status.

**Symptom: Synthesis sections suddenly disappear across all new enrichments**
Cause: Anthropic credit balance depleted.
Fix: Add credits to your Anthropic account.

**Symptom: `overloaded_error` appearing in logs**
Cause: Anthropic's API is under high load (relatively common).
Fix: These requests are typically automatically retried. If persistent, wait 5–10 minutes and re-enrich affected leads.

---

## Apify

### Role in the Platform

Apify is a cloud-based web scraping infrastructure service. Recon uses it for three distinct categories of scraping, each requiring Apify to run different actors (Apify's term for scraping scripts):

**Actor 1: Google Maps Scraper**
Used for: Maps Search feature
Scrapes: Business listings from Google Maps matching a search term and location
Returns: Business name, address, phone, website URL, rating, review count, category

**Actor 2: Review Scraper**
Used for: Reviews tab in Intel Reports
Scrapes: Google Maps reviews, Yelp reviews, TripAdvisor reviews for each lead
Returns: Platform rating, total review count, top review snippets with reviewer names and dates

**Actor 3: Social Media Scraper**
Used for: Social data in Intel Reports
Scrapes: LinkedIn company pages, Facebook business pages, X/Twitter profiles
Returns: Follower counts, bio text, recent post content

### Obtaining a Key

1. Go to [https://apify.com](https://apify.com) and create an account
2. Navigate to **Settings → Integrations**
3. Find the **Personal API tokens** section
4. Click **+ Add new token**, give it a name, select all permissions
5. Copy the token (begins with `apify_api_`)

### Apify Plans and Credit Economics

Apify uses a compute-unit billing model. Credits are consumed based on how long the actor runs and how many pages are scraped.

**Free plan:** $5/month of compute units included. Sufficient for occasional testing only — not for regular use.

**Starter plan ($49/month):** $49 of compute units. Sufficient for moderate use (several Maps searches per week, daily enrichments).

**Scale plan ($99/month):** For teams running daily Maps searches and enriching 100+ leads per week.

**Credit consumption estimates per operation:**

| Operation | Estimated Credit Cost |
|---|---|
| Maps Search — 2×2 grid (4 cells) | $0.20–$0.60 |
| Maps Search — 4×4 grid (16 cells) | $0.80–$2.50 |
| Maps Search — 6×6 grid (36 cells) | $2.00–$6.00 |
| Review scraping — per lead | $0.02–$0.15 |
| Social profile — per lead | $0.01–$0.08 |
| Full enrichment (reviews + social) per lead | $0.03–$0.23 |

**For a team enriching 50 leads per week with weekly Maps searches:**
Estimated Apify cost: $15–$40/month → Starter plan is appropriate.

**For a team enriching 200+ leads per week with multiple daily Maps searches:**
Estimated Apify cost: $60–$120/month → Scale plan is appropriate.

### Monitoring Apify Credits

1. Log into [https://apify.com](https://apify.com)
2. Go to **Billing** in the left sidebar
3. Check **Available balance** and **Usage this month**

Credits reset on your monthly billing date, not calendar month.

### Diagnosing Apify Issues

**Symptom: Maps Search starts but returns 0 results**
Possible causes:
1. Apify key invalid → Check Settings and Apify account
2. Apify credits exhausted → Check Apify billing dashboard
3. Search term returns no results on Google Maps (unlikely for major cities)
Fix: Verify key, check credits, try a different search term.

**Symptom: Maps Search returns some results but far fewer than expected**
Possible cause: Google Maps returned fewer than 20 results per cell (expected for low-density areas).
Or: Some grid cells failed to complete due to Apify timeout.
Fix: Not a configuration issue — this is normal for sparse areas. Increase grid density or run overlapping searches.

**Symptom: Reviews tab empty on all new enrichments (was working before)**
Possible cause: Apify credits exhausted mid-month.
Fix: Top up Apify account balance.

**Symptom: Reviews appear for some leads but not others**
Possible cause: Some businesses have no review pages on supported platforms.
Or: Some review pages had anti-bot protection that blocked Apify.
Fix: Expected behaviour — not all businesses appear on Yelp or TripAdvisor.

**Symptom: Apify runs but takes much longer than expected**
Possible cause: Target websites have slow response times, or Apify's infrastructure is under load.
Fix: Monitor Apify's status page. Consider running enrichments during off-peak hours.

---

## Seamless.AI

### Role in the Platform

Seamless.AI provides verified B2B contact data — the decision-maker names, titles, direct emails, and phone numbers that populate the Contacts tab. When Recon enriches a lead, it queries Seamless.AI with the business domain and retrieves the top 5 matching contacts.

Contacts returned include:
- Full name
- Job title
- Verified direct email address
- Direct phone / mobile number
- LinkedIn profile URL

### Obtaining a Key

1. Log into your Seamless.AI account at [https://seamless.ai](https://seamless.ai)
2. Navigate to **Settings → Integrations → API**
3. Generate or copy your API key

### Credit Economics

Seamless.AI operates on a credit model. Each contact lookup consumes credits. The number of contacts returned per domain varies from 0 to 5+ per enrichment.

**Credit consumption:** Typically 1 credit per contact returned. A domain that returns 3 contacts costs 3 credits.

**Plan considerations:**
- Basic Seamless.AI plans include 50–200 credits/month — insufficient for regular use
- Professional plans include 250–1,000 credits/month
- For teams enriching 100+ leads/week, an enterprise plan or credit top-up is necessary

**Monitoring:** Check your Seamless.AI dashboard under **Usage** to track remaining credits.

### Coverage Reality Check

Seamless.AI's database has strong coverage for:
- US-based companies with 10+ employees
- B2B-oriented businesses in technology, professional services, SaaS, healthcare
- Companies with significant LinkedIn and business directory presence

Coverage is notably weaker for:
- Small independent owner-operated businesses (arcades, family venues, restaurants)
- Companies under 5 employees
- Businesses outside the US, UK, Canada, and Australia
- Companies formed in the last 12–18 months

**For SMB entertainment venue prospecting:** Expect 40–60% of enriched leads to return zero or one contact. This is not a Recon or Seamless.AI configuration failure — it reflects the reality that many small independent operators do not have their personal contact details indexed in B2B databases.

**Alternative for zero-contact leads:** The website crawl often extracts a phone number and sometimes an email address from the business's website. These appear in the lead's report header even when Seamless.AI returns no contacts.

### Diagnosing Seamless.AI Issues

**Symptom: Contacts tab empty across 100% of enriched leads**
Cause: Seamless.AI key missing, invalid, or account suspended.
Fix: Verify key in Settings; check Seamless.AI account status.

**Symptom: Contacts tab empty for 50-70% of leads**
Cause: Normal — small business coverage limitations.
Fix: Expected. Not a configuration issue.

**Symptom: Contacts appear but titles/emails are outdated**
Cause: Seamless.AI data has variable refresh rates. B2B database lag is normal.
Fix: Verify on LinkedIn before calling. Use as a starting point, not ground truth.

**Symptom: Credits depleting faster than expected**
Cause: High enrichment volume, or some domains returning many contacts.
Fix: Monitor usage in Seamless.AI dashboard; upgrade plan or add credits.

---

## CRM Integrations

### HubSpot

**What it enables:**
A **Push to CRM** button appears on every Intel Report. Clicking it sends the lead's core data to HubSpot as a new Contact record.

**Data sent to HubSpot:**

| Recon Field | HubSpot Field |
|---|---|
| Business name | Company Name |
| Website URL | Website URL |
| Score (0-100) | Custom property: Recon Score |
| Verdict | Custom property: Recon Verdict |
| ICP Explanation | Notes |
| Key Signals | Custom property: Recon Key Signals |
| Contact 1 Name | First Name / Last Name |
| Contact 1 Title | Job Title |
| Contact 1 Email | Email |
| Contact 1 Phone | Phone Number |

**Setup process:**
1. Go to **Settings → HubSpot**
2. Click **Connect HubSpot**
3. You will be redirected to a HubSpot OAuth authorisation screen
4. Log in to HubSpot and authorise Recon's access
5. You will be returned to Recon with the connection active

**Important HubSpot notes:**
- Recon creates a new Contact record each time you push. It does not check whether the company already exists in HubSpot. If you push the same lead twice, two records are created.
- Custom Recon fields (Score, Verdict, Key Signals) must be pre-created as custom properties in HubSpot before they will populate. Recon will attempt to write to these properties; if they do not exist, those fields will be silently dropped.
- HubSpot's OAuth token expires periodically. If the Push to CRM button stops working, reconnect HubSpot in Settings.

### Salesforce

**What it enables:**
Same as HubSpot — a **Push to CRM** button on Intel Reports that creates a Lead record in Salesforce.

**Setup process:**
1. Go to **Settings → Salesforce**
2. Enter your Salesforce domain (e.g. `yourcompany.my.salesforce.com`)
3. Enter your Salesforce API credentials (username, password + security token)
4. Click **Connect**

**Important Salesforce notes:**
- Salesforce API access requires Professional Edition or higher. Developer and Essentials editions may not have API access.
- The security token for API access is separate from your login password. It can be reset from Salesforce Settings → Personal Information → Reset My Security Token.
- Custom field mapping (e.g. writing Recon Score to a custom Salesforce field) requires those fields to be pre-created in Salesforce. Work with your Salesforce admin to set up the field mappings before using the integration.
- If your Salesforce org uses IP restrictions, the Recon server's IP may need to be whitelisted.

---

## Full Setup Checklist

Use this checklist when setting up Recon for the first time or for a new team member:

```
MANDATORY (platform will not function without these):
☐ Google Gemini API key added in Settings
☐ Google Gemini API key verified — billing enabled on Google Cloud account
☐ Google Gemini API: Gemini API enabled in the associated Cloud project
☐ Anthropic API key added in Settings
☐ Anthropic account has credit balance

REQUIRED FOR FULL FUNCTIONALITY:
☐ Apify API key added in Settings
☐ Apify account on a paid plan (Starter minimum for regular use)
☐ Seamless.AI API key added in Settings
☐ Seamless.AI account has sufficient credits for intended volume

OPTIONAL (CRM integration):
☐ HubSpot OAuth connection completed (if using HubSpot)
☐ Salesforce credentials configured (if using Salesforce)
☐ Custom Recon fields pre-created in CRM (if pushing score/verdict to CRM)

ICP CONFIGURATION (before any enrichment):
☐ At least one ICP created in ICP Library
☐ ICP has been reviewed for completeness (all 9 prompt sections present)
☐ ICP is set as Active (green ACTIVE badge visible)

VERIFICATION:
☐ Single test lead enriched and completed successfully
☐ All four Intel Report tabs populated (or expected empties explained by known missing keys)
☐ Maps Search test: one search returned results
☐ CRM push test: one lead pushed and visible in CRM (if CRM configured)
```

---

## Complete Troubleshooting Matrix

| Symptom | First Check | Second Check | Resolution |
|---|---|---|---|
| Enrichment fails immediately for all leads | Gemini key in Settings | Google Cloud billing status | Re-enter key; enable billing in Cloud Console |
| Enrichment fails for some leads, succeeds for others | Lead URLs — are failed leads reachable? | Gemini rate limit hit mid-batch | Test failed URLs manually; upgrade Gemini quota |
| Score shows 0 or null | ICP prompt — output format section intact? | Gemini API error log | Restore exact output format block; check for trailing text |
| Overview tab: partial content only | Anthropic key in Settings | Anthropic credit balance | Add Anthropic key; top up credits |
| Overview tab: outreach hook missing | Anthropic key configured | Anthropic API response (check logs) | Verify Anthropic key; check Anthropic console |
| Contacts tab empty — ALL leads | Seamless.AI key in Settings | Seamless.AI account status | Add key; check account active status |
| Contacts tab empty — MOST leads | Seamless.AI key configured | Business type (SMB independent?) | Normal for SMB sector — check Seamless.AI coverage |
| Contacts tab shows outdated info | Seamless.AI key works | Data freshness | Verify on LinkedIn; normal data lag |
| Reviews tab empty — ALL leads | Apify key in Settings | Apify credit balance | Add key; top up credits |
| Reviews tab empty — SOME leads | Apify working on other leads | Business has no review pages | Normal — not all businesses are on Yelp/TripAdvisor |
| Maps Search returns nothing | Apify key in Settings | Apify credit balance | Add key; top up credits |
| Maps Search returns fewer results than expected | Grid density — is it high enough? | Area density — rural area? | Increase grid density; run multiple search terms |
| Push to CRM button missing | HubSpot/Salesforce connected in Settings | OAuth token not expired? | Reconnect CRM in Settings |
| Push to CRM button present but push fails | Custom fields created in CRM? | CRM API access for account tier? | Create custom fields in CRM; verify API access tier |
| Key saved but feature still broken | No spaces before/after key | Key permissions (correct scope?) | Copy to plain text editor; check for spaces; verify key permissions |
| Batch stalls mid-way and never completes | Gemini rate limit (check logs) | Apify timeout on specific lead | Check logs; re-enrich stalled leads; upgrade Gemini tier |
