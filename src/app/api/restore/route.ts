import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** Restore files from a snapshot. Explicit user action only. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { snapshotId, paths } = body as { snapshotId?: string; paths?: string[] };
    if (!snapshotId) return NextResponse.json({ error: "snapshotId required" }, { status: 400 });
    const snap = await db.snapshot.findUnique({ where: { id: snapshotId } });
    if (!snap) return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    const result = await getEngine().restoreSnapshot(snap.projectId, snapshotId, paths);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Restore failed" }, { status: 400 });
  }
}
