import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const filter = req.nextUrl.searchParams.get("filter") || "all";
  const search = (req.nextUrl.searchParams.get("search") || "").toLowerCase();

  const symbols = await db.symbol.findMany({
    where: { projectId },
    orderBy: [{ filePath: "asc" }, { startLine: "asc" }],
  });

  // duplicate groups
  const byHash = new Map<string, string[]>();
  for (const s of symbols) {
    if (!s.bodyHash) continue;
    byHash.set(s.bodyHash, [...(byHash.get(s.bodyHash) || []), s.id]);
  }
  const dupGroups: string[][] = [...byHash.values()].filter((ids) => ids.length > 1);
  const dupOf = new Map<string, number>();
  dupGroups.forEach((ids, idx) => {
    for (const id of ids) dupOf.set(id, idx + 1);
  });

  let enriched = symbols.map((s) => {
    const flags: string[] = [];
    if (s.isStub) flags.push("stub");
    if (s.hasTodo) flags.push("todo");
    if (!s.isExported && s.callCount === 0 && ["function", "method", "arrow", "component"].includes(s.kind)) flags.push("dead");
    if (s.isExported && s.callCount === 0 && ["function", "component"].includes(s.kind)) flags.push("no-callers");
    if (dupOf.has(s.id)) flags.push("duplicate");
    if (s.unusedParams > 0) flags.push("unused-param");
    if (!s.isTested && s.isExported && ["function", "component"].includes(s.kind)) flags.push("untested");
    const severity = flags.includes("stub") || flags.includes("dead") ? "warning" : flags.length ? "info" : "ok";
    return { ...s, flags, severity, dupGroup: dupOf.get(s.id) || null };
  });

  if (filter === "issues") enriched = enriched.filter((s) => s.flags.length > 0);
  else if (filter !== "all") enriched = enriched.filter((s) => s.flags.includes(filter));
  if (search) {
    enriched = enriched.filter(
      (s) => s.name.toLowerCase().includes(search) || s.filePath.toLowerCase().includes(search)
    );
  }

  const summary = {
    total: symbols.length,
    stubs: symbols.filter((s) => s.isStub).length,
    dead: symbols.filter((s) => !s.isExported && s.callCount === 0 && ["function", "method", "arrow", "component"].includes(s.kind)).length,
    duplicates: dupGroups.length,
    untested: symbols.filter((s) => s.isExported && !s.isTested && ["function", "component"].includes(s.kind)).length,
    withIssues: enriched.filter((s) => s.flags.length > 0).length,
  };

  return NextResponse.json({ symbols: enriched.slice(0, 800), summary });
}
