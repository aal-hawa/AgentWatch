"use client";

import { useAppStore, useApi, type EngineEvent } from "./core";
import { HealthRing, StatTile, Badge, AgentBadge, SeverityDot, SectionTitle, EmptyHint, timeAgo, SEVERITY_STYLE } from "./shared";

type Overview = {
  project: { id: string; name: string; rootPath: string; status: string; healthScore: number; fileCount: number; lastScanAt: string | null };
  stats: {
    symbolCount: number;
    snapshotCount: number;
    issueBySeverity: Record<string, number>;
    issueByKind: Record<string, number>;
    planCounts: Record<string, number>;
  };
  recentSnapshots: { id: string; type: string; label: string; agentName: string; filesChanged: number; insertions: number; deletions: number; createdAt: string }[];
  recentErrors: { id: string; errorType: string; message: string; count: number; status: string; filePath: string | null; lastSeenAt: string }[];
  agents: { id: string; agentName: string; taskContext: string; lastActiveAt: string }[];
  activity24h: { createdAt: string; insertions: number; deletions: number }[];
};

const KIND_LABELS: Record<string, string> = {
  "broken-import": "Broken imports",
  "circular-dep": "Circular deps",
  "orphan-file": "Orphan files",
  "dead-code": "Dead code",
  duplicate: "Duplicates",
  "near-duplicate": "Near-duplicates",
  "missing-impl": "Missing impls",
  stub: "Stubs",
  "no-callers": "No callers",
  "missing-tests": "Untested exports",
  "unused-param": "Unused params",
  todo: "TODOs",
};

export function DashboardView({ events }: { events: EngineEvent[] }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const setView = useAppStore((s) => s.setView);
  const { data, loading } = useApi<Overview>(activeProjectId ? `/api/overview?projectId=${activeProjectId}` : null, refreshKey, 8000);

  if (!activeProjectId) {
    return <EmptyHint title="No project selected" body="Add or select a project from the top bar to start monitoring." />;
  }
  if (loading && !data) {
    return <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[...Array(4)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-zinc-900" />)}</div>;
  }
  if (!data) return <EmptyHint title="Could not load overview" body="The engine may still be scanning. Try again in a moment." />;

  const { project, stats, recentSnapshots, recentErrors, agents } = data;
  const critical = stats.issueBySeverity.critical || 0;
  const warnings = stats.issueBySeverity.warning || 0;
  const infos = stats.issueBySeverity.info || 0;
  const openIssues = critical + warnings + infos;

  const topKinds = Object.entries(stats.issueByKind)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const maxKind = topKinds[0]?.[1] || 1;

  const activityBuckets = (() => {
    const buckets = new Array(12).fill(0);
    const now = Date.now();
    for (const a of data.activity24h) {
      const hoursAgo = Math.floor((now - new Date(a.createdAt).getTime()) / 3600_000);
      if (hoursAgo < 12) buckets[11 - hoursAgo] += a.insertions + a.deletions;
    }
    return buckets;
  })();
  const maxBucket = Math.max(1, ...activityBuckets);

  return (
    <div className="space-y-6">
      {/* header row */}
      <div className="aw-fade-up grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="aw-card-hover rounded-xl border border-zinc-800 bg-card p-4">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Project health</div>
          <div className="mt-2 flex items-center gap-4">
            <HealthRing score={project.healthScore} size={84} />
            <div className="min-w-0 text-xs text-zinc-400">
              <div className="truncate font-medium text-zinc-200">{project.name}</div>
              <div className="mt-1 truncate text-[11px] text-zinc-500">{project.rootPath}</div>
              <div className="mt-2 flex gap-1.5">
                <Badge className={project.status === "active" ? "text-emerald-300 border-emerald-300/40 bg-emerald-300/10" : "text-zinc-400"}>{project.status}</Badge>
                <Badge>{project.fileCount} files</Badge>
              </div>
            </div>
          </div>
        </div>
        <StatTile label="Functions analyzed" value={stats.symbolCount} hint={`${stats.snapshotCount} snapshots saved`} accent="text-cyan-300" />
        <StatTile
          label="Open issues"
          value={openIssues}
          hint={`${critical} critical · ${warnings} warning · ${infos} info`}
          accent={critical ? "text-red-400" : openIssues ? "text-amber-300" : "text-emerald-300"}
        />
        <StatTile label="Open errors" value={recentErrors.length} hint="from terminal & console" accent={recentErrors.length ? "text-red-400" : "text-emerald-300"} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* issue breakdown */}
        <div className="aw-fade-up rounded-xl border border-zinc-800 bg-card p-5">
          <SectionTitle>Analysis signals</SectionTitle>
          {topKinds.length === 0 && <div className="py-6 text-center text-xs text-zinc-500">No issues detected — code looks healthy.</div>}
          <div className="space-y-2.5">
            {topKinds.map(([kind, count]) => (
              <button key={kind} onClick={() => setView("functions")} className="group w-full text-left">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 group-hover:text-cyan-300">{KIND_LABELS[kind] || kind}</span>
                  <span className="tabular-nums text-zinc-500">{count}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400"
                    style={{ width: `${Math.max(6, (count / maxKind) * 100)}%`, transition: "width 500ms ease" }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* 24h activity */}
        <div className="aw-fade-up rounded-xl border border-zinc-800 bg-card p-5">
          <SectionTitle right={<span className="text-[10px] text-zinc-500">last 12 hours</span>}>Change activity</SectionTitle>
          <div className="flex h-24 items-end gap-1.5">
            {activityBuckets.map((v, i) => (
              <div key={i} className="group relative flex-1">
                <div
                  className="w-full rounded-t bg-gradient-to-t from-cyan-500/40 to-cyan-300/80"
                  style={{ height: `${Math.max(3, (v / maxBucket) * 88)}px`, transition: "height 500ms ease" }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[9px] text-zinc-600">
            <span>-12h</span>
            <span>now</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
            <div className="rounded-lg border border-zinc-800 p-2">
              <span className="text-zinc-500">Plan: </span>
              {stats.planCounts.blocked ? <span className="text-red-400">{stats.planCounts.blocked} blocked</span> : null}
              {stats.planCounts["in-progress"] ? <span className="text-cyan-300"> {stats.planCounts["in-progress"]} active</span> : null}
              {!stats.planCounts.blocked && !stats.planCounts["in-progress"] ? <span>idle</span> : null}
            </div>
            <button className="rounded-lg border border-zinc-800 p-2 text-left hover:border-cyan-300/40" onClick={() => setView("plan")}>
              <span className="text-zinc-500">View </span>
              <span className="text-cyan-300">project plan →</span>
            </button>
          </div>
        </div>

        {/* agents */}
        <div className="aw-fade-up rounded-xl border border-zinc-800 bg-card p-5">
          <SectionTitle right={<span className="text-[10px] text-zinc-500">attribution</span>}>Active agents</SectionTitle>
          {agents.length === 0 ? (
            <div className="py-4 text-center text-xs text-zinc-500">
              No agents registered yet. Agents can report via <code className="text-cyan-300">POST /api/ingest</code>.
            </div>
          ) : (
            <div className="space-y-2">
              {agents.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                  <div className="min-w-0">
                    <AgentBadge name={a.agentName} />
                    {a.taskContext && <div className="mt-1 truncate text-[11px] text-zinc-500">{a.taskContext}</div>}
                  </div>
                  <span className="shrink-0 text-[10px] text-zinc-600">{timeAgo(a.lastActiveAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* recent snapshots */}
        <div className="aw-fade-up rounded-xl border border-zinc-800 bg-card p-5">
          <SectionTitle right={<button className="text-[11px] text-cyan-300 hover:underline" onClick={() => setView("timeline")}>full timeline →</button>}>
            Recent changes
          </SectionTitle>
          {recentSnapshots.length === 0 ? (
            <div className="py-6 text-center text-xs text-zinc-500">No changes observed yet. Edit a watched file and come back.</div>
          ) : (
            <div className="aw-scroll max-h-80 space-y-2 overflow-y-auto pr-1">
              {recentSnapshots.map((s) => (
                <div key={s.id} className="aw-card-hover rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-xs font-medium text-zinc-200">{s.label}</div>
                    <span className="shrink-0 text-[10px] text-zinc-600">{timeAgo(s.createdAt)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <AgentBadge name={s.agentName} />
                    <Badge className="text-emerald-300 border-emerald-300/30">+{s.insertions}</Badge>
                    <Badge className="text-red-400 border-red-400/30">-{s.deletions}</Badge>
                    <Badge>{s.filesChanged} files</Badge>
                    <Badge className="uppercase">{s.type}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* recent errors */}
        <div className="aw-fade-up rounded-xl border border-zinc-800 bg-card p-5">
          <SectionTitle right={<button className="text-[11px] text-cyan-300 hover:underline" onClick={() => setView("console")}>console →</button>}>
            Recent errors
          </SectionTitle>
          {recentErrors.length === 0 ? (
            <div className="py-6 text-center text-xs text-zinc-500">No errors captured. Clean runs.</div>
          ) : (
            <div className="aw-scroll max-h-80 space-y-2 overflow-y-auto pr-1">
              {recentErrors.map((e) => (
                <div key={e.id} className="rounded-lg border border-red-400/20 bg-red-400/5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-xs text-red-300">{e.message}</div>
                    {e.count > 1 && <Badge className="shrink-0 text-amber-300 border-amber-300/40">{e.count}×</Badge>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-zinc-500">
                    <Badge className="uppercase">{e.errorType}</Badge>
                    {e.filePath && <span className="truncate">{e.filePath}</span>}
                    <span className="ml-auto">{timeAgo(e.lastSeenAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
