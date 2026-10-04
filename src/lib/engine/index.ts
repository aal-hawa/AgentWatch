// Agent Watch engine: orchestrates watchers, snapshots, analysis.
// Singleton stored on globalThis to survive Next.js dev HMR.
import fs from "fs";
import path from "path";
import chokidar, { type FSWatcher } from "chokidar";
import { diffLines } from "diff";
import { db } from "@/lib/db";
import { ENGINE_CONFIG, isWatchableFile, isIgnoredPath, isAnalyzableFile } from "./config";
import { putBlob, relPath, absPath } from "./store";
import { generateMessage, type ChangedFile } from "./commitMessage";
import { analyzeProject, scanTodoIssues } from "./analyzer";
import { generatePlan } from "./plan";
import { emitEvent } from "./events";

type PendingChange = { path: string; event: "add" | "change" | "unlink" | "addDir" | "unlinkDir"; at: number };

type EngineState = {
  watchers: Map<string, FSWatcher>;
  pending: Map<string, Map<string, PendingChange>>;
  flushTimers: Map<string, NodeJS.Timeout>;
  analysisTimers: Map<string, NodeJS.Timeout>;
  analyzing: Set<string>;
  scanning: Set<string>;
  attribution: Map<string, { agentName: string; taskContext: string }>; // per-project current agent context
  initialized: boolean;
};

class Engine {
  state: EngineState;

  constructor() {
    this.state = {
      watchers: new Map(),
      pending: new Map(),
      flushTimers: new Map(),
      analysisTimers: new Map(),
      analyzing: new Set(),
      scanning: new Set(),
      attribution: new Map(),
      initialized: false,
    };
  }

  /** Load active projects and start watchers. Safe to call repeatedly. */
  async ensureStarted(): Promise<void> {
    if (this.state.initialized) return;
    this.state.initialized = true;
    try {
      const projects = await db.project.findMany({ where: { status: "active" } });
      for (const p of projects) {
        await this.startWatcher(p.id, p.rootPath).catch((e) => {
          console.error(`[agent-watch] failed to start watcher for ${p.name}:`, e.message);
        });
      }
      // auto-register demo project on first ever run
      const count = await db.project.count();
      if (count === 0) {
        const demoPath = path.join(process.cwd(), "demo-target");
        if (fs.existsSync(demoPath)) {
          await this.addProject(demoPath, "Demo — Task API (sample)").catch(() => {});
        }
      }
    } catch (e) {
      console.error("[agent-watch] ensureStarted failed:", e);
      this.state.initialized = false;
    }
  }

  async addProject(rootPath: string, name?: string): Promise<{ id: string }> {
    const resolved = path.resolve(rootPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Path is not a directory: ${resolved}`);
    }
    const existing = await db.project.findUnique({ where: { rootPath: resolved } });
    if (existing) {
      if (existing.status === "paused") {
        await db.project.update({ where: { id: existing.id }, data: { status: "active" } });
        await this.startWatcher(existing.id, resolved);
      }
      return { id: existing.id };
    }
    const project = await db.project.create({
      data: {
        name: name || path.basename(resolved),
        rootPath: resolved,
        status: "active",
      },
    });
    emitEvent("project", project.id, { action: "added", name: project.name });
    await this.startWatcher(project.id, resolved);
    return { id: project.id };
  }

  async removeProject(projectId: string): Promise<void> {
    const watcher = this.state.watchers.get(projectId);
    if (watcher) {
      await watcher.close().catch(() => {});
      this.state.watchers.delete(projectId);
    }
    const t = this.state.flushTimers.get(projectId);
    if (t) clearTimeout(t);
    const a = this.state.analysisTimers.get(projectId);
    if (a) clearTimeout(a);
    this.state.pending.delete(projectId);
    await db.project.delete({ where: { id: projectId } }).catch(() => {});
    emitEvent("project", projectId, { action: "removed" });
  }

  async pauseProject(projectId: string): Promise<void> {
    const watcher = this.state.watchers.get(projectId);
    if (watcher) {
      await watcher.close().catch(() => {});
      this.state.watchers.delete(projectId);
    }
    await db.project.update({ where: { id: projectId }, data: { status: "paused" } });
    emitEvent("project", projectId, { action: "paused" });
  }

  async resumeProject(projectId: string): Promise<void> {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error("Project not found");
    await db.project.update({ where: { id: projectId }, data: { status: "active" } });
    await this.startWatcher(projectId, project.rootPath);
    emitEvent("project", projectId, { action: "resumed" });
  }

  /** Force a full rescan + analysis. */
  async rescanProject(projectId: string): Promise<void> {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error("Project not found");
    await this.baselineScan(project.id, project.rootPath, true);
  }

  /** Set agent attribution context for the next snapshots. */
  setAttribution(projectId: string, agentName: string, taskContext = "") {
    this.state.attribution.set(projectId, { agentName, taskContext });
  }

  getAttribution(projectId: string): { agentName: string; taskContext: string } {
    return this.state.attribution.get(projectId) || { agentName: "developer", taskContext: "" };
  }

  // -------------------------------------------------------------------------
  // Watcher plumbing
  // -------------------------------------------------------------------------

  private async startWatcher(projectId: string, rootPath: string): Promise<void> {
    if (this.state.watchers.has(projectId)) return; // already watching

    const watcher = chokidar.watch(rootPath, {
      ignored: (p: string) => isIgnoredPath(p, rootPath),
      ignoreInitial: true,
      persistent: true,
      depth: 14,
      awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
    });

    this.state.pending.set(projectId, new Map());

    watcher.on("add", (p) => this.queueChange(projectId, rootPath, p, "add"));
    watcher.on("change", (p) => this.queueChange(projectId, rootPath, p, "change"));
    watcher.on("unlink", (p) => this.queueChange(projectId, rootPath, p, "unlink"));
    watcher.on("addDir", (p) => this.queueChange(projectId, rootPath, p, "addDir"));
    watcher.on("unlinkDir", (p) => this.queueChange(projectId, rootPath, p, "unlinkDir"));
    watcher.on("error", (err) => console.error(`[agent-watch] watcher error:`, err.message));

    this.state.watchers.set(projectId, watcher);

    // If the project has no file states yet, do the baseline scan.
    const count = await db.fileState.count({ where: { projectId } });
    if (count === 0) {
      await this.baselineScan(projectId, rootPath, false);
    }
  }

  private queueChange(projectId: string, rootPath: string, absFile: string, event: PendingChange["event"]) {
    if (isIgnoredPath(absFile, rootPath)) return;
    const pending = this.state.pending.get(projectId);
    if (!pending) return;
    pending.set(absFile, { path: absFile, event, at: Date.now() });

    // reset debounce timer
    const prev = this.state.flushTimers.get(projectId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      void this.flush(projectId).catch((e) => console.error("[agent-watch] flush error:", e));
    }, ENGINE_CONFIG.debounceMs);
    this.state.flushTimers.set(projectId, timer);
  }

  /** Build a snapshot from the pending change batch. */
  async flush(projectId: string): Promise<void> {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) return;
    const pending = this.state.pending.get(projectId);
    if (!pending || pending.size === 0) return;

    // take and clear batch
    const batch = [...pending.values()];
    pending.clear();

    // keep only watchable files (and file-dir pairs)
    const fileEvents = batch.filter((b) => {
      try {
        if (b.event === "addDir" || b.event === "unlinkDir") return false;
        if (b.event === "unlink") return isWatchableFile(b.path, project.rootPath);
        if (!fs.existsSync(b.path)) return false;
        if (!fs.statSync(b.path).isFile()) return false;
        return isWatchableFile(b.path, project.rootPath);
      } catch {
        return false;
      }
    });
    if (!fileEvents.length) {
      emitEvent("status", projectId, { message: "changes observed (non-file)" });
      return;
    }

    const attribution = this.getAttribution(projectId);
    const changedFiles: ChangedFile[] = [];
    const snapshotFiles: {
      path: string; changeType: "add" | "modify" | "delete"; beforeHash: string | null; afterHash: string | null; insertions: number; deletions: number;
    }[] = [];

    for (const ev of fileEvents) {
      const rel = relPath(project.rootPath, ev.path);
      const prev = await db.fileState.findUnique({
        where: { projectId_path: { projectId, path: rel } },
      });

      let afterHash: string | null = null;
      let afterContent: string | null = null;
      if (ev.event !== "unlink" && fs.existsSync(ev.path)) {
        try {
          const stat = fs.statSync(ev.path);
          if (stat.isFile() && stat.size <= ENGINE_CONFIG.maxFileSize) {
            afterContent = fs.readFileSync(ev.path, "utf8");
            afterHash = await putBlob(afterContent);
          }
        } catch {
          // unreadable
        }
      }

      const beforeHash = prev?.hash ?? null;
      let changeType: "add" | "modify" | "delete";
      if (!beforeHash && afterHash) changeType = "add";
      else if (beforeHash && !afterHash) changeType = "delete";
      else if (!beforeHash && !afterHash) continue; // non-content event
      else if (beforeHash === afterHash) continue; // no actual change
      else changeType = "modify";

      // diff stats
      let insertions = 0;
      let deletions = 0;
      if (changeType === "modify") {
        const { getBlob } = await import("./store");
        const before = await getBlob(beforeHash);
        if (before != null && afterContent != null) {
          for (const part of diffLines(before, afterContent)) {
            if (part.added) insertions += part.value.split("\n").length - (part.value.endsWith("\n") ? 1 : 0);
            if (part.removed) deletions += part.value.split("\n").length - (part.value.endsWith("\n") ? 1 : 0);
          }
        }
      } else if (changeType === "add" && afterContent != null) {
        insertions = afterContent.split("\n").length;
      } else if (changeType === "delete" && beforeHash) {
        const { getBlob } = await import("./store");
        const before = await getBlob(beforeHash);
        if (before != null) deletions = before.split("\n").length;
      }

      changedFiles.push({ path: rel, changeType, insertions, deletions });
      snapshotFiles.push({ path: rel, changeType, beforeHash, afterHash, insertions, deletions });

      // update file state
      await db.fileState.upsert({
        where: { projectId_path: { projectId, path: rel } },
        update: { hash: afterHash, deleted: changeType === "delete", size: afterContent ? Buffer.byteLength(afterContent) : 0, updatedAt: new Date() },
        create: { projectId, path: rel, hash: afterHash, deleted: changeType === "delete", size: afterContent ? Buffer.byteLength(afterContent) : 0 },
      });
    }

    if (!snapshotFiles.length) return;

    // classify snapshot type
    const lastSnapshot = await db.snapshot.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
    let type: "micro" | "semantic" | "milestone" = "micro";
    if (snapshotFiles.length >= ENGINE_CONFIG.milestoneFiles) type = "milestone";
    else if (snapshotFiles.length >= ENGINE_CONFIG.semanticFiles) type = "semantic";
    else if (lastSnapshot && Date.now() - lastSnapshot.createdAt.getTime() > 25 * 60 * 1000) type = "semantic";

    const msg = await generateMessage(changedFiles);
    const snapshot = await db.snapshot.create({
      data: {
        projectId,
        type,
        label: msg.label,
        summary: msg.summary,
        agentName: attribution.agentName,
        taskContext: attribution.taskContext,
        tags: JSON.stringify(msg.tags),
        filesChanged: snapshotFiles.length,
        insertions: changedFiles.reduce((s, f) => s + f.insertions, 0),
        deletions: changedFiles.reduce((s, f) => s + f.deletions, 0),
        trigger: "fs-event",
        files: { create: snapshotFiles },
      },
    });

    emitEvent("snapshot", projectId, {
      id: snapshot.id,
      type,
      label: snapshot.label,
      agentName: snapshot.agentName,
      filesChanged: snapshot.filesChanged,
      insertions: snapshot.insertions,
      deletions: snapshot.deletions,
      via: msg.via,
    });

    // schedule analysis (debounced)
    this.scheduleAnalysis(projectId);
  }

  /** Full project scan: baseline snapshot + analysis + plan. */
  private async baselineScan(projectId: string, rootPath: string, forced: boolean): Promise<void> {
    if (this.state.scanning.has(projectId)) return;
    this.state.scanning.add(projectId);
    try {
      const files = await this.walkFiles(rootPath);
      const rows: { projectId: string; path: string; hash: string | null; size: number; deleted: boolean }[] = [];

      if (forced) {
        // create an explicit baseline snapshot of current state
        const existingStates = await db.fileState.findMany({ where: { projectId } });
        const known = new Map(existingStates.map((s) => [s.path, s]));
        const batch: ChangedFile[] = [];
        const snapshotFiles: { path: string; changeType: "add" | "modify" | "delete"; beforeHash: string | null; afterHash: string | null; insertions: number; deletions: number }[] = [];
        for (const f of files) {
          const rel = relPath(rootPath, f);
          try {
            const stat = fs.statSync(f);
            if (stat.size > ENGINE_CONFIG.maxFileSize) continue;
            const content = fs.readFileSync(f, "utf8");
            const hash = await putBlob(content);
            const prev = known.get(rel);
            rows.push({ projectId, path: rel, hash, size: stat.size, deleted: false });
            if (!prev || prev.hash !== hash) {
              const insertions = content.split("\n").length;
              batch.push({ path: rel, changeType: prev ? "modify" : "add", insertions, deletions: 0 });
              snapshotFiles.push({ path: rel, changeType: prev ? "modify" : "add", beforeHash: prev?.hash || null, afterHash: hash, insertions, deletions: 0 });
            }
          } catch {
            // skip unreadable
          }
        }
        // mark deletions
        for (const st of existingStates) {
          if (!fs.existsSync(absPath(rootPath, st.path))) {
            rows.push({ projectId, path: st.path, hash: null, size: 0, deleted: true });
            if (!st.deleted) {
              batch.push({ path: st.path, changeType: "delete", insertions: 0, deletions: 0 });
              snapshotFiles.push({ path: st.path, changeType: "delete", beforeHash: st.hash, afterHash: null, insertions: 0, deletions: 0 });
            }
          }
        }

        if (snapshotFiles.length) {
          const msg = await generateMessage(batch);
          await db.snapshot.create({
            data: {
              projectId,
              type: forced ? "manual" : "baseline",
              label: forced ? `Full rescan: ${msg.label}` : "Initial baseline scan — project indexed",
              summary: msg.summary,
              agentName: "agent-watch",
              tags: JSON.stringify(["scan"]),
              filesChanged: snapshotFiles.length,
              insertions: batch.reduce((s, f) => s + f.insertions, 0),
              deletions: batch.reduce((s, f) => s + f.deletions, 0),
              trigger: "scan",
              files: { create: snapshotFiles },
            },
          });
        }
      } else {
        for (const f of files) {
          try {
            const stat = fs.statSync(f);
            if (stat.size > ENGINE_CONFIG.maxFileSize) continue;
            const content = fs.readFileSync(f, "utf8");
            const hash = await putBlob(content);
            rows.push({ projectId, path: relPath(rootPath, f), hash, size: stat.size, deleted: false });
          } catch {
            // skip
          }
        }
      }

      if (rows.length) {
        // SQLite has no createMany skipDuplicates — dedupe explicitly
        const existing = await db.fileState.findMany({ where: { projectId }, select: { path: true, hash: true, deleted: true } });
        const existingMap = new Map(existing.map((e) => [e.path, e]));
        const toCreate = rows.filter((r) => !existingMap.has(r.path));
        const toUpdate = rows.filter((r) => {
          const prev = existingMap.get(r.path);
          return prev && (prev.hash !== r.hash || prev.deleted !== r.deleted);
        });
        if (toCreate.length) await db.fileState.createMany({ data: toCreate });
        for (const r of toUpdate) {
          await db.fileState.update({
            where: { projectId_path: { projectId, path: r.path } },
            data: { hash: r.hash, size: r.size, deleted: r.deleted, updatedAt: new Date() },
          });
        }
      }

      await db.project.update({ where: { id: projectId }, data: { fileCount: await db.fileState.count({ where: { projectId, deleted: false } }) } });

      // analyze + plan
      await this.analyzeNow(projectId);
      await scanTodoIssues(projectId, rootPath);
      await generatePlan(projectId);
      emitEvent("analysis", projectId, { done: true, baseline: true });
    } finally {
      this.state.scanning.delete(projectId);
    }
  }

  scheduleAnalysis(projectId: string) {
    const prev = this.state.analysisTimers.get(projectId);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      void this.analyzeNow(projectId).catch((e) => console.error("[agent-watch] analyze error:", e));
    }, ENGINE_CONFIG.analysisDebounceMs);
    this.state.analysisTimers.set(projectId, timer);
  }

  async analyzeNow(projectId: string): Promise<void> {
    if (this.state.analyzing.has(projectId)) return;
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) return;
    this.state.analyzing.add(projectId);
    try {
      const result = await analyzeProject(projectId, project.rootPath);
      await scanTodoIssues(projectId, project.rootPath);
      await generatePlan(projectId);
      emitEvent("analysis", projectId, { done: true, ...result });
    } finally {
      this.state.analyzing.delete(projectId);
    }
  }

  private async walkFiles(rootPath: string): Promise<string[]> {
    const out: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 14) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        if (isIgnoredPath(abs, rootPath)) continue;
        if (e.isDirectory()) walk(abs, depth + 1);
        else if (e.isFile()) out.push(abs);
      }
    };
    walk(rootPath, 0);
    return out.filter((f) => {
      try {
        return isWatchableFile(f, rootPath) && fs.statSync(f).size <= ENGINE_CONFIG.maxFileSize;
      } catch {
        return false;
      }
    });
  }

  /** Restore files from a snapshot (explicit user action). */
  async restoreSnapshot(projectId: string, snapshotId: string, onlyPaths?: string[]): Promise<{ restored: string[]; failed: string[] }> {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (!project) throw new Error("Project not found");
    const snap = await db.snapshot.findUnique({ where: { id: snapshotId }, include: { files: true } });
    if (!snap || snap.projectId !== projectId) throw new Error("Snapshot not found");

    const { getBlob } = await import("./store");
    const restored: string[] = [];
    const failed: string[] = [];

    for (const f of snap.files) {
      if (onlyPaths && !onlyPaths.includes(f.path)) continue;
      const abs = absPath(project.rootPath, f.path);
      try {
        if (f.changeType === "delete") {
          // "restore delete" means re-create the file with its BEFORE content
          const before = await getBlob(f.beforeHash);
          if (before != null) {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, before, "utf8");
            restored.push(f.path);
          } else failed.push(f.path);
        } else {
          const after = await getBlob(f.afterHash);
          if (after != null) {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, after, "utf8");
            restored.push(f.path);
          } else failed.push(f.path);
        }
      } catch {
        failed.push(f.path);
      }
    }
    emitEvent("status", projectId, { message: `Restored ${restored.length} file(s) from snapshot` });
    // re-analyze after restore
    this.scheduleAnalysis(projectId);
    return { restored, failed };
  }
}

const g = globalThis as unknown as { __agentWatchEngine?: Engine };

export function getEngine(): Engine {
  if (!g.__agentWatchEngine) {
    g.__agentWatchEngine = new Engine();
  }
  return g.__agentWatchEngine;
}

export type { Engine };
