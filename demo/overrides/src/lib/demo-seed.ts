// Demo data seeder — hosted AgentWatch demo (testing only).
//
// Runs ONLY on the serverless deployment (called from the demo instrumentation
// override) right after the ephemeral SQLite schema is created. It seeds two
// realistic sample projects so visitors can explore the dashboard, timeline,
// functions, plan and issues views without adding a local folder.
//
// - The local (localhost) app NEVER runs this file — the main source tree is
//   untouched and keeps working exactly as before.
// - Idempotent: if the database already has projects, it does nothing.
// - Timestamps are relative to "now" so the 24h activity chart always has data.
import { db } from "@/lib/db";

const MIN = 60_000;
const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);

type SeedFile = { path: string; changeType: string; insertions?: number; deletions?: number };
type SeedSnapshot = {
  type: string; label: string; summary: string; agentName: string; taskContext?: string;
  tags?: string; filesChanged: number; insertions: number; deletions: number;
  trigger: string; createdAt: Date; files?: SeedFile[];
};

async function seedSnapshots(projectId: string, snapshots: SeedSnapshot[]) {
  for (const s of snapshots) {
    await db.snapshot.create({
      data: {
        projectId, type: s.type, label: s.label, summary: s.summary,
        agentName: s.agentName, taskContext: s.taskContext || "", tags: s.tags || "[]",
        filesChanged: s.filesChanged, insertions: s.insertions, deletions: s.deletions,
        trigger: s.trigger, createdAt: s.createdAt,
        files: { create: (s.files || []).map((f) => ({
          path: f.path, changeType: f.changeType, insertions: f.insertions ?? 0, deletions: f.deletions ?? 0,
        })) },
      },
    });
  }
}

export async function seedDemoData(): Promise<void> {
  const existing = await db.project.count();
  if (existing > 0) return;

  console.log("[agent-watch] seeding demo projects …");

  // ------------------------------------------------------------------
  // Demo project 1 — "task-api": mid-refactor backend with an open error
  // ------------------------------------------------------------------
  const taskApi = await db.project.create({
    data: {
      id: "demo-task-api",
      name: "task-api",
      rootPath: "C:\\Users\\demo\\projects\\task-api",
      status: "active",
      healthScore: 82,
      fileCount: 38,
      lastScanAt: ago(20),
      createdAt: ago(60 * 24 * 9),
    },
  });

  await seedSnapshots(taskApi.id, [
    { type: "baseline", label: "Baseline scan — 38 files indexed", summary: "Initial observation of the repository. Express + TypeScript service, 38 source files, ~4,210 lines.", agentName: "developer", tags: JSON.stringify(["baseline"]), filesChanged: 38, insertions: 4210, deletions: 0, trigger: "scan", createdAt: ago(720) },
    { type: "semantic", label: "Add JWT auth to login route", summary: "Introduced jsonwebtoken-based login and refresh tokens. Auth middleware added to protected routes.", agentName: "claude-code", taskContext: "implement authentication", tags: JSON.stringify(["auth", "api", "feature"]), filesChanged: 3, insertions: 112, deletions: 18, trigger: "debounce", createdAt: ago(540), files: [
      { path: "src/routes/auth.ts", changeType: "add", insertions: 74 },
      { path: "src/middleware/auth.ts", changeType: "add", insertions: 31 },
      { path: "src/server.ts", changeType: "modify", insertions: 7, deletions: 18 },
    ] },
    { type: "semantic", label: "Refactor task pagination to cursor-based", summary: "Replaced offset pagination with cursor pagination on GET /api/tasks. Page size capped at 50.", agentName: "claude-code", taskContext: "implement authentication", tags: JSON.stringify(["refactor", "api"]), filesChanged: 2, insertions: 86, deletions: 64, trigger: "debounce", createdAt: ago(420), files: [
      { path: "src/routes/tasks.ts", changeType: "modify", insertions: 52, deletions: 41 },
      { path: "src/services/task.service.ts", changeType: "modify", insertions: 34, deletions: 23 },
    ] },
    { type: "error", label: "Fix TypeError: cannot read 'dueDate' of undefined", summary: "Crash in the dueDate filter when a task had no due date. Guarded with optional chaining and a zod schema.", agentName: "developer", tags: JSON.stringify(["fix", "error"]), filesChanged: 1, insertions: 9, deletions: 3, trigger: "error", createdAt: ago(300), files: [
      { path: "src/services/task.service.ts", changeType: "modify", insertions: 9, deletions: 3 },
    ] },
    { type: "semantic", label: "Add integration tests for the auth flow", summary: "Supertest suite covering login, refresh and 401 paths. 12 passing, 1 known failure on rate limiting.", agentName: "cursor", taskContext: "write auth tests", tags: JSON.stringify(["test", "auth"]), filesChanged: 2, insertions: 140, deletions: 2, trigger: "command", createdAt: ago(180), files: [
      { path: "tests/auth.test.ts", changeType: "add", insertions: 138 },
    ] },
    { type: "milestone", label: "v1.2 milestone — auth + pagination stable", summary: "Authentication and cursor pagination feature-complete. Rate limiting deferred to v1.3.", agentName: "developer", tags: JSON.stringify(["milestone", "release"]), filesChanged: 0, insertions: 0, deletions: 0, trigger: "manual", createdAt: ago(90) },
    { type: "semantic", label: "Tighten zod validation on dueDate filter", summary: "dueDate query param now validated with zod before hitting the service layer.", agentName: "claude-code", taskContext: "harden request validation", tags: JSON.stringify(["validation", "fix"]), filesChanged: 1, insertions: 22, deletions: 9, trigger: "debounce", createdAt: ago(35), files: [
      { path: "src/utils/validate.ts", changeType: "modify", insertions: 22, deletions: 9 },
    ] },
  ]);

  await db.symbol.createMany({
    data: [
      { projectId: taskApi.id, filePath: "src/routes/auth.ts", name: "loginUser", kind: "function", isExported: true, startLine: 12, endLine: 41, paramCount: 2, complexity: 4, callCount: 6, isTested: true, bodyHash: "d1", signature: "[req,res]" },
      { projectId: taskApi.id, filePath: "src/routes/auth.ts", name: "refreshToken", kind: "function", isExported: true, startLine: 44, endLine: 58, paramCount: 2, complexity: 3, callCount: 4, isTested: true, bodyHash: "d2", signature: "[req,res]" },
      { projectId: taskApi.id, filePath: "src/middleware/auth.ts", name: "requireAuth", kind: "function", isExported: true, startLine: 8, endLine: 26, paramCount: 3, complexity: 5, callCount: 11, bodyHash: "d3", signature: "[req,res,next]" },
      { projectId: taskApi.id, filePath: "src/services/auth.service.ts", name: "verifyToken", kind: "function", isExported: true, startLine: 15, endLine: 27, paramCount: 1, complexity: 3, callCount: 15, bodyHash: "d4", signature: "[token]" },
      { projectId: taskApi.id, filePath: "src/services/auth.service.ts", name: "hashPassword", kind: "function", isExported: true, startLine: 30, endLine: 32, paramCount: 1, complexity: 1, callCount: 0, bodyHash: "d5", signature: "[plain]" },
      { projectId: taskApi.id, filePath: "src/services/task.service.ts", name: "listTasks", kind: "function", isExported: true, startLine: 18, endLine: 64, paramCount: 3, complexity: 7, callCount: 22, hasTodo: true, bodyHash: "d6", signature: "[cursor,limit,filters]" },
      { projectId: taskApi.id, filePath: "src/services/task.service.ts", name: "getTaskById", kind: "function", isExported: true, startLine: 67, endLine: 74, paramCount: 1, complexity: 2, callCount: 9, bodyHash: "d7", signature: "[id]" },
      { projectId: taskApi.id, filePath: "src/services/task.service.ts", name: "createTask", kind: "function", isExported: true, startLine: 77, endLine: 95, paramCount: 1, complexity: 3, callCount: 7, bodyHash: "d8", signature: "[input]" },
      { projectId: taskApi.id, filePath: "src/services/task.service.ts", name: "updateTask", kind: "function", isExported: true, startLine: 98, endLine: 121, paramCount: 2, complexity: 4, callCount: 5, bodyHash: "d9", signature: "[id,patch]" },
      { projectId: taskApi.id, filePath: "src/services/task.service.ts", name: "deleteTask", kind: "function", isExported: true, startLine: 124, endLine: 131, paramCount: 1, complexity: 2, callCount: 3, bodyHash: "da", signature: "[id]" },
      { projectId: taskApi.id, filePath: "src/services/task.service.ts", name: "paginateCursor", kind: "arrow", startLine: 134, endLine: 152, paramCount: 2, unusedParams: 1, complexity: 5, callCount: 2, bodyHash: "db", signature: "[rows,opts]" },
      { projectId: taskApi.id, filePath: "src/utils/validate.ts", name: "validateDueDate", kind: "function", isExported: true, startLine: 5, endLine: 5, paramCount: 1, complexity: 1, isStub: true, bodyHash: "dc", signature: "[value]" },
      { projectId: taskApi.id, filePath: "src/db/prisma.ts", name: "prisma", kind: "constant", isExported: true, startLine: 3, endLine: 8, paramCount: 0, complexity: 1, callCount: 31, bodyHash: "dd", signature: "[]" },
      { projectId: taskApi.id, filePath: "src/routes/tasks.ts", name: "tasksRouter", kind: "constant", isExported: true, startLine: 7, endLine: 66, paramCount: 0, complexity: 6, callCount: 1, bodyHash: "de", signature: "[]" },
    ],
  });

  await db.issue.createMany({
    data: [
      { projectId: taskApi.id, kind: "broken-import", severity: "critical", title: "Cannot resolve import '@/utils/legacy'", detail: JSON.stringify({ from: "src/routes/old-filter.ts", specifier: "@/utils/legacy" }), filePath: "src/routes/old-filter.ts", detectedAt: ago(700) },
      { projectId: taskApi.id, kind: "missing-tests", severity: "warning", title: "updateTask has no test coverage", detail: JSON.stringify({ symbol: "updateTask", file: "src/services/task.service.ts" }), filePath: "src/services/task.service.ts", symbolName: "updateTask", detectedAt: ago(280) },
      { projectId: taskApi.id, kind: "unused-param", severity: "warning", title: "paginateCursor: parameter 'opts.raw' is never used", detail: JSON.stringify({ symbol: "paginateCursor", param: "opts.raw" }), filePath: "src/services/task.service.ts", symbolName: "paginateCursor", detectedAt: ago(280) },
      { projectId: taskApi.id, kind: "dead-code", severity: "info", title: "hashPassword has no callers", detail: JSON.stringify({ symbol: "hashPassword", callCount: 0 }), filePath: "src/services/auth.service.ts", symbolName: "hashPassword", detectedAt: ago(270) },
      { projectId: taskApi.id, kind: "todo", severity: "info", title: "TODO in listTasks: filter by assignee", detail: JSON.stringify({ symbol: "listTasks", line: 40 }), filePath: "src/services/task.service.ts", symbolName: "listTasks", detectedAt: ago(270) },
    ],
  });

  await db.errorEvent.create({
    data: {
      projectId: taskApi.id, source: "terminal", errorType: "typescript",
      message: "TypeError: Cannot read properties of undefined (reading 'dueDate')",
      rawText: "TypeError: Cannot read properties of undefined (reading 'dueDate')\n    at listTasks (src/services/task.service.ts:40:19)\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
      filePath: "src/services/task.service.ts", line: 40,
      stack: JSON.stringify(["listTasks (src/services/task.service.ts:40:19)", "GET /api/tasks"]),
      agentName: "developer", status: "open", count: 3, firstSeenAt: ago(310), lastSeenAt: ago(55),
    },
  });

  await db.terminalLog.createMany({
    data: [
      { projectId: taskApi.id, source: "terminal", command: "npm run dev", stream: "stdout", text: "> task-api@1.2.0 dev\n> tsx watch src/server.ts\n\nServer listening on http://localhost:3000", createdAt: ago(600) },
      { projectId: taskApi.id, source: "terminal", command: "npm test", stream: "stdout", text: "PASS tests/auth.test.ts (12 tests)\nFAIL tests/rate-limit.test.ts (1 test)\nTests: 13 total, 12 passed, 1 failed", createdAt: ago(170) },
      { projectId: taskApi.id, source: "terminal", command: "npm run build", stream: "stdout", text: "tsc --build\nBuild succeeded — 38 files, 0 errors", createdAt: ago(160) },
      { projectId: taskApi.id, source: "terminal", command: "npm install jsonwebtoken zod", stream: "stdout", text: "added 12 packages in 3s\n\n12 packages are looking for funding", createdAt: ago(530) },
      { projectId: taskApi.id, source: "terminal", command: "git log --oneline -5", stream: "stdout", text: "9f3c1e2 tighten zod validation on dueDate filter\n2b8a7d1 v1.2 milestone\n5c4e9f0 add integration tests for auth\n7d2f8a3 fix TypeError in task.service\n1e6b5c4 refactor pagination to cursor-based", createdAt: ago(30) },
    ],
  });

  await db.planItem.createMany({
    data: [
      { projectId: taskApi.id, title: "JWT login + refresh tokens", status: "completed", category: "feature", detail: "Login and refresh endpoints with middleware-protected routes.", evidence: JSON.stringify(["snapshot: Add JWT auth to login route", "12 passing auth tests"]), confidence: 92, order: 1 },
      { projectId: taskApi.id, title: "Cursor pagination on /api/tasks", status: "completed", category: "feature", detail: "Offset pagination replaced with stable cursor pagination.", evidence: JSON.stringify(["snapshot: Refactor task pagination to cursor-based"]), confidence: 88, order: 2 },
      { projectId: taskApi.id, title: "Auth integration tests", status: "completed", category: "test", detail: "Supertest suite for login, refresh and 401 paths.", evidence: JSON.stringify(["snapshot: Add integration tests for the auth flow", "12 passed / 1 failed"]), confidence: 90, order: 3 },
      { projectId: taskApi.id, title: "Rate limiting on the login route", status: "blocked", category: "risk", detail: "Blocked: 1 test failure in rate-limit.test.ts needs investigation.", evidence: JSON.stringify(["terminal: npm test -> FAIL tests/rate-limit.test.ts"]), confidence: 40, order: 4 },
      { projectId: taskApi.id, title: "Migrate dueDate column to Date type", status: "in-progress", category: "refactor", detail: "Currently stored as ISO string; migration script drafted but not run.", evidence: JSON.stringify(["error: TypeError on dueDate", "snapshot: Tighten zod validation on dueDate filter"]), confidence: 55, order: 5 },
      { projectId: taskApi.id, title: "Add OpenAPI docs endpoint", status: "next", category: "docs", detail: "Expose /api/docs from the existing zod schemas.", evidence: JSON.stringify([]), confidence: 60, order: 6 },
    ],
  });

  await db.agentSession.createMany({
    data: [
      { projectId: taskApi.id, agentName: "claude-code", taskContext: "implement authentication + harden validation", startedAt: ago(560), lastActiveAt: ago(35) },
      { projectId: taskApi.id, agentName: "cursor", taskContext: "write auth tests", startedAt: ago(200), lastActiveAt: ago(180) },
    ],
  });

  await db.fileState.createMany({
    data: [
      { projectId: taskApi.id, path: "src/server.ts", size: 1840, updatedAt: ago(540) },
      { projectId: taskApi.id, path: "src/routes/auth.ts", size: 2410, updatedAt: ago(540) },
      { projectId: taskApi.id, path: "src/routes/tasks.ts", size: 3120, updatedAt: ago(420) },
      { projectId: taskApi.id, path: "src/middleware/auth.ts", size: 980, updatedAt: ago(540) },
      { projectId: taskApi.id, path: "src/services/task.service.ts", size: 5230, updatedAt: ago(300) },
      { projectId: taskApi.id, path: "src/services/auth.service.ts", size: 1470, updatedAt: ago(540) },
      { projectId: taskApi.id, path: "src/utils/validate.ts", size: 860, updatedAt: ago(35) },
      { projectId: taskApi.id, path: "src/db/prisma.ts", size: 320, updatedAt: ago(700) },
      { projectId: taskApi.id, path: "tests/auth.test.ts", size: 4390, updatedAt: ago(180) },
      { projectId: taskApi.id, path: "src/routes/old-filter.ts", size: 640, deleted: true, updatedAt: ago(280) },
    ],
  });

  await db.dependency.createMany({
    data: [
      { projectId: taskApi.id, fromPath: "src/routes/auth.ts", toPath: "src/services/auth.service.ts", kind: "import" },
      { projectId: taskApi.id, fromPath: "src/routes/tasks.ts", toPath: "src/services/task.service.ts", kind: "import" },
      { projectId: taskApi.id, fromPath: "src/services/task.service.ts", toPath: "src/db/prisma.ts", kind: "import" },
      { projectId: taskApi.id, fromPath: "src/services/task.service.ts", toPath: "src/utils/legacy.ts", kind: "import", resolved: false },
      { projectId: taskApi.id, fromPath: "src/routes/auth.ts", toPath: "jsonwebtoken", kind: "import", external: true },
      { projectId: taskApi.id, fromPath: "src/routes/tasks.ts", toPath: "zod", kind: "import", external: true },
      { projectId: taskApi.id, fromPath: "tests/auth.test.ts", toPath: "src/routes/auth.ts", kind: "test" },
    ],
  });

  // ------------------------------------------------------------------
  // Demo project 2 — "portfolio-site": healthy frontend, recent activity
  // ------------------------------------------------------------------
  const portfolio = await db.project.create({
    data: {
      id: "demo-portfolio-site",
      name: "portfolio-site",
      rootPath: "C:\\Users\\demo\\projects\\portfolio-site",
      status: "active",
      healthScore: 93,
      fileCount: 24,
      lastScanAt: ago(12),
      createdAt: ago(60 * 24 * 5),
    },
  });

  await seedSnapshots(portfolio.id, [
    { type: "baseline", label: "Baseline scan — 24 files indexed", summary: "Vite + React portfolio. 24 files, clean dependency graph.", agentName: "developer", filesChanged: 24, insertions: 3150, deletions: 0, trigger: "scan", createdAt: ago(600) },
    { type: "semantic", label: "Add dark-mode toggle with CSS variables", summary: "Theme tokens moved to CSS custom properties; toggle persisted to localStorage.", agentName: "windsurf", taskContext: "implement dark mode", tags: JSON.stringify(["feature", "ui"]), filesChanged: 3, insertions: 64, deletions: 12, trigger: "debounce", createdAt: ago(400), files: [
      { path: "src/components/ThemeToggle.tsx", changeType: "add", insertions: 38 },
      { path: "src/styles/globals.css", changeType: "modify", insertions: 22, deletions: 10 },
      { path: "src/hooks/useTheme.ts", changeType: "add", insertions: 4 },
    ] },
    { type: "semantic", label: "Lazy-load project images below the fold", summary: "Project images below the fold now load with loading=lazy and a blur placeholder.", agentName: "windsurf", taskContext: "implement dark mode", tags: JSON.stringify(["perf", "ui"]), filesChanged: 2, insertions: 38, deletions: 6, trigger: "debounce", createdAt: ago(240), files: [
      { path: "src/components/ProjectCard.tsx", changeType: "modify", insertions: 24, deletions: 4 },
      { path: "src/components/ProjectGrid.tsx", changeType: "modify", insertions: 14, deletions: 2 },
    ] },
    { type: "semantic", label: "Contact form: add client-side validation", summary: "Name/email/message validated before submit; inline error states.", agentName: "developer", tags: JSON.stringify(["feature", "forms"]), filesChanged: 1, insertions: 45, deletions: 4, trigger: "debounce", createdAt: ago(120), files: [
      { path: "src/components/ContactForm.tsx", changeType: "modify", insertions: 45, deletions: 4 },
    ] },
    { type: "semantic", label: "Bump framer-motion to v12 + fix layout shift", summary: "Animation library upgraded; hero no longer shifts on first paint.", agentName: "claude-code", taskContext: "dependency upgrades", tags: JSON.stringify(["deps", "fix"]), filesChanged: 2, insertions: 21, deletions: 30, trigger: "command", createdAt: ago(45), files: [
      { path: "package.json", changeType: "modify", insertions: 3, deletions: 3 },
      { path: "src/components/Hero.tsx", changeType: "modify", insertions: 18, deletions: 27 },
    ] },
  ]);

  await db.symbol.createMany({
    data: [
      { projectId: portfolio.id, filePath: "src/App.tsx", name: "App", kind: "component", isExported: true, startLine: 6, endLine: 48, paramCount: 0, complexity: 3, callCount: 1, bodyHash: "p1", signature: "[]" },
      { projectId: portfolio.id, filePath: "src/components/Hero.tsx", name: "Hero", kind: "component", isExported: true, startLine: 4, endLine: 62, paramCount: 1, complexity: 4, callCount: 1, bodyHash: "p2", signature: "[props]" },
      { projectId: portfolio.id, filePath: "src/components/Navbar.tsx", name: "Navbar", kind: "component", isExported: true, startLine: 3, endLine: 34, paramCount: 0, complexity: 2, callCount: 1, bodyHash: "p3", signature: "[]" },
      { projectId: portfolio.id, filePath: "src/components/ProjectGrid.tsx", name: "ProjectGrid", kind: "component", isExported: true, startLine: 5, endLine: 41, paramCount: 1, complexity: 3, callCount: 1, bodyHash: "p4", signature: "[projects]" },
      { projectId: portfolio.id, filePath: "src/components/ProjectCard.tsx", name: "ProjectCard", kind: "component", isExported: true, startLine: 8, endLine: 66, paramCount: 2, complexity: 4, callCount: 6, bodyHash: "p5", signature: "[project,onOpen]" },
      { projectId: portfolio.id, filePath: "src/components/ContactForm.tsx", name: "ContactForm", kind: "component", isExported: true, startLine: 10, endLine: 88, paramCount: 0, complexity: 6, hasTodo: true, callCount: 1, bodyHash: "p6", signature: "[]" },
      { projectId: portfolio.id, filePath: "src/components/ThemeToggle.tsx", name: "ThemeToggle", kind: "component", isExported: true, startLine: 4, endLine: 28, paramCount: 0, complexity: 2, callCount: 2, bodyHash: "p7", signature: "[]" },
      { projectId: portfolio.id, filePath: "src/hooks/useTheme.ts", name: "useTheme", kind: "function", isExported: true, startLine: 3, endLine: 19, paramCount: 0, complexity: 2, callCount: 3, bodyHash: "p8", signature: "[]" },
      { projectId: portfolio.id, filePath: "src/hooks/useInView.ts", name: "useInView", kind: "function", isExported: true, startLine: 3, endLine: 24, paramCount: 1, complexity: 3, callCount: 4, bodyHash: "p9", signature: "[ref]" },
      { projectId: portfolio.id, filePath: "src/utils/formatDate.ts", name: "formatDate", kind: "function", isExported: true, startLine: 1, endLine: 9, paramCount: 2, complexity: 2, callCount: 8, bodyHash: "pa", signature: "[date,style]" },
    ],
  });

  await db.issue.createMany({
    data: [
      { projectId: portfolio.id, kind: "todo", severity: "info", title: "TODO in ContactForm: add honeypot field", detail: JSON.stringify({ symbol: "ContactForm", note: "spam protection" }), filePath: "src/components/ContactForm.tsx", symbolName: "ContactForm", detectedAt: ago(110) },
      { projectId: portfolio.id, kind: "missing-tests", severity: "info", title: "formatDate has no test coverage", detail: JSON.stringify({ symbol: "formatDate" }), filePath: "src/utils/formatDate.ts", symbolName: "formatDate", detectedAt: ago(110) },
    ],
  });

  await db.terminalLog.createMany({
    data: [
      { projectId: portfolio.id, source: "terminal", command: "npm run dev", stream: "stdout", text: "VITE v6.0.3  ready in 412 ms\n➜  Local:   http://localhost:5173/", createdAt: ago(500) },
      { projectId: portfolio.id, source: "terminal", command: "npm run build", stream: "stdout", text: "vite v6.0.3 building for production...\n✓ 24 modules transformed.\ndist/index.html                 1.42 kB\ndist/assets/index-CJ8x2p.css    18.71 kB\ndist/assets/index-B7f1k9.js     142.06 kB", createdAt: ago(40) },
      { projectId: portfolio.id, source: "terminal", command: "git commit -m \"bump framer-motion, fix hero layout shift\"", stream: "stdout", text: "[main 4d9c2f1] bump framer-motion, fix hero layout shift\n 2 files changed, 21 insertions(+), 30 deletions(-)", createdAt: ago(44) },
    ],
  });

  await db.planItem.createMany({
    data: [
      { projectId: portfolio.id, title: "Dark mode with CSS variables", status: "completed", category: "feature", detail: "Theme tokens as CSS custom properties, persisted toggle.", evidence: JSON.stringify(["snapshot: Add dark-mode toggle with CSS variables"]), confidence: 95, order: 1 },
      { projectId: portfolio.id, title: "Lazy-load below-the-fold images", status: "completed", category: "feature", detail: "Native lazy loading + blur placeholder.", evidence: JSON.stringify(["snapshot: Lazy-load project images below the fold"]), confidence: 90, order: 2 },
      { projectId: portfolio.id, title: "Contact-form validation", status: "completed", category: "feature", detail: "Client-side validation with inline error states.", evidence: JSON.stringify(["snapshot: Contact form: add client-side validation"]), confidence: 88, order: 3 },
      { projectId: portfolio.id, title: "Simple analytics for project pages", status: "next", category: "feature", detail: "Privacy-friendly page-view counter per project card.", evidence: JSON.stringify([]), confidence: 60, order: 4 },
    ],
  });

  await db.agentSession.create({
    data: { projectId: portfolio.id, agentName: "windsurf", taskContext: "implement dark mode + perf polish", startedAt: ago(410), lastActiveAt: ago(45) },
  });

  await db.fileState.createMany({
    data: [
      { projectId: portfolio.id, path: "src/App.tsx", size: 1720, updatedAt: ago(600) },
      { projectId: portfolio.id, path: "src/components/Hero.tsx", size: 2140, updatedAt: ago(45) },
      { projectId: portfolio.id, path: "src/components/ProjectGrid.tsx", size: 1180, updatedAt: ago(240) },
      { projectId: portfolio.id, path: "src/components/ProjectCard.tsx", size: 1990, updatedAt: ago(240) },
      { projectId: portfolio.id, path: "src/components/ContactForm.tsx", size: 2760, updatedAt: ago(120) },
      { projectId: portfolio.id, path: "src/components/ThemeToggle.tsx", size: 840, updatedAt: ago(400) },
      { projectId: portfolio.id, path: "src/hooks/useTheme.ts", size: 620, updatedAt: ago(400) },
    ],
  });

  await db.dependency.createMany({
    data: [
      { projectId: portfolio.id, fromPath: "src/App.tsx", toPath: "src/components/Navbar.tsx", kind: "import" },
      { projectId: portfolio.id, fromPath: "src/App.tsx", toPath: "src/components/Hero.tsx", kind: "import" },
      { projectId: portfolio.id, fromPath: "src/App.tsx", toPath: "src/components/ProjectGrid.tsx", kind: "import" },
      { projectId: portfolio.id, fromPath: "src/components/ProjectGrid.tsx", toPath: "src/components/ProjectCard.tsx", kind: "import" },
      { projectId: portfolio.id, fromPath: "src/components/Hero.tsx", toPath: "framer-motion", kind: "import", external: true },
      { projectId: portfolio.id, fromPath: "src/components/ThemeToggle.tsx", toPath: "src/hooks/useTheme.ts", kind: "import" },
    ],
  });

  console.log("[agent-watch] demo data seeded: task-api, portfolio-site");
}
