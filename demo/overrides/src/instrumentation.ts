// Next.js instrumentation — DEMO OVERRIDE for the hosted deployment.
// (The original file in the repo root boots the local engine; this override
// lives in demo/overrides/ and is only applied when assembling the demo
// deployment. It never runs on your local machine.)
export async function register() {
  // Only run in the Node.js runtime (not edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Serverless (Vercel): the filesystem is read-only except /tmp and every
    // cold start gets a fresh machine — so the SQLite database lives in /tmp
    // and its schema is (re)created on demand. Data is intentionally ephemeral:
    // this deployment is for TESTING, not production use.
    if (process.env.VERCEL) {
      try {
        const fs = await import("fs");
        const path = await import("path");
        const os = await import("os");
        const dbDir = path.join(os.tmpdir(), "agentwatch-db");
        fs.mkdirSync(dbDir, { recursive: true });
        const dbFile = path.join(dbDir, "custom.db");
        process.env.DATABASE_URL = "file:" + dbFile;
        const { db } = await import("@/lib/db");
        const rows = (await db.$queryRawUnsafe(
          "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'"
        )) as { n: number | bigint }[];
        if (Number(rows[0]?.n ?? 0) === 0) {
          const { DDL } = await import("@/lib/db-bootstrap");
          for (const stmt of DDL) {
            await db.$executeRawUnsafe(stmt);
          }
          console.log("[agent-watch] ephemeral database schema created at", dbFile);
        }
        // Seed the two demo projects (no-op when data already exists) so
        // visitors land on a populated dashboard instead of an empty state.
        const { seedDemoData } = await import("@/lib/demo-seed");
        await seedDemoData();
        console.log("[agent-watch] ephemeral sqlite ready at", dbFile);
      } catch (e) {
        console.error("[agent-watch] ephemeral db bootstrap failed:", e);
      }
      // The local engine (chokidar folder watchers, terminal capture) is a
      // local-machine feature. On serverless there is no real project folder
      // to watch, so the engine stays off — the UI relies on the seeded data
      // and normal polling. (ensureStarted() is also guarded in the engine
      // override, so API routes that call it are covered.)
      console.log("[agent-watch] demo deploy: local engine skipped");
      return;
    }
    try {
      const { getEngine } = await import("@/lib/engine");
      const engine = getEngine();
      await engine.ensureStarted();
      console.log("[agent-watch] engine started via instrumentation");
    } catch (e) {
      console.error("[agent-watch] instrumentation bootstrap failed:", e);
    }
  }
}
