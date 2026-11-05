export function canonicalizeLeadUrl(value: string): string {
  const raw = value.trim();
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        ["gclid", "fbclid", "msclkid", "mc_cid", "mc_eid"].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return raw.toLowerCase().replace(/\/+$/, "");
  }
}