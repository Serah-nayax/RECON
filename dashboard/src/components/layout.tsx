import { Link, useLocation } from "wouter";
import { Activity, Target, Settings, AlertTriangle, History, Map } from "lucide-react";
import { useEffect, useState } from "react";
import { HelpModal } from "@/components/help-modal";
import { getCrawlerApiKey } from "@/lib/crawlerAuth";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [hasApiKey, setHasApiKey] = useState(true);

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

  const navLinks = [
    { href: "/qualify", label: "Lead Qualifier", icon: Target },
    { href: "/maps", label: "Maps Search", icon: Map },
    { href: "/history", label: "History", icon: History },
    { href: "/icp", label: "ICP Library", icon: Target },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground selection:bg-primary selection:text-primary-foreground font-sans">
      <header className="sticky top-0 z-50 flex h-14 items-center gap-4 border-b bg-background/95 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Link href="/" className="flex items-center gap-2 font-mono font-bold tracking-tight text-primary transition-colors hover:text-primary/80" data-testid="link-home-logo">
          <Activity className="h-5 w-5" />
          <span>RECON_</span>
        </Link>
        <nav className="flex items-center gap-1 ml-6 text-sm font-medium">
          {navLinks.map((link) => {
            const isActive = link.href === "/" ? location === "/" : location.startsWith(link.href);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors text-sm ${
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <HelpModal />
        </div>
      </header>

      {!hasApiKey && location !== "/settings" && (
        <div className="bg-destructive/10 border-b border-destructive/20 text-destructive text-sm font-medium px-4 py-3 flex justify-center items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span>API Key not configured. Recon requires a valid API key to operate.</span>
          <Link href="/settings" className="underline underline-offset-4 ml-2">Configure now</Link>
        </div>
      )}

      <main className="flex-1 flex flex-col items-center">
        <div className="w-full max-w-5xl px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
