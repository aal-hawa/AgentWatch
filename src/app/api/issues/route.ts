import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const severity = req.nextUrl.searchParams.get("severity");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const issues = await db.issue.findMany({
    where: {
      projectId,
      ...(severity && severity !== "all" ? { severity } : {}),
    },
    orderBy: [{ severity: "asc" }, { detectedAt: "desc" }],
    take: 300,
  });
  return NextResponse.json({ issues });
}
