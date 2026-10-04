"use client";

// Function health table: completeness, duplication, test status + source drawer.

import { useState } from "react";
import { useAppStore, useApi, type EngineEvent } from "./core";
import { Badge, EmptyHint, SectionTitle, FLAG_STYLE } from "./shared";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

type FnSymbol = {
  id: string; filePath: string; name: string; kind: string; isExported: boolean;
  startLine: number; endLine: number; paramCount: number; unusedParams: number;
  isStub: boolean; hasTodo: boolean; complexity: number; callCount: number; isTested: boolean;
  flags: string[]; severity: string; dupGroup: number | null;
};

type Response = {
  symbols: FnSymbol[];
  summary: { total: number; stubs: number; dead: number; duplicates: number; untested: number; withIssues: number };
};

const FILTERS = ["all", "issues", "stub", "dead", "duplicate", "untested", "todo"];

export function FunctionsView({ events }: { events: EngineEvent[] }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<FnSymbol | null>(null);

  const url = activeProjectId ? `/api/functions?projectId=${activeProjectId}&filter=${filter}&search=${encodeURIComponent(search)}` : null;
  const { data, loading } = useApi<Response>(url, refreshKey + Math.min(events.length, 3), 8000);

  if (!activeProjectId) return <EmptyHint title="No project selected" body="Select a project to inspect function health." />;

  return (
    <div className="space-y-4">
      <SectionTitle
        right={
          data ? (
            <span className="flex gap-2 text-[10px] text-zinc-500">
              <span>{data.summary.total} functions</span>
              <span className="text-amber-300">{data.summary.stubs} stubs</span>
              <span className="text-red-400">{data.summary.dead} dead</span>
              <span className="text-violet-300">{data.summary.duplicates} dup groups</span>
            </span>
          ) : null
        }
      >
        Function health
      </SectionTitle>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-[11px] capitalize transition ${
              filter === f ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-200" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            {f}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search functions or files…"
          className="ml-auto w-56 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-300/50 focus:outline-none"
        />
      </div>

      {loading && !data ? (
        <div className="h-72 animate-pulse rounded-xl bg-zinc-900" />
      ) : !data || data.symbols.length === 0 ? (
        <EmptyHint title="No functions found" body="The analyzer indexes JS/TS/JSX/TSX files. Add code to the watched project and it appears here." />
      ) : (
        <div className="aw-scroll max-h-[64vh] overflow-auto rounded-xl border border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur">
              <tr className="text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-2.5 font-medium">Function</th>
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-4 py-2.5 font-medium">Calls</th>
                <th className="px-4 py-2.5 font-medium">Complexity</th>
                <th className="px-4 py-2.5 font-medium">Signals</th>
              </tr>
            </thead>
            <tbody>
              {data.symbols.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setSelected(s)}
                  className="cursor-pointer border-t border-zinc-800/70 transition hover:bg-zinc-900/60"
                >
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-cyan-300">{s.name}()</span>
                    <span className="ml-2 text-[10px] text-zinc-600">{s.kind}</span>
                    {s.isExported && <span className="ml-1.5 rounded bg-violet-300/10 px-1 text-[9px] text-violet-300">export</span>}
                  </td>
                  <td className="max-w-[240px] px-4 py-2.5">
                    <span className="block truncate font-mono text-[10.5px] text-zinc-500">
                      {s.filePath}:{s.startLine}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-zinc-400">{s.callCount}</td>
                  <td className="px-4 py-2.5">
                    <span className={s.complexity > 8 ? "text-amber-300" : "text-zinc-400"}>{s.complexity}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {s.flags.length === 0 && <Badge className="text-emerald-300 border-emerald-300/30">ok</Badge>}
                      {s.flags.map((f) => (
                        <Badge key={f} className={FLAG_STYLE[f] || ""}>
                          {f}
                          {f === "duplicate" && s.dupGroup ? ` #${s.dupGroup}` : ""}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* source drawer */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full border-zinc-800 bg-zinc-950 p-0 sm:max-w-2xl">
          {selected && (
            <SourcePreview symbol={selected} onClose={() => setSelected(null)} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SourcePreview({ symbol }: { symbol: FnSymbol }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const { data } = useApi<{ content: string }>(
    activeProjectId ? `/api/source?projectId=${activeProjectId}&path=${encodeURIComponent(symbol.filePath)}` : null
  );
  const lines = (data?.content || "").split("\n");
  const from = Math.max(0, symbol.startLine - 6);
  const to = Math.min(lines.length, symbol.endLine + 4);
  const slice = lines.slice(from, to);

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="border-b border-zinc-800 px-5 py-4">
        <SheetTitle className="text-left font-mono text-sm text-cyan-300">
          {symbol.name}()
        </SheetTitle>
        <SheetDescription asChild>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] text-zinc-500">{symbol.filePath}:{symbol.startLine}-{symbol.endLine}</span>
            {symbol.flags.map((f) => (
              <Badge key={f} className={FLAG_STYLE[f] || ""}>{f}</Badge>
            ))}
          </div>
        </SheetDescription>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <pre className="aw-scroll p-4 font-mono text-[11px] leading-[1.6] text-zinc-300">
          {slice.map((line, i) => {
            const ln = from + i + 1;
            const inSymbol = ln >= symbol.startLine && ln <= symbol.endLine;
            return (
              <div key={i} className={`flex ${inSymbol ? "bg-cyan-300/5" : ""}`}>
                <span className="w-10 shrink-0 select-none pr-3 text-right text-zinc-700">{ln}</span>
                <span className={inSymbol ? "text-zinc-200" : "text-zinc-500"}>{line || " "}</span>
              </div>
            );
          })}
        </pre>
      </ScrollArea>
    </div>
  );
}
