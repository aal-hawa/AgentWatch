// Event bus: in-memory ring buffer (polling fallback) + socket.io relay service.
import { io as ioClient } from "socket.io-client";

export type EngineEvent = {
  seq: number;
  type:
    | "snapshot"
    | "analysis"
    | "issue"
    | "error"
    | "log"
    | "plan"
    | "project"
    | "terminal"
    | "status";
  projectId?: string;
  payload?: unknown;
  at: string;
};

type EventBusState = {
  buffer: EngineEvent[];
  seq: number;
  socket: ReturnType<typeof ioClient> | null;
};

const g = globalThis as unknown as { __awEventBus?: EventBusState };
const state: EventBusState =
  g.__awEventBus ?? (g.__awEventBus = { buffer: [], seq: 0, socket: null });

const SOCKET_PORT = process.env.WS_PORT || "3003";

function relaySocket() {
  if (!state.socket) {
    try {
      // volatile: drop events if the relay is down instead of queueing forever
      const sock = ioClient(`http://127.0.0.1:${SOCKET_PORT}`, {
        path: "/",
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2000,
        timeout: 4000,
      });
      // silence client logs
      sock.on("connect_error", () => {});
      state.socket = sock;
    } catch {
      return null;
    }
  }
  return state.socket;
}

/** Fire an event: buffered for polling + pushed to socket relay (best-effort). */
export function emitEvent(type: EngineEvent["type"], projectId?: string, payload?: unknown) {
  const evt: EngineEvent = {
    seq: ++state.seq,
    type,
    projectId,
    payload,
    at: new Date().toISOString(),
  };
  state.buffer.push(evt);
  if (state.buffer.length > 300) state.buffer.shift();

  // best-effort relay to socket.io mini-service (drops silently if down)
  try {
    const sock = relaySocket();
    sock?.volatile.emit("engine-event", { type, projectId, payload });
  } catch {
    // ignore
  }

  return evt;
}

export function eventsSince(sinceSeq: number): EngineEvent[] {
  return state.buffer.filter((e) => e.seq > sinceSeq);
}

export function recentEvents(n = 50): EngineEvent[] {
  return state.buffer.slice(-n);
}
