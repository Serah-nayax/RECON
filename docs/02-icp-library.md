# ICP Library

The ICP Library is the most critical section of Recon. Every score, verdict, signal, and recommendation the platform produces flows directly from the ICP configuration that was active when the lead was enriched. A poorly configured ICP produces unreliable, inconsistent results regardless of how powerful the underlying AI is. A well-crafted and regularly maintained ICP turns Recon into a highly accurate qualification machine.

Most users underestimate the depth of work required to configure an ICP correctly. This document covers everything: component architecture, configuration principles, advanced prompt engineering, calibration methodology, multi-ICP management strategies, and the full catalogue of failure modes with their causes and fixes.

---

## ICP Architecture — How the Four Components Work Together

An ICP has four components. They are not independent — they interact at enrichment time to form a single combined instruction that the AI reads alongside the crawled website content.

### How Components Are Combined at Runtime

At enrichment time, the platform assembles the final prompt by:

1. Taking the **system prompt** as the base
2. Interpolating the **qualify signals** list into the prompt at the `{QUALIFY_SIGNALS}` placeholder
3. Interpolating the **disqualify criteria** list at the `{DISQUALIFY_CRITERIA}` placeholder
4. Interpolating the **score band descriptions** at the `{SCORE_BANDS}` placeholder
5. Appending the **lead context** (crawled website content)
6. Appending the **output format instruction** (JSON schema)

The combined prompt is then sent to Gemini. The AI reads it as a single document and produces the score based on the totality of the instruction.

**Implication:** Your prompt template must contain the interpolation placeholders for the signals, criteria, and bands to be injected. If you write a custom prompt that does not include these placeholders, the signals and criteria you configured in the Signals and Score Bands tabs will not be included in what the AI reads.

---

## Component 1: The Overview Tab

### Profile Name

An internal identifier. Appears in:
- The ICP Library sidebar
- Every batch header in History
- The ICP selector when reviewing a report

Use naming conventions that age well:

| Good Names | Poor Names |
|---|---|
| `FEC Arcade Venues — US v3` | `My ICP` |
| `Enterprise Chains — Global Q3` | `Test` |
| `Barcade Segment — Urban Markets` | `New (copy)` |
| `SMB Independent Operators — EMEA` | `Updated June` |

Include: target segment, geography if applicable, version number.

### ICP Description

This field serves as the framing context provided to the AI before the scoring prompt. It tells the AI who the target customer is at a high level before it reads the detailed scoring criteria.

The description is not scoring logic — it does not directly control scores. Its role is to orient the AI. Think of it as the briefing paragraph you would give an analyst before handing them the scoring rubric.

**Length:** 3–6 sentences. More than that becomes noise.

**What to include:**
1. Who you sell to (customer type, industry, size)
2. What you sell (product category, not brand name)
3. The primary qualifier (the most important single criterion)
4. Key inclusions (types of businesses that qualify even if they seem unusual)
5. Key exclusions (types of businesses that definitely do not qualify)

**Strong description example:**
> "We sell cashless payment systems and loyalty management platforms to staffed entertainment venues with a meaningful arcade machine fleet. The primary qualifier is fleet size: 15+ arcade, redemption, or ticket machines at a permanently staffed venue. Target types include family entertainment centres, arcades, barcades, bowling alleys with arcade areas, trampoline parks with game zones, laser tag venues, go-kart entertainment complexes, and any other staffed multi-game venue. Exclusions: unattended route operators, retail hardware sellers, venues with fewer than 15 machines, pure VR lounges."

**Weak description example:**
> "Entertainment venues with arcade machines that might want payment solutions."

The first version gives the AI clear inclusion and exclusion parameters before it reads any scoring logic. The second provides so little context that the AI must infer the product and market from the prompt alone.

---

## Component 2: Qualify Signals

Qualify signals are the enumerated list of positive traits the AI uses as evidence when building a score. They represent the observable characteristics of your ideal customer that can be detected on a website.

### Principles for Signal Writing

**Principle 1: Write observable, not abstract**

Every signal must correspond to something that can actually appear on a business website — text, page content, images referenced in alt text, or structural elements.

| Abstract (poor) | Observable (good) |
|---|---|
| Is an established business | "Years in operation" or founding date stated |
| Has lots of customers | Redemption counter or prize wall present on premises |
| Uses technology | Token vending machines referenced in FAQ or photos |
| Runs events | Birthday party packages listed with arcade access |

**Principle 2: Cover both explicit and implied signals**

Explicit signals are directly stated facts ("50 arcade games"). Implied signals are structural or contextual evidence that strongly indicates a qualifying trait without stating it directly.

```
EXPLICIT SIGNALS:
"50+ arcade games listed by name on website"
"Cashless card system referenced directly"

IMPLIED SIGNALS:
"Full prize redemption counter → implies 15+ machines (single machines don't justify a redemption counter)"
"Birthday party packages with arcade access → implies staffed, full-service venue"
"'Largest arcade in [city/region]' language → implies high machine count"
"Token vending machine mentioned → implies coin/token-operated fleet (cashless upgrade opportunity)"
"Prize wall photos → implies ticket redemption games = fleet presence"
```

**Principle 3: Include signals for every sub-type in your ICP**

If your ICP includes barcades, bowling alleys with arcades, and trampoline parks, you need signals that apply to each type — not just signals written with FECs in mind.

**Principle 4: 8–15 signals is the optimal range**

Fewer than 8 signals leaves the AI without enough evidence anchors. More than 20 signals creates noise and dilutes the weight of your strongest signals. The AI does not score 1 point per signal — it reasons holistically, and too many signals can lead to over-counting of marginal evidence.

### Signal Priority Weighting

The AI infers signal importance from context within the prompt. Signals that appear early in the list, that are mentioned multiple times, or that are referenced in the score band descriptions carry more implicit weight.

**Structure your signals list with this in mind:**
1. Place your primary qualifier signal first
2. Follow with your 3–5 strongest secondary signals
3. List supporting signals after
4. Include "upgrade opportunity" signals last (they indicate fit but are not primary qualifiers)

**Example structured signals list:**
```
PRIMARY:
1. 15+ arcade/redemption/ticket machines confirmed or strongly implied

STRONG SECONDARY:
2. Full redemption or prize counter visible on website
3. Ticket redemption games present (ski ball, crane machines, etc.)
4. Dedicated arcade floor or game room (not just a corner with 3 machines)

SUPPORTING:
5. Birthday party rooms or private event hosting (confirms staffed venue)
6. Multi-attraction venue (bowling + arcade, laser tag + arcade, etc.)
7. National or regional chain location (Dave & Buster's, Round 1, Main Event, Chuck E. Cheese)
8. Barcade, beercade, or super arcade identity — gaming as primary offering

UPGRADE OPPORTUNITY:
9. Token or coin-op payment system in use (direct cashless upgrade candidate)
10. Existing cashless card system — upgrade/displacement
11. Loyalty or rewards programme in place
12. "Largest arcade in [city/state/region]" claim
```

---

## Component 3: Disqualify Criteria

Disqualify criteria are hard rules. When the AI identifies any of these patterns in the crawled content, the lead scores 0–20 regardless of any positive signals present elsewhere. This override is absolute.

### The Risk of Over-Disqualification

Because disqualify criteria override everything else, poorly written criteria are the leading cause of false negatives (strong leads being incorrectly rejected).

**The test for each criterion:**
Before adding any disqualify criterion, mentally apply it to your 10 best customers. Would any of them trigger it? If yes, the criterion is too broad.

**Common over-disqualification traps:**

| Too Broad (Wrong) | Why It's Wrong | Better Version |
|---|---|---|
| "Bar" | Many barcades and entertainment bars qualify | "Bar or pub with 2-3 standalone machines and no redemption counter" |
| "Restaurant" | Many entertainment restaurants have large arcades | "Restaurant with no dedicated gaming area and no mentions of machines" |
| "Retail" | Ambiguous — a games retailer is different from a venue | "Retail store selling arcade hardware, no operating venue" |
| "Online" | Could match any business with an online presence | "Online or digital-only gaming business with no physical venue" |

### The Risk of Under-Disqualification

Criteria that are too specific will miss the disqualify patterns you actually care about.

| Too Specific (Wrong) | Why It's Wrong | Better Version |
|---|---|---|
| "Route operator with 3 machines" | Misses route operators with 5 or 10 machines | "Unattended route operator with no permanently staffed venue" |
| "Sells hardware online" | Misses brick-and-mortar hardware retailers | "Business primarily selling arcade hardware, not operating a venue" |

### Recommended Disqualify Criteria Set

```
1. Unattended route operator with no permanent on-site staff or venue
2. Bar or restaurant with only 2-3 standalone machines and no redemption or prize system
3. Business primarily selling or renting arcade hardware — not operating a venue
4. Pure VR lounge or digital-only gaming experience with no physical arcade machines
5. Office, residential, or commercial space with a casual game room (not a public venue)
```

---

## Component 4: Score Bands

Score bands serve dual roles: they communicate actionable categories to your sales team, and they directly calibrate the AI's score placement decisions.

### How the AI Uses Score Band Descriptions

This is the most misunderstood aspect of score bands. When Gemini assigns a score of 84, it is doing so because it read your "80-89" band description and determined that the evidence best matches that description's criteria.

**The AI's implicit reasoning process:**
1. It reads all band descriptions simultaneously
2. It evaluates the crawled evidence against each band
3. It assigns the score that best places the lead within the band whose description most closely matches the evidence found

This means your band descriptions function as scoring criteria, not just labels. Vague descriptions → inconsistent placement. Specific, differentiated descriptions → consistent, accurate placement.

### Score Band Design Principles

**Principle 1: Each band must be clearly distinguishable from adjacent bands**

If bands 70-79 and 80-89 have similar descriptions, the AI cannot reliably distinguish leads that belong in each. You will see clustering at band boundaries.

**Principle 2: Use concrete, measurable criteria — not adjectives**

| Adjective-based (poor) | Criteria-based (good) |
|---|---|
| "Good fit, worth pursuing" | "20-30 machines, staffed arcade section, ticket/redemption evidence" |
| "Very strong prospect" | "50+ machines, full redemption counter, loyalty programme, multi-attraction" |
| "Possibly qualifies" | "15-20 machines confirmed or strongly inferred from signals" |

**Principle 3: Include a recommended action in each band description**

This directly shapes the AI's `recommendedAction` output and gives reps immediate direction.

```
80-89: 30-50 machines, staffed redemption counter, clear FEC identity.
High-value prospect. Call within 24 hours; prioritise decision-maker outreach.
```

**Principle 4: Anchor each band to the primary qualifier**

Every band except the disqualify range should reference whether the primary qualifier is met. This reinforces the primacy of the qualifier throughout the scoring.

### Complete Band Set Example

```
BAND: 90-100 | Top Tier — Prioritise
50+ machines confirmed, full redemption counter, loyalty or rewards programme,
multi-attraction (bowling, laser tag, go-karts) OR national/regional chain
(Dave & Buster's, Round 1, Main Event, etc. — always 90+ regardless of CSV category).
Action: Call immediately, same business day.

BAND: 80-89 | Strong Fit — Outreach Now
30-50 machines confirmed, staffed redemption counter present,
clear FEC or entertainment venue identity.
High-value independent operator.
Action: Outreach within 24 hours.

BAND: 70-79 | Good Fit — Targeted Outreach
20-30 machines, staffed arcade section confirmed,
evidence of ticket redemption games or prize counter.
Action: Schedule outreach within the week.

BAND: 60-69 | Probable Fit — Verify First
15-20 machines confirmed OR "15+" strongly inferred from multiple signals
(redemption counter + birthday parties, etc.).
Action: Verify machine count with one call before full outreach cadence.

BAND: 40-59 | Uncertain — Research Required
Arcade or entertainment signals present but machine count unconfirmed.
Website content may be thin. Verdict uncertain.
Action: Manual review of website; call to qualify before pursuing.

BAND: 0-39 | Disqualified
Does not meet minimum fleet size, unattended route operator confirmed,
or disqualify criterion triggered. Not a viable prospect.
Action: Remove from active pipeline.
```

---

## Component 5: The AI System Prompt

The system prompt is the full instruction set for Gemini. It is the most technically demanding component of the ICP and the primary driver of scoring accuracy. A well-structured prompt is the difference between an ICP that reliably surfaces strong leads and one that produces inconsistent, unreliable output.

### Loading the Starter Template

Click **USE TEMPLATE** in the AI Prompt tab to load a pre-structured prompt skeleton with placeholder sections. This ensures you include all required sections in the correct format.

If the prompt field already contains text, Recon will ask for confirmation before overwriting. This protects existing working prompts from accidental replacement.

### Required Prompt Sections — Complete Anatomy

A production-quality system prompt must contain all nine of the following sections. Each serves a specific role. Missing or combining sections is the most common cause of scoring failures.

---

**SECTION 1 — Role and Product Definition**

Purpose: Establishes the AI's persona and evaluation lens.

```
You qualify leads for [Company Name] — [product/service in one phrase] for
[target customer type, specific].
```

Without this, the AI applies generic B2B evaluation logic that may not match your market.

---

**SECTION 2 — Primary Qualifier**

Purpose: States the single most important criterion. Everything else is subordinate to this.

```
PRIMARY QUALIFIER — [Key criterion] is the deciding factor:
- QUALIFY if the [target] has [minimum threshold] AND [secondary condition]
- This applies regardless of [common false negative sources — list them explicitly]
- [Special handling for strongest positive indicator]
```

The "regardless of" clause is critical. Without it, the AI may apply its training-data assumptions about categories (e.g. "bars are not B2B targets") instead of evaluating the actual evidence.

---

**SECTION 3 — Segment-Specific Rules**

Purpose: Handles the specific sub-types and edge cases in your ICP that the general scoring logic would mishandle.

Write one sub-section per major segment or category requiring special handling.

```
[SEGMENT NAME]:
- [Characteristic of this segment] → [Scoring guidance]
- [Characteristic] → [Guidance]
- Do NOT [common incorrect action for this segment]
```

Example:
```
BARCADES / BEERCADES / SUPER ARCADES:
- Any venue whose primary identity is gaming (barcade, beercade, *cade suffix)
  qualifies strongly even if the Google Maps category says "bar"
- 70+ machines + bar identity = score 70-80
- 250+ machines + bar identity = score 90+
- Token machines or cashless vending = strong signal regardless of alcohol presence
- Loyalty rewards already in place = upgrade opportunity
- Do NOT penalise the bar/beer component — it is irrelevant to arcade fleet qualification

TOKEN VENDING MACHINES:
- Venues using tokens or coins for arcade access are prime cashless upgrade targets
- Any confirmed token machine presence = significant score boost in the 5-10 point range
- Coin-op = outdated infrastructure = clear upgrade narrative

BOWLING + ARCADE COMBOS:
- Full bowling + arcade combo venues qualify as strongly as dedicated arcades
- 20+ machines in the arcade section of a bowling alley = score 70-80
- Redemption counter in the arcade section = score 80+
```

---

**SECTION 4 — Score Bands (Mirror of Score Bands Tab)**

Purpose: Gives the AI direct access to band criteria in the prompt. Even though bands are configured in the Score Bands tab, including them in the prompt ensures the AI prioritises them during scoring.

```
SCORE BANDS (all require staffed venue AND 15+ machines as baseline):
- 90-100: [Mirror of 90-100 band description]
- 80-89: [Mirror of 80-89 band description]
- 70-79: [Mirror of 70-79 band description]
- 60-69: [Mirror of 60-69 band description]
- 40-59: [Mirror of 40-59 band description]
```

---

**SECTION 5 — Disqualify Rules (Mirror of Disqualify Tab)**

Purpose: Hard overrides. Mirror your Disqualify Criteria tab here.

```
DISQUALIFY (score 0-20 regardless of other signals):
- [Disqualify condition 1]
- [Disqualify condition 2]
- [Disqualify condition 3]
```

---

**SECTION 6 — Edge Case Handling (The Most-Neglected Section)**

Purpose: Explicitly overrides the AI's category assumptions for venue types that are commonly misscored.

Most prompts are wrong because they omit this section entirely. The AI has strong priors from its training data (e.g. "restaurants are food businesses, not gaming businesses"). Without explicit overrides, these priors affect scoring.

```
IMPORTANT — Do NOT disqualify based on any of these alone:
- Category label "bar" or "pub" → evaluate whether gaming is the primary activity
- Category label "restaurant" → evaluate whether a dedicated gaming area is present
- Category label "bowling" → evaluate whether arcade section meets machine count threshold
- Category label "trampoline park" → evaluate whether arcade area meets threshold
- Category label "laser tag" → evaluate whether additional gaming meets threshold

POSITIVE OVERRIDES:
- "bar" + dedicated game room + redemption counter → treat as QUALIFY candidate
- "bowling alley" + 20+ arcade machines → score as 70-79 minimum
- "restaurant" + arcade section + prize wall → score as 60-69 minimum
- "go-kart" + large arcade floor + birthday packages → score as 70+ minimum

Only disqualify on category if evidence clearly shows: (a) fewer than 15 machines confirmed,
OR (b) exclusively unattended operation, OR (c) no physical venue at all.
```

---

**SECTION 7 — Signal Inference Rules**

Purpose: Teaches the AI to infer your primary qualifier from indirect evidence when it is not explicitly stated.

This section is what separates a prompt that scores a 1-page website at 62 (conservative fallback) from one that scores the same website at 78 because it correctly inferred machine count from contextual signals.

```
[KEY METRIC] INFERENCE — use ALL available evidence, not just explicit statements:

EXPLICIT SIGNALS (highest confidence):
- "[exact quote example 1]" → confirms [metric]
- "[exact quote example 2]" → confirms [metric]

STRONG IMPLICIT SIGNALS (high confidence):
- [Implied signal A] → implies [metric threshold] (reasoning: [why this implies it])
- [Implied signal B] → implies [metric threshold]

MODERATE IMPLICIT SIGNALS (medium confidence — score conservatively):
- [Implied signal C] → suggests [metric] but unconfirmed
- [Implied signal D] → suggests [metric]

NO SIGNAL FOUND:
- If no [metric] signal is present but category strongly fits → score 60-65
- If no [metric] signal AND category only partially fits → score 45-55
```

Example for machine count:
```
MACHINE COUNT INFERENCE — use ALL available evidence:

EXPLICIT (high confidence):
- "50 arcade games", "20+ machines", "over 100 cabinets" → confirms count directly
- Named list of specific game titles → count them; each named game = 1 machine minimum

STRONG IMPLICIT (high confidence):
- Full prize redemption counter with prize wall → implies 15+ (no venue runs a redemption
  counter for fewer than 15 machines — the economics don't work)
- Large token/card vending infrastructure → implies fleet operation of 20+
- "Our 10,000 sq ft arcade floor" → implies 50+ machines by floor space
- "Largest arcade in [city/state/region]" → implies 50+ for any major city

MODERATE IMPLICIT (medium confidence — score in 60-69):
- Dedicated arcade room or floor mentioned but not sized → implies 15+
- Birthday party packages with "arcade time" as feature → implies staffed arcade of meaningful size
- Multiple named game types (redemption games, shooting games, racing games) → implies 10-20+ machines

NO SIGNAL FOUND:
- Category fits (FEC, arcade, barcade) but no machine count clues → score 60-65 conservatively
- Category partially fits (bowling, trampoline) but no arcade section mentioned → score 40-55
```

---

**SECTION 8 — Handling National Chains and Known Brands**

Purpose: Ensures that well-known brands always score correctly, regardless of how thin their local website is.

```
NATIONAL AND REGIONAL CHAINS — always score 90+ regardless of local website content:
[List of brands that are always a strong fit]

Examples:
- Dave & Buster's: Always 95+ (50+ machines confirmed at every location)
- Round 1 Entertainment: Always 95+ (150+ machines, full FEC)
- Main Event Entertainment: Always 90+ (large arcade section, full FEC)
- Chuck E. Cheese: 80-85 (25-50 machines, strong redemption, kid-focused)
- Bowlero / Lucky Strike: 70-80 (arcade section varies by location)
```

---

**SECTION 9 — Output Format (MANDATORY — DO NOT MODIFY)**

Purpose: Instructs the AI to return structured JSON that Recon's parser can process. This section must appear exactly as shown at the end of every prompt. Any modification will cause all enrichments to fail with a parse error.

```
Based on the crawled website content provided, score this lead from 0-100
and explain your reasoning.

Return ONLY valid JSON with this exact structure:
{
  "score": <number 0-100>,
  "verdict": "QUALIFY" | "BORDERLINE" | "DISQUALIFY",
  "icpExplanation": "<2-3 sentence explanation of score and fit>",
  "keySignals": ["<signal found on website>", ...],
  "missingSignals": ["<signal looked for but not found>", ...],
  "recommendedAction": "<specific next action for sales team>"
}
```

> **WARNING:** Do not add any text after this block. Do not add extra fields to the JSON. Do not wrap the JSON in markdown code fences. Any deviation from this exact structure will cause enrichment to fail silently with no score output.

---

## Advanced Prompt Techniques

### Technique 1: Anchor Scoring with Named Examples

Including specific, named examples of businesses at each score level gives the AI calibration anchors that dramatically improve consistency.

```
CALIBRATION EXAMPLES:
- Score 95: Dave & Buster's (50+ machines, full redemption, loyalty programme, national chain)
- Score 85: Local FEC with named 40-machine arcade, full prize counter, birthday packages
- Score 72: Bowling alley with confirmed 20-machine arcade and ticket redemption
- Score 62: Entertainment venue with arcade signals but no explicit machine count
- Score 25: Bar with 3 standalone claw machines, no redemption counter
- Score 5: Online arcade game website, no physical venue
```

### Technique 2: Confidence Scoring Instructions

Adding explicit confidence guidance prevents the AI from defaulting to the conservative fallback zone when evidence is moderate.

```
CONFIDENCE GUIDELINES:
- If 3+ strong signals confirmed → score confidently at upper end of applicable band
- If 1-2 strong signals confirmed + 2+ implied signals → score mid-band
- If only implied signals, no explicit evidence → score at lower end of applicable band or borderline zone
- If website content under 500 words total → note thin content in explanation, score conservatively
```

### Technique 3: Anti-Hallucination Instructions

The AI will sometimes generate signals it inferred from nowhere, or misread a signal. Adding explicit instructions reduces this.

```
EVIDENCE STANDARD:
- Only include in keySignals items that are explicitly or strongly implied by the website content
- Do not infer signals from the business name or address alone
- If you cannot point to specific text on the website that supports a signal, do not include it
- Prefer "machine count not explicitly stated" in missingSignals over guessing a count
```

---

## Failure Mode Catalogue

Understanding what goes wrong — and exactly why — is essential for maintaining a productive ICP.

| Failure Mode | Observable Symptom | Root Cause | Targeted Fix |
|---|---|---|---|
| Score clustering at 60-65 | Most leads score 60-65 regardless of actual fit | Inference rules absent; AI defaults to conservative fallback | Add explicit machine count inference section |
| Score clustering at band boundary | Many leads score 79 or 80, 69 or 70 | Adjacent band descriptions too similar | Differentiate band descriptions with specific, measurable criteria |
| Barcades scoring 30-40 | Barcades with 100+ machines score low | Prompt treating "bar" as a disqualifier implicitly | Add explicit barcade override in edge case section |
| National chains scoring 60-75 | Dave & Buster's scoring 70 | No chain override; thin local website content | Add named chain override section (always 90+) |
| All leads QUALIFY | 90%+ of batch is QUALIFY | Qualify signals too broad; disqualify criteria missing | Tighten signals; add concrete disqualify criteria |
| All leads DISQUALIFY | 80%+ of batch is DISQUALIFY | Disqualify criteria too broad | Review each criterion; test against known good customers |
| JSON parse errors | Leads show "enrichment failed" with no score | Output format section modified or truncated | Restore exact output format block; check for trailing text |
| Inconsistent ICP explanation | Different explanations for similar venues | AI has insufficient structure to reason consistently | Add calibration examples; tighten band descriptions |
| False positives (wrong industry) | Businesses with no arcade scoring 60+ | Category not in disqualify criteria | Add category-based disqualify for clearly irrelevant types |
| Score drops after ICP save | Previously scoring leads now score lower | Prompt inadvertently changed inference or band rules | Compare old and new prompt; identify the specific change |
| Signals list empty | No key signals in report | AI scoring from minimal content; signals too specific | Add more implied signal definitions; check crawl depth |

---

## ICP Versioning Strategy

### When to Create a New Version

Create a new ICP version (with a new name) before:
- Making significant changes to the system prompt
- Adding or removing more than 2 qualify signals at once
- Substantially changing score band descriptions
- Testing a fundamentally different qualification approach

Do not make changes to the active ICP while a campaign is running. Changes to the active ICP affect all enrichments from that point forward, making it impossible to compare results across the campaign.

### Version Naming Convention

```
[Market Segment] — [Region] v[Number]
FEC Arcade Venues — US v1
FEC Arcade Venues — US v2
FEC Arcade Venues — UK v1
Barcade Segment — Global v1
Enterprise Chains — US v3
```

### Testing a New Version Before Activating

1. Create the new ICP version
2. Set it as Active temporarily (in a non-production window)
3. Re-enrich 10–15 leads you know well (5 strong qualifiers, 5 clear disqualifies, 5 borderlines)
4. Compare results to previous version
5. If improved: keep active
6. If not improved: revert to previous version; diagnose what changed

---

## Managing Multiple ICPs

### Multi-ICP Use Cases

**Multiple Products:**
If your company sells two products with different target customers, create one ICP per product. Never use a blended ICP that tries to qualify for both simultaneously — the conflicting criteria will produce compromised results for both.

**Multiple Market Segments:**
Your enterprise chain target (Dave & Buster's tier) and your independent operator target require different scoring thresholds, signals, and disqualify criteria. Separate ICPs ensure each segment is qualified accurately.

**Geographic Markets:**
A US-calibrated ICP may not transfer to the UK or EU. Business types, terminology, and evidence patterns differ. Consider creating market-specific ICPs for international prospecting.

**Testing and Experimentation:**
Maintain at least one stable production ICP and one experimental ICP at all times. Run experiments on the experimental ICP without disrupting live production enrichments.

### Switching Between ICPs

1. Go to ICP Library
2. Click the ICP you want to activate
3. Click **SET ACTIVE**
4. The green **ACTIVE** badge moves to the new profile
5. All subsequent enrichments use the new active ICP

**Switching is immediate** — there is no confirmation step. Be certain you are switching to the right profile before confirming.

**Historical results are unaffected** — switching the active ICP does not retroactively change any previously enriched lead's score. See `06-history.md` for details on ICP snapshots.
