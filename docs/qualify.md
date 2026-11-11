# Qualify and ICPs

The Lead Qualifier scores each lead against the **active ICP** (ideal customer profile).

## Running a batch

- **From Maps**: *Qualify all* on a search, or send single places.
- **From a file**: upload a CSV, Excel or ODS list with at least a name, ideally a website, or paste a list.

Batches run in the background. They can be stopped, resumed and retried, and resume on their own after a restart. Past batches are listed under **History**.

## Results

| Field | Meaning |
|---|---|
| **Score** 0–100 | How well the lead fits the ICP |
| **Verdict** | QUALIFY (60+), BORDERLINE (40–59), DISQUALIFY (below 40) |
| **Signals** | The evidence for and against, quoted from the website or taken from Maps |

Results can be exported to Excel once every lead of the batch is scored (a stopped batch must be resumed first). Once HubSpot or Salesforce is connected in Settings, they can also be pushed there (the Push buttons are hidden until then).

## How a lead is scored

1. **RECON reads the website**: the homepage and the most useful pages. A lead without a website is scored from its name and Maps data. A site that cannot be read (network cut, slow site) is put aside and read again at the end of the batch; only if it still fails is the lead scored without it, marked "website could not be crawled".
2. **The AI (Claude) analyses the site**: what kind of business it is, and which ICP signals it meets, each backed by a quote from the site. RECON checks that every quote is really on the site.
3. **RECON computes the score** from the verified facts. The same evidence always gives the same score. Every lead is analysed twice at the same time; if the two verdicts differ, a third analysis decides (the middle score is kept), so the same lead gets the same verdict from one run to the next. Only a lead that is clearly the ICP's kind of business can reach QUALIFY: the AI must quote the ICP's own words naming that kind of venue (e.g. "restaurants" for Street Route) and a sentence of the lead showing the machines or games. A venue that shows the machines but that the ICP does not name stays BORDERLINE at most; a venue that shows no machines at all is a DISQUALIFY unless its signals lift it. The Google Maps category alone does not count when the website shows another activity. A missing payment system does not lower the fit (a venue still on coins is the opportunity).

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

One ICP is active at a time. It is used by the qualifier and suggests search terms on the Maps page.
