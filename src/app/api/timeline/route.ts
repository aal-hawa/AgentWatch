import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const type = req.nextUrl.searchParams.get("type");
  const agent = req.nextUrl.searchParams.get("agent");
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") || "50", 10) || 50, 200);
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const where = {
    projectId,
    ...(type && type !== "all" ? { type } : {}),
    ...(agent && agent !== "all" ? { agentName: agent } : {}),
  };
  const snapshots = await db.snapshot.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { files: { take: 12 } },
  });
  const agents = await db.snapshot.findMany({
    where: { projectId },
    distinct: ["agentName"],
    select: { agentName: true },
  });
  return NextResponse.json({ snapshots, agents: agents.map((a) => a.agentName) });
}
