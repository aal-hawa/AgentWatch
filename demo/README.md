# demo/ — hosted demo deployment (testing only)

This folder contains **everything that exists only for the hosted demo** at
**https://agentwatch-demo.vercel.app**. The main source tree of AgentWatch is
the original, untouched app and keeps working locally exactly as before — all
serverless adaptations live here.

> ⚠️ **The hosted deployment is for testing and previewing only — not a working
> product.** Data is ephemeral, folder watching and terminal capture are
> local-machine features and stay off in the cloud.

## What's inside

| Path | Purpose |
|---|---|
| `overrides/` | Files that **replace** their same-path counterparts in the main tree at deploy time (see table below) |
| `deploy.mjs` | Assembles `repo + overrides` and uploads the result to Vercel via the REST API |
| `README.md` | This file |

### Override files (applied on top of the main tree at deploy time)

| Override | What it changes vs. the original |
|---|---|
| `next.config.ts` | `output: "standalone"` only off-Vercel (Vercel does its own packaging) |
| `package.json` | adds `postinstall: prisma generate` for the cloud build |
| `src/instrumentation.ts` | ephemeral SQLite at `/tmp` + DDL bootstrap + **seeds two demo projects**; skips the local watcher engine on Vercel |
| `src/lib/db-bootstrap.ts` | DDL statements extracted from `prisma db push` (creates the schema on a cold /tmp database) |
| `src/lib/demo-seed.ts` | seeds the **task-api** and **portfolio-site** demo projects with snapshots, symbols, issues, plan items, terminal logs and agent sessions, so visitors land on a populated dashboard |
| `src/lib/engine/index.ts` | `ensureStarted()` becomes a no-op on Vercel (no folder watchers on serverless) |
| `src/lib/engine/llm.ts` | on Vercel, LLM settings come from env vars (`GEMINI_API` → Google Gemini, `gemini-flash-lite-latest`) instead of the local database |
| `src/app/api/settings/route.ts` | never exposes the env-injected API key to the browser on Vercel |
| `src/app/api/terminal/route.ts` | `maxDuration = 300` (Vercel Hobby plan cap) |

## Deploying (or updating) the demo

From the **repo root**, with `VERCEL_API_TOKEN` and `GEMINI_API` set in your
environment (values are never printed or committed):

```bash
node demo/deploy.mjs
```

The script reuses the existing `agentwatch` Vercel project, so the production
URL stays stable. The database resets whenever the serverless instance goes
cold — the demo data is re-seeded automatically on the next cold start.

## Why this structure

- `git clone` → `npm install` → `npm run dev` keeps working exactly as the
  original app, with zero demo/cloud code in the way.
- Every demo-only change is reviewable in one place and never interleaved
  with the app's real source.
