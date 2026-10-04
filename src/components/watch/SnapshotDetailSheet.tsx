"use client";

// Snapshot detail sheet: file list + side-by-side diffs + per-file restore.
import { useState } from "react";
import { useAppStore, useApi } from "./core";
import { Badge, AgentBadge, SNAP_TYPE_STYLE, timeAgo } from "./shared";
import { DiffViewer } from "./DiffViewer";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

type Detail = {
  snapshot: {
    id: string; type: string; label: string; summary: string; agentName: string; taskContext: string;
    tags: string[]; trigger: string; filesChanged: number; insertions: number; deletions: number; createdAt: string;
  };
  files: { path: string; changeType: string; insertions: number; deletions: number; before: string | null; after: string | null; hasDiff: boolean }[];
};

export function SnapshotDetailSheet() {
  const openSnapshotId = useAppStore((s) => s.openSnapshotId);
  const setOpenSnapshotId = useAppStore((s) => s.setOpenSnapshotId);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const { toast } = useToast();

  const { data } = useApi<Detail>(openSnapshotId ? `/api/snapshots/${openSnapshotId}` : null, refreshKey);

  const handleRestore = async (paths?: string[]) => {
    if (!openSnapshotId) return;
    const res = await fetch("/api/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ snapshotId: openSnapshotId, paths }),
    });
    const json = await res.json();
    if (res.ok) {
      toast({ title: "Restore complete", description: `Restored ${json.restored?.length ?? 0} file(s)${json.failed?.length ? `, ${json.failed.length} failed` : ""}.` });
      bumpRefresh();
    } else {
      toast({ title: "Restore failed", description: json.error || "Unknown error", variant: "destructive" });
    }
  };

  const current = data?.files.find((f) => f.path === selectedFile) || data?.files[0];

  return (
    <Sheet open={!!openSnapshotId} onOpenChange={(o) => !o && setOpenSnapshotId(null)}>
      <SheetContent className="w-full max-w-4xl overflow-hidden border-zinc-800 bg-zinc-950 p-0 sm:max-w-4xl">
        {data ? (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-zinc-800 px-5 py-4">
              <div className="flex items-center gap-2">
                <Badge className={`uppercase ${SNAP_TYPE_STYLE[data.snapshot.type]?.color || ""}`}>{data.snapshot.type}</Badge>
                <span className="text-[10px] text-zinc-500">{timeAgo(data.snapshot.createdAt)} · via {data.snapshot.trigger}</span>
              </div>
              <SheetTitle className="mt-1 text-left text-base text-zinc-100">{data.snapshot.label}</SheetTitle>
              <SheetDescription asChild>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <AgentBadge name={data.snapshot.agentName} />
                  <Badge className="text-emerald-300 border-emerald-300/30">+{data.snapshot.insertions}</Badge>
                  <Badge className="text-red-400 border-red-400/30">-{data.snapshot.deletions}</Badge>
                  <Badge>{data.snapshot.filesChanged} files</Badge>
                  {data.snapshot.tags.map((t) => (
                    <Badge key={t} className="text-cyan-300 border-cyan-300/30">#{t}</Badge>
                  ))}
                  <Button size="sm" variant="outline" className="ml-auto h-7 border-zinc-700 text-xs" onClick={() => void handleRestore()}>
                    Restore all
                  </Button>
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="flex min-h-0 flex-1">
              {/* file list */}
              <ScrollArea className="w-60 shrink-0 border-r border-zinc-800">
                <div className="p-2">
                  {data.files.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => setSelectedFile(f.path)}
                      className={`mb-1 w-full rounded-md px-2 py-1.5 text-left transition ${
                        current?.path === f.path ? "bg-cyan-300/10 text-cyan-200" : "text-zinc-400 hover:bg-zinc-900"
                      }`}
                    >
                      <div className="truncate font-mono text-[11px]">{f.path}</div>
                      <div className="mt-0.5 flex items-center gap-1 text-[9px]">
                        <span className={f.changeType === "add" ? "text-emerald-400" : f.changeType === "delete" ? "text-red-400" : "text-amber-300"}>
                          {f.changeType.toUpperCase()}
                        </span>
                        <span className="text-emerald-500/70">+{f.insertions}</span>
                        <span className="text-red-500/70">-{f.deletions}</span>
                      </div>
                    </button>
                  ))}
                  {data.files.length === 0 && <div className="p-4 text-center text-[11px] text-zinc-500">No file changes in this snapshot.</div>}
                </div>
              </ScrollArea>

              {/* diff */}
              <ScrollArea className="min-w-0 flex-1">
                <div className="p-4">
                  {current && current.hasDiff ? (
                    <>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="font-mono text-xs text-zinc-300">{current.path}</span>
                        <Button size="sm" variant="outline" className="h-7 border-zinc-700 text-[11px]" onClick={() => void handleRestore([current.path])}>
                          Restore this file
                        </Button>
                      </div>
                      <DiffViewer before={current.before} after={current.after} height="h-[calc(100vh-260px)]" />
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                      {current ? "No content stored for this file (binary, too large, or deleted)." : "Select a file to view its diff."}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading snapshot…</div>
        )}
      </SheetContent>
    </Sheet>
  );
}
