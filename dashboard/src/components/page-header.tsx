import type { LucideIcon } from "lucide-react";

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
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-4 min-w-0">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          {step !== undefined && (
            <p className="text-xs font-medium text-primary mb-0.5">Step {step}</p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
      {actions && <div className="flex gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
