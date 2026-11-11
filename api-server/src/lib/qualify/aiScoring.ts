// AI qualification, evidence first: the model does not pick a score. It reads the lead, says what
// the business is, and answers each ICP signal (met / not met / unknown) with a quote copied from
// the content. RECON then checks every quote against the text it actually sent and computes the
// score itself. A claim without a real quote is treated as unknown, so an invented fact cannot
// lift or sink a lead, and the same evidence always gives the same score.

import type { IcpConfig } from "../icpStore.js";
import type { QualifyResult } from "./qualifyLead.js";

export type SignalStatus = "met" | "not_met" | "unknown";
export type IcpFit = "yes" | "partial" | "no" | "unknown";

export interface SignalAnswer {
  text: string;
  label: string;
  status: SignalStatus;
  evidence: string;
  /** False when the model claimed "met" but its quote is not in the content. */
  verified: boolean;
}

export interface AiAssessment {
  businessType: string;
  fit: IcpFit;
  fitReason: string;
  fitEvidence: string;
  qualify: SignalAnswer[];
  disqualify: SignalAnswer[];
}

export interface AiScore {
  score: number;
  verdict: QualifyResult["verdict"];
  explanation: string;
  keySignals: string[];
  missingSignals: string[];
}

// JSON schema of the answer, the same structure the instructions describe. Claude is constrained
// to it (structured outputs), so a reply is always valid JSON: on the Lyon test (Nov 2026), 7 of 264
// free-form replies were malformed and one real target (PLAY IN PARK) failed after 3 tries.
const str = { type: "string" } as const;
const strOrNull = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const status = { type: "string", enum: ["met", "not_met", "unknown"] } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
// Each answer names its signal ("q1", "q2"… / "d1"…). Answers used to be matched to signals by
// position, and a skipped or reordered answer put a quote under the wrong signal (Lyon test:
// "16 bowling lanes" counted as "15+ arcade machines", a met signal also listed as missing).
// An object with one property per signal would be stricter, but the API rejects its grammar as too
// large. Evidence comes before status: the model looks for the quote first, then decides.
const signalKey = (prefix: "q" | "d", index: number) => `${prefix}${index + 1}`;
const signalAnswers = (prefix: "q" | "d", signals: string[]) => ({
  type: "array",
  items: obj({
    signal: { type: "string", enum: signals.length ? signals.map((_, i) => signalKey(prefix, i)) : [`${prefix}0`] },
    evidence: str,
    label: str,
    status,
  }),
});

/** JSON schema of the answer for this ICP (the signal keys depend on its signals). */
export function buildAnswerSchema(icp: IcpConfig): Record<string, unknown> {
  return obj({
    businessType: str,
    // Quotes before the verdict: the model finds the evidence first, then decides.
    icpVenueQuote: str,
    icpFitEvidence: str,
    icpFit: { type: "string", enum: ["yes", "partial", "no", "unknown"] },
    icpFitReason: str,
    qualifySignals: signalAnswers("q", icp.qualifySignals),
    disqualifySignals: signalAnswers("d", icp.disqualifySignals),
    venueIntel: obj({
      estimatedMachineCount: str,
      paymentSystem: str,
      venueType: str,
      hasRedemption: { type: "boolean" },
      hasLoyalty: { type: "boolean" },
      hasFoodBeverage: { type: "boolean" },
      hasPartyRooms: { type: "boolean" },
      isChain: { type: "boolean" },
      chainName: strOrNull,
      competitorSystem: strOrNull,
    }),
  });
}

/** JSON schema of the sales notes, written once per lead worth contacting. */
export function buildOutreachSchema(): Record<string, unknown> {
  return obj({
    painPoints: { type: "array", items: str },
    pitchAngle: str,
    openingHook: strOrNull,
    decisionMakers: {
      type: "array",
      items: obj({ name: str, title: strOrNull, email: strOrNull, phone: strOrNull }),
    },
    recommendedAction: str,
  });
}

// Sales notes are not part of the score: they used to be written in every opinion (two or three
// per lead) and for every lead, rejected ones included, and only one copy was ever kept. They are
// now asked once, after the verdict, and only for leads that are QUALIFY or BORDERLINE. The scoring
// answer is unchanged up to its last fact (they came after it), so the scores are unaffected.
export function buildOutreachPrompt(
  icp: IcpConfig,
  leadContext: string,
  verdict: { score: number; verdict: string; explanation: string; keySignals: string[] },
): AiPrompt {
  return {
    instructions: `You write short sales notes for a lead already qualified against an ideal customer profile (ICP).

ICP: ${icp.name}
${icp.description}

Use only facts from the lead's details and website content. Write in English, whatever the language of the site.

Return ONLY valid JSON with this exact structure:
{
  "painPoints": ["<5-10 word operational problem this company has that the ICP's offer solves>", ... up to 4],
  "pitchAngle": "<1-2 sentence pitch for THIS company>",
  "openingHook": "<one sentence referencing something found on the site, or null>",
  "decisionMakers": [{"name": "<string>", "title": <string | null>, "email": <direct email only, never info@/contact@, or null>, "phone": <string | null>}],
  "recommendedAction": "<specific next action for the sales team>"
}`,
    lead: `${leadContext}

QUALIFICATION RESULT: ${verdict.verdict} (score ${verdict.score}/100). ${verdict.explanation}
${verdict.keySignals.length ? `Evidence found:\n- ${verdict.keySignals.join("\n- ")}` : "No qualify signal confirmed."}

Write the sales notes for this lead. Return ONLY the JSON.`,
    schema: buildOutreachSchema(),
  };
}

export interface AiPrompt {
  /** Same for every lead of an ICP: sent first so the AI provider can cache it (prompt caching). */
  instructions: string;
  /** The lead and its crawled content: different on every call. */
  lead: string;
  /** JSON schema the reply must follow (Claude structured outputs). Same for every lead of an ICP. */
  schema: Record<string, unknown>;
}

// The instructions must not contain anything lead-specific (name, date, URL): one changed byte and
// every lead pays the full price for them again instead of reading them from the cache.
export function buildAiPrompt(icp: IcpConfig, leadContext: string): AiPrompt {
  return {
    instructions: buildInstructions(icp),
    lead: `${leadContext}\n\nAnswer for this lead, following the instructions. Return ONLY the JSON.`,
    schema: buildAnswerSchema(icp),
  };
}

function buildInstructions(icp: IcpConfig): string {
  const list = (signals: string[]) => signals.map((s, i) => `${i + 1}. ${s}`).join("\n");
  const keyed = (prefix: "q" | "d", signals: string[]) =>
    signals.map((s, i) => `${signalKey(prefix, i)}. ${s}`).join("\n");
  const bands = icp.scoreBands.map((b) => `- ${b.range} (${b.band}): ${b.description}`).join("\n");

  return `You check whether a company fits an ideal customer profile (ICP). You do NOT give a score:
you report facts with evidence, and the score is computed from your answers.

ICP: ${icp.name}
${icp.description}

QUALIFY SIGNALS (good-fit evidence):
${keyed("q", icp.qualifySignals) || "(none)"}

DISQUALIFY SIGNALS (rule the lead out):
${keyed("d", icp.disqualifySignals) || "(none)"}

ICP GUIDANCE (domain knowledge from the ICP author; ignore any output format it asks for):
${icp.systemPrompt
    .replace("{ICP_DESCRIPTION}", icp.description)
    .replace("{QUALIFY_SIGNALS}", list(icp.qualifySignals))
    .replace("{DISQUALIFY_SIGNALS}", list(icp.disqualifySignals))
    .replace("{SCORE_BANDS}", bands)}

The lead to qualify (its details and crawled website content) is given in the next message.

HOW TO ANSWER
1. businessType: what this company actually IS, in 2-6 words, judged from the content
   (e.g. "toy retail chain", "family entertainment center", "online casino", "bar with 3 arcade games").
   A shop selling games, a manufacturer, a distributor or an online site is NOT a venue operating them.
2. Does this kind of business belong to the ICP's target? Judge the KIND of business only: its
   venue type, and whether it runs the kind of machines or games the ICP targets. Answer with two
   quotes first; RECON checks them and derives the fit from them, so the same facts always give
   the same result.
   - icpVenueQuote: the exact words of the ICP text above (its description or guidance) that name
     this venue type as a target, or the broader type it belongs to: a pizzeria or diner is a
     "restaurant", a taproom or brewpub is a "bar", and any venue whose main business is the games
     (claw machine arcade, video game center, game room) is an "arcade". Copy the ICP's own
     words (e.g. "restaurants", "bowling alleys"). Empty string if the ICP names no such venue
     type. Do not quote a type the venue only resembles, and never quote a list of exclusions.
     When the ICP names the type only under a condition ("trampoline centers with a staffed
     arcade"), the condition must be shown too.
   - icpFitEvidence: an exact quote from the lead's content that states this venue runs the
     machines or games the ICP targets: an arcade, game room, game corner, amusement or prize
     machines… The Google Maps category is often wrong: it is enough only when there is no website
     content, or the website agrees. When the website shows a different activity and no machines
     (e.g. a trampoline park or VR arena tagged "Video arcade"), leave this empty.
     Empty string if the content shows none.
   - icpFit:
     "yes" = both quotes found: a venue type the ICP names, running the machines or games.
     "partial" = the machines or games are shown but the ICP does not name the venue type.
     "no" = a different kind of business, or a nearby activity that shows none of the machines or
     games (e.g. a VR arena, escape room or trampoline park with no arcade games, for an arcade
     ICP).
     "unknown" = not enough content to tell, or a venue type the ICP names whose content shows no
     machines or games.
   Details that are not described (how many machines, how big the room is, who operates the
   machines, how they are paid) never lower the fit: they are unknown, and the qualify signals score
   them. Missing buying signals (payment system, game cards, counter, redemption, loyalty…) do not
   lower it either. A target venue that still runs on coins or cash is the opportunity, not a
   weaker fit.
3. Give one answer for EVERY qualify signal (q1, q2…) and every disqualify signal (d1, d2…), in
   order, with "signal" set to its code. Each answer is about that signal only:
   - evidence: an EXACT quote copied character for character from the lead's content that shows
     THIS signal (any language, do not translate, max 200 characters). Empty string if none.
   - label: what the quote shows, as a 3-6 word English phrase (e.g. "40 arcade games listed").
   - status "met" only if the quote clearly shows this signal; "not_met" if the content clearly
     shows the opposite; otherwise "unknown". Missing information is "unknown", never "not_met".
   - Reasonable inference is allowed when the ICP guidance says so (e.g. a redemption counter
     implies a machine fleet), but the evidence must still quote the text you inferred from.
   The quote must show the signal itself, not something next to it. Words that merely look related
   do not count: "prix" (price) is not a prize counter, "jeux" on a shop page is not a games venue,
   "carte cadeau" is not a loyalty program, and a count of other things (bowling lanes, billiard
   tables, VR rooms, escape rooms) does not meet a count of machines.
   One fact meets one signal only, the one that names it most directly: a birthday package is the
   birthday signal, not also a play package; scores kept between visits are leaderboards, not also
   a loyalty program. Never reuse a quote, or the same fact in other words, for a second signal.
4. The lead's company name, category and notes are content too and may be quoted.

Write all labels and free text in English, whatever the language of the site.

Return ONLY valid JSON with this exact structure:
{
  "businessType": "<2-6 words>",
  "icpVenueQuote": "<exact words of the ICP text or empty>",
  "icpFitEvidence": "<exact quote from the lead's content or empty>",
  "icpFit": "yes" | "partial" | "no" | "unknown",
  "icpFitReason": "<one sentence>",
  "qualifySignals": [{"signal": "q1", "evidence": "<exact quote or empty>", "label": "<3-6 words>", "status": "met" | "not_met" | "unknown"}, ... one per qualify signal],
  "disqualifySignals": [{"signal": "d1", "evidence": "<exact quote or empty>", "label": "<3-6 words>", "status": "met" | "not_met" | "unknown"}, ... one per disqualify signal],
  "venueIntel": {
    "estimatedMachineCount": "<e.g. 50+, 20-30, 2-3, unknown>",
    "paymentSystem": "<e.g. token/coin-op, cashless (card system), mixed, unknown>",
    "venueType": "<most specific label>",
    "hasRedemption": <boolean>,
    "hasLoyalty": <boolean>,
    "hasFoodBeverage": <boolean>,
    "hasPartyRooms": <boolean>,
    "isChain": <boolean>,
    "chainName": <string | null>,
    "competitorSystem": <name of an existing cashless/card system found, or null>
  }
}`;
}

/** Lowercase, no accents, no punctuation, single spaces: quotes survive small copy differences. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * True when the quote is in the content. A quote the model shortened or stitched together still
 * passes if a long enough run of it (8 words, or all of a shorter quote) appears verbatim.
 */
export function quoteIsInContent(quote: string, normalizedContent: string): boolean {
  const q = normalize(quote);
  if (q.length < 3) return false;
  if (normalizedContent.includes(q)) return true;
  const words = q.split(" ");
  const run = Math.min(8, words.length);
  if (run < 3) return false;
  for (let i = 0; i + run <= words.length; i++) {
    if (normalizedContent.includes(words.slice(i, i + run).join(" "))) return true;
  }
  return false;
}

/** True when the quote appears as whole words in the text ("bars" must not match "barstool"). */
function wordsAreIn(quote: string, normalizedText: string): boolean {
  const q = normalize(quote);
  return q.length >= 3 && ` ${normalizedText} `.includes(` ${q} `);
}

function readStatus(value: unknown): SignalStatus {
  return value === "met" || value === "not_met" ? value : "unknown";
}

function readAnswers(raw: unknown, prefix: "q" | "d", signals: string[], content: string): SignalAnswer[] {
  return signals.map((text, i) => {
    // Each answer names its signal ("q1"…). Answers without one are read by position.
    const items: unknown[] = Array.isArray(raw) ? raw : [];
    const named = items.some((x) => x && typeof x === "object" && "signal" in x);
    const found = named
      ? items.find((x) => (x as Record<string, unknown>)?.signal === signalKey(prefix, i))
      : items[i];
    const item = (found && typeof found === "object" ? found : {}) as Record<string, unknown>;
    const evidence = typeof item.evidence === "string" ? item.evidence.trim() : "";
    let status = readStatus(item.status);
    const verified = status === "unknown" || quoteIsInContent(evidence, content);
    // A claim the content does not back is downgraded: no quote, no fact.
    if (!verified) status = "unknown";
    return {
      text,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : text,
      status,
      evidence: status === "unknown" ? "" : evidence,
      verified,
    };
  });
}

/** Reads the model's JSON and checks every quote against the content that was sent to it. */
export function readAssessment(parsed: any, icp: IcpConfig, content: string): AiAssessment {
  const normalizedContent = normalize(content);
  const rawFit = parsed?.icpFit;
  let fit: IcpFit = rawFit === "yes" || rawFit === "partial" || rawFit === "no" ? rawFit : "unknown";
  const fitEvidence = typeof parsed?.icpFitEvidence === "string" ? parsed.icpFitEvidence.trim() : "";
  const venueQuote = typeof parsed?.icpVenueQuote === "string" ? parsed.icpVenueQuote.trim() : "";
  // Between "yes" and "partial" the model's own judgement varied on identical facts: on the Santa
  // Rosa test (Nov 2026) three Mountain Mike's pizzerias with the same "arcade" amenity got "yes",
  // "yes" and "partial" (70 / 70 / 51), the model saying once that the Street Route ICP names
  // restaurants and once that it does not. The model now quotes the ICP's own words naming the
  // venue type and the content showing the machines before it decides, and both quotes are checked.
  // The checks only lower the fit, never raise it: letting them turn "partial" into "yes" made a
  // trampoline park (ICP quote "trampoline", Maps category "Video arcade") a 90 QUALIFY on Aix.
  // A venue with no machine shown (a bar, a wings restaurant) is not a known target: "unknown",
  // a DISQUALIFY unless signals lift it, never more than BORDERLINE.
  // The one raise allowed: a venue whose content shows the machines is at least "partial". With the
  // FEC ICP the same pizzeria-with-arcade page got "no" (10) on some runs and "partial" (51) on
  // others; "partial" is capped at BORDERLINE, so this cannot create a false QUALIFY.
  const modelFit = fit;
  const machinesShown = quoteIsInContent(fitEvidence, normalizedContent);
  if (fit === "yes" || fit === "partial") {
    const venueNamed = wordsAreIn(venueQuote, normalize(`${icp.description} ${icp.systemPrompt}`));
    if (!machinesShown) fit = "unknown";
    else if (fit === "yes" && !venueNamed) fit = "partial";
  } else if (fit === "no" && machinesShown) {
    fit = "partial";
  }
  // The model's sentence was written for its own fit; when the checks changed it, the sentence
  // would contradict the score, so it is replaced by what the checks found.
  const modelReason = typeof parsed?.icpFitReason === "string" ? parsed.icpFitReason.trim() : "";
  const short = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);
  const fitReason =
    fit === modelFit ? modelReason :
    fit === "partial" ? `The content shows the games ("${short(fitEvidence)}"), but the ICP's text does not name this kind of venue.` :
    "No content shows the machines or games the ICP targets.";

  return {
    businessType: typeof parsed?.businessType === "string" ? parsed.businessType.trim() : "",
    fit,
    fitReason,
    fitEvidence,
    qualify: readAnswers(parsed?.qualifySignals, "q", icp.qualifySignals, normalizedContent),
    disqualify: readAnswers(parsed?.disqualifySignals, "d", icp.disqualifySignals, normalizedContent),
  };
}

// Score floor per fit: what a lead is worth before any qualify signal is confirmed.
const FIT_BASE: Record<IcpFit, number> = { yes: 60, partial: 42, unknown: 30, no: 10 };
// Score reached with all the needed signals. Only the ICP's real target can be a QUALIFY (60+): on
// the Lyon test (Nov 2026) a laser-tag center the model itself called a partial fit ("no arcade
// machines") reached 100 with side signals, and on Aix (Nov 10) a trampoline park "with no evidence
// of amusement machines" scored 67 QUALIFY. A partial fit stays at most BORDERLINE.
const FIT_CEILING: Record<IcpFit, number> = { yes: 100, partial: 59, unknown: 59, no: 10 };
// Confirmed signals needed for the top of the range. ICP signals overlap and some exclude each
// other (token vs. cashless), so a real target rarely meets all of them.
const SIGNALS_FOR_FULL_SCORE = 4;
const DISQUALIFIED_CAP = 25;

/** Deterministic score from verified facts: the same evidence always gives the same score. */
export function scoreAssessment(a: AiAssessment, opts: { hasContent: boolean }): AiScore {
  // A quote counts for one signal only: the same sentence under two signals is one fact.
  const seenQuotes = new Set<string>();
  const met = a.qualify.filter((s) => {
    if (s.status !== "met") return false;
    const quote = normalize(s.evidence);
    if (seenQuotes.has(quote)) return false;
    seenQuotes.add(quote);
    return true;
  });
  const disqualifiers = a.disqualify.filter((s) => s.status === "met");
  const reasons: string[] = [];

  let score: number;
  if (a.fit === "no") {
    score = FIT_BASE.no;
  } else {
    const base = FIT_BASE[a.fit];
    const needed = Math.max(1, Math.min(SIGNALS_FOR_FULL_SCORE, a.qualify.length));
    score = base + (FIT_CEILING[a.fit] - base) * Math.min(1, met.length / needed);
  }
  reasons.push(
    a.fit === "yes" ? "fits the ICP's target" :
    a.fit === "partial" ? "partial fit with the ICP's target" :
    a.fit === "no" ? "not the ICP's kind of business" :
    "the machines or games the ICP targets are not shown",
  );
  reasons.push(`${met.length} of ${a.qualify.length} qualify signals confirmed`);

  if (disqualifiers.length > 0) {
    score = Math.min(score, DISQUALIFIED_CAP);
    reasons.push(`disqualified: ${disqualifiers.map((d) => d.label).join("; ")}`);
  }
  if (!opts.hasContent && score > 55) {
    score = 55;
    reasons.push("no website content to confirm it");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const verdict: QualifyResult["verdict"] = score >= 60 ? "QUALIFY" : score >= 40 ? "BORDERLINE" : "DISQUALIFY";
  const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  return {
    score,
    verdict,
    explanation: [
      a.businessType ? `${a.businessType[0].toUpperCase()}${a.businessType.slice(1)}.` : "",
      a.fitReason,
      `Score from verified evidence: ${reasons.join("; ")}.`,
    ].filter(Boolean).join(" "),
    keySignals: [
      ...met.map((s) => `${s.label} — "${short(s.evidence, 90)}"`),
      ...disqualifiers.map((s) => `✕ ${s.label} — "${short(s.evidence, 90)}"`),
    ].slice(0, 12),
    missingSignals: a.qualify.filter((s) => s.status !== "met").map((s) => s.text).slice(0, 8),
  };
}
