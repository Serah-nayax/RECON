import { useEffect, useState } from "react";

/**
 * RECON mark: a planet (Tigapo's pink-to-orange round with its hole) and a moon in Nayax yellow
 * circling it, like RECON going round an area to find every venue in it.
 * `animated` makes the moon orbit: it passes in front of the planet, then behind it. The orbit is
 * drawn as two half rings and two moons (one in front of the planet, one behind) that take turns.
 * `detailed` adds a second, wider orbit and a few twinkling places (large version on the home page).
 */
const ORBIT_FRONT = "M1.5 17 A14.5 4.6 0 0 0 30.5 17";
const ORBIT_BACK = "M30.5 17 A14.5 4.6 0 0 0 1.5 17";
const ORBIT_FULL = `${ORBIT_FRONT} A14.5 4.6 0 0 0 1.5 17`;
const ORBIT_SECONDS = 5;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function Moon({ visibleIn }: { visibleIn: "front" | "back" }) {
  return (
    <circle r="2.3" fill="#ffcc00" stroke="#fff3b0" strokeWidth="0.4">
      <animateMotion dur={`${ORBIT_SECONDS}s`} repeatCount="indefinite" path={ORBIT_FULL} />
      {/* First half of the path is the front of the orbit, second half the back. */}
      <animate
        attributeName="opacity"
        values={visibleIn === "front" ? "1;0" : "0;1"}
        keyTimes="0;0.5"
        dur={`${ORBIT_SECONDS}s`}
        calcMode="discrete"
        repeatCount="indefinite"
      />
    </circle>
  );
}

export function Logo({
  className = "h-8 w-8",
  animated = false,
  detailed = false,
}: {
  className?: string;
  animated?: boolean;
  detailed?: boolean;
}) {
  const moving = animated && !usePrefersReducedMotion();
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden="true" overflow="visible">
      <defs>
        <linearGradient id="recon-planet" x1="9" y1="9" x2="24" y2="25" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ff2d7a" />
          <stop offset="0.55" stopColor="#ff4f5e" />
          <stop offset="1" stopColor="#ff8a3d" />
        </linearGradient>
        <radialGradient id="recon-shine" cx="12" cy="12" r="10" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        {/* The hole is cut out, so the page shows through it whatever the background. */}
        <mask id="recon-hole">
          <rect width="32" height="32" fill="#fff" />
          <circle cx="14.6" cy="18.8" r="3.1" fill="#000" />
        </mask>
      </defs>

      <g transform="rotate(-20 16 17)">
        {detailed && (
          <ellipse cx="16" cy="17" rx="19" ry="7" stroke="#ffcc00" strokeWidth="0.3" opacity="0.25" strokeDasharray="1 1.5" />
        )}
        <path d={ORBIT_BACK} stroke="#e2e8f0" strokeWidth="0.7" opacity="0.35" />
        {moving && <Moon visibleIn="back" />}
      </g>

      <circle cx="16" cy="17" r="9" stroke="#ffcc00" strokeWidth="0.8" className="logo-ping" />
      <g mask="url(#recon-hole)">
        <circle cx="16" cy="17" r="9" fill="url(#recon-planet)" />
        <circle cx="16" cy="17" r="9" fill="url(#recon-shine)" />
      </g>

      <g transform="rotate(-20 16 17)">
        <path d={ORBIT_FRONT} stroke="#e2e8f0" strokeWidth="0.9" opacity="0.7" />
        {moving ? <Moon visibleIn="front" /> : <circle cx="27.1" cy="19.96" r="2.3" fill="#ffcc00" stroke="#fff3b0" strokeWidth="0.4" />}
      </g>

      {detailed &&
        [
          [3, 5, 0],
          [29, 4, 1.1],
          [30, 29, 2.3],
          [2.5, 27, 0.6],
        ].map(([cx, cy, delay]) => (
          <circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r="0.6"
            fill="#fde68a"
            className={moving ? "logo-blip" : undefined}
            style={moving ? { animationDelay: `${delay}s` } : undefined}
          />
        ))}
    </svg>
  );
}
