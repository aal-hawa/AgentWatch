"use client";

// Living Project Plan board: completed / in-progress / blocked / missing / next.

import { useAppStore, useApi, type EngineEvent } from "./core";
import { Badge, EmptyHint, SectionTitle } from "./shared";

type PlanItem = {
  id: string;
  title: string;
  status: string;
  category: string;
  detail: string;
  evidence: string;
  confidence: number;
  order: number;
  updatedAt: string;
};

const COLUMNS: { id: string; title: string; color: string; dot: string }[] = [
  { id: "blocked", title: "Blocked / Risk", color: "text-red-400", dot: "bg-red-400" },
  { id: "missing", title: "Missing pieces", color: "text-amber-300", dot: "bg-amber-300" },
  { id: "in-progress", title: "In progress", color: "text-cyan-300", dot: "bg-cyan-300" },
  { id: "next", title: "Expected next steps", color: "text-violet-300", dot: "bg-violet-300" },
  { id: "completed", title: "Completed", color: "text-emerald-300", dot: "bg-emerald-300" },
];

const CATEGORY_STYLE: Record<string, string> = {
  feature: "text-cyan-300 border-cyan-300/30",
  fix: "text-red-400 border-red-400/30",
  test: "text-emerald-300 border-emerald-300/30",
  docs: "text-zinc-300 border-zinc-500/30",
  refactor: "text-violet-300 border-violet-300/30",
  risk: "text-red-400 border-red-400/40",
  setup: "text-zinc-300 border-zinc-500/30",
};

export function PlanView({ events }: { events: EngineEvent[] }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const { data, loading } = useApi<{ items: PlanItem[] }>(activeProjectId ? `/api/plan?projectId=${activeProjectId}` : null, refreshKey + events.length, 8000);

  if (!activeProjectId) return <EmptyHint title="No project selected" body="Select a project to see its living plan." />;

  const items = data?.items || [];
  const byStatus = (status: string) => items.filter((i) => i.status === status);

  return (
    <div className="space-y-4">
      <SectionTitle right={<span className="text-[10px] text-zinc-500">derived live from code, TODOs, errors & snapshots</span>}>
        Living project plan
      </SectionTitle>

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">{[...Array(5)].map((_, i) => <div key={i} className="h-64 animate-pulse rounded-xl bg-zinc-900" />)}</div>
      ) : items.length === 0 ? (
        <EmptyHint title="Plan is empty" body="The plan fills in automatically as the project evolves — TODOs, stubs, errors and milestones all become plan items." />
      ) : (
        <div className="aw-scroll -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
          {COLUMNS.map((col) => {
            const colItems = byStatus(col.id);
            return (
              <div key={col.id} className="w-72 shrink-0 rounded-xl border border-zinc-800 bg-zinc-950/60">
                <div className="flex items-center gap-2 border-b border-zinc-800 px-3.5 py-2.5">
                  <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                  <span className={`text-xs font-semibold ${col.color}`}>{col.title}</span>
                  <span className="ml-auto rounded-md bg-zinc-900 px-1.5 text-[10px] tabular-nums text-zinc-500">{colItems.length}</span>
                </div>
                <div className="aw-scroll max-h-[62vh] space-y-2 overflow-y-auto p-2.5">
                  {colItems.length === 0 && <div className="py-6 text-center text-[11px] text-zinc-600">—</div>}
                  {colItems.map((item) => {
                    const evidence = safeArr(item.evidence);
                    return (
                      <div key={item.id} className="aw-fade-up aw-card-hover rounded-lg border border-zinc-800 bg-card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs font-medium leading-snug text-zinc-200">{item.title}</div>
                        </div>
                        {item.detail && <div className="mt-1.5 line-clamp-3 text-[10.5px] leading-relaxed text-zinc-500">{item.detail}</div>}
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          <Badge className={CATEGORY_STYLE[item.category] || ""}>{item.category}</Badge>
                          <div className="ml-auto flex items-center gap-1" title={`confidence ${item.confidence}%`}>
                            <div className="h-1 w-10 overflow-hidden rounded-full bg-zinc-800">
                              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400" style={{ width: `${item.confidence}%` }} />
                            </div>
                            <span className="text-[9px] tabular-nums text-zinc-600">{item.confidence}%</span>
                          </div>
                        </div>
                        {evidence.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {evidence.slice(0, 3).map((e) => (
                              <span key={e} className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[9.5px] text-zinc-500">{e}</span>
                            ))}
                            {evidence.length > 3 && <span className="text-[9.5px] text-zinc-600">+{evidence.length - 3}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function safeArr(json: string): string[] {
  try {
    return JSON.parse(json) as string[];
  } catch {
    return [];
  }
}
