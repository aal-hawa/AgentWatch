"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppStore, useLiveEvents, type EngineEvent } from "@/components/watch/core";
import { BRAND } from "@/lib/brand.config";
import { Badge } from "@/components/watch/shared";
import { DashboardView } from "@/components/watch/DashboardView";
import { TimelineView } from "@/components/watch/TimelineView";
import { PlanView } from "@/components/watch/PlanView";
import { GraphView } from "@/components/watch/GraphView";
import { FunctionsView } from "@/components/watch/FunctionsView";
import { ConsoleView } from "@/components/watch/ConsoleView";
import { SnapshotsView } from "@/components/watch/SnapshotsView";
import { SettingsView } from "@/components/watch/SettingsView";
import { AddProjectDialog } from "@/components/watch/AddProjectDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "◧" },
  { id: "timeline", label: "Timeline", icon: "≡" },
  { id: "plan", label: "Project Plan", icon: "◈" },
  { id: "graph", label: "Dependencies", icon: "⬡" },
  { id: "functions", label: "Function Health", icon: "ƒ" },
  { id: "console", label: "Console & Errors", icon: "▸" },
  { id: "snapshots", label: "Snapshots & Restore", icon: "⏱" },
  { id: "settings", label: "Settings", icon: "⚙" },
] as const;

export default function Page() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const projects = useAppStore((s) => s.projects);
  const setProjects = useAppStore((s) => s.setProjects);
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId);
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const { toast } = useToast();

  const onEvent = useCallback(
    (e: EngineEvent) => {
      setEvents((prev) => [...prev.slice(-80), e]);
      if (e.type === "snapshot") {
        toast({
          title: "Checkpoint saved",
          description: String((e.payload as { label?: string })?.label || "Project changed"),
          duration: 3000,
        });
      }
      if (e.type === "error") {
        toast({ title: "Error detected", description: "New errors were parsed from the console.", duration: 3000 });
      }
      bumpRefresh();
    },
    [bumpRefresh, toast]
  );
  const { mode } = useLiveEvents(onEvent);

  // load project list
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/projects");
        const json = await res.json();
        const list = (json.projects || []) as { id: string; name: string }[];
        setProjects(list);
        setActiveProjectId((cur) => cur || list[0]?.id || null);
      } catch {
        // engine warming up
      }
    };
    void load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [setProjects, setActiveProjectId]);

  // show welcome if no projects after initial load
  useEffect(() => {
    const t = setTimeout(() => {
      if (projects.length === 0) setWelcomeOpen(true);
    }, 2500);
    return () => clearTimeout(t);
  }, [projects.length]);

  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* sidebar — Harbor H2: navy gradient, logo, pill nav */}
      <aside className="aw-sidebar hidden w-[264px] shrink-0 flex-col md:flex">
        <div className="px-4 pb-5 pt-6">
          <img src="/logo-320.png" alt={BRAND.name} width={152} height={152} className="aw-logo block w-[152px]" />
          <div className="mt-3 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8d99c8]">
            read-only observer
          </div>
        </div>
        <nav className="aw-scroll flex-1 space-y-1.5 overflow-y-auto px-3 py-2">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={cn("aw-nav-btn", view === item.id && "on")}
            >
              <span className={cn("w-4 text-center font-mono text-xs", view === item.id ? "opacity-100" : "opacity-70")}>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-3.5">
          <div className="aw-side-card p-4">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#a5b0e0]">
              Never touches your code
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-[#98a1c7]">
              Agent Watch only reads files and observes output. It writes nothing except when you explicitly restore a checkpoint.
            </p>
          </div>
        </div>
      </aside>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar — light, blurred */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-800/60 bg-background/80 px-5 backdrop-blur">
          <div className="flex items-center gap-2 md:hidden">
            <img src="/logo-320.png" alt="" width={28} height={28} className="h-7 w-7 rounded-[7px]" />
          </div>
          {/* mobile nav */}
          <div className="flex gap-1 overflow-x-auto md:hidden">
            {NAV.slice(0, 5).map((item) => (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px]",
                  view === item.id ? "bg-cyan-300/10 text-cyan-200" : "text-zinc-500"
                )}
              >
                {item.label.split(" ")[0]}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <select
              value={activeProjectId || ""}
              onChange={(e) => setActiveProjectId(e.target.value || null)}
              className="max-w-[220px] rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-cyan-300/50 focus:outline-none"
            >
              {projects.length === 0 && <option value="">no project</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <AddProjectDialog />
            <Badge
              className={cn(
                "gap-1.5",
                mode === "live" && "text-emerald-300 border-emerald-300/40",
                mode === "polling" && "text-amber-300 border-amber-300/40",
                mode === "connecting" && "text-zinc-500"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", mode === "live" ? "bg-emerald-400 aw-live-dot" : mode === "polling" ? "bg-amber-300" : "bg-zinc-600")} />
              {mode === "live" ? "live" : mode === "polling" ? "polling" : "connecting"}
            </Badge>
          </div>
        </header>

        {/* view title */}
        <div className="flex items-baseline gap-3 border-b border-zinc-800/60 px-6 py-3.5">
          <h1 className="text-lg font-semibold text-zinc-100">{NAV.find((n) => n.id === view)?.label}</h1>
          {activeProject && <span className="truncate font-mono text-[11px] text-zinc-600">{activeProject.rootPath}</span>}
        </div>

        {/* content */}
        <main className="aw-scroll min-h-0 flex-1 overflow-y-auto p-6">
          {view === "dashboard" && <DashboardView events={events} />}
          {view === "timeline" && <TimelineView events={events} />}
          {view === "plan" && <PlanView events={events} />}
          {view === "graph" && <GraphView events={events} />}
          {view === "functions" && <FunctionsView events={events} />}
          {view === "console" && <ConsoleView events={events} />}
          {view === "snapshots" && <SnapshotsView events={events} />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>

      {/* welcome dialog */}
      <Dialog open={welcomeOpen} onOpenChange={setWelcomeOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-zinc-100">
              <img src="/logo-320.png" alt="" width={36} height={36} className="aw-logo h-9 w-9" />
              Welcome to {BRAND.name}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-2 text-sm text-zinc-400">
                <p>
                  The read-only agent that watches, remembers, analyzes and maps everything your AI agents build — like Git, but with meaning.
                </p>
                <ul className="space-y-1.5 text-[13px]">
                  <li className="flex gap-2"><span className="text-cyan-300">◆</span> Auto-saves every meaningful change with semantic checkpoints</li>
                  <li className="flex gap-2"><span className="text-cyan-300">◈</span> Generates a living project plan from real evidence</li>
                  <li className="flex gap-2"><span className="text-cyan-300">⬡</span> Maps file & function relationships, finds duplicates and dead code</li>
                  <li className="flex gap-2"><span className="text-cyan-300">▸</span> Observes terminal output and links errors to the changes that caused them</li>
                </ul>
                <p className="text-[12px] text-zinc-500">
                  Add a project folder below (top bar → + Add project) and Agent Watch starts building its timeline, plan and maps from real activity.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <AddProjectDialog />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
