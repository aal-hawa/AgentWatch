"use client";

// Timeline view: every change with agent, task, time, semantic summary + filters.

import { useState } from "react";
import { useAppStore, useApi, type EngineEvent } from "./core";
import { Badge, AgentBadge, EmptyHint, SectionTitle, timeAgo, SNAP_TYPE_STYLE } from "./shared";
import { SnapshotDetailSheet } from "./SnapshotDetailSheet";

type SnapshotRow = {
  id: string;
  type: string;
  label: string;
  summary: string;
  agentName: string;
  taskContext: string;
  tags: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  trigger: string;
  createdAt: string;
  files: { path: string; changeType: string; insertions: number; deletions: number }[];
};

const TYPES = ["all", "milestone", "semantic", "micro", "baseline", "manual"];

export function TimelineView({ events }: { events: EngineEvent[] }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const setOpenSnapshotId = useAppStore((s) => s.setOpenSnapshotId);
  const [type, setType] = useState("all");
  const [agent, setAgent] = useState("all");

  const url = activeProjectId ? `/api/timeline?projectId=${activeProjectId}&type=${type}&agent=${encodeURIComponent(agent)}` : null;
  const { data, loading } = useApi<{ snapshots: SnapshotRow[]; agents: string[] }>(url, refreshKey + events.length, 6000);

  if (!activeProjectId) return <EmptyHint title="No project selected" body="Select a project to see its change timeline." />;

  return (
    <div className="space-y-4">
      <SectionTitle right={<span className="text-[10px] text-zinc-500">{data?.snapshots.length ?? 0} checkpoints</span>}>
        Change timeline
      </SectionTitle>

      <div className="flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`rounded-full border px-3 py-1 text-[11px] transition ${
              type === t ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            {t}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-zinc-800" />
        <button
          onClick={() => setAgent("all")}
          className={`rounded-full border px-3 py-1 text-[11px] transition ${
            agent === "all" ? "border-violet-300/60 bg-violet-300/10 text-violet-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
          }`}
        >
          all agents
        </button>
        {(data?.agents || []).map((a) => (
          <button
            key={a}
            onClick={() => setAgent(a)}
            className={`rounded-full border px-3 py-1 text-[11px] transition ${
              agent === a ? "border-violet-300/60 bg-violet-300/10 text-violet-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-zinc-900" />)}</div>
      ) : !data || data.snapshots.length === 0 ? (
        <EmptyHint title="No checkpoints yet" body="When files in the watched project change, Agent Watch groups them into semantic snapshots here." />
      ) : (
        <div className="relative space-y-3 before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-zinc-800 pl-6">
          {data.snapshots.map((s) => {
            const style = SNAP_TYPE_STYLE[s.type] || SNAP_TYPE_STYLE.micro;
            const tags = safeTags(s.tags);
            return (
              <div key={s.id} className="aw-fade-up relative">
                <span className={`absolute -left-6 top-4 flex h-4 w-4 items-center justify-center rounded-full border bg-zinc-950 text-[9px] ${style.color}`}>
                  {style.icon}
                </span>
                <button
                  onClick={() => setOpenSnapshotId(s.id)}
                  className="aw-card-hover w-full rounded-xl border border-zinc-800 bg-card p-4 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-100">{s.label}</div>
                      {s.taskContext && <div className="mt-0.5 truncate text-[11px] text-violet-300/80">task: {s.taskContext}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[10px] text-zinc-500">{timeAgo(s.createdAt)}</div>
                      <Badge className={`mt-1 uppercase ${style.color}`}>{s.type}</Badge>
                    </div>
                  </div>
                  {s.summary && <div className="mt-2 line-clamp-2 whitespace-pre-line font-mono text-[11px] text-zinc-500">{s.summary}</div>}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <AgentBadge name={s.agentName} />
                    <Badge className="text-emerald-300 border-emerald-300/30">+{s.insertions}</Badge>
                    <Badge className="text-red-400 border-red-400/30">-{s.deletions}</Badge>
                    <Badge>{s.filesChanged} files</Badge>
                    {tags.map((t) => (
                      <Badge key={t} className="text-cyan-300 border-cyan-300/30">#{t}</Badge>
                    ))}
                  </div>
                  {s.files.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.files.slice(0, 5).map((f) => (
                        <span key={f.path} className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
                          {f.changeType === "add" ? "A" : f.changeType === "delete" ? "D" : "M"} {f.path}
                        </span>
                      ))}
                      {s.filesChanged > 5 && <span className="px-1 py-0.5 text-[10px] text-zinc-600">+{s.filesChanged - 5} more</span>}
                    </div>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <SnapshotDetailSheet />
    </div>
  );
}

function safeTags(json: string): string[] {
  try {
    return JSON.parse(json) as string[];
  } catch {
    return [];
  }
}
