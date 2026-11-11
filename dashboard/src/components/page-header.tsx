import type { LucideIcon } from "lucide-react";
import { stepStyle } from "@/lib/steps";

/** Same title block on every page: step (when the page is a step of the workflow), title, one line on what it does. */
export function PageHeader({
  icon: Icon,
  step,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  step?: number;
  title: string;
  description: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const style = stepStyle(step);
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-4 min-w-0">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset shadow-lg shadow-black/30 ${style.tile}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          {step !== undefined && (
            <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${style.text} mb-1`}>Step {step}</p>
          )}
          <h1 className="text-[1.7rem] leading-tight font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
      {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
