"use client";

// Interactive dependency graph: hand-rolled force simulation on canvas.
// Files as nodes (sized by connectivity), imports as edges, color-coded states.

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore, useApi, type EngineEvent } from "./core";
import { Badge, EmptyHint, SectionTitle } from "./shared";

type GraphNode = {
  id: string; inbound: number; outbound: number; symbolCount: number; state: "ok" | "broken" | "cycle" | "orphan";
  // simulation fields
  x: number; y: number; vx: number; vy: number; fixed?: boolean;
};
type GraphLink = { source: string; target: string; resolved: boolean; external: boolean };
type GraphData = { nodes: GraphNode[]; links: GraphLink[]; cycles: string[][] };

const STATE_COLOR: Record<string, string> = {
  ok: "#22d3ee",
  broken: "#f87171",
  cycle: "#fbbf24",
  orphan: "#a78bfa",
};

export function GraphView({ events }: { events: EngineEvent[] }) {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const [showBrokenOnly, setShowBrokenOnly] = useState(false);
  const { data } = useApi<GraphData>(
    activeProjectId ? `/api/graph?projectId=${activeProjectId}` : null,
    refreshKey + Math.min(events.length, 3),
    10000
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<{ nodes: GraphNode[]; links: { s: number; t: number; resolved: boolean }[] }>({ nodes: [], links: [] });
  const viewRef = useRef({ panX: 0, panY: 0, zoom: 1 });
  const hoverRef = useRef<{ node: GraphNode | null; mx: number; my: number }>({ node: null, mx: 0, my: 0 });
  const [hoverInfo, setHoverInfo] = useState<{ node: GraphNode | null }>({ node: null });

  const filtered = useMemo(() => {
    if (!data) return null;
    if (!showBrokenOnly) return data;
    const keep = new Set<string>();
    for (const n of data.nodes) if (n.state !== "ok") keep.add(n.id);
    for (const l of data.links) {
      if (keep.has(l.source) || keep.has(l.target) || !l.resolved) {
        keep.add(l.source);
        keep.add(l.target);
      }
    }
    return {
      nodes: data.nodes.filter((n) => keep.has(n.id)),
      links: data.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
      cycles: data.cycles,
    };
  }, [data, showBrokenOnly]);

  // (re)build simulation when data changes
  useEffect(() => {
    if (!filtered) return;
    const W = wrapRef.current?.clientWidth || 900;
    const H = wrapRef.current?.clientHeight || 560;
    const nodes: GraphNode[] = filtered.nodes.map((n, i) => ({
      ...n,
      x: W / 2 + Math.cos((i / Math.max(1, filtered.nodes.length)) * Math.PI * 2) * (W / 3),
      y: H / 2 + Math.sin((i / Math.max(1, filtered.nodes.length)) * Math.PI * 2) * (H / 3),
      vx: 0,
      vy: 0,
    }));
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    const links = filtered.links
      .map((l) => ({ s: index.get(l.source) ?? -1, t: index.get(l.target) ?? -1, resolved: l.resolved }))
      .filter((l) => l.s >= 0 && l.t >= 0);
    simRef.current = { nodes, links };
    viewRef.current = { panX: 0, panY: 0, zoom: nodes.length > 40 ? 0.75 : 1 };
  }, [filtered]);

  // simulation + render loop
  useEffect(() => {
    let raf = 0;
    let running = true;
    const W = () => wrapRef.current?.clientWidth || 900;
    const H = () => wrapRef.current?.clientHeight || 560;

    const step = () => {
      if (!running) return;
      const { nodes, links } = simRef.current;
      const w = W();
      const h = H();

      // physics
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = Math.random() - 0.5;
            dy = Math.random() - 0.5;
            d2 = 1;
          }
          const repulse = 5200 / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * Math.min(repulse, 40);
          const fy = (dy / d) * Math.min(repulse, 40);
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }
      for (const l of links) {
        const a = nodes[l.s];
        const b = nodes[l.t];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const target = 110;
        const k = ((d - target) / d) * (l.resolved ? 0.02 : 0.002);
        a.vx += dx * k;
        a.vy += dy * k;
        b.vx -= dx * k;
        b.vy -= dy * k;
      }
      for (const n of nodes) {
        // center gravity
        n.vx += (w / 2 - n.x) * 0.0025;
        n.vy += (h / 2 - n.y) * 0.0025;
        if (!n.fixed) {
          n.vx *= 0.86;
          n.vy *= 0.86;
          n.x += Math.max(-6, Math.min(6, n.vx));
          n.y += Math.max(-6, Math.min(6, n.vy));
        } else {
          n.vx = 0;
          n.vy = 0;
        }
      }

      // render
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          canvas.style.width = `${w}px`;
          canvas.style.height = `${h}px`;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, w, h);
          const view = viewRef.current;
          ctx.save();
          ctx.translate(w / 2 + view.panX, h / 2 + view.panY);
          ctx.scale(view.zoom, view.zoom);
          ctx.translate(-w / 2, -h / 2);

          const hovered = hoverRef.current.node;
          const neighbors = new Set<string>();
          if (hovered) {
            neighbors.add(hovered.id);
            for (const l of simRef.current.links) {
              const s = simRef.current.nodes[l.s];
              const t = simRef.current.nodes[l.t];
              if (s.id === hovered.id) neighbors.add(t.id);
              if (t.id === hovered.id) neighbors.add(s.id);
            }
          }

          // links
          for (const l of simRef.current.links) {
            const a = simRef.current.nodes[l.s];
            const b = simRef.current.nodes[l.t];
            const dim = hovered && !(neighbors.has(a.id) && neighbors.has(b.id));
            ctx.strokeStyle = l.resolved ? `rgba(34,211,238,${dim ? 0.05 : 0.16})` : `rgba(248,113,113,${dim ? 0.08 : 0.5})`;
            ctx.lineWidth = 1;
            if (!l.resolved) ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            ctx.setLineDash([]);
          }

          // nodes
          for (const n of simRef.current.nodes) {
            const r = 5 + Math.min(14, (n.inbound + n.outbound) * 1.1);
            const color = STATE_COLOR[n.state] || "#22d3ee";
            const dim = hovered && !neighbors.has(n.id);
            ctx.globalAlpha = dim ? 0.18 : 1;

            if (n.state !== "ok") {
              ctx.shadowColor = color;
              ctx.shadowBlur = 12;
            }
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // ring for hovered
            if (hovered?.id === n.id) {
              ctx.strokeStyle = "#fff";
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(n.x, n.y, r + 3, 0, Math.PI * 2);
              ctx.stroke();
            }

            if (view.zoom > 1.15 || hovered?.id === n.id || simRef.current.nodes.length <= 26) {
              ctx.fillStyle = "rgba(228,228,231,0.85)";
              ctx.font = "10px 'Geist Mono', monospace";
              ctx.textAlign = "center";
              ctx.fillText(n.id.split("/").pop() || n.id, n.x, n.y + r + 12);
            }
            ctx.globalAlpha = 1;
          }
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  // interactions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const toWorld = (cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      const w = rect.width;
      const h = rect.height;
      return {
        x: (cx - rect.left - (w / 2 + view.panX)) / view.zoom + w / 2,
        y: (cy - rect.top - (h / 2 + view.panY)) / view.zoom + h / 2,
      };
    };
    const pick = (cx: number, cy: number): GraphNode | null => {
      const { x, y } = toWorld(cx, cy);
      for (const n of simRef.current.nodes) {
        const r = 5 + Math.min(14, (n.inbound + n.outbound) * 1.1) + 4;
        if (Math.hypot(n.x - x, n.y - y) <= r) return n;
      }
      return null;
    };

    let dragging: { kind: "canvas" | "node"; node?: GraphNode; lx: number; ly: number } | null = null;

    const onDown = (e: MouseEvent) => {
      const node = pick(e.clientX, e.clientY);
      dragging = { kind: node ? "node" : "canvas", node: node || undefined, lx: e.clientX, ly: e.clientY };
      if (node) node.fixed = true;
    };
    const onMove = (e: MouseEvent) => {
      const hovered = pick(e.clientX, e.clientY);
      hoverRef.current = { node: hovered, mx: e.clientX, my: e.clientY };
      if (hoverRef.current.node !== hoverInfo.node) setHoverInfo({ node: hovered });
      canvas.style.cursor = hovered ? "pointer" : "grab";
      if (!dragging) return;
      const view = viewRef.current;
      const dx = e.clientX - dragging.lx;
      const dy = e.clientY - dragging.ly;
      if (dragging.kind === "canvas") {
        view.panX += dx;
        view.panY += dy;
      } else if (dragging.node) {
        const { x, y } = toWorld(e.clientX, e.clientY);
        dragging.node.x = x;
        dragging.node.y = y;
      }
      dragging.lx = e.clientX;
      dragging.ly = e.clientY;
    };
    const onUp = () => {
      if (dragging?.node) dragging.node.fixed = false;
      dragging = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const view = viewRef.current;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      view.zoom = Math.max(0.3, Math.min(3, view.zoom * factor));
    };
    const onLeave = () => {
      hoverRef.current = { node: null, mx: 0, my: 0 };
      setHoverInfo({ node: null });
    };

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("mouseleave", onLeave);
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("mouseleave", onLeave);
    };
  }, [hoverInfo.node]);

  if (!activeProjectId) return <EmptyHint title="No project selected" body="Select a project to map its dependency graph." />;

  return (
    <div className="space-y-4">
      <SectionTitle
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBrokenOnly((v) => !v)}
              className={`rounded-full border px-3 py-1 text-[11px] transition ${
                showBrokenOnly ? "border-red-400/60 bg-red-400/10 text-red-300" : "border-zinc-800 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              problem paths only
            </button>
          </div>
        }
      >
        Dependency graph
      </SectionTitle>

      <div ref={wrapRef} className="relative h-[64vh] overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
        <canvas ref={canvasRef} className="absolute inset-0" />

        {/* legend */}
        <div className="absolute left-3 top-3 flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-950/85 p-2.5 text-[10px] text-zinc-400 backdrop-blur">
          {Object.entries(STATE_COLOR).map(([k, c]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: c, boxShadow: k !== "ok" ? `0 0 6px ${c}` : undefined }} />
              <span className="capitalize">{k === "ok" ? "healthy" : k}</span>
            </div>
          ))}
          <div className="mt-1 border-t border-zinc-800 pt-1 text-zinc-600">scroll = zoom · drag = pan</div>
        </div>

        {/* hover card */}
        {hoverInfo.node && (
          <div className="pointer-events-none absolute right-3 top-3 max-w-xs rounded-lg border border-zinc-700 bg-zinc-950/90 p-3 text-[11px] backdrop-blur">
            <div className="font-mono text-cyan-300">{hoverInfo.node.id}</div>
            <div className="mt-1.5 flex gap-1.5">
              <Badge>{hoverInfo.node.inbound} in</Badge>
              <Badge>{hoverInfo.node.outbound} out</Badge>
              <Badge>{hoverInfo.node.symbolCount} functions</Badge>
              {hoverInfo.node.state !== "ok" && <Badge className="border-red-400/40 text-red-300">{hoverInfo.node.state}</Badge>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
