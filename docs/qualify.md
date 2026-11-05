# Qualify and ICPs

The Lead Qualifier scores each lead against the **active ICP** (ideal customer profile).

## Running a batch

- **From Maps**: *Qualify all* on a finished search, or send single places.
- **From a file**: upload a CSV, Excel or ODS list with at least a name, ideally a website.

Each lead gets:

| Field | Meaning |
|---|---|
| **Score** 0–100 | How well the lead fits the ICP |
| **Verdict** | QUALIFY (60+), BORDERLINE (40–59), DISQUALIFY (below 40) |
| **Signals** | The evidence found for and against: the sentence from the site, or the Maps data |

Batches run in the background, can be stopped and retried, and resume after a restart. Results can be exported to Excel or pushed to HubSpot / Salesforce. Past batches are listed under **History**.

## How a lead is scored

1. **Read the website.** RECON fetches the homepage and the most useful linked pages, with a 15-second time limit. It also notes review and social media links. A place without a website is scored from its name, Google category and Maps data, more cautiously.
2. **Score.** Three scorers, in this order:
   - **Gemini**, only when switched on (`RECON_ENABLE_GEMINI=1`, see [setup](setup.md#optional-ai-gemini)). It reads the pages with the ICP's prompt and returns a score, a verdict and the signals.
   - **Local model** (the default, free). A small multilingual model runs on your machine; no data leaves it. It compares each ICP signal with the sentences of the site *by meaning*, checks that the Google category and the site fit the ICP's sector, and reads numbers ("40 games") against numeric signals ("15+ machines"). The model is downloaded once (~120 MB) into `.models/`.
   - **Rules**, if the local model cannot load. Multilingual keyword rules (EN/FR/DE/ES/IT/NL/PT) built for the arcade ICP. Arcade ICPs also get venue details from these rules: payment system, machines, pitch.
3. Results are cached for 6 hours, so re-running a batch does not crawl again.

## Current limits

The free scorers find evidence; they do not reason. On a Lyon test (Nov 2026), the keyword/local scoring was **not reliable enough** for the team: venues were mis-scored when the site did not state its fleet size in plain words.

**Planned next step:** a hybrid qualifier. The rules decide the clear cases. Gemini (free tier, opt-in) handles the uncertain ones and quotes its evidence. Accuracy is measured against a reference set of known Lyon venues before it is trusted.

## ICP library

An ICP is a profile of the customers you want:

- **Name and description**: who the customer is.
- **Qualify signals**: what makes a good lead ("15+ arcade machines", "redemption counter", "token machines").
- **Disqualify signals**: what rules a lead out ("unattended route operator", "fewer than 15 machines").
- **Score bands**: what each score range means.
- **System prompt**: instructions given to Gemini when it is on.

Only one ICP is active at a time. It is used by the qualifier and suggests search terms on the Maps page. RECON ships with an example ICP, *FEC & Arcade Venues*. **Reset** turns the active ICP back into this example.

Write signals as a person would describe the evidence: the local model matches them by meaning, in any language.
