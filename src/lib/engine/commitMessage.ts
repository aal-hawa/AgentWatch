// Heuristic + LLM-enhanced semantic commit message generation.
import { llmSummarize } from "./llm";

export type ChangedFile = {
  path: string;
  changeType: "add" | "modify" | "delete";
  insertions: number;
  deletions: number;
};

const AREA_KEYWORDS: Record<string, string[]> = {
  auth: ["auth", "login", "session", "token", "password", "jwt", "credential"],
  ui: ["component", "components", "page", "pages", "view", "views", "ui", "style", "css", "layout", "screen"],
  api: ["api", "route", "routes", "controller", "endpoint", "handler", "server", "resolvers"],
  data: ["model", "models", "schema", "db", "database", "prisma", "migration", "entity", "repository"],
  test: ["test", "tests", "spec", "__tests__", "coverage"],
  config: ["config", "tsconfig", "package", "webpack", "vite", "tailwind", ".env.example", "docker"],
  docs: ["readme", "docs", "doc", "changelog"],
  utils: ["util", "utils", "helper", "helpers", "lib", "shared", "common", "format", "validate"],
  services: ["service", "services", "client", "store", "state", "hooks"],
};

function inferAreas(files: ChangedFile[]): string[] {
  const scores = new Map<string, number>();
  for (const f of files) {
    const lower = f.path.toLowerCase();
    for (const [area, kws] of Object.entries(AREA_KEYWORDS)) {
      if (kws.some((kw) => lower.includes(kw))) {
        scores.set(area, (scores.get(area) || 0) + 1);
      }
    }
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([a]) => a);
}

function humanArea(p: string): string {
  const parts = p.split("/");
  // pick a meaningful middle segment or filename
  const withoutFile = parts.slice(0, -1);
  const meaningful = withoutFile.find((s) => !["src", "app", "lib", "project", "source"].includes(s));
  const file = parts[parts.length - 1].replace(/\.[^.]+$/, "");
  if (meaningful) return meaningful;
  return file;
}

export function inferTags(files: ChangedFile[]): string[] {
  const tags = new Set<string>();
  for (const f of files) {
    const lower = f.path.toLowerCase();
    for (const [area, kws] of Object.entries(AREA_KEYWORDS)) {
      if (kws.some((kw) => lower.includes(kw))) tags.add(area);
    }
    if (f.changeType === "add") tags.add("new");
    if (f.changeType === "delete") tags.add("cleanup");
  }
  return [...tags].slice(0, 4);
}

/** Fast deterministic summary, zero dependencies. */
export function heuristicMessage(files: ChangedFile[]): { label: string; summary: string } {
  if (!files.length) return { label: "No-op checkpoint", summary: "Nothing changed." };
  const adds = files.filter((f) => f.changeType === "add");
  const dels = files.filter((f) => f.changeType === "delete");
  const mods = files.filter((f) => f.changeType === "modify");
  const ins = files.reduce((s, f) => s + f.insertions, 0);
  const del = files.reduce((s, f) => s + f.deletions, 0);

  const areas = inferAreas(files);
  const areaPrefix = areas.length ? `${areas.map((a) => a[0].toUpperCase() + a.slice(1)).join(" + ")}: ` : "";

  let verb: string;
  if (adds.length && !mods.length && !dels.length) verb = "Created";
  else if (dels.length && !adds.length && !mods.length) verb = "Removed";
  else verb = "Updated";

  const focus = files.length === 1 ? humanArea(files[0].path) : `${files.length} files`;
  const label = `${areaPrefix}${verb} ${focus} (+${ins}/-${del})`;

  const lines: string[] = [];
  for (const f of files.slice(0, 8)) {
    const stat = `+${f.insertions}/-${f.deletions}`;
    const icon = f.changeType === "add" ? "A" : f.changeType === "delete" ? "D" : "M";
    lines.push(`[${icon}] ${f.path} (${stat})`);
  }
  if (files.length > 8) lines.push(`… and ${files.length - 8} more files`);
  const summary = lines.join("\n");
  return { label, summary };
}

/** Try LLM, fall back to heuristics. */
export async function generateMessage(files: ChangedFile[]): Promise<{
  label: string;
  summary: string;
  tags: string[];
  via: "llm" | "heuristic";
}> {
  const heuristic = heuristicMessage(files);
  const tags = inferTags(files);
  try {
    const fileList = files
      .slice(0, 20)
      .map((f) => `${f.changeType.toUpperCase()}: ${f.path} (+${f.insertions}/-${f.deletions})`)
      .join("\n");
    const llm = await llmSummarize(
      `A developer/AI agent just changed these files in a project:\n${fileList}\n\nWrite ONE concise semantic commit message (max 90 chars, no quotes, imperative mood) describing WHAT was done and WHY if inferable.`,
      "You write precise, terse git commit messages for watched AI coding sessions. Output only the message.",
      100
    );
    if (llm) {
      return { label: llm, summary: heuristic.summary, tags, via: "llm" };
    }
  } catch {
    // ignore
  }
  return { label: heuristic.label, summary: heuristic.summary, tags, via: "heuristic" };
}
