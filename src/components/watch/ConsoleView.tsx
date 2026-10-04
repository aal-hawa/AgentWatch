"use client";

// Console & Errors: captured terminal stream, command runner (observed), parsed errors with root-cause links.

import { useState } from "react";
import { useAppStore, useApi, type EngineEvent } from "./core";
import { Badge, EmptyHint, SectionTitle, timeAgo } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type LogRow = { id: string; source: string; command: string | null; stream: string; text: string; createdAt: string };
type ErrorRow = {
  id: string; errorType: string; message: string; filePath: string | null; line: number | null;
  count: number; status: string; agentName: string; rootCause: string | null; lastSeenAt: string; rawText: string;
};
type ErrorsResponse = { errors: ErrorRow[]; stats: { open: number; recurring: number; resolved: number } };

export function ConsoleView({ events }: { events: EngineEvent[] }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const { toast } = useToast();

  const logsUrl = activeProjectId ? `/api/logs?projectId=${activeProjectId}&limit=300` : null;
  const errorsUrl = activeProjectId ? `/api/errors?projectId=${activeProjectId}` : null;
  const { data: logs } = useApi<{ logs: LogRow[] }>(logsUrl, refreshKey + events.length, running ? 1500 : 4000);
  const { data: errors } = useApi<ErrorsResponse>(errorsUrl, refreshKey + events.length, 5000);

  const runCommand = async () => {
    if (!command.trim() || !activeProjectId || running) return;
    setRunning(true);
    try {
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: activeProjectId, command: command.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast({ title: "Capture failed", description: json.error, variant: "destructive" });
      } else {
        toast({
          title: `Command finished (exit ${json.result?.exitCode ?? "?"})`,
          description: json.result?.timedOut ? "The command timed out and was terminated." : "Output captured and scanned for errors.",
        });
        setCommand("");
        bumpRefresh();
      }
    } finally {
      setRunning(false);
    }
  };

  const resolveError = async (id: string) => {
    await fetch("/api/errors", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action: "resolve" }) });
    bumpRefresh();
  };

  if (!activeProjectId) return <EmptyHint title="No project selected" body="Select a project to view its console stream and parsed errors." />;

  const visibleErrors = (errors?.errors || []).filter((e) => (showResolved ? true : e.status !== "resolved"));

  return (
    <div className="space-y-4">
      <SectionTitle
        right={
          errors ? (
            <span className="flex gap-2 text-[10px] text-zinc-500">
              <span className="text-red-400">{errors.stats.open} open</span>
              <span className="text-amber-300">{errors.stats.recurring} recurring</span>
              <span className="text-emerald-300">{errors.stats.resolved} resolved</span>
            </span>
          ) : null
        }
      >
        Console & errors
      </SectionTitle>

      {/* command capture */}
      <div className="rounded-xl border border-zinc-800 bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 aw-live-dot" />
          Observed run — Agent Watch never starts builds on its own. You choose the command; it watches the output.
        </div>
        <div className="flex gap-2">
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runCommand()}
            placeholder="e.g. npm run build   ·   npm test   ·   node script.js"
            className="border-zinc-800 bg-zinc-900 font-mono text-xs"
            disabled={running}
          />
          <Button onClick={() => void runCommand()} disabled={running || !command.trim()} className="bg-cyan-400/90 text-zinc-950 hover:bg-cyan-300">
            {running ? "Capturing…" : "Run & capture"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* stream */}
        <div className="flex flex-col rounded-xl border border-zinc-800 bg-card">
          <div className="border-b border-zinc-800 px-4 py-2.5 text-[10px] uppercase tracking-wider text-zinc-500">Captured stream</div>
          <div className="aw-scroll h-[52vh] overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
            {!logs || logs.logs.length === 0 ? (
              <div className="flex h-full items-center justify-center text-zinc-600">No output captured yet.</div>
            ) : (
              logs.logs.map((l) => (
                <div
                  key={l.id}
                  className={`whitespace-pre-wrap break-all border-b border-zinc-900/60 py-1 ${
                    l.stream === "stderr" ? "text-red-300/90" : l.stream === "meta" ? "text-cyan-300/80" : "text-zinc-300"
                  }`}
                >
                  {l.text}
                </div>
              ))
            )}
          </div>
        </div>

        {/* parsed errors */}
        <div className="rounded-xl border border-zinc-800 bg-card">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Parsed errors</span>
            <button onClick={() => setShowResolved((v) => !v)} className="text-[10px] text-cyan-300 hover:underline">
              {showResolved ? "hide resolved" : "show resolved"}
            </button>
          </div>
          <div className="aw-scroll h-[52vh] space-y-2 overflow-y-auto p-3">
            {visibleErrors.length === 0 && <div className="flex h-full items-center justify-center text-xs text-zinc-600">No errors parsed. Clean signal.</div>}
            {visibleErrors.map((e) => {
              let cause: { label?: string; snapshotId?: string; filePath?: string } | null = null;
              try {
                cause = e.rootCause ? JSON.parse(e.rootCause) : null;
              } catch {
                cause = null;
              }
              return (
                <div key={e.id} className={`aw-fade-up rounded-lg border p-3 ${e.status === "resolved" ? "border-zinc-800 opacity-50" : "border-red-400/25 bg-red-400/5"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-xs text-red-300">{e.message}</div>
                    <div className="flex shrink-0 gap-1">
                      {e.count > 1 && <Badge className="text-amber-300 border-amber-300/40">{e.count}×</Badge>}
                      {e.status === "recurring" && <Badge className="text-red-400 border-red-400/40">recurring</Badge>}
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                    <Badge className="uppercase">{e.errorType}</Badge>
                    {e.filePath && <span className="truncate font-mono">{e.filePath}{e.line ? `:${e.line}` : ""}</span>}
                    <span className="ml-auto">{timeAgo(e.lastSeenAt)}</span>
                  </div>
                  {cause?.label && (
                    <div className="mt-2 rounded-md border border-amber-300/20 bg-amber-300/5 px-2.5 py-1.5 text-[10.5px] text-amber-200/90">
                      <span className="font-medium">Root cause candidate:</span> {cause.label}
                      {cause.filePath ? ` · touched ${cause.filePath}` : ""}
                    </div>
                  )}
                  {e.status !== "resolved" && (
                    <button onClick={() => void resolveError(e.id)} className="mt-2 text-[10px] text-zinc-500 hover:text-emerald-300">
                      mark resolved ✓
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
