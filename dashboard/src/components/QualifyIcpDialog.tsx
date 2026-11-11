import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Target, CheckCircle2 } from "lucide-react";
import { icpApi, type IcpConfig } from "@/lib/qualifyApi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** One line per ICP: its "Primary qualifier" sentence, which says who it is for. */
function icpSummary(icp: IcpConfig): string {
  const primary = icp.description.match(/Primary qualifier:\s*([^.]+)\./i)?.[1];
  const raw = primary ?? icp.description;
  const text = raw.charAt(0).toUpperCase() + raw.slice(1);
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

/**
 * Asked before "Qualify All": which ICP scores these places. The active one is preselected;
 * picking another makes it the active ICP (as on the ICP page), since the Qualifier scores with
 * the active ICP.
 */
export function QualifyIcpDialog({
  open,
  onOpenChange,
  count,
  searchTerms,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  searchTerms: string[];
  onConfirm: (icpId: string, changed: boolean) => void;
  pending: boolean;
}) {
  const { data } = useQuery({ queryKey: ["icps"], queryFn: icpApi.list, enabled: open });
  const [picked, setPicked] = useState<string | null>(null);
  const activeId = data?.active.id ?? null;

  useEffect(() => {
    if (open) setPicked(null);
  }, [open]);

  const selected = picked ?? activeId;
  const changed = selected !== null && selected !== activeId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Which ICP scores these {count.toLocaleString()} leads?</DialogTitle>
          <DialogDescription>
            {searchTerms.length > 0 && (
              <>
                Searched: <span className="text-foreground">{searchTerms.join(", ")}</span>.{" "}
              </>
            )}
            They are all scored against one ICP. Keep the active one or pick the one that fits these leads.
          </DialogDescription>
        </DialogHeader>

        {!data ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the ICPs…
          </div>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
            {data.icps.map((icp) => {
              const isSelected = icp.id === selected;
              return (
                <button
                  key={icp.id}
                  type="button"
                  onClick={() => setPicked(icp.id)}
                  className={`w-full text-left rounded-lg border px-3.5 py-3 transition-colors ${
                    isSelected
                      ? "border-pink-400/50 bg-pink-500/10"
                      : "border-white/[0.08] hover:border-white/20 hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-3.5 w-3.5 rounded-full border shrink-0 ${
                        isSelected ? "border-pink-400 bg-pink-400 shadow-[0_0_0_3px_rgba(244,114,182,0.2)]" : "border-white/30"
                      }`}
                    />
                    <span className="text-sm font-medium">{icp.name}</span>
                    {icp.id === activeId && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5 pl-5.5 leading-relaxed">{icpSummary(icp)}</p>
                </button>
              );
            })}
          </div>
        )}

        {changed && (
          <p className="text-xs text-amber-400">
            This ICP becomes the active one for the whole team, as when you choose it on the ICP page.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => selected && onConfirm(selected, changed)} disabled={!selected || pending}>
            {pending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Target className="h-4 w-4 mr-2" />}
            Qualify {count.toLocaleString()} leads
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
