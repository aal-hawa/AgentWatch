import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await getEngine().ensureStarted();
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const [issueBySeverity, issueByKind, snapshotCount, recentSnapshots, recentErrors, agents, planCounts, latestAnalysis] =
    await Promise.all([
      db.issue.groupBy({ by: ["severity"], where: { projectId }, _count: true }),
      db.issue.groupBy({ by: ["kind"], where: { projectId }, _count: true }),
      db.snapshot.count({ where: { projectId } }),
      db.snapshot.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 8 }),
      db.errorEvent.findMany({ where: { projectId, status: { in: ["open", "recurring"] } }, orderBy: { lastSeenAt: "desc" }, take: 6 }),
      db.agentSession.findMany({ where: { projectId }, orderBy: { lastActiveAt: "desc" }, take: 5 }),
      db.planItem.groupBy({ by: ["status"], where: { projectId }, _count: true }),
      db.symbol.aggregate({ where: { projectId }, _count: true }),
    ]);

  const timeline = await db.snapshot.findMany({
    where: { projectId, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, insertions: true, deletions: true },
  });

  return NextResponse.json({
    project: {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      status: project.status,
      healthScore: project.healthScore,
      fileCount: project.fileCount,
      lastScanAt: project.lastScanAt,
    },
    stats: {
      symbolCount: latestAnalysis._count,
      snapshotCount,
      issueBySeverity: Object.fromEntries(issueBySeverity.map((g) => [g.severity, g._count])),
      issueByKind: Object.fromEntries(issueByKind.map((g) => [g.kind, g._count])),
      planCounts: Object.fromEntries(planCounts.map((g) => [g.status, g._count])),
    },
    recentSnapshots,
    recentErrors,
    agents,
    activity24h: timeline,
  });
}
