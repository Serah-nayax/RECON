/**
 * One colour per workflow step, used by the menu, the page titles and the home cards, so each
 * step is recognised at a glance. Green, amber and red stay free for verdicts and statuses.
 * Full class names (not built from parts) so Tailwind keeps them in the build.
 */
export interface StepStyle {
  /** Icon tile: gradient fill, text colour, ring. */
  tile: string;
  /** Small solid badge (step number in the menu). */
  badge: string;
  /** Text accent (the "Step N" label, links). */
  text: string;
  /** Thin gradient bar on top of a card. */
  bar: string;
  /** Coloured glow on hover. */
  glow: string;
}

export const STEP_STYLES: Record<number, StepStyle> = {
  1: {
    tile: "bg-gradient-to-br from-violet-500/30 to-fuchsia-500/10 text-violet-300 ring-violet-400/30",
    badge: "bg-gradient-to-br from-violet-400 to-fuchsia-500 text-white",
    text: "text-violet-300",
    bar: "from-violet-400 to-fuchsia-500",
    glow: "hover:shadow-[0_14px_36px_-14px_rgba(167,139,250,0.55)] hover:border-violet-400/40",
  },
  2: {
    tile: "bg-gradient-to-br from-cyan-400/30 to-sky-500/10 text-cyan-300 ring-cyan-400/30",
    badge: "bg-gradient-to-br from-cyan-400 to-sky-500 text-white",
    text: "text-cyan-300",
    bar: "from-cyan-400 to-sky-500",
    glow: "hover:shadow-[0_14px_36px_-14px_rgba(34,211,238,0.5)] hover:border-cyan-400/40",
  },
  3: {
    tile: "bg-gradient-to-br from-pink-500/30 to-rose-500/10 text-pink-300 ring-pink-400/30",
    badge: "bg-gradient-to-br from-pink-400 to-rose-500 text-white",
    text: "text-pink-300",
    bar: "from-pink-400 to-rose-500",
    glow: "hover:shadow-[0_14px_36px_-14px_rgba(244,114,182,0.5)] hover:border-pink-400/40",
  },
  4: {
    tile: "bg-gradient-to-br from-blue-500/30 to-indigo-500/10 text-blue-300 ring-blue-400/30",
    badge: "bg-gradient-to-br from-blue-400 to-indigo-500 text-white",
    text: "text-blue-300",
    bar: "from-blue-400 to-indigo-500",
    glow: "hover:shadow-[0_14px_36px_-14px_rgba(96,165,250,0.55)] hover:border-blue-400/40",
  },
};

/** Pages outside the workflow (Settings) keep the neutral blue. */
export const NEUTRAL_STYLE: StepStyle = {
  tile: "bg-gradient-to-br from-primary/25 to-indigo-500/10 text-primary ring-primary/25",
  badge: "bg-primary text-primary-foreground",
  text: "text-primary/80",
  bar: "from-sky-400 to-indigo-500",
  glow: "",
};

export function stepStyle(step?: number): StepStyle {
  return (step && STEP_STYLES[step]) || NEUTRAL_STYLE;
}
