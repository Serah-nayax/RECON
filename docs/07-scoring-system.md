# Understanding the Scoring System

The scoring system is the engine of Recon. Every decision the platform makes — which leads to prioritise, what evidence to surface, what action to recommend — flows from the interaction between your ICP configuration and the AI's analysis of the crawled website content.

This document covers the complete scoring architecture, the mechanics of how Gemini generates scores, the role of score bands in calibrating output, everything that affects score reliability, how to interpret scores correctly, how to identify and fix systematic errors, and the full calibration methodology for maintaining accuracy over time.

---

## Scoring Architecture — Complete Technical Picture

Recon's scoring is not a rules engine, a points accumulator, or a keyword counter. It is an AI reasoning process. Understanding this distinction is fundamental to working with the platform effectively.

### What Actually Happens When a Lead Is Scored

```
INPUT ASSEMBLY
═══════════════════════════════════════════════════════════
Lead Context Block (assembled from enrichment stages):

  [WEBSITE CONTENT]
  Page: Home
  [full text of home page]

  Page: About Us
  [full text of about page]

  Page: Games / Arcade
  [full text of games page]

  ... (up to 12 pages)

  [CONTACT METADATA]
  Phone: +1 214 555 0100
  Email: info@venue.com
  Address: 123 Main St, Dallas TX

  [REVIEW DATA]
  Google Maps: 4.7 stars (847 reviews)
  Top reviews: [snippets]

  [SOCIAL DATA]
  Facebook: 12,400 followers
  Bio: "Dallas's premier family entertainment center..."

ICP System Prompt (from active ICP, with signals/bands injected):

  You qualify leads for [Company]...
  PRIMARY QUALIFIER...
  SCORE BANDS...
  DISQUALIFY...
  EDGE CASE HANDLING...
  INFERENCE RULES...
  Return ONLY valid JSON...
═══════════════════════════════════════════════════════════

GEMINI 2.5 FLASH PROCESSING
  - Reads both the ICP prompt and the lead context simultaneously
  - Applies the ICP criteria to the evidence found in the context
  - Reasons about score band placement
  - Produces a chain of reasoning (internal to the model)
  - Returns structured JSON output

OUTPUT
  {
    "score": 84,
    "verdict": "QUALIFY",
    "icpExplanation": "The venue operates a confirmed 40+ machine arcade floor
                       with a dedicated redemption counter...",
    "keySignals": [
      "Redemption counter present on homepage",
      "40+ games referenced in About page",
      "Birthday party packages with arcade time listed",
      "Token vending machines referenced in FAQ"
    ],
    "missingSignals": [
      "No existing cashless system confirmed",
      "Loyalty programme not mentioned"
    ],
    "recommendedAction": "Call immediately — strong ICP fit, no existing cashless
                          system suggests greenfield cashless opportunity"
  }
```

### Why This Matters for ICP Configuration

Because scoring is a reasoning process (not a calculation), the quality of the reasoning depends entirely on the quality of the instructions. An AI given clear, specific, well-structured instructions with good examples will produce consistent, accurate reasoning. An AI given vague, ambiguous, or contradictory instructions will produce inconsistent, unreliable reasoning — regardless of how much evidence is available.

This is why ICP configuration is not a commodity task. It requires understanding of:
- How large language models process and weight instructions
- What kinds of evidence actually appear on business websites
- How to structure criteria so the AI can distinguish adjacent score bands
- How to handle edge cases that the AI's training-data priors would get wrong

---

## The Score — Detailed Mechanics

### What the Number Represents

The score is a continuous confidence measure from 0–100 representing how strongly the available evidence supports the lead meeting your ICP's criteria. It is calibrated against your score band descriptions — the AI assigns the score that best fits the band whose description most closely matches the evidence profile.

**What the score is NOT:**
- Not a points tally (signals found × fixed point values)
- Not a percentage of qualify signals matched
- Not a measure of business quality, revenue potential, or likelihood to buy
- Not comparable across different ICPs

**What the score IS:**
- A measure of ICP fit as determined by the AI
- Calibrated to your specific score band descriptions
- Relative to the evidence available (websites with more content produce more reliable scores)
- Consistent within a single ICP (same lead, same ICP = same score)

### Score Stability

If you enrich the same lead twice with the same active ICP and the same website content, you should receive the same or nearly identical score (±2-3 points for LLM temperature variation). Significant score variation between enrichments of the same lead with the same ICP suggests:
- The website content changed between enrichments
- An ICP configuration was modified between enrichments
- An API change in the underlying Gemini model (rare)

### The Conservative Fallback Zone (55–65)

When the AI encounters a lead where the website content is thin, ambiguous, or provides insufficient evidence to confidently place the lead in any specific band, it defaults to the 55–65 range. This is not a genuine assessment — it is the AI signalling "I don't have enough evidence to score this confidently."

**Signs a score is a conservative fallback:**
- Score is exactly 60, 62, or 65 with a round number feel
- ICP Explanation says "machine count not explicitly stated" or "limited website content"
- Key Signals list has fewer than 3 items
- Missing Signals list is longer than Key Signals list
- The lead's website is 1–2 pages with minimal text

**Action:** Treat conservative fallback scores as BORDERLINE requiring manual review, not as genuine assessments. If the business looks promising from other data (Maps rating, review count, category), verify manually or by phone.

---

## Score Bands — The Calibration Layer

### How Band Descriptions Function as Scoring Instructions

This is the most misunderstood mechanism in Recon. Score bands are not just labels applied after scoring — they are read by the AI during scoring as criteria for where to place a lead.

**The AI's band-placement reasoning (simplified):**
1. Reads all band descriptions
2. Evaluates the evidence found against each band's description
3. Places the lead in the band whose description best matches the evidence profile
4. Assigns a score at the point within that band that reflects the strength of the match

**Implication:** If you change your band descriptions, scores will change even if the ICP prompt, signals, and criteria remain identical. Band descriptions are scoring instructions, not just display labels.

### Band Differentiation — The Critical Design Requirement

Adjacent bands must be clearly distinguishable by concrete, measurable criteria. Without clear differentiation, the AI cannot reliably place leads at band boundaries and will cluster scores at round numbers near the boundaries.

**Poorly differentiated bands (causes clustering):**
```
70-79: Good entertainment venue with significant arcade
80-89: Very good entertainment venue with strong arcade
```

These are functionally identical to the AI. "Good" vs "very good" and "significant" vs "strong" are subjective adjectives the AI cannot apply consistently.

**Well-differentiated bands (prevents clustering):**
```
70-79: 20-30 machines, staffed arcade section, ticket redemption evidence,
       may or may not have dedicated redemption counter

80-89: 30-50 machines, confirmed full redemption counter present on premises,
       clear FEC or multi-attraction identity — not just an arcade section
       within a larger non-gaming venue
```

The second version gives the AI two measurable criteria for differentiation: machine count (20-30 vs 30-50) and redemption counter status (may or may not have vs confirmed present).

### Band Boundary Effects

When a lead's evidence profile sits at the boundary between two bands, the AI typically places it in the lower band rather than the upper one. This is a natural tendency toward conservative scoring.

**Design implication:** Write your qualifying band descriptions to capture what you genuinely want the lower bound to be, not what you hope for. If you write the 70-79 band to require 20 machines, expect leads with 18-19 machines to score 60-69 rather than 70-71.

### Score Band Interaction with Disqualify Rules

When a disqualify criterion is triggered, it overrides the band system entirely. The AI bypasses band placement logic and assigns a score in the 0-20 range regardless of positive signals.

**The override hierarchy:**
```
Disqualify Criterion Triggered → Score 0-20 (DISQUALIFY)
    ↓ (if no disqualify triggered)
Band Placement Logic → Score based on closest matching band
    ↓
Output: score + verdict + signals + explanation
```

There is no mechanism to "partially" trigger a disqualify criterion. It is either triggered or it is not.

---

## Factors That Affect Score Reliability — Complete Analysis

### Factor 1: Website Content Depth

The single most important predictor of score reliability is the depth and richness of the website content the crawler finds.

**Content depth categories and their scoring effects:**

| Website Type | Token Count (approx) | Score Reliability | Typical Behaviour |
|---|---|---|---|
| Rich multi-page site (15+ pages, detailed) | 15,000–50,000 tokens | High | Accurate band placement, specific signals |
| Standard business site (5–10 pages) | 5,000–15,000 tokens | Good | Generally accurate, some inference |
| Thin site (1–3 pages) | 1,000–5,000 tokens | Medium | Conservative fallback zone common |
| Landing page only | 200–1,000 tokens | Low | Conservative score, few signals |
| Under construction | <200 tokens | Very Low | Effectively unscorable |
| No website | 0 tokens | None | Enrichment fails |

**Signs the crawl found minimal content:**
- Score in the 55–65 range with no specific evidence cited
- ICP Explanation uses phrases like "limited website content" or "website provides minimal detail"
- Key Signals contains only 1-2 items
- Missing Signals contains 5+ items

**What to do:**
- Check the business's website directly — does it have content the crawler should have found?
- If the site has JavaScript-heavy rendering, the crawler may have missed dynamic content
- Re-enrich is unlikely to help if the site is genuinely thin
- Verify by phone call instead

### Factor 2: ICP System Prompt Quality

The most controllable factor. A prompt that is specific, structured, and comprehensive will outperform a vague prompt on the same AI model with the same website content.

**Prompt quality dimensions:**

| Dimension | Poor Prompt | Good Prompt |
|---|---|---|
| Role definition | Absent or vague | Specific to company, product, target market |
| Primary qualifier | Not stated | Clearly stated with threshold and conditions |
| Segment handling | One-size-fits-all | Sub-sections per major segment type |
| Score band descriptions | Adjectives only | Concrete measurable criteria per band |
| Edge case handling | Absent | Explicit overrides for known misfire categories |
| Inference rules | Absent | Detailed implied signal guidance |
| Calibration examples | Absent | Named examples at 3+ score levels |
| Disqualify rules | Absent or overly broad | Specific, targeted, tested against known good customers |
| Output format | Modified or absent | Exact JSON schema, unmodified |

### Factor 3: Website Anti-Bot Protection

Some websites block automated crawlers. Common protection mechanisms and their effect on enrichment:

| Protection Type | Crawl Effect | Score Effect |
|---|---|---|
| Cloudflare Basic | Partial access | Reduced content, lower score confidence |
| Cloudflare Enterprise | Often blocked | Very minimal content or crawl failure |
| JavaScript-only SPA | No static content extracted | Near-empty context, conservative fallback |
| Login-gated content | Only public pages accessed | Scored on public content only |
| CAPTCHAs | May trigger on crawl | Some pages skipped |
| robots.txt exclusions | Respected by crawler | Some pages skipped |

**When to suspect anti-bot blocking:**
- A large, well-known venue scores 55–62 with only 1-2 signals
- The ICP Explanation says "limited website content" for a business you know has a rich website
- The crawl completes very quickly (< 30 seconds) for a complex site

**Workaround:** None available within Recon. Anti-bot protection is a website-level choice by the business owner. Consider manual research for high-priority leads affected by this.

### Factor 4: ICP/Market Mismatch

An ICP built for one market will produce unreliable results when applied to a different market. The ICP's signals, band descriptions, and disqualify criteria are all tuned for a specific context.

**Examples of ICP/market mismatches:**
- US FEC ICP applied to UK entertainment venues (different terminology, different business types)
- Arcade ICP applied to European gaming arcades (different market structure)
- SMB ICP applied to enterprise chains (different qualifying criteria at different scales)

**Detection:** If you run a batch in a new market and results look systematically wrong (large well-known venues scoring low, obvious disqualifies scoring high), suspect ICP/market mismatch before assuming a platform issue.

### Factor 5: API Model Changes

Gemini 2.5 Flash is an actively developed model. Periodically, Google deploys updates that may slightly change the model's reasoning behaviour. This is rare but can cause score shifts of ±5-8 points for borderline leads.

**Signs of a model change affecting scores:**
- Scores shift systematically across an entire batch without any ICP changes
- Leads that previously scored consistently at specific values now score differently
- Model change is announced in Google AI Studio release notes

**Mitigation:** After any noticed score shift, re-enrich a set of "reference leads" (leads you know well) to establish a new baseline. If the shift is significant, adjust band descriptions to recalibrate.

---

## Verdict Analysis — When Verdict and Score Diverge

In most cases, verdict maps predictably to score range. But divergences occur and are meaningful:

### Divergence Type 1: QUALIFY at Low Score (65-68)

Lead qualified but scored at the lower end of what your QUALIFY range covers.

**Meaning:** The AI found the lead to meet the primary qualifier clearly but with limited secondary evidence. Confident about qualification, cautious about scale.

**Action:** Treat as a genuine QUALIFY but with lower priority. Verify machine count or secondary signals before prioritising over higher-scoring leads.

### Divergence Type 2: DISQUALIFY at Moderate Score (35-45)

Lead disqualified but scored not at the very bottom.

**Meaning:** A disqualify criterion was triggered but positive signals were also present. The AI disqualified on the hard rule but the positive signals pushed the score above the minimum.

**Action:** Read the ICP Explanation. The explanation will identify what positive signals were present alongside the disqualify trigger. In some cases, the disqualify trigger may be incorrect (a prompt edge case). Manually review.

### Divergence Type 3: BORDERLINE at Higher Score (68-72)

Lead in BORDERLINE verdict with score in the range that would normally be QUALIFY.

**Meaning:** The AI found strong evidence in some areas but conflicting evidence in others. Rather than resolving the conflict by choosing a verdict, it flagged uncertainty.

**Action:** This is one of the highest-priority manual review cases. A BORDERLINE at 70+ often becomes a QUALIFY after 5 minutes of manual website review. The conflict the AI flagged is usually a resolvable ambiguity (e.g. the website doesn't confirm machine count explicitly, but the venue clearly runs arcade operations).

---

## Score Interpretation Reference — Detailed Action Guide

| Score | Typical Evidence Profile | Confidence Level | Action |
|---|---|---|---|
| 95-100 | All primary and secondary signals confirmed; may be named chain | Very High | Same-day outreach, highest priority |
| 88-94 | Strong primary signal, multiple strong secondary signals, clear ICP fit | High | Outreach within 24 hours |
| 80-87 | Primary signal confirmed, most secondary signals present | High | Outreach within 48 hours |
| 72-79 | Primary signal confirmed, some secondary signals, clear venue type | Medium-High | Schedule outreach this week; good prospect |
| 65-71 | Primary signal inferred (not explicit), venue type matches | Medium | Verify 1 key signal by phone before full cadence |
| 58-64 | Arcade/entertainment signals present, evidence thin | Medium-Low | Manual review; quick verification call worthwhile |
| 50-57 | Partial signals, significant uncertainty, thin website | Low | Research manually; cold call to qualify only if pipeline thin |
| 40-49 | Minimal relevant signals, does not clearly meet primary qualifier | Low | Do not prioritise; revisit if market coverage demands |
| 25-39 | Most criteria unmet, possible category or size mismatch | Very Low | Remove from active pipeline |
| 0-24 | Disqualify criterion triggered | N/A | Remove from pipeline; retain in History |

---

## Calibration Methodology — The Post-Batch Review Process

ICP calibration is the ongoing practice of identifying scoring errors and making targeted prompt changes to prevent them recurring. Teams that calibrate regularly see scoring accuracy improve measurably over 3–5 batch cycles.

### Step 1: Identify Systematic Errors (10–15 minutes post-batch)

After each batch, review a sample of results to look for patterns:

**Review set selection:**
- 3 highest-scoring QUALIFY leads (confirm they are genuinely strong)
- 3 lowest-scoring QUALIFY leads (check if they are genuine qualifies or should be BORDERLINE)
- 3 BORDERLINE leads near the qualify boundary (were they correctly placed?)
- 3 DISQUALIFY leads (were they genuinely disqualified or false negatives?)
- 3 leads from any venue type that seemed to score wrong

**Questions to ask for each lead:**
1. Do I agree with the verdict?
2. Do I agree with the score (approximately)?
3. Does the ICP Explanation correctly describe why the lead scored as it did?
4. Are the Key Signals genuinely present on the website?
5. Are the Missing Signals genuinely absent?

### Step 2: Classify Errors

For each error found, classify it:

| Error Type | Description | Example |
|---|---|---|
| **Category bias** | AI using category label instead of evidence | Barcade scoring low because AI defaulted to "bar = low score" |
| **Inference failure** | AI not inferring from implied signals | Venue with redemption counter scoring 62 because machine count not explicit |
| **Band misplacement** | Lead in wrong band despite correct evidence | 35-machine venue scoring 72 instead of 82 |
| **Disqualify false positive** | Good lead incorrectly disqualified | FEC with bowling section triggering "route operator" criterion |
| **Disqualify false negative** | Bad lead slipping through disqualify | Retail hardware store scoring 45 instead of disqualifying |
| **Signal hallucination** | Key Signal listed but not actually on website | "50 machines confirmed" when website says nothing about count |
| **Conservative fallback** | Score 60-65 when more evidence was available | AI not inferring from redemption counter signal |

### Step 3: Diagnose Root Cause

Each error type maps to a specific ICP component that needs fixing:

| Error Type | Root Cause Location | Fix |
|---|---|---|
| Category bias | Missing edge case handling section | Add explicit "do not disqualify based on [category]" overrides |
| Inference failure | Missing inference rules section | Add detailed implied signal guidance |
| Band misplacement | Band descriptions too similar | Differentiate adjacent bands with measurable criteria |
| Disqualify false positive | Disqualify criterion too broad | Narrow the criterion with specific conditions |
| Disqualify false negative | Criterion missing or too specific | Add or broaden relevant criterion |
| Signal hallucination | No anti-hallucination instructions | Add evidence standard instructions |
| Conservative fallback | Insufficient inference rules | Add more implied signal pathways |

### Step 4: Make Targeted Changes (Not Wholesale Rewrites)

Change one component at a time. If you change the prompt, the signals list, and the score bands simultaneously, you will not be able to identify which change caused which improvement or regression.

**Change order recommendation:**
1. Fix disqualify criteria first (these have the broadest impact)
2. Fix edge case handling second
3. Fix inference rules third
4. Fix band descriptions last

### Step 5: Test Before Activating

Before applying changes to your active ICP:
1. Create a new ICP version with the proposed changes
2. Re-enrich the 10–15 leads from your error review under the new ICP
3. Compare results: did the errors you identified get corrected?
4. Check for regressions: did correctly scored leads stay correct?
5. If net improvement confirmed: activate new version

### Step 6: Document the Change

Maintain a change log for your ICP versions. This creates accountability and allows you to reverse specific changes if they cause unexpected problems.

**Change log template:**
```
VERSION: FEC Venues US v3
DATE: 2026-07-15
CHANGED FROM: FEC Venues US v2
CHANGES MADE:
- Added barcade/beercade override section (edge case: barcades scoring low due to "bar" category)
- Added token vending machine inference rule
- Tightened 80-89 band description to require confirmed redemption counter
  (was: "staffed redemption counter present" — ambiguous; now: "confirmed full redemption
  counter with prize wall visible on website")
REASON FOR CHANGES:
- 8 barcades in Chicago batch scored 35-45 despite 100+ machine floors
- 4 token-operated arcades scored 58-62 when they should be 70-78 (upgrade opportunity)
TEST RESULTS:
- Re-enriched 12 reference leads: 10/12 moved to correct band
- No regressions on previously correct leads
ACTIVATED: 2026-07-15 14:30 UTC
```

---

## Comparative Analysis Across Batches

### When Comparison Is Valid

Direct score comparison between batches is only valid when:
1. Both batches used the same ICP version
2. Both batches were enriched at approximately the same time (same model version)
3. The leads' websites have not significantly changed between enrichments

### When Comparison Is Invalid

Do not compare scores across:
- Different ICP versions (different scoring criteria)
- Batches separated by more than 3–6 months (websites may have changed)
- Different market segments (scores are relative to ICP, not absolute)

### Building a Reference Benchmark

For teams running ongoing campaigns, establishing a benchmark set of reference leads allows you to track ICP accuracy over time.

**Reference benchmark setup:**
1. Select 20–30 leads where you know the ground truth (you have spoken to them, visited them, or have definitive knowledge of their fit)
2. Categorise them: 10 strong qualifies, 10 clear disqualifies, 5-10 borderlines
3. Re-enrich this set whenever you make a significant ICP change
4. Track whether scores move in the correct direction

This benchmark turns ICP calibration from subjective ("seems better") into measurable ("accuracy on reference set improved from 72% to 89%").
