import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getBlobs } from "@/lib/engine/store";
import { diffLines } from "diff";

export const dynamic = "force-dynamic";

type DiffPart = { type: "same" | "add" | "del"; text: string };

function sideBySide(before: string, after: string): { left: DiffPart[]; right: DiffPart[]; stats: { insertions: number; deletions: number } } {
  const parts = diffLines(before || "", after || "");
  const left: DiffPart[] = [];
  const right: DiffPart[] = [];
  let insertions = 0;
  let deletions = 0;
  for (const part of parts) {
    const lines = part.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    if (part.added) {
      insertions += lines.length;
      right.push({ type: "add", text: lines.join("\n") });
    } else if (part.removed) {
      deletions += lines.length;
      left.push({ type: "del", text: lines.join("\n") });
    } else {
      left.push({ type: "same", text: lines.join("\n") });
      right.push({ type: "same", text: lines.join("\n") });
    }
  }
  return { left, right, stats: { insertions, deletions } };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const snapshot = await db.snapshot.findUnique({ where: { id }, include: { files: true } });
  if (!snapshot) return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });

  const hashes = snapshot.files.flatMap((f) => [f.beforeHash, f.afterHash].filter(Boolean) as string[]);
  const blobs = await getBlobs(hashes);

  const files = snapshot.files.map((f) => {
    const before = f.beforeHash ? blobs.get(f.beforeHash) ?? null : null;
    const after = f.afterHash ? blobs.get(f.afterHash) ?? null : null;
    const diff = sideBySide(before ?? "", after ?? "");
    return {
      path: f.path,
      changeType: f.changeType,
      insertions: f.insertions,
      deletions: f.deletions,
      before,
      after,
      hasDiff: before != null || after != null,
    };
  });

  return NextResponse.json({
    snapshot: {
      id: snapshot.id,
      type: snapshot.type,
      label: snapshot.label,
      summary: snapshot.summary,
      agentName: snapshot.agentName,
      taskContext: snapshot.taskContext,
      tags: JSON.parse(snapshot.tags || "[]"),
      trigger: snapshot.trigger,
      filesChanged: snapshot.filesChanged,
      insertions: snapshot.insertions,
      deletions: snapshot.deletions,
      createdAt: snapshot.createdAt,
    },
    files,
  });
}
