"use client";

// Snapshots & Restore panel: rollback files, modules, or entire checkpoints.

import { useState } from "react";
import { useAppStore, useApi, type EngineEvent } from "./core";
import { Badge, AgentBadge, EmptyHint, SectionTitle, timeAgo, SNAP_TYPE_STYLE } from "./shared";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

type SnapshotRow = {
  id: string; type: string; label: string; agentName: string; filesChanged: number;
  insertions: number; deletions: number; trigger: string; createdAt: string;
};

export function SnapshotsView({ events }: { events: EngineEvent[] }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const setOpenSnapshotId = useAppStore((s) => s.setOpenSnapshotId);
  const [restoreTarget, setRestoreTarget] = useState<SnapshotRow | null>(null);
  const { toast } = useToast();

  const url = activeProjectId ? `/api/timeline?projectId=${activeProjectId}&limit=100` : null;
  const { data, loading } = useApi<{ snapshots: SnapshotRow[] }>(url, refreshKey + events.length, 6000);

  const doRestore = async () => {
    if (!restoreTarget) return;
    const res = await fetch("/api/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshotId: restoreTarget.id }),
    });
    const json = await res.json();
    if (res.ok) {
      toast({ title: "Restore complete", description: `${json.restored?.length ?? 0} file(s) written back to the project.` });
      bumpRefresh();
    } else {
      toast({ title: "Restore failed", description: json.error, variant: "destructive" });
    }
    setRestoreTarget(null);
  };

  if (!activeProjectId) return <EmptyHint title="No project selected" body="Select a project to manage its snapshots." />;

  return (
    <div className="space-y-4">
      <SectionTitle right={<span className="text-[10px] text-zinc-500">every checkpoint is a rollback point</span>}>
        Snapshots & restore
      </SectionTitle>

      {loading && !data ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-zinc-900" />)}</div>
      ) : !data || data.snapshots.length === 0 ? (
        <EmptyHint title="No snapshots yet" body="Snapshots appear automatically as the project changes." />
      ) : (
        <div className="aw-scroll max-h-[66vh] space-y-2 overflow-y-auto pr-1">
          {data.snapshots.map((s) => {
            const style = SNAP_TYPE_STYLE[s.type] || SNAP_TYPE_STYLE.micro;
            return (
              <div key={s.id} className="aw-fade-up flex items-center gap-3 rounded-lg border border-zinc-800 bg-card px-4 py-3">
                <Badge className={`uppercase ${style.color}`}>{s.type}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-zinc-200">{s.label}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                    <AgentBadge name={s.agentName} />
                    <span>{s.filesChanged} files</span>
                    <span className="text-emerald-500/80">+{s.insertions}</span>
                    <span className="text-red-500/80">-{s.deletions}</span>
                    <span>· {timeAgo(s.createdAt)}</span>
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-[11px] text-zinc-400 hover:text-cyan-300" onClick={() => setOpenSnapshotId(s.id)}>
                  view diff
                </Button>
                <Button size="sm" variant="outline" className="h-7 border-zinc-700 text-[11px]" onClick={() => setRestoreTarget(s)}>
                  restore
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!restoreTarget} onOpenChange={(o) => !o && setRestoreTarget(null)}>
        <AlertDialogContent className="border-zinc-800 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-100">Restore this checkpoint?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-zinc-400">
                <p>
                  Files touched by <span className="text-cyan-300">{restoreTarget?.label}</span> will be written back to the project
                  ({restoreTarget?.filesChanged} files). Files deleted in this snapshot will be re-created from their previous content.
                </p>
                <p className="text-amber-300/90">This writes to the watched project — your only explicit write action. Everything stays reversible via newer snapshots.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-800 bg-transparent text-zinc-300">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doRestore()} className="bg-cyan-400/90 text-zinc-950 hover:bg-cyan-300">
              Restore checkpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
