import { Link, useLocation } from "wouter";
import { Settings, AlertTriangle, History, Map, ListChecks, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { HelpModal } from "@/components/help-modal";
import { getCrawlerApiKey } from "@/lib/crawlerAuth";
import { useServerInfo } from "@/lib/serverInfo";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [hasApiKey, setHasApiKey] = useState(true);
  // Only a shared server needs a key: locally the banner was shown for nothing.
  const needsKey = useServerInfo().data?.local === false;

  useEffect(() => {
    const checkKey = () => {
      setHasApiKey(
        !!getCrawlerApiKey()
      );
    };
    checkKey();
    window.addEventListener("storage", checkKey);
    window.addEventListener("api-key-updated", checkKey);
    return () => {
      window.removeEventListener("storage", checkKey);
      window.removeEventListener("api-key-updated", checkKey);
    };
  }, [location]);

  // The work in order: who we look for, find, qualify, results. Settings apart.
  const mainLinks = [
    { href: "/icp", label: "ICP", icon: BookOpen, step: 1 },
    { href: "/maps", label: "Maps Search", icon: Map, step: 2 },
    { href: "/qualify", label: "Lead Qualifier", icon: ListChecks, step: 3 },
    { href: "/history", label: "History", icon: History, step: 4 },
  ];
  const sideLinks = [{ href: "/settings", label: "Settings", icon: Settings }];
  const linkClass = (href: string) =>
    `flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm ${
      location.startsWith(href)
        ? "bg-primary/12 text-foreground font-medium ring-1 ring-inset ring-primary/30"
        : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
    }`;

  return (
    <div className="app-bg flex min-h-screen w-full flex-col text-foreground selection:bg-primary selection:text-primary-foreground font-sans">
      <header className="sticky top-0 z-50 flex h-16 items-center gap-2 border-b border-white/[0.06] bg-background/70 px-6 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2 mr-6 font-semibold tracking-tight text-foreground hover:text-primary transition-colors" data-testid="link-home-logo">
          <Logo className="h-8 w-8 drop-shadow-[0_0_12px_rgba(125,211,252,0.35)]" />
          <span className="text-lg tracking-[0.12em]">RECON</span>
        </Link>
        <nav className="flex items-center gap-1">
          {mainLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href} className={`group ${linkClass(link.href)}`}>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                    location.startsWith(link.href) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {link.step}
                </span>
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>
        <nav className="ml-auto flex items-center gap-1">
          {sideLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href} className={linkClass(link.href)}>
                <Icon className="h-4 w-4" />
                {link.label}
              </Link>
            );
          })}
          <HelpModal />
        </nav>
      </header>

      {needsKey && !hasApiKey && location !== "/settings" && (
        <div className="bg-destructive/10 border-b border-destructive/20 text-destructive text-sm font-medium px-4 py-3 flex justify-center items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span>Enter the access key of this RECON server to use it.</span>
          <Link href="/settings" className="underline underline-offset-4 ml-2">Settings</Link>
        </div>
      )}

      <main className="flex-1 flex flex-col items-center">
        <div className="w-full max-w-6xl px-6 py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
