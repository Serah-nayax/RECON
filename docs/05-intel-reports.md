# Intel Reports

An Intel Report is the full output Recon generates for a single business after enrichment. It combines AI-powered lead scoring, live website crawl data, verified decision-maker contacts, customer review sentiment analysis, and competitive intelligence into a single structured view with four tabs.

Intel Reports are what reps actually use. They are the deliverable from which call preparation, CRM entry, outreach personalisation, and pipeline prioritisation all flow. Understanding every section — where the data comes from, how to interpret it accurately, how to use it in outreach, and where its limitations lie — is what determines whether Recon produces genuine sales efficiency or just impressive-looking data.

---

## Report Generation Pipeline

Each Intel Report is assembled from up to 8 data sources. The number of sources successfully queried determines how complete the report is.

```
DATA SOURCES AND THEIR CONTRIBUTION TO EACH TAB:

                        Overview  Contacts  Reviews  Competitors
────────────────────────────────────────────────────────────────
Website Crawl               ✅        ✅        ❌         ✅
(always runs)            score,   phone/    (not      competitive
                         signals  email     used)     signals

Apify Reviews               ❌        ❌        ✅         ❌
(requires Apify key)                       rating,
                                          snippets

Apify Social                ❌        ✅        ❌         ✅
(requires Apify key)               social    (not    social-based
                                  followers  used)    intel

Seamless.AI                 ❌        ✅        ❌         ❌
(requires Seamless.AI    (not    name/     (not       (not
key)                     used)  title/    used)      used)
                               email/phone

Gemini Scoring              ✅        ❌        ❌         ❌
(requires Gemini key)  score,    (not      (not       (not
                       verdict,  used)     used)      used)
                       signals,
                       explanation

Claude Synthesis            ✅        ❌        ❌         ✅
(requires Anthropic)  overview   (not    (not    competitive
                      paragraph  used)   used)   narrative,
                      hook                       competitive
                                                 angle
────────────────────────────────────────────────────────────────
```

**Minimum viable report** (Gemini key only):
- Overview tab: Score, verdict, signals, ICP explanation ✅
- Overview tab: Synthesis paragraph, outreach hook ❌
- Contacts tab: Empty ❌
- Reviews tab: Empty ❌
- Competitors tab: Minimal (no narrative) ❌

**Full report** (all keys):
- All tabs fully populated ✅

---

## The Overview Tab — Complete Reference

### Score Arc — Reading Beyond the Colour

The circular gauge displays the exact 0–100 score inside a coloured arc. The colour follows the verdict (green/amber/red), but the number inside is more informative than the colour alone.

**Why the number matters more than the colour:**

Two leads can both be green (QUALIFY) with very different scores:
- Score 94: Near-perfect ICP match. All primary and most secondary signals confirmed. Call immediately.
- Score 67: Meets primary qualifier but evidence is thin. Probable fit; verify before committing full outreach cadence.

The colour tells you the decision category. The number tells you how confident that decision is.

**Score precision:**
Scores are reported as whole numbers. The AI reasons holistically, not computationally, so a score of 83 vs 84 is not meaningfully different. Treat scores as approximate band placements, not precise rankings. The meaningful distinctions are:
- 90+ vs 80-89 (same QUALIFY band but different urgency)
- 70+ vs 60-69 (both QUALIFY but different verification needs)
- Above vs below 60 (QUALIFY vs BORDERLINE threshold — depends on your ICP)

### Verdict Badge — Nuanced Interpretation

**QUALIFY**
The AI determined this lead meets your ICP's primary qualifier with sufficient evidence. Read the ICP Explanation to understand what evidence drove the QUALIFY decision.

**When to trust QUALIFY:** The ICP Explanation references specific, concrete evidence. Key Signals contain observable, verifiable items.

**When to question QUALIFY:** The ICP Explanation says "category suggests strong fit" without citing specific evidence. This indicates the AI relied on category assumptions rather than actual website content. Verify manually.

**BORDERLINE**
The AI found meaningful but insufficient evidence. This is not a soft rejection — it is a quality flag requiring human review.

**BORDERLINE lead types and how to handle each:**

| BORDERLINE Type | ICP Explanation Pattern | Action |
|---|---|---|
| Thin website | "Limited website content" | Check website manually; call to qualify |
| Explicit count missing | "Machine count not stated" | One question on call confirms or denies |
| Edge case venue | "Category association is ambiguous" | Quick website review resolves immediately |
| Conflicting signals | "Strong arcade signals but also route operator language" | Read full website carefully; check context |
| Score just below qualify band | Score 58-62 | Check if near-threshold evidence exists for upgrade |

**DISQUALIFY**
The AI determined this lead does not meet the ICP criteria. Two types:

1. **Hard disqualify:** A disqualify criterion was triggered. Score is typically 0–25. The ICP Explanation will identify which criterion.

2. **Soft disqualify:** No hard criterion triggered, but evidence does not support the ICP's requirements. Score is typically 20–39. The ICP Explanation will explain what was missing or what undermined the score.

**Auditing DISQUALIFY decisions:**
After each batch, review 3–5 DISQUALIFY leads you know from experience are actually good fits. If you find a pattern (e.g. all barcades being disqualified), the ICP has an edge case problem that needs fixing.

### ICP Explanation — The Most Important Field

The ICP Explanation is the AI's 2–3 sentence narrative rationale for the score. It is the single most important field to read for any lead before taking action.

**What it tells you:**

1. **What evidence was found:** "The venue operates a confirmed 40+ machine arcade floor with a dedicated redemption counter..."
2. **How that evidence mapped to the ICP:** "...placing it firmly in the 80-89 'Strong Fit' band."
3. **What evidence was absent:** "No existing cashless system was identified, indicating a greenfield opportunity."
4. **What action is implied:** "Recommended: call immediately to discuss cashless transition."

**Reading ICP Explanations critically:**

The explanation reveals the AI's reasoning chain. Sometimes that chain reveals a flaw in the ICP rather than a truth about the lead.

| Explanation Language | What It Reveals | Action |
|---|---|---|
| "Category 'bar' typically associated with..." | AI used category bias, not website evidence | Check ICP edge case handling; verify lead manually |
| "Website provides limited information about..." | Conservative fallback — thin content | Manual verification; call to qualify |
| "Machine count not explicitly stated, scoring conservatively" | Missing inference rules in ICP | Update ICP; lead may be stronger than score |
| "Large token machine infrastructure confirmed" | Strong direct evidence | Reliable score |
| "Birthday party packages suggest staffed operation" | Good inference from implied signal | Reliable inference |
| "Redemption counter present" | Direct strong signal | Most reliable type of evidence |

### Key Signals — Field-Level Analysis

Each key signal is a specific piece of evidence extracted from the crawled website content that contributed positively to the score. Signals are written as short evidential noun phrases: "Redemption counter present" not "Has a redemption counter."

**Signal quality tiers:**

**Tier 1 — Explicit confirmation (highest reliability):**
The website states the fact directly.
```
"50+ arcade games listed by name on Games page"
"Third-party cashless payment system referenced in FAQ"
"Founded 2008 — established venue with long operating history"
```

**Tier 2 — Strong implication (high reliability):**
The evidence strongly implies the fact without stating it.
```
"Full prize redemption counter with prize wall (implies 15+ machines)"
"Birthday party packages with arcade time as core feature (implies staffed operation)"
"'Largest arcade in [city]' claim (implies significant machine count)"
```

**Tier 3 — Moderate implication (medium reliability):**
The evidence suggests the fact but is not conclusive.
```
"Multiple game categories mentioned (shooting, racing, redemption)"
"Token vending mentioned in passing"
"Game room referenced but not sized"
```

**Using signals in outreach — full reference:**

| Signal Type | Cold Call Application | Email Application |
|---|---|---|
| Machine count confirmed | Open with fleet-specific reference | Personalise subject line with count |
| Redemption counter present | Ask about prize inventory management | Reference redemption as efficiency angle |
| Token/coin system | Ask about cashless transition plans | Position as upgrade opportunity |
| Existing cashless (competitor) | Ask about system satisfaction | Position as upgrade/displacement |
| Loyalty programme | Ask about redemption rates | Position as enhancement |
| Multi-attraction | Ask about cross-attraction coordination | Position as integrated solution |
| Birthday parties | Ask about party conversion to regulars | Position as retention tool |
| Large chain | Ask about regional/national rollout | Position as enterprise solution |

### Missing Signals — The Call Preparation Gold

Missing Signals are often more actionable than Key Signals. They tell you exactly what information the AI looked for and did not find — which means you can find it on the call.

**The missing signal to discovery question translation:**

| Missing Signal | Natural Discovery Question |
|---|---|
| Machine count not stated | "Can I ask — roughly how many machines do you have on the floor at the moment?" |
| No cashless system found | "Are you currently running on tokens or coins, or have you moved to a card system?" |
| No loyalty programme found | "Do you run any kind of loyalty scheme or membership for your regulars?" |
| Ownership/decision-maker unclear | "Are you the owner, or is there someone else I should be talking to about the technology side?" |
| Multi-attraction status unclear | "Is it purely the arcade, or do you have other things going on — bowling, laser tag, that kind of thing?" |
| Venue size/sq footage unknown | "How big is the floor? Are you in a standalone venue, or is it within a larger complex?" |

**Missing signals as qualification signals:**
A BORDERLINE lead at score 62 with a missing signal of "machine count not stated" is not necessarily a weak lead. It may be a 50-machine arcade whose website simply does not mention the count. One question on the call resolves the most important qualification criterion. Treat these as opportunities, not weaknesses.

### Recommended Action

The AI's suggested next step, calibrated to the specific score and evidence profile. It is not generic — it reflects the ICP's score band descriptions and the specific signals found.

**Action categories and their meaning:**

| Action Type | Typical Phrasing | Meaning |
|---|---|---|
| Immediate outreach | "Call immediately — strong ICP fit confirmed" | Top-tier lead, no verification needed |
| Prioritised outreach | "High-value prospect, outreach within 24 hours" | Strong lead, action this week |
| Verify then pursue | "Confirm machine count before full outreach cadence" | Good lead, one verification step needed |
| Phone qualify | "Call to qualify — signals present but count unconfirmed" | Promising but needs a confirming call |
| Research first | "Further research recommended before outreach" | Uncertain — manual review needed |
| Do not pursue | "Remove from pipeline — disqualify criterion triggered" | Hard stop |

---

## The Contacts Tab — Complete Reference

### Contact Data Architecture

Each contact record returned by Seamless.AI contains:

| Field | Description | Reliability |
|---|---|---|
| **Name** | Full legal name | Very high — directly indexed |
| **Title** | Job title at time of indexing | Medium — changes with role changes |
| **Direct Email** | Verified direct work email | High when verified |
| **Direct Phone** | Direct dial or mobile | Medium — changes with number changes |
| **LinkedIn URL** | Profile URL | High if indexed |

### Contact Prioritisation Matrix

For entertainment venue outreach, the following hierarchy applies:

**Tier 1 — Budget holders (most important to reach):**
- Owner / Co-Owner
- CEO / President (for larger operations)
- Managing Director

**Tier 2 — Operational decision-makers (typically control vendor selection):**
- General Manager (GM)
- Director of Operations
- VP of Operations
- Regional Manager (for chains)

**Tier 3 — Influencers (involved in evaluation, not final decision):**
- Director of Entertainment
- Arcade Manager
- Entertainment Supervisor
- Events Manager / Director

**Tier 4 — Entry points (useful for introductions, not decisions):**
- Marketing Manager / Director
- Marketing Coordinator

**Skip entirely:**
- F&B Director (unrelated function)
- HR Manager (unrelated function)
- Finance Manager (unless specifically told to involve them)

### Pre-Call Contact Verification

Seamless.AI data reflects when the contact was indexed, which may be months or over a year ago. Job changes in the entertainment industry are frequent. Always verify before calling:

**Verification checklist:**
```
☐ Search: "[Contact Name] [Business Name]" on LinkedIn
☐ Confirm: Contact is still shown as employed at the business
☐ Confirm: Title matches what Seamless.AI returned (or note the difference)
☐ If LinkedIn shows "No longer at [company]": call main line and ask for current GM/Owner
☐ If LinkedIn profile is absent: the contact may be an owner/operator with low LinkedIn presence
    → Call the main business number and ask by name; confirm they are the right person
```

### When Contacts Tab Is Empty

**Scenario 1: Seamless.AI key not configured**
All Contacts tabs will be empty. Fix: Add Seamless.AI key in Settings.

**Scenario 2: Seamless.AI key configured, credits exhausted**
All new Contacts tabs after credit depletion will be empty; older reports retain contacts. Fix: Top up Seamless.AI credits.

**Scenario 3: Seamless.AI key configured, credits available, contacts still empty**
The business domain has no indexed contacts in Seamless.AI's database. This is common for:
- Small independent operators (sole owner, no HR department)
- Recently opened businesses (not yet indexed)
- International businesses outside Seamless.AI's strong coverage zones

**Action for empty contacts:**
1. The report header in Overview often shows a phone number extracted from the website crawl — call this number
2. Ask: "Can I speak with the owner / general manager?"
3. Confirm the person you reach is the right decision-maker before pitching

---

## The Reviews Tab — Complete Reference

### Data Collection

Review data is collected by Apify from three platforms:
- **Google Maps** — most comprehensive; nearly all businesses have Google reviews
- **Yelp** — strong in the US; coverage outside North America is limited
- **TripAdvisor** — strongest for tourist-oriented and event venues; less common for pure arcades

### Overall Sentiment Rating

The AI synthesises rating data from all available platforms and assigns a single overall sentiment:

| Rating | Criteria | Outreach Implication |
|---|---|---|
| **Excellent** | 4.2+ average, predominantly positive themes, low complaint frequency | Business is well-run; customer experience is strong — your product adds to a good foundation |
| **Good** | 3.8–4.2 average, mostly positive, isolated complaints | Solid operation; complaints may surface specific pain points to address |
| **Mixed** | 3.2–3.8 average, balanced positive/negative | Operational challenges likely; complaints may directly relate to problems your product solves |
| **Poor** | Below 3.2, frequent negative themes, complaints outweigh praise | Assess carefully; the business may have deeper problems unrelated to your product |

### Strengths — How to Use in Outreach

Strengths tell you what the business values and what their customers praise. Use this to frame your product in terms the business owner cares about.

**If strength is "Staff friendliness":**
→ Owner values the customer experience. Lead with customer satisfaction outcomes, not operational efficiency.
→ "Venues that have the kind of service culture your reviews describe tend to get even more out of loyalty programmes because their customers want to come back."

**If strength is "Variety of games":**
→ Owner invests in the fleet. They care about keeping it modern and well-stocked.
→ "With the range of machines you run, having full visibility on which games are pulling the most card swipes helps you decide what to add next."

### Weaknesses — The Outreach Intelligence Gold

Weaknesses are the most tactically valuable section of the Reviews tab. They surface the business's real pain points — the problems causing customers to complain. If your product solves any of these, you have an immediate, validated, specific pitch.

**Weakness-to-pitch translation table:**

| Review Weakness | Your Product Angle |
|---|---|
| "Queues at token machines" | Cashless tap-to-play eliminates queue friction entirely |
| "Token machines always breaking" | No physical coin mechanism to break |
| "Hard to track prize redemption" | Integrated loyalty tracks redemptions automatically |
| "Prices went up and loyalty rewards didn't" | Loyalty programme creates retention buffer for pricing changes |
| "Used to have a rewards card, wish they still did" | Your loyalty programme — directly requested by their customers |
| "Staff never knew how many tokens I had" | Digital wallet visible on app and at every terminal |
| "Machines down and staff didn't know" | Management console with real-time machine status |

**Outreach script adaptation example:**

Review shows weakness: "Queue wait times at token machines on weekends — sometimes 10-minute wait"

Natural opening on call:
> "We work with a lot of entertainment venues across the state, and one thing we consistently hear from GMs about weekend operations is the friction around token stations during peak periods. Is that something you deal with at your venue?"

This frames the knowledge as market experience, not customer review analysis. The business owner validates the pain point and you are in a discovery conversation.

### Review Data Quality and Limitations

**Sample size matters:**
- <5 reviews total: Insufficient data for reliable sentiment analysis
- 5–25 reviews: Small sample; themes may not be representative
- 25–100 reviews: Good sample; themes are reasonably reliable
- 100+ reviews: Strong sample; high confidence in identified themes

**Review recency:**
Recon surfaces current reviews but cannot distinguish current operational quality from historical issues. A business with poor reviews from 2023 but strong reviews from 2025 shows a mixed sentiment. The trend over time is often more informative than the aggregate.

**Platform bias:**
- Yelp reviewers tend to be more critical than Google reviewers for the same business
- TripAdvisor skews toward tourists and occasional visitors
- Google Maps reviewers represent the broadest cross-section of actual customers

When platforms give conflicting signals (strong on Google, poor on Yelp), investigate why. Sometimes it reflects specific audience differences; sometimes it reflects a real operational issue that one audience experiences more than another.

---

## The Competitors Tab — Complete Reference

### How Competitor Data Is Gathered

The Competitors tab is assembled from multiple crawl sources:

**From the website crawl:**
- Direct product mentions ("our [Vendor] card system", "we use [Vendor]")
- Support or help pages referencing specific software/hardware
- Job listings mentioning required experience ("familiarity with [Vendor] card system a plus")
- FAQ sections answering questions about specific technology

**From review data:**
- Customer reviews mentioning products by name ("love how the [Vendor] system works")
- Complaints about specific systems ("the [Vendor] app keeps crashing")

**From social data:**
- Facebook posts announcing new equipment or system launches
- Instagram posts tagging vendor products

### Current Systems Section

A list of identified technology and platforms in use. Each item shows:
- The identified product/service
- The evidence source (website FAQ, job listing, review mention, etc.)
- Confidence level (confirmed, likely, possible)

**Confidence levels:**

| Level | Evidence Basis | Action |
|---|---|---|
| **Confirmed** | Direct mention in authoritative source (website, FAQ, About page) | Use in pitch planning with confidence |
| **Likely** | Strong indirect evidence (job listing, multiple reviews mentioning) | Use cautiously; verify on call |
| **Possible** | Single mention in peripheral source | Do not lead with this in pitch |

### Strategic Overview

A narrative paragraph explaining the business's current technology landscape and what it means for your sales approach. Written by Claude Sonnet based on all available evidence.

**What to extract from the Strategic Overview:**
1. Is this a greenfield opportunity, displacement opportunity, or upgrade opportunity?
2. What is the technology sophistication of the business?
3. What is their current pain profile?
4. What is the complexity of a sale here?

**Strategic situation guide:**

**Greenfield (no existing system):**
- No cashless system identified
- Still using tokens or cash
- No loyalty programme
- Approach: Educational sell — explain what they're missing, what ROI looks like
- Pitch angle: "What venues like yours typically experience after switching..."
- Timeline expectation: Longer — they need to build conviction before buying

**Direct Displacement (competitor confirmed):**
- Named competitor system confirmed
- Approach: Feature comparison, migration case studies
- Pitch angle: "What drove most venues from [competitor] to switch was..."
- Key asset: Specific advantages over the confirmed system
- Timeline expectation: Shorter if they have a pain point with current system

**Upgrade Path (older/partial system):**
- Token system or basic cashless without loyalty
- Approach: Natural next step, not replacement
- Pitch angle: "You've already done the hard part — the machines are there, the customers are ready..."
- Timeline expectation: Medium — they see the value but need to prioritise

### Competitive Angle

The specific positioning guidance for this lead based on what was found. This is produced by Claude and tailored to the specific competitive situation at this business.

**Using the Competitive Angle:**

The Competitive Angle is a briefing note for the rep. It should be read before the call, not during it. Key things to extract:

1. What is the most compelling differentiation point for this specific prospect?
2. What competitor objection is most likely, and what is the counter?
3. What outcome should I lead with?

**Internalising the Competitive Angle into a call:**
Don't read the Competitive Angle to the prospect. Extract the key insight and make it your own:

Competitive Angle says: "Venue currently on a competitor card system, which lacks loyalty integration. Lead with loyalty as the primary differentiator — they already understand cashless, they need the retention layer."

Rep says on call: "Most venues we talk to who are already on a cashless system tell us the next thing they want is a loyalty layer — being able to reward their regulars, track visits, push offers. Is that something you've been thinking about?"

This is the Competitive Angle translated into a natural conversation starter.

---

## Report Reliability and Limitations — Complete Reference

| Report Section | Data Source | Reliability | Key Limitation |
|---|---|---|---|
| Score | Gemini + ICP + crawled content | High (when ICP is well-calibrated) | Degrades with thin website content; ICP quality matters |
| Verdict | Gemini + ICP | High (when ICP is well-calibrated) | Can diverge from score in edge cases |
| ICP Explanation | Gemini | High (reflects AI's actual reasoning) | May reveal ICP flaws, not lead flaws |
| Key Signals | Gemini + crawled content | Medium-High | Only what the crawler found; visual signals missed |
| Missing Signals | Gemini | Medium | May be present on uncrawled pages |
| Overview Synthesis | Claude + all sources | High | Quality depends on data completeness |
| Outreach Hook | Claude + key signals | High | Requires editing before use — starting point, not final copy |
| Contacts | Seamless.AI | Medium | Data lag; job changes not reflected in real time |
| Reviews Sentiment | Apify + Claude | High | Platform coverage varies; small review counts reduce reliability |
| Review Quotes | Apify | Very High | Verbatim from actual reviews |
| Current Systems | Claude + all sources | Medium | Only shows what is mentioned online |
| Competitive Angle | Claude | High | Well-reasoned but based on available data only |
