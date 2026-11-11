import type { TigapoMatch } from "@/lib/mapsApi";

/** What a Tigapo match says, in words (badge tooltip and export column). */
export function tigapoText(t: TigapoMatch): string {
  const where = `${t.name}${t.operator && t.operator !== t.name ? ` (${t.operator})` : ""}`;
  if (t.how === "maybe") {
    const how = t.distanceM == null ? "same name, same city" : `${(t.distanceM / 1000).toFixed(1)} km away`;
    return `Maybe ${t.active ? "Tigapo customer" : "former Tigapo customer"} ${where}, ${how}`;
  }
  if (t.how === "address") return `Same address as Tigapo location ${where}${t.active ? "" : ", closed"}`;
  return `${t.active ? "Tigapo customer" : "Former Tigapo customer"}: ${where}`;
}

/** "Tigapo" (violet), "Ex-Tigapo", "Tigapo?" or "Tigapo address?" next to a place's name. */
export function TigapoBadge({ match }: { match: TigapoMatch }) {
  const strong = match.active && match.how === "name";
  return (
    <span
      title={match.distanceM == null || match.how === "maybe" ? tigapoText(match) : `${tigapoText(match)} (${match.distanceM} m away)`}
      className={`shrink-0 inline-flex px-1.5 py-0.5 rounded text-xs font-medium border ${
        strong ? "text-violet-200 bg-violet-500/15 border-violet-400/30" : "text-muted-foreground bg-white/5 border-white/10"
      }`}
    >
      {match.how === "maybe" ? "Tigapo?" : match.how === "address" ? "Tigapo address?" : match.active ? "Tigapo" : "Ex-Tigapo"}
    </span>
  );
}
