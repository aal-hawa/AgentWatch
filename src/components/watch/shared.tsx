"use client";

// Shared UI atoms: badges, health ring, stat tiles, time formatting.

import { cn } from "@/lib/utils";

export function timeAgo(iso: string | Date): string {
  const then = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  const diff = Date.now() - then;
  if (diff < 15000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export const SEVERITY_STYLE: Record<string, string> = {
  critical: "text-red-400 border-red-400/40 bg-red-400/10",
  warning: "text-amber-300 border-amber-300/40 bg-amber-300/10",
  info: "text-cyan-300 border-cyan-300/40 bg-cyan-300/10",
  ok: "text-emerald-300 border-emerald-300/40 bg-emerald-300/10",
};

export const SNAP_TYPE_STYLE: Record<string, { color: string; icon: string }> = {
  baseline: { color: "text-violet-300 border-violet-300/40 bg-violet-300/10", icon: "◈" },
  micro: { color: "text-zinc-300 border-zinc-500/40 bg-zinc-500/10", icon: "•" },
  semantic: { color: "text-cyan-300 border-cyan-300/40 bg-cyan-300/10", icon: "◆" },
  milestone: { color: "text-violet-300 border-violet-300/40 bg-violet-300/10", icon: "✦" },
  error: { color: "text-red-400 border-red-400/40 bg-red-400/10", icon: "✖" },
  manual: { color: "text-emerald-300 border-emerald-300/40 bg-emerald-300/10", icon: "⏱" },
};

export const FLAG_STYLE: Record<string, string> = {
  stub: "text-amber-300 border-amber-300/40 bg-amber-300/10",
  todo: "text-cyan-300 border-cyan-300/40 bg-cyan-300/10",
  dead: "text-red-400 border-red-400/40 bg-red-400/10",
  duplicate: "text-violet-300 border-violet-300/40 bg-violet-300/10",
  "no-callers": "text-zinc-300 border-zinc-500/40 bg-zinc-500/10",
  "unused-param": "text-zinc-300 border-zinc-500/40 bg-zinc-500/10",
  untested: "text-zinc-300 border-zinc-500/40 bg-zinc-500/10",
};

export function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap",
        "border-zinc-700 bg-zinc-800/60 text-zinc-300",
        className
      )}
    >
      {children}
    </span>
  );
}

export function AgentBadge({ name }: { name: string }) {
  const isAgent = name !== "developer" && name !== "agent-watch" && name !== "unknown";
  return (
    <Badge className={isAgent ? "text-violet-300 border-violet-300/40 bg-violet-300/10" : ""}>
      <span className={cn("h-1.5 w-1.5 rounded-full", isAgent ? "bg-violet-400" : "bg-cyan-400")} />
      {name}
    </Badge>
  );
}

export function HealthRing({ score, size = 92 }: { score: number; size?: number }) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 80 ? "#34d399" : pct >= 55 ? "#22d3ee" : pct >= 30 ? "#fbbf24" : "#f87171";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="stroke-zinc-800" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          stroke={color}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: "stroke-dashoffset 700ms ease, stroke 400ms ease", filter: `drop-shadow(0 0 6px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-semibold tabular-nums" style={{ color }}>
          {pct}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-zinc-500">health</span>
      </div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: string;
}) {
  return (
    <div className="aw-card-hover rounded-xl border border-zinc-800 bg-card p-4">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", accent || "text-foreground")}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>}
    </div>
  );
}

export function SeverityDot({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-400",
    warning: "bg-amber-300",
    info: "bg-cyan-300",
    ok: "bg-emerald-300",
  };
  return <span className={cn("inline-block h-2 w-2 rounded-full", map[severity] || "bg-zinc-500")} />;
}

export function EmptyHint({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 p-10 text-center">
      <div className="text-sm font-medium text-zinc-300">{title}</div>
      <div className="mt-1 max-w-sm text-xs text-zinc-500">{body}</div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold tracking-wide text-zinc-200">{children}</h2>
      {right}
    </div>
  );
}
