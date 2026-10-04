import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const items = await db.planItem.findMany({
    where: { projectId },
    orderBy: [{ order: "asc" }, { confidence: "desc" }],
  });
  return NextResponse.json({ items });
}
