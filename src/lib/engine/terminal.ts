// Terminal capture: user-initiated command runs observed by Agent Watch.
// Agent Watch never starts builds on its own — commands only run when the
// user/agent explicitly asks to capture a run. Output is recorded, parsed
// for errors, and linked to snapshots.
import { spawn } from "child_process";
import { db } from "@/lib/db";
import { ENGINE_CONFIG } from "./config";
import { parseLogChunk, recordErrors } from "./errorParser";
import { emitEvent } from "./events";

const g = globalThis as unknown as { __awRunningCommands?: Map<string, NodeJS.Timeout> };
const running = g.__awRunningCommands ?? (g.__awRunningCommands = new Map());

export type CaptureResult = {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

export async function captureCommand(
  projectId: string,
  rootPath: string,
  command: string,
  agentName = "developer"
): Promise<CaptureResult> {
  // guard: one command at a time per project (observer, not a job runner)
  if (running.has(projectId)) {
    throw new Error("A command capture is already running for this project");
  }

  const log = async (stream: "stdout" | "stderr" | "meta", text: string) => {
    if (!text) return;
    await db.terminalLog.create({ data: { projectId, source: "terminal", command, stream, text: text.slice(0, 20000) } });
    emitEvent("terminal", projectId, { stream, text: text.slice(0, 2000), command });
  };

  await log("meta", `$ ${command}\n`);

  return new Promise<CaptureResult>((resolve) => {
    // Windows has no bash — use cmd.exe; keep POSIX shells elsewhere
    const isWin = process.platform === "win32";
    const spawnCmd = isWin ? "cmd.exe" : "bash";
    const spawnArgs = isWin ? ["/d", "/s", "/c", command] : ["-lc", command];
    const child = spawn(spawnCmd, spawnArgs, {
      cwd: rootPath,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      detached: !isWin, // process groups are POSIX-only; Windows kills via child.kill
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, ENGINE_CONFIG.commandTimeoutMs);
    running.set(projectId, timeout);

    const handleChunk = async (stream: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (stream === "stdout") stdout = (stdout + text).slice(-ENGINE_CONFIG.maxTerminalBuffer);
      else stderr = (stderr + text).slice(-ENGINE_CONFIG.maxTerminalBuffer);
      await log(stream, text);
      // live error detection on streamed output
      const errors = parseLogChunk(text).filter((e) => e.errorType !== "warning");
      if (errors.length) {
        const added = await recordErrors(projectId, errors, "terminal", agentName);
        if (added > 0) emitEvent("error", projectId, { added, errors: errors.map((e) => e.message.slice(0, 120)) });
      }
    };

    child.stdout.on("data", (c: Buffer) => void handleChunk("stdout", c));
    child.stderr.on("data", (c: Buffer) => void handleChunk("stderr", c));

    const finish = async (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      running.delete(projectId);
      const meta = timedOut
        ? `\n[agent-watch] command timed out after ${ENGINE_CONFIG.commandTimeoutMs / 1000}s and was terminated\n`
        : `\n[agent-watch] exit code: ${code}\n`;
      await log("meta", meta);
      emitEvent("terminal", projectId, { done: true, exitCode: code, timedOut });
      resolve({ exitCode: code, timedOut, stdout, stderr });
    };

    child.on("close", (code) => void finish(code));
    child.on("error", (err) => {
      void log("stderr", `[agent-watch] failed to start: ${err.message}\n`);
      void finish(-1);
    });
  });
}

/** Ingest external log text (from an agent or CI webhook). */
export async function ingestLog(
  projectId: string,
  text: string,
  source: "ingested" | "console" = "ingested",
  agentName = "unknown"
): Promise<{ errorsFound: number }> {
  await db.terminalLog.create({ data: { projectId, source, command: null, stream: source === "console" ? "stdout" : "stderr", text: text.slice(0, 20000) } });
  emitEvent("log", projectId, { text: text.slice(0, 1000) });
  const errors = parseLogChunk(text);
  const added = await recordErrors(projectId, errors, source, agentName);
  if (added > 0) emitEvent("error", projectId, { added, errors: errors.map((e) => e.message.slice(0, 120)) });
  return { errorsFound: added };
}
