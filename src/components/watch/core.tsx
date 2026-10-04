"use client";

// App-wide client state (zustand) + data fetching/live hooks.

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

export type ViewId =
  | "dashboard"
  | "timeline"
  | "plan"
  | "graph"
  | "functions"
  | "console"
  | "snapshots"
  | "settings";

type AppState = {
  view: ViewId;
  setView: (v: ViewId) => void;
  projects: { id: string; name: string }[];
  setProjects: (p: { id: string; name: string }[]) => void;
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null | ((cur: string | null) => string | null)) => void;
  refreshKey: number;
  bumpRefresh: () => void;
  openSnapshotId: string | null;
  setOpenSnapshotId: (id: string | null) => void;
};

export const useAppStore = create<AppState>((set) => ({
  view: "dashboard",
  setView: (view) => set({ view }),
  projects: [],
  setProjects: (projects) => set({ projects }),
  activeProjectId: null,
  setActiveProjectId: (updater) =>
    set((s) => ({
      activeProjectId:
        typeof updater === "function"
          ? (updater as (cur: string | null) => string | null)(s.activeProjectId)
          : updater,
    })),
  refreshKey: 0,
  bumpRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
  openSnapshotId: null,
  setOpenSnapshotId: (openSnapshotId) => set({ openSnapshotId }),
}));

/** Tiny fetch hook with manual refresh + optional polling. */
export function useApi<T>(url: string | null, refreshKey = 0, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const firstRef = useRef(true);

  useEffect(() => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(url);
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) setError((json as { error?: string }).error || `HTTP ${res.status}`);
        else {
          setData(json as T);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "network error");
      } finally {
        if (alive) {
          setLoading(false);
          firstRef.current = false;
        }
      }
    };
    void load();
    let timer: ReturnType<typeof setInterval> | undefined;
    if (pollMs > 0) timer = setInterval(load, pollMs);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [url, refreshKey, pollMs]);

  return { data, error, loading, reload: () => setLoading(true) };
}

// ---------------------------------------------------------------------------
// Live events: socket.io with layered fallbacks (gateway → direct → polling)
// ---------------------------------------------------------------------------

export type EngineEvent = {
  seq?: number;
  type: string;
  projectId?: string;
  payload?: Record<string, unknown>;
  at: string;
};

export type LiveMode = "connecting" | "live" | "polling";

export function useLiveEvents(onEvent: (e: EngineEvent) => void) {
  const [mode, setMode] = useState<LiveMode>("connecting");
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    let disposed = false;
    let socket: { disconnect: () => void; on: (ev: string, cb: (...args: unknown[]) => void) => void } | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let lastSeq = -1;

    const startPolling = () => {
      if (disposed || pollTimer) return;
      setMode("polling");
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch(`/api/events?since=${lastSeq}`);
          const json = (await res.json()) as { events: EngineEvent[]; lastSeq: number };
          if (disposed) return;
          for (const e of json.events || []) handlerRef.current(e);
          lastSeq = json.lastSeq ?? lastSeq;
        } catch {
          // offline — keep trying
        }
      }, 3500);
    };

    const tryConnect = async () => {
      if (disposed) return;
      try {
        const { io } = await import("socket.io-client");
        if (disposed) return;

        const attempts: { url: string; opts: Record<string, unknown> }[] = [
          // 1) sandbox gateway style
          { url: "/?XTransformPort=3003", opts: { path: "/", timeout: 4000, transports: ["polling", "websocket"] } },
          // 2) direct local service (user's machine)
          { url: "http://localhost:3003", opts: { path: "/", timeout: 4000, transports: ["polling", "websocket"] } },
        ];

        for (const attempt of attempts) {
          if (disposed) return;
          const ok = await new Promise<boolean>((resolve) => {
            const s = io(attempt.url, attempt.opts as never);
            const to = setTimeout(() => {
              s.disconnect();
              resolve(false);
            }, 5000);
            s.on("connect", () => {
              clearTimeout(to);
              socket = s;
              resolve(true);
            });
            s.on("connect_error", () => {
              clearTimeout(to);
              s.disconnect();
              resolve(false);
            });
          });
          if (ok && socket && !disposed) {
            socket.on("engine-event", (raw: unknown) => {
              const e = raw as EngineEvent;
              handlerRef.current(e);
            });
            setMode("live");
            return;
          }
        }
        startPolling();
      } catch {
        startPolling();
      }
    };

    void tryConnect();

    return () => {
      disposed = true;
      if (pollTimer) clearInterval(pollTimer);
      socket?.disconnect();
    };
  }, []);

  return { mode };
}
