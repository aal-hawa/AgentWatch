import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Machine-readable intelligence report for the REAL building agent or developer.
 * format=json (default) | md
 * This endpoint is read-only and safe to wire into MCP tools, CLI scripts, webhooks.
 */
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const format = (req.nextUrl.searchParams.get("format") || "json").toLowerCase();
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const [issues, errors, plan, snapshots, symbols, deps] = await Promise.all([
    db.issue.findMany({ where: { projectId }, orderBy: [{ severity: "asc" }, { kind: "asc" }] }),
    db.errorEvent.findMany({ where: { projectId, status: { in: ["open", "recurring"] } }, orderBy: { lastSeenAt: "desc" }, take: 15 }),
    db.planItem.findMany({ where: { projectId }, orderBy: [{ order: "asc" }, { confidence: "desc" }] }),
    db.snapshot.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 15 }),
    db.symbol.findMany({ where: { projectId, OR: [{ isStub: true }, { hasTodo: true }] }, take: 30 }),
    db.dependency.findMany({ where: { projectId, external: false, resolved: false } }),
  ]);

  const brokenImports = issues.filter((i) => i.kind === "broken-import");
  const duplicates = issues.filter((i) => i.kind === "duplicate" || i.kind === "near-duplicate");
  const dead = issues.filter((i) => i.kind === "dead-code");
  const missing = issues.filter((i) => i.kind === "missing-impl");

  const suggestedFocus: string[] = [];
  if (brokenImports.length) suggestedFocus.push(`Resolve ${brokenImports.length} broken import(s) before anything else — they break builds.`);
  if (errors.length) suggestedFocus.push(`Investigate the recurring error: "${errors[0].message.slice(0, 100)}"`);
  if (missing.length) suggestedFocus.push(`Implement ${missing.length} missing function(s): ${missing.slice(0, 3).map((m) => m.symbolName).filter(Boolean).join(", ")}.`);
  if (duplicates.length) suggestedFocus.push(`Consolidate ${duplicates.length} duplicate/near-duplicate implementations.`);
  if (!suggestedFocus.length) suggestedFocus.push("No critical signals — consider expanding test coverage and reducing dead code.");

  if (format === "md") {
    const md = [
      `# Agent Watch — Project Intelligence Report`,
      ``,
      `**Project:** ${project.name}  `,
      `**Root:** ${project.rootPath}  `,
      `**Health score:** ${project.healthScore}/100  `,
      `**Files watched:** ${project.fileCount}  `,
      `**Generated:** ${new Date().toISOString()}`,
      ``,
      `## Suggested focus`,
      ...suggestedFocus.map((s) => `- ${s}`),
      ``,
      `## Living project plan`,
      ...(["blocked", "missing", "in-progress", "next", "completed"].flatMap((status) => {
        const items = plan.filter((p) => p.status === status);
        if (!items.length) return [];
        return [`### ${status}`, ...items.map((i) => `- (${i.category}) ${i.title} — confidence ${i.confidence}%`), ``];
      })),
      `## Open errors (${errors.length})`,
      ...errors.map((e) => `- **${e.errorType}** ${e.message} ${e.filePath ? `(in \`${e.filePath}\`)` : ""} — seen ${e.count}×`),
      ``,
      `## Issues (${issues.length})`,
      ...(["critical", "warning", "info"].flatMap((sev) => {
        const items = issues.filter((i) => i.severity === sev);
        if (!items.length) return [];
        return [`### ${sev}`, ...items.slice(0, 40).map((i) => `- (${i.kind}) ${i.title}${i.filePath ? ` — \`${i.filePath}\`` : ""}`), ``];
      })),
      `## Recent checkpoints`,
      ...snapshots.map((s) => `- \`${s.type}\` ${s.label} — by ${s.agentName} at ${s.createdAt.toISOString()}`),
      ``,
      `## Stubs / TODO symbols`,
      ...symbols.map((s) => `- ${s.name}() in \`${s.filePath}\`:${s.startLine}${s.isStub ? " (stub)" : ""}${s.hasTodo ? " (has TODO)" : ""}`),
      ``,
      `## Unresolved imports`,
      ...deps.map((d) => `- \`${d.fromPath}\` → ${d.toPath}`),
    ].join("\n");
    return new NextResponse(md, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  }

  return NextResponse.json({
    project: {
      name: project.name,
      rootPath: project.rootPath,
      healthScore: project.healthScore,
      fileCount: project.fileCount,
      generatedAt: new Date().toISOString(),
    },
    suggestedFocus,
    plan: plan.map((p) => ({ title: p.title, status: p.status, category: p.category, confidence: p.confidence, detail: p.detail })),
    errors: errors.map((e) => ({ type: e.errorType, message: e.message, filePath: e.filePath, count: e.count, lastSeenAt: e.lastSeenAt, rootCause: e.rootCause ? JSON.parse(e.rootCause) : null })),
    issues: issues.map((i) => ({ kind: i.kind, severity: i.severity, title: i.title, filePath: i.filePath, symbol: i.symbolName })),
    recentCheckpoints: snapshots.map((s) => ({ id: s.id, type: s.type, label: s.label, agent: s.agentName, at: s.createdAt, files: s.filesChanged })),
    stubs: symbols.filter((s) => s.isStub).map((s) => ({ name: s.name, filePath: s.filePath, line: s.startLine })),
    todoSymbols: symbols.filter((s) => s.hasTodo && !s.isStub).map((s) => ({ name: s.name, filePath: s.filePath, line: s.startLine })),
    unresolvedImports: deps.map((d) => ({ from: d.fromPath, to: d.toPath })),
  });
}
