# Qualify and ICPs

The Lead Qualifier scores each lead against the **active ICP** (ideal customer profile).

## Running a batch

- **From Maps**: *Qualify all* on a search, or send single places.
- **From a file**: upload a CSV, Excel or ODS list with at least a name, ideally a website.

Batches run in the background. They can be stopped, resumed and retried, and resume on their own after a restart. Past batches are listed under **History**.

## Results

| Field | Meaning |
|---|---|
| **Score** 0–100 | How well the lead fits the ICP |
| **Verdict** | QUALIFY (60+), BORDERLINE (40–59), DISQUALIFY (below 40) |
| **Signals** | The evidence for and against, quoted from the website or taken from Maps |

Results can be exported to Excel or pushed to HubSpot or Salesforce.

## How a lead is scored

1. **RECON reads the website**: the homepage and the most useful pages. A lead without a website is scored from its name and Maps data.
2. **The AI (Claude) analyses the site**: what kind of business it is, and which ICP signals it meets, each backed by a quote from the site. RECON checks that every quote is really on the site.
3. **RECON computes the score** from the verified facts. The same evidence always gives the same score. A lead with an uncertain score is analysed again to confirm it.

Without AI, a local model scores the leads on the machine.

## AI consumption

The Qualify page shows the AI usage and estimated cost of the batch and of the month.

## ICP library

An ICP describes the customers you want:

- **Name and description**: who the customer is.
- **Qualify signals**: what makes a good lead.
- **Disqualify signals**: what rules a lead out.
- **Score bands**: what each score range means.
- **System prompt**: instructions given to the AI.

One ICP is active at a time. It is used by the qualifier and suggests search terms on the Maps page. **Reset** restores the example ICP.
