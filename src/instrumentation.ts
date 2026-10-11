// Next.js instrumentation: boots the Agent Watch engine when the server starts.
export async function register() {
  // Only run in the Node.js runtime (not edge)
  if (process.env.NEXT_RUNTIME === "nodejs") {
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
