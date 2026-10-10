import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";
import { captureCommand } from "@/lib/engine/terminal";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // hobby plan cap

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, command, agentName } = body as { projectId?: string; command?: string; agentName?: string };
    if (!projectId || !command || typeof command !== "string") {
      return NextResponse.json({ error: "projectId and command are required" }, { status: 400 });
    }
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const engine = getEngine();
    if (agentName) engine.setAttribution(projectId, agentName);

    // observe the run (never started automatically — explicit user/agent action)
    const result = await captureCommand(projectId, project.rootPath, command, agentName || "developer");

    // snapshot after the command completes (terminal-command trigger)
    const pending = engine.state.pending.get(projectId);
    if (pending && pending.size > 0) {
      await engine.flush(projectId);
    } else {
      const { emitEvent } = await import("@/lib/engine/events");
      // create a lightweight command snapshot for the history
      const snapshot = await db.snapshot.create({
        data: {
          projectId,
          type: "semantic",
          label: `Ran command: ${command.slice(0, 80)}`,
          summary: `Terminal command executed under observation.\nExit code: ${result.exitCode}${result.timedOut ? " (timed out)" : ""}`,
          agentName: agentName || "developer",
          tags: JSON.stringify(["command", result.exitCode === 0 ? "success" : "failure"]),
          filesChanged: 0,
          trigger: "command",
        },
      });
      emitEvent("snapshot", projectId, { id: snapshot.id, type: snapshot.type, label: snapshot.label, agentName: snapshot.agentName, filesChanged: 0, insertions: 0, deletions: 0 });
    }

    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Capture failed" }, { status: 400 });
  }
}
