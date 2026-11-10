/** RECON mark: radar rings with a sweep and one target found. */
export function Logo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="recon-logo" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7dd3fc" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14" stroke="url(#recon-logo)" strokeWidth="2" />
      <circle cx="16" cy="16" r="8.5" stroke="url(#recon-logo)" strokeWidth="1.5" opacity="0.5" />
      <path d="M16 16 L16 2 A14 14 0 0 1 28.12 9 Z" fill="url(#recon-logo)" opacity="0.3" />
      <circle cx="16" cy="16" r="2.6" fill="url(#recon-logo)" />
      <circle cx="22.5" cy="8.5" r="1.9" fill="#e0f2fe" />
    </svg>
  );
}
