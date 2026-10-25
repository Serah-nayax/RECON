import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { icpApi, type IcpConfig } from "@/lib/qualifyApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Save, RotateCcw, Plus, X, Target, ShieldCheck, ShieldX, BarChart3,
  Zap, Trash2, CheckCircle2, Map, FileText,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PROMPT_STARTER_TEMPLATE = `You qualify leads for [Your Company] — [brief description of your product/service] for [target customer type].

PRIMARY QUALIFIER — [Key criterion, e.g. fleet size, revenue, team size] is the deciding factor:
- QUALIFY if the [target] has [minimum threshold] AND [secondary condition]
- This applies regardless of [edge cases to include, e.g. venue type, industry segment]
- [Special case note, e.g. "Large operators with X attribute score higher even if Y"]

SCORE BANDS (all require [minimum threshold]):
- 90-100: [Description of ideal/top-tier customer — strongest signals]
- 80-89: [Description of strong fit customer]
- 70-79: [Description of good fit customer]
- 60-69: [Description of probable fit — verify before outreach]
- 40-59: [Description of uncertain — signals present but unconfirmed]

DISQUALIFY (score 0-20):
- [Disqualify condition 1]
- [Disqualify condition 2]
- [Disqualify condition 3]

IMPORTANT — Do NOT disqualify based on [common false negative, e.g. category alone]:
- A [edge case example 1] → QUALIFY if [condition]
- Only disqualify if evidence clearly shows [hard disqualify signal]

SIGNALS TO LOOK FOR (use all available evidence):
- Explicit mention: "[example signal 1]", "[example signal 2]"
- [Implied signal 1] → implies [qualification]
- [Implied signal 2] → implies [qualification]
- No [key signal] found → score conservatively ([score range]) if category fits

Based on the crawled website content provided, score this lead from 0-100 and explain your reasoning.

Return ONLY valid JSON with this exact structure:
{
  "score": <number 0-100>,
  "verdict": "QUALIFY" | "BORDERLINE" | "DISQUALIFY",
  "icpExplanation": "<2-3 sentence explanation of score and fit>",
  "keySignals": ["<signal found on website>", ...],
  "missingSignals": ["<signal looked for but not found>", ...],
  "recommendedAction": "<specific next action for sales team>"
}`;


type EditorTab = "overview" | "signals" | "bands" | "prompt";

function IcpEditor({
  icp,
  onSave,
  onActivate,
  onDelete,
  isSaving,
  isActivating,
  isDeleting,
}: {
  icp: IcpConfig;
  onSave: (data: Omit<IcpConfig, "id" | "isActive" | "createdAt" | "updatedAt">) => void;
  onActivate: () => void;
  onDelete: () => void;
  isSaving: boolean;
  isActivating: boolean;
  isDeleting: boolean;
}) {
  const [, navigate] = useLocation();
  const [form, setForm] = useState({
    name: icp.name,
    description: icp.description,
    systemPrompt: icp.systemPrompt,
    qualifySignals: [...icp.qualifySignals],
    disqualifySignals: [...icp.disqualifySignals],
    scoreBands: icp.scoreBands.map((b) => ({ ...b })),
  });
  const [activeTab, setActiveTab] = useState<EditorTab>("overview");
  const [showDelete, setShowDelete] = useState(false);
  const [showTemplateConfirm, setShowTemplateConfirm] = useState(false);

  const applyStarterTemplate = () => {
    if (form.systemPrompt.trim()) {
      setShowTemplateConfirm(true);
    } else {
      setForm({ ...form, systemPrompt: PROMPT_STARTER_TEMPLATE });
    }
  };

  const tabs = [
    { id: "overview" as EditorTab, label: "Overview", icon: Target },
    { id: "signals" as EditorTab, label: "Signals", icon: ShieldCheck },
    { id: "bands" as EditorTab, label: "Score Bands", icon: BarChart3 },
    { id: "prompt" as EditorTab, label: "AI Prompt", icon: ShieldX },
  ];

  const addSignal = (type: "qualifySignals" | "disqualifySignals") => {
    setForm({ ...form, [type]: [...form[type], ""] });
  };

  const updateSignal = (type: "qualifySignals" | "disqualifySignals", idx: number, val: string) => {
    const arr = [...form[type]];
    arr[idx] = val;
    setForm({ ...form, [type]: arr });
  };

  const removeSignal = (type: "qualifySignals" | "disqualifySignals", idx: number) => {
    setForm({ ...form, [type]: form[type].filter((_, i) => i !== idx) });
  };

  const updateBand = (idx: number, field: "band" | "range" | "description", val: string) => {
    const bands = form.scoreBands.map((b, i) => (i === idx ? { ...b, [field]: val } : b));
    setForm({ ...form, scoreBands: bands });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          {icp.isActive ? (
            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border font-mono text-xs">
              <CheckCircle2 className="h-3 w-3 mr-1" /> ACTIVE
            </Badge>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onActivate}
              disabled={isActivating}
              className="font-mono text-xs h-7"
            >
              {isActivating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
              SET ACTIVE
            </Button>
          )}
          <span className="text-xs text-muted-foreground font-mono">
            Updated {new Date(icp.updatedAt).toLocaleString()}
          </span>
        </div>
        <div className="flex gap-2">
          {icp.isActive && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/maps")}
              className="font-mono text-xs h-7 border-primary/30 text-primary hover:bg-primary/10"
            >
              <Map className="h-3 w-3 mr-1" /> Search Maps
            </Button>
          )}
          {!icp.isActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDelete(true)}
              disabled={isDeleting}
              className="font-mono text-xs h-7 text-destructive hover:text-destructive"
            >
              {isDeleting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
              DELETE
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => onSave(form)}
            disabled={isSaving}
            className="font-mono font-bold h-7"
          >
            {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
            SAVE
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-muted">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-mono font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-4">
          <Card className="border-muted/50 bg-card/50">
            <CardHeader>
              <CardTitle className="text-base">Profile Name</CardTitle>
              <CardDescription>A short label for this ICP (shown in batch reports).</CardDescription>
            </CardHeader>
            <CardContent>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. FEC Arcade Venues"
                className="bg-background/50 border-muted font-mono"
              />
            </CardContent>
          </Card>
          <Card className="border-muted/50 bg-card/50">
            <CardHeader>
              <CardTitle className="text-base">ICP Description</CardTitle>
              <CardDescription>Describe who you are selling to. Be specific — given to the AI for lead scoring.</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. We sell cashless payment solutions to family entertainment centers with 15+ arcade machines..."
                className="bg-background/50 border-muted min-h-[140px] resize-none"
              />
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "signals" && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="border-muted/50 bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Qualify Signals
              </CardTitle>
              <CardDescription>What signals on a website indicate a good lead.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {form.qualifySignals.map((signal, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={signal}
                    onChange={(e) => updateSignal("qualifySignals", i, e.target.value)}
                    className="bg-background/50 border-muted text-sm"
                    placeholder="e.g. Has redemption/prize counter"
                  />
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeSignal("qualifySignals", i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full font-mono text-xs mt-2" onClick={() => addSignal("qualifySignals")}>
                <Plus className="h-3 w-3 mr-1" /> ADD SIGNAL
              </Button>
            </CardContent>
          </Card>

          <Card className="border-muted/50 bg-card/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldX className="h-4 w-4 text-rose-500" />
                Disqualify Criteria
              </CardTitle>
              <CardDescription>Conditions that immediately disqualify a lead.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {form.disqualifySignals.map((signal, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={signal}
                    onChange={(e) => updateSignal("disqualifySignals", i, e.target.value)}
                    className="bg-background/50 border-muted text-sm"
                    placeholder="e.g. Solo operator with 1-2 machines"
                  />
                  <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeSignal("disqualifySignals", i)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-full font-mono text-xs mt-2" onClick={() => addSignal("disqualifySignals")}>
                <Plus className="h-3 w-3 mr-1" /> ADD CRITERIA
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "bands" && (
        <Card className="border-muted/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-base">Score Bands</CardTitle>
            <CardDescription>Define what each score range means for your qualification process.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {form.scoreBands.map((band, i) => (
              <div key={i} className="grid grid-cols-[100px_120px_1fr] gap-3 items-start">
                <div>
                  <p className="text-xs text-muted-foreground font-mono mb-1">RANGE</p>
                  <Input value={band.range} onChange={(e) => updateBand(i, "range", e.target.value)} className="bg-background/50 border-muted text-sm font-mono" placeholder="80-100" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-mono mb-1">LABEL</p>
                  <Input value={band.band} onChange={(e) => updateBand(i, "band", e.target.value)} className="bg-background/50 border-muted text-sm" placeholder="Strong Fit" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-mono mb-1">DESCRIPTION</p>
                  <Input value={band.description} onChange={(e) => updateBand(i, "description", e.target.value)} className="bg-background/50 border-muted text-sm" placeholder="What this score means..." />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {activeTab === "prompt" && (
        <Card className="border-muted/50 bg-card/50">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">AI System Prompt</CardTitle>
                <CardDescription>The full prompt sent to the AI for lead scoring.</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={applyStarterTemplate}
                className="font-mono text-xs h-7 shrink-0 border-primary/30 text-primary hover:bg-primary/10"
              >
                <FileText className="h-3 w-3 mr-1" />
                USE TEMPLATE
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              className="bg-background/50 border-muted font-mono text-xs min-h-[400px] resize-none leading-relaxed"
            />
          </CardContent>
        </Card>
      )}

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{icp.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This ICP profile will be permanently deleted. Any batches that used it will keep their snapshot.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showTemplateConfirm} onOpenChange={setShowTemplateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your current prompt?</AlertDialogTitle>
            <AlertDialogDescription>
              This will overwrite your existing AI prompt with the starter template. Your current prompt will be lost unless you've already saved it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep current prompt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setForm({ ...form, systemPrompt: PROMPT_STARTER_TEMPLATE });
                setShowTemplateConfirm(false);
              }}
            >
              Use template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function IcpSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["icps"],
    queryFn: icpApi.list,
  });

  const icps = data?.icps ?? [];
  const active = data?.active;
  const selectedIcp = icps.find((i) => i.id === selectedId) ?? active ?? icps[0] ?? null;

  const saveMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof icpApi.update>[1] }) =>
      icpApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["icps"] });
      toast({ title: "ICP saved" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const activateMutation = useMutation({
    mutationFn: icpApi.activate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["icps"] });
      toast({ title: "ICP activated", description: "This profile will be used for all new batches." });
    },
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: icpApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["icps"] });
      setSelectedId(null);
      toast({ title: "ICP deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const resetMutation = useMutation({
    mutationFn: icpApi.reset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["icps"] });
      toast({ title: "ICP reset to defaults" });
    },
    onError: (err: Error) => toast({ title: "Reset failed", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (name: string) =>
      icpApi.create({
        name,
        description: "",
        systemPrompt: "",
        qualifySignals: [],
        disqualifySignals: [],
        scoreBands: [],
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["icps"] });
      setSelectedId(created.id);
      setShowNewForm(false);
      setNewName("");
      toast({ title: "ICP created", description: "Fill in the details and save." });
    },
    onError: (err: Error) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-mono font-bold tracking-tight mb-2">ICP_LIBRARY</h1>
          <p className="text-muted-foreground">Manage your Ideal Customer Profiles. The active one is used for all lead scoring.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => resetMutation.mutate()}
            disabled={resetMutation.isPending}
            className="font-mono text-xs"
          >
            {resetMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCcw className="h-3 w-3 mr-1" />}
            RESET_DEFAULT
          </Button>
          <Button
            size="sm"
            onClick={() => setShowNewForm(true)}
            className="font-mono font-bold"
          >
            <Plus className="h-4 w-4 mr-1" />
            NEW_ICP
          </Button>
        </div>
      </div>

      {showNewForm && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">Create New ICP</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Enterprise SaaS, SMB Retail..."
              className="bg-background/50 border-muted font-mono"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newName.trim()) createMutation.mutate(newName.trim());
                if (e.key === "Escape") { setShowNewForm(false); setNewName(""); }
              }}
            />
            <Button
              onClick={() => newName.trim() && createMutation.mutate(newName.trim())}
              disabled={!newName.trim() || createMutation.isPending}
              className="font-mono shrink-0"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "CREATE"}
            </Button>
            <Button variant="ghost" onClick={() => { setShowNewForm(false); setNewName(""); }} className="shrink-0">
              <X className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-[240px_1fr] gap-6">
        <div className="space-y-1">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2 px-1">Profiles</p>
          {icps.map((icp) => (
            <button
              key={icp.id}
              onClick={() => setSelectedId(icp.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                selectedIcp?.id === icp.id
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-transparent bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{icp.name}</span>
                {icp.isActive && (
                  <span className="shrink-0 h-1.5 w-1.5 rounded-full bg-emerald-400" title="Active" />
                )}
              </div>
              <p className="text-xs text-muted-foreground/60 mt-0.5 font-mono">
                {new Date(icp.updatedAt).toLocaleDateString()}
              </p>
            </button>
          ))}
          {icps.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-4 text-center border border-dashed border-muted rounded-lg">
              No ICPs yet. Create one above.
            </p>
          )}
        </div>

        <div>
          {selectedIcp ? (
            <IcpEditor
              key={selectedIcp.id}
              icp={selectedIcp}
              onSave={(formData) => saveMutation.mutate({ id: selectedIcp.id, data: formData })}
              onActivate={() => activateMutation.mutate(selectedIcp.id)}
              onDelete={() => deleteMutation.mutate(selectedIcp.id)}
              isSaving={saveMutation.isPending}
              isActivating={activateMutation.isPending}
              isDeleting={deleteMutation.isPending}
            />
          ) : (
            <div className="flex items-center justify-center min-h-[200px] border border-dashed border-muted rounded-lg text-muted-foreground text-sm">
              Select an ICP profile to edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
