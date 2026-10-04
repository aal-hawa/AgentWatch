// Living Project Plan: derives plan items from real evidence in the project.
import { db } from "@/lib/db";

type PlanStatus = "completed" | "in-progress" | "blocked" | "missing" | "next";
type PlanCategory = "feature" | "fix" | "test" | "docs" | "refactor" | "risk" | "setup";

type NewPlanItem = {
  title: string;
  status: PlanStatus;
  category: PlanCategory;
  detail: string;
  evidence: string[];
  confidence: number;
  order: number;
};

export async function generatePlan(projectId: string): Promise<{ items: number }> {
  const [project, recentSnapshots, issues, openErrors, recentFiles] = await Promise.all([
    db.project.findUnique({ where: { id: projectId } }),
    db.snapshot.findMany({
      where: { projectId, type: { in: ["milestone", "semantic", "manual"] } },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    db.issue.findMany({ where: { projectId } }),
    db.errorEvent.findMany({ where: { projectId, status: { in: ["open", "recurring"] } }, orderBy: { lastSeenAt: "desc" }, take: 8 }),
    db.fileState.findMany({ where: { projectId, deleted: false }, orderBy: { updatedAt: "desc" }, take: 10 }),
  ]);
  if (!project) return { items: 0 };

  const items: NewPlanItem[] = [];
  const seen = new Set<string>();
  const push = (i: NewPlanItem) => {
    const key = i.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) return;
    seen.add(key);
    items.push(i);
  };

  const dayAgo = Date.now() - 24 * 3600 * 1000;

  // ---- blocked: critical issues ------------------------------------------
  for (const issue of issues.filter((i) => i.severity === "critical").slice(0, 6)) {
    push({
      title: `Fix: ${issue.title}`,
      status: "blocked",
      category: "risk",
      detail: `Detected by static analysis in ${issue.filePath || "project"}. This blocks a healthy build.`,
      evidence: issue.filePath ? [issue.filePath] : [],
      confidence: 90,
      order: 0,
    });
  }

  // ---- blocked: recurring errors ------------------------------------------
  for (const err of openErrors.filter((e) => e.status === "recurring").slice(0, 4)) {
    push({
      title: `Fix recurring error: ${err.message.slice(0, 90)}`,
      status: "blocked",
      category: "risk",
      detail: `Seen ${err.count}×. Root cause candidate: ${err.rootCause ? (JSON.parse(err.rootCause).label as string) : "unknown change"}.`,
      evidence: err.filePath ? [err.filePath] : [],
      confidence: 85,
      order: 1,
    });
  }

  // ---- missing: stubs + missing implementations ----------------------------
  for (const issue of issues.filter((i) => i.kind === "missing-impl").slice(0, 6)) {
    push({
      title: `Implement ${issue.symbolName || "missing function"}()`,
      status: "missing",
      category: "feature",
      detail: `${issue.symbolName || "A function"} is called in ${issue.filePath} but has no definition anywhere in the project.`,
      evidence: issue.filePath ? [issue.filePath] : [],
      confidence: 88,
      order: 2,
    });
  }
  for (const issue of issues.filter((i) => i.kind === "stub").slice(0, 6)) {
    push({
      title: `Complete stub: ${issue.symbolName || "function"}()`,
      status: "missing",
      category: "feature",
      detail: `The body of ${issue.symbolName || "this function"} in ${issue.filePath} is empty or a placeholder.`,
      evidence: issue.filePath ? [issue.filePath] : [],
      confidence: 82,
      order: 3,
    });
  }

  // ---- in progress / missing: TODO comments -------------------------------
  const todoIssues = issues.filter((i) => i.kind === "todo").slice(0, 10);
  for (const t of todoIssues) {
    const recentlyTouched = recentFiles.some((f) => f.path === t.filePath && f.updatedAt.getTime() > dayAgo);
    push({
      title: t.title.length > 90 ? `${t.title.slice(0, 87)}…` : t.title,
      status: recentlyTouched ? "in-progress" : "missing",
      category: /fix/i.test(t.title) ? "fix" : /doc/i.test(t.title) ? "docs" : "feature",
      detail: `Found as a code annotation in ${t.filePath}${t.detail ? ` (line ${JSON.parse(t.detail).line})` : ""}.`,
      evidence: t.filePath ? [t.filePath] : [],
      confidence: recentlyTouched ? 75 : 60,
      order: 4,
    });
  }

  // ---- in progress: recently modified files grouped by area ---------------
  const recentAreas = new Map<string, string[]>();
  for (const f of recentFiles.slice(0, 6)) {
    const area = f.path.split("/").slice(0, 2).join("/");
    recentAreas.set(area, [...(recentAreas.get(area) || []), f.path]);
  }
  for (const [area, files] of [...recentAreas.entries()].slice(0, 3)) {
    push({
      title: `Work in progress: ${area}`,
      status: "in-progress",
      category: "feature",
      detail: `Files were modified recently: ${files.slice(0, 3).join(", ")}`,
      evidence: files,
      confidence: 70,
      order: 5,
    });
  }

  // ---- next: untested critical areas ---------------------------------------
  const untestedIssues = issues.filter((i) => i.kind === "missing-tests").slice(0, 3);
  for (const u of untestedIssues) {
    const area = (u.filePath || "module").split("/").slice(0, 2).join("/");
    push({
      title: `Add tests for ${area}`,
      status: "next",
      category: "test",
      detail: `Exported functions in ${area} have no test coverage yet. Exported symbols like ${u.symbolName || "these"} should be covered.`,
      evidence: u.filePath ? [u.filePath] : [],
      confidence: 55,
      order: 6,
    });
  }

  // ---- next: dead code cleanup --------------------------------------------
  const deadCount = issues.filter((i) => i.kind === "dead-code").length;
  const dupCount = issues.filter((i) => i.kind === "duplicate").length;
  if (deadCount >= 2) {
    push({
      title: `Clean up ${deadCount} dead code paths`,
      status: "next",
      category: "refactor",
      detail: `${deadCount} functions are defined but never called. Removing them reduces bundle size and confusion.`,
      evidence: [],
      confidence: 50,
      order: 7,
    });
  }
  if (dupCount >= 1) {
    push({
      title: `Consolidate ${dupCount} duplicated implementation${dupCount > 1 ? "s" : ""}`,
      status: "next",
      category: "refactor",
      detail: "Multiple functions share identical or near-identical bodies. Extract them into a shared module.",
      evidence: [],
      confidence: 50,
      order: 8,
    });
  }

  // ---- completed: recent semantic snapshots --------------------------------
  for (const snap of recentSnapshots.slice(0, 6)) {
    push({
      title: snap.label.slice(0, 110),
      status: "completed",
      category: snap.type === "manual" ? "docs" : "feature",
      detail: `${snap.agentName} · ${snap.filesChanged} file(s) changed · ${snap.trigger}`,
      evidence: [],
      confidence: 95,
      order: 9,
    });
  }

  // ---- setup fallback for empty projects -----------------------------------
  if (items.length === 0) {
    push({
      title: "Monitor project activity",
      status: "next",
      category: "setup",
      detail: "No plan signals detected yet. As agents and developers make changes, the plan fills in automatically from TODOs, stubs, errors, and snapshots.",
      evidence: [],
      confidence: 40,
      order: 10,
    });
  }

  // ---- persist ----
  await db.planItem.deleteMany({ where: { projectId } });
  await db.planItem.createMany({
    data: items.map((i) => ({
      projectId,
      title: i.title,
      status: i.status,
      category: i.category,
      detail: i.detail,
      evidence: JSON.stringify(i.evidence),
      confidence: i.confidence,
      order: i.order,
    })),
  });
  return { items: items.length };
}
