// Next.js instrumentation: boots the Agent Watch engine when the server starts.
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
        console.log("[agent-watch] ephemeral sqlite ready at", dbFile);
      } catch (e) {
        console.error("[agent-watch] ephemeral db bootstrap failed:", e);
      }
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
