// demo/deploy.mjs — builds and deploys the hosted AgentWatch demo to Vercel.
//
// How it works:
//   1. walks the repo (main tree = the original, untouched app)
//   2. applies every file in demo/overrides/ on top of it (same relative
//      paths) — these carry all serverless/demo adaptations
//   3. uploads the result to Vercel via the REST API and waits for READY
//
// Run from the repo root:   node demo/deploy.mjs
// Requires in your environment (values are never printed):
//   VERCEL_API_TOKEN  — Vercel API token
//   GEMINI_API        — free-tier Google Gemini key (demo AI summaries)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const TOKEN = process.env.VERCEL_API_TOKEN;
if (!TOKEN) { console.error("FATAL: VERCEL_API_TOKEN is not set"); process.exit(1); }
const GEMINI = process.env.GEMINI_API || "";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "agentwatch-demo"; // reuse the existing project -> same production URL
let TEAM = null;

// ---- API helper with automatic team-scope retry ----
async function api(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${TOKEN}` } };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  let res = await fetch(teamUrl(url), opts);
  let json = await res.json().catch(() => null);
  if ((res.status === 403 || res.status === 400) && !TEAM && json?.error?.message?.toLowerCase().includes("team")) {
    const me = await fetch("https://api.vercel.com/v2/user", { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.json()).catch(() => null);
    TEAM = me?.user?.defaultTeamId || null;
    if (TEAM) {
      res = await fetch(teamUrl(url), opts);
      json = await res.json().catch(() => null);
    }
  }
  return { status: res.status, json };
}
function teamUrl(url) {
  const u = new URL("https://api.vercel.com" + url);
  if (TEAM) u.searchParams.set("teamId", TEAM);
  return u;
}

// ---- file collection (main tree) ----
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".user-git", "db", ".state", ".vercel", ".wrangler", "dist", "build", ".bridge-tools", "demo"]);
const SKIP_FILES = new Set([".env", "server.log", "setup.log", "tsconfig.tsbuildinfo", "close.bat", "setup.bat", "start.bat", ".gitignore", "deploy-vercel.mjs", "_restructure-once.mjs"]);
function walk(dir, base = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...walk(path.join(dir, e.name), base ? `${base}/${e.name}` : e.name));
    } else if (!SKIP_FILES.has(e.name)) {
      out.push({ rel: base ? `${base}/${e.name}` : e.name, abs: path.join(dir, e.name) });
    }
  }
  return out;
}

async function setEnv(key, value, targets) {
  let r = await api("POST", `/v10/projects/${NAME}/env`, { key, value, target: targets, type: "encrypted" });
  if (r.status >= 300) {
    const list = await api("GET", `/v9/projects/${NAME}/env`);
    const found = (list.json?.envs || []).find(e => e.key === key);
    if (found) {
      await api("DELETE", `/v10/projects/${NAME}/env/${found.id}`);
      r = await api("POST", `/v10/projects/${NAME}/env`, { key, value, target: targets, type: "encrypted" });
    }
  }
  return r.status < 300;
}

async function main() {
  console.log("== Vercel demo deploy: AgentWatch ==");
  console.log(`repo root: ${ROOT}`);
  console.log(`GEMINI_API: ${GEMINI ? "present (hidden)" : "MISSING"}`);

  // 1. create project (or reuse — reuse keeps the production URL stable)
  let proj = await api("POST", "/v9/projects", { name: NAME, framework: "nextjs" });
  if (proj.status === 409) {
    console.log(`project '${NAME}' already exists — reusing`);
  } else if (proj.status < 300) {
    console.log(`project '${NAME}' created`);
  } else {
    console.error("project create failed:", proj.status, JSON.stringify(proj.json).slice(0, 300));
    process.exit(1);
  }

  // 2. env vars (values never printed)
  const okGem = GEMINI ? await setEnv("GEMINI_API", GEMINI, ["production", "preview"]) : false;
  const okDb = await setEnv("DATABASE_URL", "file:/tmp/agentwatch-db/custom.db", ["production", "preview"]);
  console.log(`env: GEMINI_API=${okGem ? "set" : (GEMINI ? "FAILED" : "skipped (not set)")}, DATABASE_URL=${okDb ? "set" : "FAILED"}`);
  if (GEMINI && !okGem) process.exit(1);
  if (!okDb) process.exit(1);

  // 3. collect main tree + apply demo overrides on top
  const files = walk(ROOT);
  const overrideDir = path.join(ROOT, "demo", "overrides");
  const overrides = walk(overrideDir);
  const byRel = new Map(files.map(f => [f.rel, f]));
  let applied = 0;
  for (const o of overrides) {
    const rel = o.rel.replace(/^overrides\//, "");
    if (byRel.has(rel)) applied++;
    byRel.set(rel, { rel, abs: o.abs });
  }
  const finalFiles = [...byRel.values()];
  const totalBytes = finalFiles.reduce((s, f) => s + fs.statSync(f.abs).size, 0);
  console.log(`files: ${finalFiles.length} (${(totalBytes / 1024).toFixed(0)} KB) — overrides applied: ${overrides.length} (${applied} replaced, ${overrides.length - applied} added)`);
  if (overrides.length < 8) { console.error("FATAL: expected at least 8 override files — demo/overrides looks incomplete"); process.exit(1); }

  const payload = finalFiles.map(f => ({ file: f.rel, data: fs.readFileSync(f.abs).toString("base64"), encoding: "base64" }));

  // 4. deploy
  console.log("creating deployment (production)…");
  const dep = await api("POST", "/v13/deployments", { name: NAME, project: NAME, target: "production", files: payload });
  if (dep.status >= 300) {
    console.error("deployment create failed:", dep.status, JSON.stringify(dep.json).slice(0, 500));
    process.exit(1);
  }
  const id = dep.json.id;
  console.log(`deployment ${id} queued`);

  // 5. poll
  const t0 = Date.now();
  while (Date.now() - t0 < 8 * 60 * 1000) {
    await new Promise(r => setTimeout(r, 6000));
    const d = await api("GET", `/v13/deployments/${id}`);
    const state = d.json?.readyState;
    const elapsed = Math.round((Date.now() - t0) / 1000);
    process.stdout.write(`\r  ${state || "…"} (${elapsed}s)   `);
    if (state === "READY") {
      console.log("\n== DEPLOYMENT READY ==");
      const urls = d.json.urls || [];
      for (const u of urls) console.log("  https://" + u.replace(/^https?:\/\//, ""));
      return;
    }
    if (state === "ERROR" || state === "CANCELED") {
      console.log(`\n== DEPLOYMENT ${state} ==`);
      console.log("errorMessage:", d.json.errorMessage || "(none)");
      const ev = await fetch(teamUrl(`/v2/deployments/${id}/events?limit=500`), { headers: { Authorization: `Bearer ${TOKEN}` } }).then(r => r.text()).catch(() => "");
      const lines = ev.split("\n").filter(l => /error|Error|ERROR|failed|FAILED/.test(l));
      console.log("error events (tail):\n" + (lines.slice(-15).join("\n") || ev.split("\n").slice(-15).join("\n")));
      process.exit(1);
    }
  }
  console.log("\ntimed out waiting for build — check the Vercel dashboard");
  process.exit(1);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
