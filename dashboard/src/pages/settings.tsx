import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Settings as SettingsIcon, Sparkles, Trash2, Eye, EyeOff, CheckCircle2, Save, KeyRound, Building2 } from "lucide-react";
import { getCrawlerApiKey } from "@/lib/crawlerAuth";
import { useServerInfo } from "@/lib/serverInfo";

interface ConfigEntry {
  key: string;
  label: string;
  category: string;
  updatedAt: string;
}

interface KeyDef {
  key: string;
  label: string;
  placeholder: string;
}

const CRM_KEYS: KeyDef[] = [
  { key: "HUBSPOT_ACCESS_TOKEN", label: "HubSpot Access Token", placeholder: "pat-na1-..." },
  { key: "SALESFORCE_CLIENT_ID", label: "Salesforce Client ID", placeholder: "3MVG9..." },
  { key: "SALESFORCE_CLIENT_SECRET", label: "Salesforce Client Secret", placeholder: "..." },
  { key: "SALESFORCE_USERNAME", label: "Salesforce Username", placeholder: "user@example.com" },
  { key: "SALESFORCE_PASSWORD", label: "Salesforce Password", placeholder: "••••••••" },
  { key: "SALESFORCE_SECURITY_TOKEN", label: "Salesforce Security Token (optional)", placeholder: "..." },
];

const ACCESS_KEY: KeyDef = { key: "crawler_api_key", label: "Access key", placeholder: "Key given by the RECON admin" };

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("x-api-key", getCrawlerApiKey());
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  const res = await fetch(`${base}/api${path}`, { ...options, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? res.statusText);
  }
  return res;
}

// ── One secret: saved state, replace, remove ──────────────────────────────────

function SecretRow({
  def,
  savedAt,
  onSave,
  onRemove,
}: {
  def: KeyDef;
  /** When it was saved, or "" when saved without a date; undefined when not set. */
  savedAt?: string;
  onSave: (value: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const isSaved = savedAt !== undefined;

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await onSave(value.trim());
      setValue("");
      setEditing(false);
      toast({ title: "Saved", description: `${def.label} saved.` });
    } catch (err) {
      toast({ title: `${def.label} not saved`, description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Remove the ${def.label}?`)) return;
    setBusy(true);
    try {
      await onRemove();
      toast({ title: "Removed", description: `${def.label} removed.` });
    } catch (err) {
      toast({ title: `${def.label} not removed`, description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{def.label}</label>
        {isSaved && !editing && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 font-mono text-xs text-green-600">
              <CheckCircle2 className="w-3 h-3 text-green-500" />
              Set{savedAt ? ` · ${new Date(savedAt).toLocaleDateString()}` : ""}
            </span>
            <button onClick={() => setEditing(true)} className="font-mono text-xs text-muted-foreground hover:text-foreground">
              Replace
            </button>
            <button onClick={remove} disabled={busy} className="text-muted-foreground hover:text-destructive" title="Remove">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      {(!isSaved || editing) && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={show ? "text" : "password"}
              placeholder={def.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              className="font-mono pr-10"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <Button size="sm" onClick={save} disabled={!value.trim() || busy} className="font-mono gap-1.5">
            <Save className="w-3.5 h-3.5" /> Save
          </Button>
          {editing && (
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setValue(""); }}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Settings() {
  const server = useServerInfo();
  const [configs, setConfigs] = useState<Map<string, ConfigEntry>>(new Map());
  const [accessKey, setAccessKey] = useState(getCrawlerApiKey());
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch("/config");
      const data = (await res.json()) as { configs?: ConfigEntry[] };
      setConfigs(new Map((data.configs ?? []).map((e) => [e.key, e])));
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, accessKey]);

  const saveAccessKey = async (value: string) => {
    localStorage.setItem("crawler_api_key", value);
    window.dispatchEvent(new Event("api-key-updated"));
    setAccessKey(value);
  };
  const removeAccessKey = async () => {
    localStorage.removeItem("crawler_api_key");
    window.dispatchEvent(new Event("api-key-updated"));
    setAccessKey("");
  };

  const saveCrmKey = (def: KeyDef) => async (value: string) => {
    await apiFetch(`/config/${encodeURIComponent(def.key)}`, {
      method: "PUT",
      body: JSON.stringify({ value, label: def.label, category: "crm" }),
    });
    await refresh();
  };
  const removeCrmKey = (def: KeyDef) => async () => {
    await apiFetch(`/config/${encodeURIComponent(def.key)}`, { method: "DELETE" });
    await refresh();
  };

  const crmSet = CRM_KEYS.filter((k) => configs.has(k.key)).length;
  const ai = server.data?.ai;

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={SettingsIcon} title="Settings" description="Access to this RECON server, AI scoring and CRM account." />

      {/* Access */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-mono flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Access
          </CardTitle>
          <CardDescription>
            {server.data?.local
              ? "RECON runs on this PC: no access key is needed."
              : "The access key of this RECON server. It is kept in this browser."}
          </CardDescription>
        </CardHeader>
        {server.data && !server.data.local && (
          <CardContent className="pt-0">
            <SecretRow
              def={ACCESS_KEY}
              savedAt={accessKey ? "" : undefined}
              onSave={saveAccessKey}
              onRemove={removeAccessKey}
            />
          </CardContent>
        )}
      </Card>

      {/* AI */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-mono flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> AI scoring
            </CardTitle>
            {server.data && (
              <Badge variant={ai ? "default" : "secondary"} className="font-mono text-xs">
                {ai ? "On" : "Off"}
              </Badge>
            )}
          </div>
          <CardDescription>
            {ai
              ? `Leads are scored by Claude (${ai.model}).`
              : "Claude is off: leads are scored by the local model. To turn Claude on, set RECON_ENABLE_CLAUDE=1 and ANTHROPIC_API_KEY in .env.local, then restart RECON."}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* CRM */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="font-mono flex items-center gap-2">
              <Building2 className="w-4 h-4" /> CRM
            </CardTitle>
            <Badge variant={crmSet > 0 ? "default" : "secondary"} className="font-mono text-xs">
              {crmSet}/{CRM_KEYS.length} set
            </Badge>
          </div>
          <CardDescription>
            HubSpot or Salesforce account that qualified leads are pushed to from the Lead Qualifier.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-0">
          {loadError && <p className="text-xs text-destructive font-mono">Could not load the CRM settings: {loadError}</p>}
          {CRM_KEYS.map((def) => (
            <SecretRow
              key={def.key}
              def={def}
              savedAt={configs.get(def.key)?.updatedAt}
              onSave={saveCrmKey(def)}
              onRemove={removeCrmKey(def)}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
