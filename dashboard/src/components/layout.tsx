import { Link, useLocation } from "wouter";
import { Radar, Settings, AlertTriangle, History, Map, ListChecks, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
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

  // The work in order (find, qualify, results), then what configures it.
  const mainLinks = [
    { href: "/maps", label: "Maps Search", icon: Map, step: 1 },
    { href: "/qualify", label: "Lead Qualifier", icon: ListChecks, step: 2 },
    { href: "/history", label: "History", icon: History, step: 3 },
  ];
  const sideLinks = [
    { href: "/icp", label: "ICP Library", icon: BookOpen },
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  const linkClass = (href: string) =>
    `flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors text-sm ${
      location.startsWith(href)
        ? "bg-primary/15 text-primary font-medium"
        : "text-muted-foreground hover:text-foreground hover:bg-muted"
    }`;

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground selection:bg-primary selection:text-primary-foreground font-sans">
      <header className="sticky top-0 z-50 flex h-16 items-center gap-2 border-b bg-background/90 px-6 backdrop-blur">
        <Link href="/" className="flex items-center gap-2 mr-6 font-semibold tracking-tight text-foreground hover:text-primary transition-colors" data-testid="link-home-logo">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Radar className="h-4.5 w-4.5" />
          </span>
          <span className="text-lg">RECON</span>
        </Link>
        <nav className="flex items-center gap-1">
          {mainLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href} className={linkClass(link.href)}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
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
