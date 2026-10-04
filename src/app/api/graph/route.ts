import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const [deps, issues, symbols] = await Promise.all([
    db.dependency.findMany({ where: { projectId, external: false } }),
    db.issue.findMany({
      where: { projectId, kind: { in: ["broken-import", "orphan-file", "circular-dep"] } },
      select: { kind: true, filePath: true, relatedPaths: true },
    }),
    db.symbol.findMany({
      where: { projectId, kind: { in: ["function", "component", "arrow"] } },
      select: { filePath: true, name: true, callCount: true, isStub: true },
    }),
  ]);

  // collect local file nodes
  const nodeSet = new Set<string>();
  for (const d of deps) {
    nodeSet.add(d.fromPath);
    nodeSet.add(d.toPath);
  }
  for (const i of issues) {
    if (i.filePath) nodeSet.add(i.filePath);
    for (const p of JSON.parse(i.relatedPaths || "[]") as string[]) if (p) nodeSet.add(p);
  }

  const brokenFrom = new Map<string, number>();
  const orphanSet = new Set<string>();
  for (const i of issues) {
    if (i.kind === "broken-import" && i.filePath) brokenFrom.set(i.filePath, (brokenFrom.get(i.filePath) || 0) + 1);
    if (i.kind === "orphan-file" && i.filePath) orphanSet.add(i.filePath);
  }
  const cycleNodes = new Set<string>();
  for (const i of issues) {
    if (i.kind === "circular-dep") {
      for (const p of JSON.parse(i.relatedPaths || "[]") as string[]) cycleNodes.add(p);
    }
  }

  const nodes = [...nodeSet].map((p) => {
    const inbound = deps.filter((d) => d.toPath === p && d.resolved).length;
    const outbound = deps.filter((d) => d.fromPath === p).length;
    const symCount = symbols.filter((s) => s.filePath === p).length;
    const state = brokenFrom.get(p) ? "broken" : cycleNodes.has(p) ? "cycle" : orphanSet.has(p) ? "orphan" : "ok";
    return { id: p, inbound, outbound, symbolCount: symCount, state };
  });

  const links = deps.map((d) => ({
    source: d.fromPath,
    target: d.toPath,
    resolved: d.resolved,
    external: d.external,
  }));

  const cycles = issues
    .filter((i) => i.kind === "circular-dep")
    .map((i) => JSON.parse(i.relatedPaths || "[]") as string[]);

  return NextResponse.json({ nodes, links, cycles });
}
