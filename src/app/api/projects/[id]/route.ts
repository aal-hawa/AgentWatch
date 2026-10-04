import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const action = (body as { action?: string }).action;
  const engine = getEngine();
  try {
    switch (action) {
      case "rescan":
        await engine.rescanProject(id);
        break;
      case "pause":
        await engine.pauseProject(id);
        break;
      case "resume":
        await engine.resumeProject(id);
        break;
      case "analyze":
        await engine.analyzeNow(id);
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    const project = await db.project.findUnique({ where: { id } });
    return NextResponse.json({ ok: true, project });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Action failed" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await getEngine().removeProject(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to remove" }, { status: 400 });
  }
}
