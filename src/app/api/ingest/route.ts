import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";
import { ingestLog } from "@/lib/engine/terminal";

export const dynamic = "force-dynamic";

/**
 * Ingestion endpoint for external AI agents & tools.
 * Body: { projectId, agentName, taskContext?, logText?, message? }
 * Records agent attribution, optionally parses pushed terminal/console output.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, agentName, taskContext, logText, message } = body as {
      projectId?: string;
      agentName?: string;
      taskContext?: string;
      logText?: string;
      message?: string;
    };
    if (!projectId || !agentName) {
      return NextResponse.json({ error: "projectId and agentName are required" }, { status: 400 });
    }
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // register/refresh agent session
    await db.agentSession.upsert({
      where: { id: `${projectId}:${agentName}` },
      update: { lastActiveAt: new Date(), taskContext: taskContext || "" },
      create: { id: `${projectId}:${agentName}`, projectId, agentName, taskContext: taskContext || "" },
    }).catch(async () => {
      // id may not be deterministic — fallback to find+create
      const existing = await db.agentSession.findFirst({ where: { projectId, agentName } });
      if (existing) {
        await db.agentSession.update({ where: { id: existing.id }, data: { lastActiveAt: new Date(), taskContext: taskContext || "" } });
      } else {
        await db.agentSession.create({ data: { projectId, agentName, taskContext: taskContext || "" } });
      }
    });

    const engine = getEngine();
    engine.setAttribution(projectId, agentName, taskContext || "");

    let errorsFound = 0;
    const text = logText || message;
    if (text && typeof text === "string") {
      const res = await ingestLog(projectId, text, "ingested", agentName);
      errorsFound = res.errorsFound;
    }

    return NextResponse.json({ ok: true, errorsFound });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ingest failed" }, { status: 400 });
  }
}
