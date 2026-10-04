import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

/** Read current file content for the code preview drawer (read-only). */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const filePath = req.nextUrl.searchParams.get("path");
  if (!projectId || !filePath) return NextResponse.json({ error: "projectId and path required" }, { status: 400 });

  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // security: only files inside the project root
  const abs = path.resolve(project.rootPath, filePath);
  if (!abs.startsWith(path.resolve(project.rootPath))) {
    return NextResponse.json({ error: "Path outside project root" }, { status: 403 });
  }

  try {
    const stat = fs.statSync(abs);
    if (stat.size > 512 * 1024) return NextResponse.json({ error: "File too large to preview" }, { status: 413 });
    const content = fs.readFileSync(abs, "utf8");
    return NextResponse.json({ path: filePath, content, size: stat.size });
  } catch {
    // fall back to last known blob
    const state = await db.fileState.findUnique({
      where: { projectId_path: { projectId, path: filePath } },
    });
    if (state?.hash) {
      const blob = await db.blob.findUnique({ where: { hash: state.hash } });
      if (blob) return NextResponse.json({ path: filePath, content: blob.content, size: blob.size, fromCache: true });
    }
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
