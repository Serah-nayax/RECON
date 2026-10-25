import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { setApiKey } from "@workspace/api-client-react";
import {
  Key,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  CheckCircle2,
  Save,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface ConfigEntry {
  key: string;
  label: string;
  category: string;
  updatedAt: string;
}

interface KeySection {
  category: string;
  title: string;
  description: string;
  keys: {
    key: string;
    label: string;
    placeholder: string;
    required?: boolean;
  }[];
}

const PREDEFINED_SECTIONS: KeySection[] = [
  {
    category: "platform",
    title: "Platform",
    description: "Core authentication for the Recon backend.",
    keys: [
      {
        key: "crawler_api_key",
        label: "Crawler API Key",
        placeholder: "Enter your Recon crawler API key",
        required: true,
      },
    ],
  },
  {
    category: "ai",
    title: "AI Services",
    description: "API keys for AI providers used for lead qualification and analysis.",
    keys: [
      { key: "ANTHROPIC_API_KEY", label: "Anthropic API Key", placeholder: "sk-ant-..." },
      { key: "GEMINI_API_KEY", label: "Google Gemini API Key", placeholder: "AIza..." },
      { key: "OPENAI_API_KEY", label: "OpenAI API Key", placeholder: "sk-..." },
    ],
  },
  {
    category: "data",
    title: "Data Sources",
    description: "Keys for external data providers used during lead enrichment.",
    keys: [
      { key: "APIFY_API_TOKEN", label: "Apify API Token", placeholder: "apify_api_..." },
    ],
  },
  {
    category: "contacts",
    title: "Contact Intelligence",
    description: "Seamless.AI automatically enriches decision makers on every qualified lead with verified emails, phone numbers, and job titles.",
    keys: [
      { key: "SEAMLESS_AI_API_KEY", label: "Seamless.AI API Key", placeholder: "Paste your Seamless.AI API key..." },
    ],
  },
  {
    category: "crm",
    title: "CRM Integrations",
    description: "Credentials for pushing qualified leads to your CRM.",
    keys: [
      { key: "HUBSPOT_ACCESS_TOKEN", label: "HubSpot Access Token", placeholder: "pat-na1-..." },
      { key: "SALESFORCE_CLIENT_ID", label: "Salesforce Client ID", placeholder: "3MVG9..." },
      { key: "SALESFORCE_CLIENT_SECRET", label: "Salesforce Client Secret", placeholder: "..." },
      { key: "SALESFORCE_USERNAME", label: "Salesforce Username", placeholder: "user@example.com" },
      { key: "SALESFORCE_PASSWORD", label: "Salesforce Password", placeholder: "••••••••" },
      { key: "SALESFORCE_SECURITY_TOKEN", label: "Salesforce Security Token (optional)", placeholder: "..." },
    ],
  },
];

function maskKey(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}${"•".repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`;
}

function getApiBase(): string {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  return `${base}/api`;
}

function getStoredApiKey(): string {
  return localStorage.getItem("crawler_api_key") ?? "";
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("x-api-key", getStoredApiKey());
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${getApiBase()}${path}`, { ...options, headers });
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw new Error(msg);
  }
  return res;
}

async function saveRemoteKey(key: string, value: string, label: string, category: string): Promise<void> {
  await apiFetch(`/config/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value, label, category }),
  });
}

async function deleteRemoteKey(key: string): Promise<void> {
  await apiFetch(`/config/${encodeURIComponent(key)}`, { method: "DELETE" });
}

async function fetchRemoteKeys(): Promise<ConfigEntry[]> {
  const res = await apiFetch("/config");
  const data = await res.json() as { configs: ConfigEntry[] };
  return data.configs ?? [];
}

// ── Predefined key row ────────────────────────────────────────────────────────

function PredefinedKeyRow({
  keyDef,
  category,
  savedEntry,
  onSaved,
  onDeleted,
}: {
  keyDef: KeySection["keys"][number];
  category: string;
  savedEntry?: ConfigEntry;
  onSaved: (key: string, label: string, category: string) => void;
  onDeleted: (key: string) => void;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const isCrawlerKey = keyDef.key === "crawler_api_key";
  const isSaved = !!savedEntry;

  const handleSave = useCallback(async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      if (isCrawlerKey) {
        localStorage.setItem("crawler_api_key", value.trim());
        setApiKey(value.trim());
        window.dispatchEvent(new Event("api-key-updated"));
      }
      if (!isCrawlerKey) {
        await saveRemoteKey(keyDef.key, value.trim(), keyDef.label, category);
      }
      onSaved(keyDef.key, keyDef.label, category);
      setValue("");
      toast({ title: "Saved", description: `${keyDef.label} saved.` });
    } catch {
      toast({ title: "Error", description: `Failed to save ${keyDef.label}.`, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [value, keyDef, category, isCrawlerKey, onSaved, toast]);

  const handleDelete = useCallback(async () => {
    try {
      if (isCrawlerKey) {
        localStorage.removeItem("crawler_api_key");
        setApiKey(null);
        window.dispatchEvent(new Event("api-key-updated"));
      } else {
        await deleteRemoteKey(keyDef.key);
      }
      onDeleted(keyDef.key);
      toast({ title: "Removed", description: `${keyDef.label} cleared.` });
    } catch {
      toast({ title: "Error", description: "Failed to remove key.", variant: "destructive" });
    }
  }, [keyDef, isCrawlerKey, onDeleted, toast]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="font-mono text-xs uppercase text-muted-foreground tracking-wider">
          {keyDef.label}
          {keyDef.required && <span className="text-destructive ml-1">*</span>}
        </label>
        {isSaved && (
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-3 h-3 text-green-500" />
            <span className="font-mono text-xs text-green-600">Configured</span>
            <button
              onClick={handleDelete}
              className="ml-2 text-muted-foreground hover:text-destructive transition-colors"
              title="Remove key"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      {isSaved ? (
        <div className="font-mono text-xs bg-muted/50 border border-border rounded px-3 py-2 text-muted-foreground">
          {maskKey("••••••••••••")} — last updated {new Date(savedEntry!.updatedAt).toLocaleDateString()}
        </div>
      ) : (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={show ? "text" : "password"}
              placeholder={keyDef.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="font-mono pr-10"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!value.trim() || saving}
            className="font-mono font-bold tracking-wider gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "SAVING..." : "SAVE"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Custom key row ────────────────────────────────────────────────────────────

function CustomKeyRow({
  entry,
  onDeleted,
}: {
  entry: ConfigEntry;
  onDeleted: (key: string) => void;
}) {
  const { toast } = useToast();

  const handleDelete = useCallback(async () => {
    try {
      await deleteRemoteKey(entry.key);
      onDeleted(entry.key);
      toast({ title: "Removed", description: `${entry.label} cleared.` });
    } catch {
      toast({ title: "Error", description: "Failed to remove key.", variant: "destructive" });
    }
  }, [entry, onDeleted, toast]);

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-xs font-medium">{entry.label}</span>
        <span className="font-mono text-xs text-muted-foreground">{entry.key}</span>
      </div>
      <div className="flex items-center gap-3">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
        <span className="font-mono text-xs text-muted-foreground">
          {new Date(entry.updatedAt).toLocaleDateString()}
        </span>
        <button
          onClick={handleDelete}
          className="text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Add custom key form ───────────────────────────────────────────────────────

function AddCustomKeyForm({ onAdded }: { onAdded: () => void }) {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleAdd = useCallback(async () => {
    if (!label.trim() || !key.trim() || !value.trim()) return;
    setSaving(true);
    try {
      await saveRemoteKey(key.trim(), value.trim(), label.trim(), "custom");
      setLabel("");
      setKey("");
      setValue("");
      onAdded();
      toast({ title: "Saved", description: `${label.trim()} added to platform.` });
    } catch {
      toast({ title: "Error", description: "Failed to save key.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [label, key, value, onAdded, toast]);

  return (
    <div className="space-y-3 pt-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-xs uppercase text-muted-foreground tracking-wider">Key Name / Label</label>
          <Input
            placeholder="e.g. My Service API Key"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="font-mono text-xs uppercase text-muted-foreground tracking-wider">Environment Key</label>
          <Input
            placeholder="e.g. MY_SERVICE_API_KEY"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase().replace(/\s/g, "_"))}
            className="font-mono text-sm"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="font-mono text-xs uppercase text-muted-foreground tracking-wider">Secret Value</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={show ? "text" : "password"}
              placeholder="Paste your key here..."
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono pr-10"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!label.trim() || !key.trim() || !value.trim() || saving}
            className="font-mono font-bold tracking-wider gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            {saving ? "SAVING..." : "ADD"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({
  section,
  configMap,
  onRefresh,
}: {
  section: KeySection;
  configMap: Map<string, ConfigEntry>;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(true);

  const configuredCount = section.keys.filter((k) => {
    if (k.key === "crawler_api_key") return !!localStorage.getItem("crawler_api_key");
    return configMap.has(k.key);
  }).length;

  return (
    <Card className="border-border">
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            <div>
              <CardTitle className="font-mono">{section.title}</CardTitle>
              <CardDescription className="mt-0.5">{section.description}</CardDescription>
            </div>
          </div>
          <Badge variant={configuredCount > 0 ? "default" : "secondary"} className="font-mono text-xs shrink-0">
            {configuredCount}/{section.keys.length} set
          </Badge>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-5 pt-0">
          {section.keys.map((k) => (
            <PredefinedKeyRow
              key={k.key}
              keyDef={k}
              category={section.category}
              savedEntry={
                k.key === "crawler_api_key"
                  ? localStorage.getItem("crawler_api_key")
                    ? { key: k.key, label: k.label, category: "platform", updatedAt: new Date().toISOString() }
                    : undefined
                  : configMap.get(k.key)
              }
              onSaved={onRefresh}
              onDeleted={onRefresh}
            />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Settings() {
  const [configMap, setConfigMap] = useState<Map<string, ConfigEntry>>(new Map());
  const [customEntries, setCustomEntries] = useState<ConfigEntry[]>([]);
  const [hasCrawlerKey, setHasCrawlerKey] = useState(!!localStorage.getItem("crawler_api_key"));
  const [, forceRender] = useState(0);

  const allPredefinedKeys = new Set(PREDEFINED_SECTIONS.flatMap((s) => s.keys.map((k) => k.key)));

  const refresh = useCallback(async () => {
    forceRender((n) => n + 1);
    const crawlerKey = localStorage.getItem("crawler_api_key");
    setHasCrawlerKey(!!crawlerKey);
    if (!crawlerKey) return;
    try {
      const entries = await fetchRemoteKeys();
      const map = new Map<string, ConfigEntry>();
      const custom: ConfigEntry[] = [];
      for (const e of entries) {
        map.set(e.key, e);
        if (!allPredefinedKeys.has(e.key) && e.key !== "crawler_api_key") {
          custom.push(e);
        }
      }
      setConfigMap(map);
      setCustomEntries(custom);
    } catch {
      // Remote keys unavailable — silently ignore, local sections still work
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold font-mono tracking-tight flex items-center gap-2">
          <Key className="w-6 h-6" /> API Key Management
        </h1>
        <p className="text-muted-foreground text-sm">
          Configure API keys for any service. Keys are stored server-side and available to all platform features.
        </p>
      </div>

      {!hasCrawlerKey && (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground font-mono">
          Set your Crawler API key below to unlock server-side key storage for all other services.
        </div>
      )}

      {PREDEFINED_SECTIONS.map((section) => (
        <SectionCard
          key={section.category}
          section={section}
          configMap={configMap}
          onRefresh={refresh}
        />
      ))}

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-mono flex items-center gap-2">
            <Plus className="w-4 h-4" /> Custom API Keys
          </CardTitle>
          <CardDescription>
            Add any API key from any source — it will be available platform-wide under the environment key you define.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {customEntries.length > 0 && (
            <div className="mb-4 border border-border rounded-md px-4 py-1">
              {customEntries.map((e) => (
                <CustomKeyRow
                  key={e.key}
                  entry={e}
                  onDeleted={() => refresh()}
                />
              ))}
            </div>
          )}
          <AddCustomKeyForm onAdded={refresh} />
        </CardContent>
      </Card>
    </div>
  );
}
