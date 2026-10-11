// LLM provider abstraction: local Ollama by default (100% offline), heuristics always work,
// optional OpenAI-compatible endpoints. No cloud SDKs are used anywhere.
import { db } from "@/lib/db";

export type LLMSettings = {
  provider: "heuristic" | "ollama" | "openai";
  apiKey: string;
  baseUrl: string; // ollama default: http://localhost:11434
  model: string; // "" = auto-pick an installed model on every call
};

export const OLLAMA_BASE = "http://localhost:11434";

export async function getLLMSettings(): Promise<LLMSettings> {
  // Serverless deploy (Vercel): use Google Gemini via env vars — testing config.
  // Local machines are untouched and keep their saved settings (Ollama, etc).
  const envKey = process.env.GEMINI_API || process.env.GOOGLE_API_KEY || "";
  if (process.env.VERCEL && envKey) {
    return {
      provider: "openai",
      apiKey: envKey,
      baseUrl: process.env.AW_LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai",
      model: process.env.AW_LLM_MODEL || "gemini-flash-lite-latest",
    };
  }
  const rows = await db.setting.findMany({
    where: { key: { in: ["llm.provider", "llm.apiKey", "llm.baseUrl", "llm.model"] } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    provider: (map["llm.provider"] as LLMSettings["provider"]) || "ollama",
    apiKey: map["llm.apiKey"] || "",
    baseUrl: map["llm.baseUrl"] || OLLAMA_BASE,
    model: map["llm.model"] || "",
  };
}

export async function saveLLMSettings(patch: Partial<LLMSettings>) {
  const kv: Record<string, string> = {};
  if (patch.provider !== undefined) kv["llm.provider"] = patch.provider;
  if (patch.apiKey !== undefined) kv["llm.apiKey"] = patch.apiKey;
  if (patch.baseUrl !== undefined) kv["llm.baseUrl"] = patch.baseUrl;
  if (patch.model !== undefined) kv["llm.model"] = patch.model;
  await Promise.all(
    Object.entries(kv).map(([key, value]) =>
      db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
    )
  );
}

// ---------------------------------------------------------------------------
// Ollama (local) helpers
// ---------------------------------------------------------------------------

const BAD_MODEL = /embed|bge|nomic|clip|whisper|guard|sqlcoder|minilm/i;
const CHAT_FAMILY =
  /qwen|llama|mistral|gemma|granite|phi|deepseek|codellama|starcoder|stablecode|wizardcoder|codegemma|yi-|command-?r|tinyllama|dolphin|hermes|nemotron|coder|instruct|chat|uigen/i;

export type OllamaModel = { name: string; size: number };

/** List installed Ollama models. Returns [] when Ollama is down. */
export async function ollamaModels(baseUrl: string, timeoutMs = 6000): Promise<OllamaModel[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const base = (baseUrl || OLLAMA_BASE).replace(/\/$/, "");
    const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: { name?: string; model?: string; size?: number }[] };
    return (json.models || [])
      .map((m) => ({ name: m.name || m.model || "", size: m.size || 0 }))
      .filter((m) => m.name);
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** Pick the best installed chat model: exact match → same base name → scored auto-pick. */
export function pickModel(models: OllamaModel[], configured?: string): string | null {
  if (!models.length) return null;
  const cfg = (configured || "").trim();
  if (cfg) {
    const exact = models.find((m) => m.name === cfg);
    if (exact) return cfg;
    const base = models.find((m) => m.name.split(":")[0] === cfg.split(":")[0]);
    if (base) return base.name;
  }
  let best: { name: string; score: number } | null = null;
  for (const m of models) {
    let score = 0;
    if (CHAT_FAMILY.test(m.name)) score += 2;
    if (BAD_MODEL.test(m.name)) score -= 4;
    if (m.size > 0 && m.size < 4 * 1024 * 1024 * 1024) score += 1; // prefer small/fast models
    if (!best || score > best.score) best = { name: m.name, score };
  }
  return best?.name ?? models[0].name;
}

async function ollamaChat(
  baseUrl: string,
  model: string,
  system: string,
  user: string,
  maxChars: number,
  timeoutMs = 25000
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const base = (baseUrl || OLLAMA_BASE).replace(/\/$/, "");
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0.2, num_predict: 120 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { message?: { content?: string } };
    const text = json?.message?.content?.trim();
    return text ? text.slice(0, maxChars) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Probe Ollama and resolve which model would be used. For the Settings "Test" button. */
export async function ollamaProbe(baseUrl: string, configured?: string) {
  const models = await ollamaModels(baseUrl);
  const resolved = pickModel(models, configured);
  return { online: models.length > 0 || resolved !== null, modelCount: models.length, resolved, models: models.map((m) => m.name) };
}

// ---------------------------------------------------------------------------
// Unified summarize entry point (fail-soft: callers fall back to heuristics)
// ---------------------------------------------------------------------------

/** Ask the configured LLM for a short text. Returns null on any failure. */
export async function llmSummarize(prompt: string, system: string, maxChars = 120): Promise<string | null> {
  const settings = await getLLMSettings();
  if (settings.provider === "heuristic") return null;
  try {
    if (settings.provider === "ollama") {
      const models = await ollamaModels(settings.baseUrl);
      const picked = pickModel(models, settings.model);
      if (!picked) return null; // Ollama offline or no models installed
      return await ollamaChat(settings.baseUrl, picked, system, prompt, maxChars);
    }
    // OpenAI-compatible endpoint (any local or remote provider)
    if (!settings.baseUrl || !settings.apiKey) return null;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(`${settings.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model || "gpt-4o-mini",
        max_tokens: 80,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = await res.json();
    const text: string | undefined = json?.choices?.[0]?.message?.content;
    return text ? text.trim().slice(0, maxChars) : null;
  } catch {
    return null;
  }
}
