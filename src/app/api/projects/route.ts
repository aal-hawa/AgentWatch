import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  await getEngine().ensureStarted();
  const projects = await db.project.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { snapshots: true, issues: true, symbols: true, fileStates: true } },
    },
  });
  const withStats = await Promise.all(
    projects.map(async (p) => {
      const [openIssues, criticalIssues, openErrors, recentSnapshot] = await Promise.all([
        db.issue.count({ where: { projectId: p.id } }),
        db.issue.count({ where: { projectId: p.id, severity: "critical" } }),
        db.errorEvent.count({ where: { projectId: p.id, status: { in: ["open", "recurring"] } } }),
        db.snapshot.findFirst({ where: { projectId: p.id }, orderBy: { createdAt: "desc" } }),
      ]);
      return {
        id: p.id,
        name: p.name,
        rootPath: p.rootPath,
        status: p.status,
        healthScore: p.healthScore,
        fileCount: p.fileCount,
        lastScanAt: p.lastScanAt,
        createdAt: p.createdAt,
        snapshotCount: p._count.snapshots,
        symbolCount: p._count.symbols,
        openIssues,
        criticalIssues,
        openErrors,
        lastActivity: recentSnapshot?.createdAt || p.lastScanAt || p.createdAt,
      };
    })
  );
  return NextResponse.json({ projects: withStats });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rootPath, name } = body as { rootPath?: string; name?: string };
    if (!rootPath || typeof rootPath !== "string") {
      return NextResponse.json({ error: "rootPath is required" }, { status: 400 });
    }
    const engine = getEngine();
    await engine.ensureStarted();
    const { id } = await engine.addProject(rootPath.trim(), name?.trim() || undefined);
    const project = await db.project.findUnique({ where: { id } });
    return NextResponse.json({ ok: true, project });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to add project" }, { status: 400 });
  }
}
