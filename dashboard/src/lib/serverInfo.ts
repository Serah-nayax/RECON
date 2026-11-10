import { useQuery } from "@tanstack/react-query";

export interface ServerInfo {
  /** RECON runs on this PC only: no access key needed. */
  local: boolean;
  /** The AI that scores leads, or null when it is off. */
  ai: { provider: "claude"; model: string } | null;
}

/** What the RECON server says about itself (public, no key needed). */
export function useServerInfo() {
  return useQuery({
    queryKey: ["server-info"],
    queryFn: async (): Promise<ServerInfo> => {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const res = await fetch(`${base}/api/healthz`);
      if (!res.ok) throw new Error(res.statusText);
      const data = (await res.json()) as Partial<ServerInfo>;
      return { local: data.local === true, ai: data.ai ?? null };
    },
    staleTime: 60_000,
  });
}
