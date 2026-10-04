"use client";

// Settings: branding (rename to YOUR name), intelligence provider, project management, agent API docs.

import { useState } from "react";
import { useAppStore, useApi } from "./core";
import { Badge, SectionTitle } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { BRAND } from "@/lib/brand.config";

type SettingsData = {
  settings: { provider: string; apiKey: string; baseUrl: string; model: string };
  brand: { name: string; tagline: string; author: string; version: string };
  capabilities: Record<string, string>;
};

type OllamaTest = { online: boolean; modelCount: number; resolved: string | null; models: string[] };

type ProjectRow = { id: string; name: string; rootPath: string; status: string; healthScore: number; fileCount: number };

export function SettingsView() {
  const refreshKey = useAppStore((s) => s.refreshKey);
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const { data } = useApi<SettingsData>("/api/settings", refreshKey);
  const { data: projects } = useApi<{ projects: ProjectRow[] }>("/api/projects", refreshKey, 10000);
  const { toast } = useToast();

  const [provider, setProvider] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");
  const [baseUrl, setBaseUrl] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const [removeTarget, setRemoveTarget] = useState<ProjectRow | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<OllamaTest | null>(null);

  if (data && !initialized) {
    setProvider(data.settings.provider);
    setApiKey(data.settings.apiKey);
    setBaseUrl(data.settings.baseUrl);
    setModel(data.settings.model);
    setInitialized(true);
  }

  const saveSettings = async () => {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, apiKey, baseUrl, model }),
    });
    if (res.ok) toast({ title: "Settings saved", description: `Intelligence provider: ${provider}` });
    else toast({ title: "Save failed", variant: "destructive" });
    bumpRefresh();
  };

  const testOllama = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ test: true, baseUrl: baseUrl || "http://localhost:11434", model }),
      });
      setTestResult((await res.json()) as OllamaTest);
    } catch {
      setTestResult({ online: false, modelCount: 0, resolved: null, models: [] });
    } finally {
      setTesting(false);
    }
  };

  const projectAction = async (id: string, action: string) => {
    await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    bumpRefresh();
  };

  const removeProject = async () => {
    if (!removeTarget) return;
    await fetch(`/api/projects/${removeTarget.id}`, { method: "DELETE" });
    toast({ title: "Project removed", description: `${removeTarget.name} and all its local analysis data were deleted.` });
    setRemoveTarget(null);
    bumpRefresh();
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {/* brand */}
      <div className="rounded-xl border border-zinc-800 bg-card p-5">
        <SectionTitle>Brand</SectionTitle>
        <div className="flex items-center gap-3">
          <div className="aw-glow flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/40 bg-cyan-300/10 text-lg font-bold text-cyan-300">
            {BRAND.name.slice(0, 1)}
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-100">{data?.brand.name || BRAND.name}</div>
            <div className="text-[11px] text-zinc-500">v{BRAND.version} · by {BRAND.author}</div>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-zinc-400">{BRAND.tagline}</p>
        <div className="mt-4 rounded-lg border border-violet-300/25 bg-violet-300/5 p-3">
          <div className="text-xs font-medium text-violet-200">Put YOUR name on it</div>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
            This project ships with a one-command rebrand. On your computer, run:
          </p>
          <code className="mt-1.5 block rounded bg-zinc-900 px-2 py-1.5 font-mono text-[11px] text-cyan-300">
            npm run rebrand -- &quot;Your Name&quot;
          </code>
          <p className="mt-1.5 text-[11px] text-zinc-500">
            It rewrites the product name across the UI, package.json, README and this config — your branding, everywhere.
          </p>
        </div>
      </div>

      {/* intelligence */}
      <div className="rounded-xl border border-zinc-800 bg-card p-5">
        <SectionTitle right={<Badge className="text-cyan-300 border-cyan-300/30">{data?.settings.provider || "ollama"}</Badge>}>
          Intelligence provider
        </SectionTitle>
        <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
          Uses your LOCAL Ollama models — nothing leaves this machine. Heuristics always work offline as a fallback.
        </p>
        <div className="space-y-3">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Provider</div>
            <Select value={provider} onValueChange={(v) => { setProvider(v); setTestResult(null); }}>
              <SelectTrigger className="border-zinc-800 bg-zinc-900 text-xs">
                <SelectValue placeholder="Choose provider" />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-950">
                <SelectItem value="ollama">Ollama — local models (recommended)</SelectItem>
                <SelectItem value="openai">OpenAI-compatible endpoint</SelectItem>
                <SelectItem value="heuristic">Built-in heuristics only (no LLM)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {provider === "ollama" && (
            <>
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Ollama URL</div>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434" className="border-zinc-800 bg-zinc-900 text-xs" />
              </div>
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Model (empty = auto-pick an installed one)</div>
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="auto — e.g. qwen2.5-coder:3b" className="border-zinc-800 bg-zinc-900 text-xs" />
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => void testOllama()} disabled={testing} className="border-zinc-700 text-zinc-200 hover:bg-zinc-800">
                  {testing ? "Testing…" : "Test Ollama connection"}
                </Button>
                {testResult && (
                  <Badge className={testResult.online && testResult.resolved ? "text-emerald-300 border-emerald-300/40" : "text-red-400 border-red-400/40"}>
                    {testResult.online && testResult.resolved ? `${testResult.modelCount} installed · using ${testResult.resolved}` : "Ollama not reachable"}
                  </Badge>
                )}
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-600">
                No models? Install one: <code className="text-cyan-300">ollama pull qwen2.5-coder:3b</code>
              </p>
            </>
          )}
          {provider === "openai" && (
            <>
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Base URL</div>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1 (or Ollama, LM Studio…)" className="border-zinc-800 bg-zinc-900 text-xs" />
              </div>
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">API key</div>
                <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" className="border-zinc-800 bg-zinc-900 text-xs" />
              </div>
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Model</div>
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" className="border-zinc-800 bg-zinc-900 text-xs" />
              </div>
            </>
          )}
          <Button onClick={() => void saveSettings()} className="bg-cyan-400/90 text-zinc-950 hover:bg-cyan-300">
            Save intelligence settings
          </Button>
        </div>
      </div>

      {/* projects */}
      <div className="rounded-xl border border-zinc-800 bg-card p-5">
        <SectionTitle>Monitored projects</SectionTitle>
        <div className="space-y-2">
          {(projects?.projects || []).map((p) => (
            <div key={p.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-zinc-200">{p.name}</div>
                <div className="truncate font-mono text-[10px] text-zinc-500">{p.rootPath}</div>
              </div>
              <Badge className={p.status === "active" ? "text-emerald-300 border-emerald-300/40" : "text-zinc-500"}>{p.status}</Badge>
              <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => void projectAction(p.id, "rescan")}>
                rescan
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => void projectAction(p.id, p.status === "active" ? "pause" : "resume")}>
                {p.status === "active" ? "pause" : "resume"}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[10px] text-red-400 hover:text-red-300" onClick={() => setRemoveTarget(p)}>
                remove
              </Button>
            </div>
          ))}
          {(!projects || projects.projects.length === 0) && <div className="py-4 text-center text-xs text-zinc-500">No projects monitored yet.</div>}
        </div>
      </div>

      {/* agent API */}
      <div className="rounded-xl border border-zinc-800 bg-card p-5">
        <SectionTitle right={<Badge className="text-violet-300 border-violet-300/30">read-only</Badge>}>Agent API</SectionTitle>
        <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
          The building agent (or any tool) can consume Agent Watch intelligence — via REST, JSON or Markdown. Perfect for MCP tools, CLIs and webhooks.
        </p>
        <div className="space-y-1.5 font-mono text-[11px]">
          {[
            ["GET", "/api/report?format=md", "full intelligence report (Markdown)"],
            ["GET", "/api/report?format=json", "machine-readable report"],
            ["GET", "/api/plan?projectId=…", "living project plan"],
            ["GET", "/api/graph?projectId=…", "dependency graph"],
            ["GET", "/api/functions?projectId=…", "function health"],
            ["GET", "/api/errors?projectId=…", "parsed errors + root causes"],
            ["POST", "/api/ingest", "push logs / declare agent presence"],
          ].map(([m, ep, desc]) => (
            <div key={ep} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
              <span className={`w-9 shrink-0 font-semibold ${m === "GET" ? "text-cyan-300" : "text-violet-300"}`}>{m}</span>
              <span className="shrink-0 text-zinc-300">{ep}</span>
              <span className="ml-auto truncate pl-2 font-sans text-[10px] text-zinc-600">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent className="border-zinc-800 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">Remove {removeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Stops watching and deletes all local analysis data (snapshots, symbols, errors). Files on disk are never touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-800 bg-transparent text-zinc-300">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeProject()} className="bg-red-400/90 text-zinc-950 hover:bg-red-300">
              Remove project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
