import type { IcpConfig } from "@/lib/qualifyApi";

/** Terms guessed from the ICP's description, for an ICP whose search terms were never set. */
function deriveSearchTerms(icp: IcpConfig): string[] {
  const text = [icp.description, ...icp.qualifySignals].join(" ");
  const patterns: [RegExp, string][] = [
    [/\bFEC[s]?\b|family entertainment center/i, "family entertainment center"],
    [/\barcade[s]?\b/i, "arcade"],
    [/\bbarcade[s]?\b/i, "barcade"],
    [/\bbeercade[s]?\b/i, "beercade"],
    [/\bbowling/i, "bowling alley"],
    [/\blaser.?tag/i, "laser tag"],
    [/\bgo.kart/i, "go-kart track"],
    [/\bescape.?room/i, "escape room"],
    [/\btrampoline/i, "trampoline park"],
    [/\bgame.?room/i, "game room"],
    [/\bentertainment.?restaurant|entertainment dining/i, "entertainment restaurant"],
    [/\bpinball/i, "pinball arcade"],
    [/\bamusement/i, "amusement center"],
  ];
  const terms: string[] = [];
  for (const [regex, term] of patterns) {
    if (regex.test(text) && !terms.includes(term)) terms.push(term);
  }
  return terms.slice(0, 7);
}

/** Search terms the ICP offers on the Maps page: the ones set on the ICP page, or guessed ones. */
export function icpSearchTerms(icp: IcpConfig): string[] {
  return Array.isArray(icp.searchTerms) ? icp.searchTerms : deriveSearchTerms(icp);
}
