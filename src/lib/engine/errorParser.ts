// Parse terminal/console/build output into structured errors, link to root-cause snapshots.
import { db } from "@/lib/db";

export type ParsedError = {
  errorType: "typescript" | "module-not-found" | "syntax" | "stack" | "test-fail" | "warning" | "generic";
  message: string;
  filePath?: string;
  line?: number;
  stack: string[];
  raw: string;
};

const GLOBAL_NAMES = new Set([
  "console", "JSON", "Object", "Array", "String", "Number", "Promise", "Math", "Date",
  "process", "require", "window", "document", "fetch", "Buffer", "global", "globalThis",
  "undefined", "NaN", "Infinity", "Error", "TypeError", "RangeError", "SyntaxError",
  "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Reflect", "Proxy", "Intl", "URL",
  "URLSearchParams", "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "queueMicrotask", "structuredClone", "crypto", "localStorage", "sessionStorage",
  "FormData", "Headers", "Request", "Response", "AbortController", "Blob", "File",
  "FileReader", "WebSocket", "Worker", "CustomEvent", "Event", "Node", "Element",
  // value-level utils often treated as globals
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent",
  "encodeURI", "decodeURI", "btoa", "atob",
  // promise-executor pattern
  "resolve", "reject",
  // test runner globals
  "describe", "it", "test", "expect", "beforeEach", "afterEach", "beforeAll", "afterAll",
  "vi", "jest", "assert",
]);

export function isKnownGlobal(name: string): boolean {
  return GLOBAL_NAMES.has(name);
}

const TS_ERROR = /error\s+TS(\d+):\s*(.+?)(?:\r?\n|$)/gi;
const MODULE_NOT_FOUND = /(?:Module not found:\s*(?:Error:\s*)?(?:Can't resolve\s*)?['"]?([^'"\s]+)['"]?|Cannot find module\s+['"](.+?)['"]|Failed to resolve import\s+["'](.+?)["'])/gi;
const SYNTAX = /(?:SyntaxError|ParseError|Unexpected token|Unterminated|string literal)/i;
const TEST_FAIL = /(FAIL|✕|✗|AssertionError|expect\(.*\).*received|Test Suites?:\s*\d+ failed)/i;
const WARNING = /(?:^|\s)(?:warning|WARN)[^\n]*/gi;
const NODE_FRAME = /\(?([^()\s:]+\.(?:ts|tsx|js|jsx|mjs|cjs)):(\d+):(\d+)\)?/g;

/** Parse a chunk of terminal output into structured errors. */
export function parseLogChunk(text: string): ParsedError[] {
  const out: ParsedError[] = [];
  if (!text || text.length < 4) return out;

  // --- TypeScript errors -------------------------------------------------
  for (const m of text.matchAll(TS_ERROR)) {
    out.push({
      errorType: "typescript",
      message: `TS${m[1]}: ${m[2].trim().slice(0, 300)}`,
      stack: [],
      raw: m[0].slice(0, 1000),
    });
  }

  // --- Module not found --------------------------------------------------
  for (const m of text.matchAll(MODULE_NOT_FOUND)) {
    const spec = m[1] || m[2] || m[3];
    if (spec) {
      out.push({
        errorType: "module-not-found",
        message: `Cannot resolve module "${spec}"`,
        stack: [],
        raw: m[0].slice(0, 1000),
      });
    }
  }

  // --- Node-style stack traces (message line + frames) --------------------
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // error header line
    const header = /^(?:(?:npm ERR!|yarn error)\s*)?((?:[A-Za-z]+Error|Error|UnhandledPromiseRejection|FATAL|Segmentation fault)[:\s].{5,300})$/.exec(line.trim());
    if (header) {
      // collect following "at ..." frames
      const stack: string[] = [];
      let filePath: string | undefined;
      let lineNo: number | undefined;
      for (let j = i + 1; j < Math.min(i + 25, lines.length); j++) {
        const l = lines[j].trim();
        if (l.startsWith("at ") || /^\s*at\s/.test(lines[j])) {
          stack.push(l.slice(0, 200));
          NODE_FRAME.lastIndex = 0;
          const fm = NODE_FRAME.exec(l);
          if (fm && !filePath && !fm[1].includes("node_modules") && !fm[1].startsWith("node:")) {
            filePath = fm[1];
            lineNo = parseInt(fm[2], 10);
          }
        } else if (stack.length && !l) break;
      }
      const isSyntax = SYNTAX.test(line);
      out.push({
        errorType: isSyntax ? "syntax" : "stack",
        message: header[1].trim().slice(0, 300),
        filePath: filePath?.replace(/^file:\/\//, ""),
        line: lineNo,
        stack: stack.slice(0, 12),
        raw: lines.slice(i, i + stack.length + 1).join("\n").slice(0, 2000),
      });
    }
  }

  // --- Test failures ------------------------------------------------------
  for (const m of text.matchAll(/(FAIL[^\n]{0,200}|✕\s*[^\n]{0,200}|AssertionError[^\n]{0,200})/g)) {
    out.push({ errorType: "test-fail", message: m[1].trim().slice(0, 300), stack: [], raw: m[0] });
  }

  // --- Warnings (only meaningful ones) ------------------------------------
  if (/warning/i.test(text)) {
    for (const m of text.matchAll(WARNING)) {
      const w = m[0].trim();
      if (w.length > 15 && !w.includes("0 vulnerabilities") && out.length < 40) {
        out.push({ errorType: "warning", message: w.slice(0, 300), stack: [], raw: w });
      }
    }
  }

  // de-dup by message
  const seen = new Set<string>();
  return out.filter((e) => {
    const key = `${e.errorType}::${e.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Upsert parsed errors into DB, dedupe recurring ones, attach root-cause snapshot. */
export async function recordErrors(
  projectId: string,
  errors: ParsedError[],
  source: "terminal" | "ingested" | "console",
  agentName = "unknown"
): Promise<number> {
  let added = 0;
  for (const e of errors) {
    if (e.errorType === "warning" && !e.filePath) {
      // keep warnings but cap them — they are low value
    }
    const fingerprint = `${e.errorType}::${e.message.slice(0, 160)}::${e.filePath || ""}`;
    const existing = await db.errorEvent.findFirst({
      where: { projectId, status: { not: "resolved" }, AND: { rawText: { contains: e.raw.slice(0, 120) } } },
    });

    let matched = existing;
    if (!matched) {
      // fallback match by message prefix
      matched = await db.errorEvent.findFirst({
        where: {
          projectId,
          status: { not: "resolved" },
          message: { startsWith: e.message.slice(0, 120) },
        },
      });
    }

    if (matched) {
      await db.errorEvent.update({
        where: { id: matched.id },
        data: {
          count: { increment: 1 },
          status: "recurring",
          lastSeenAt: new Date(),
          agentName: agentName !== "unknown" ? agentName : matched.agentName,
        },
      });
    } else {
      const rootCause = await findRootCause(projectId, e.filePath);
      await db.errorEvent.create({
        data: {
          projectId,
          source,
          errorType: e.errorType,
          message: e.message.slice(0, 500),
          rawText: e.raw.slice(0, 4000),
          filePath: e.filePath,
          line: e.line,
          stack: JSON.stringify(e.stack),
          agentName,
          rootCause: rootCause ? JSON.stringify(rootCause) : null,
        },
      });
      added++;
    }
    void fingerprint;
  }
  return added;
}

/** Link an error to the most recent snapshot that touched the same file (or any snapshot). */
async function findRootCause(projectId: string, filePath?: string | null) {
  try {
    if (filePath) {
      const sf = await db.snapshotFile.findFirst({
        where: { snapshot: { projectId }, path: { contains: filePath.split("/").pop() || filePath } },
        orderBy: { snapshot: { createdAt: "desc" } },
        include: { snapshot: true },
      });
      if (sf) {
        return {
          snapshotId: sf.snapshotId,
          label: sf.snapshot.label,
          filePath: sf.path,
          agentName: sf.snapshot.agentName,
          at: sf.snapshot.createdAt,
        };
      }
    }
    const snap = await db.snapshot.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    if (snap) {
      return {
        snapshotId: snap.id,
        label: snap.label,
        filePath: null,
        agentName: snap.agentName,
        at: snap.createdAt,
      };
    }
  } catch {
    // ignore
  }
  return null;
}
