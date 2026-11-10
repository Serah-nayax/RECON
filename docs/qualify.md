# Qualify and ICPs

The Lead Qualifier scores each lead against the **active ICP** (ideal customer profile).

## Running a batch

- **From Maps**: *Qualify all* on a finished search, or send single places.
- **From a file**: upload a CSV, Excel or ODS list with at least a name, ideally a website. CSV files may use commas, semicolons (French Excel) or tabs, quoted fields with line breaks, and UTF-8 or Windows (Latin-1) encoding.

Each lead gets:

| Field | Meaning |
|---|---|
| **Score** 0–100 | How well the lead fits the ICP |
| **Verdict** | QUALIFY (60+), BORDERLINE (40–59), DISQUALIFY (below 40) |
| **Signals** | The evidence found for and against: the sentence from the site, or the Maps data |

Batches run in the background, can be stopped and retried, and resume after a restart. Each finished lead is saved within a second, so a restart only re-runs the leads that were in progress. A resumed batch also retries its failed leads (a failure is usually a passing AI or network error); cancelled batches are not resumed. A stopped batch shows **Stopped** (here and in History) with the leads actually scored (e.g. 53/306); **Resume unscored** scores the rest. A batch cannot be retried while it is still running. A lead that fails after AI calls keeps its AI usage, so the batch and monthly costs include it. When Claude is on and still unreachable after several tries, the lead fails rather than getting a score from the free scorers: retry it later. Results can be exported to Excel or pushed to HubSpot / Salesforce. Past batches are listed under **History**.

## How a lead is scored

1. **Read the website.** RECON fetches the homepage and the most useful linked pages, with a 15-second time limit. A mistyped `wwww.` address is read as `www.`. It also notes review and social media links. A place without a website is scored from its name, Google category and Maps data, more cautiously.
2. **Score.** Three scorers, in this order:
   - **AI: Claude or Gemini**, when switched on. Claude (Haiku, `RECON_ENABLE_CLAUDE=1`, see [setup](setup.md#optional-ai-claude-recommended-for-qualify)) is the recommended scorer and is used first; otherwise Gemini (`RECON_ENABLE_GEMINI=1`). Both use the same prompt and the same scoring. The AI does **not** choose the score. It says what the business is and whether it is the ICP's kind of business. It answers each qualify and disqualify signal (met / not met / unknown) with a quote copied from the site. RECON checks every quote against the text it sent: a claim whose quote is not there counts as unknown. The score is then computed from the verified facts (see below), so the same evidence always gives the same score.
   - **Local model** (the default, free). A small multilingual model runs on your machine; no data leaves it. It compares each ICP signal with the sentences of the site *by meaning*, checks that the Google category and the site fit the ICP's sector, and reads numbers ("40 games") against numeric signals ("15+ machines"). The model is downloaded once (~120 MB) into `.models/`.
   - **Rules**, if the local model cannot load. Multilingual keyword rules (EN/FR/DE/ES/IT/NL/PT) built for the arcade ICP. Arcade ICPs also get venue details from these rules: payment system, machines, pitch.
3. Results are cached for 6 hours, so re-running a batch does not crawl again.

## How the AI score is computed

| Step | Effect |
|---|---|
| Kind of business | Target: 60. Partial fit: 42. Unknown: 30. Another kind of business: 10, final |
| Qualify signals | Each confirmed signal raises the score; 4 confirmed signals reach the ceiling: 100 for the target, 75 for a partial fit, 60 for unknown |
| Disqualify signal confirmed | Score capped at 25 |
| No website content | Score capped at 55 (BORDERLINE) |

"Target" needs a quote too: without one, the lead counts as a partial fit. Each answer names the ICP signal it is about, and one fact counts for one signal only (the same quote under two signals counts once).

**Second opinion on uncertain scores.** The AI does not answer exactly the same way twice. Clear cases (shops, escape games, well-documented arcades) are stable, but a score between 25 and 75 could move by up to 25 points from one run to the next. Such a lead is therefore scored a second time. If both runs give the same verdict, the lower score is kept. If they disagree, a third run decides and the middle score is kept. This costs about 50% more (≈ $0.003 per lead instead of $0.0018). On two runs of the same 21 Lyon leads (Nov 2026), 20 got the same score. The remaining one, a VR escape game, stayed between DISQUALIFY and BORDERLINE.

**A site that cannot be read** is tried again 5 seconds later. If it still gives nothing, the lead is scored from its name and Maps data, capped at 55, and marked "website could not be crawled". That result is cached for 5 minutes only, so retrying the lead reads the site again.

The quotes appear under **Signals**, so anyone can check why a lead got its score.

## AI consumption

Each lead scored by the AI keeps its token count (calls, input and output tokens, model). Under the batch counters, the Qualify page shows:

- **AI this batch**: calls, tokens, estimated cost and cost per lead.
- **AI this month**: AI-scored leads, calls and estimated cost across all batches.

The API also gives these totals: `usage` in `GET /api/qualify` and `GET /api/qualify/:batchId`, and the monthly totals in `GET /api/qualify/usage`.

**Prompt caching (Claude).** The instructions built from the ICP (about 3,900 tokens) are the same for every lead, so they are sent first with a cache marker: one small request writes them to the cache at the start of a batch, and every lead then reads them at 0.1x the input price. Only the lead's own content (name, crawled pages) is paid in full. The cache lasts 5 minutes and each lead refreshes it. Editing the ICP changes the instructions, so the next lead writes the cache again. The batch line shows the cache tokens read and written; if "read" stays at 0, caching is broken.

The cost is an **estimate** from list prices (USD per million tokens, in `aiUsage.ts`). The provider console (Claude Console) is the real bill. Leads served from the cache and leads scored without AI cost nothing and are not counted.

## Current limits

Without AI, the free scorers find evidence but do not reason. On a Lyon test (Nov 2026) they were **not reliable enough** for the team: toy shops scored high and real arcades low. Use Claude for real lists.

## ICP library

An ICP is a profile of the customers you want:

- **Name and description**: who the customer is.
- **Qualify signals**: what makes a good lead ("15+ arcade machines", "redemption counter", "token machines").
- **Disqualify signals**: what rules a lead out ("unattended route operator", "fewer than 15 machines").
- **Score bands**: what each score range means.
- **System prompt**: instructions given to the AI (Claude or Gemini) when it is on.

Only one ICP is active at a time. It is used by the qualifier and suggests search terms on the Maps page. RECON ships with an example ICP, *FEC & Arcade Venues*. **Reset** turns the active ICP back into this example.

Write signals as a person would describe the evidence: the local model matches them by meaning, in any language.
