import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const errors = await db.errorEvent.findMany({
    where: { projectId },
    orderBy: { lastSeenAt: "desc" },
    take: 100,
  });
  const open = errors.filter((e) => e.status !== "resolved");
  return NextResponse.json({
    errors,
    stats: {
      open: open.filter((e) => e.status === "open").length,
      recurring: open.filter((e) => e.status === "recurring").length,
      resolved: errors.length - open.length,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { id, action } = body as { id?: string; action?: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (action === "resolve") {
    await db.errorEvent.update({ where: { id }, data: { status: "resolved" } });
  } else if (action === "reopen") {
    await db.errorEvent.update({ where: { id }, data: { status: "open" } });
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
