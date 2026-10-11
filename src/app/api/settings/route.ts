import { NextRequest, NextResponse } from "next/server";
import { getLLMSettings, saveLLMSettings, ollamaProbe, type LLMSettings } from "@/lib/engine/llm";
import { BRAND } from "@/lib/brand.config";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getLLMSettings();
  return NextResponse.json({
    settings,
    brand: BRAND,
    rebrandHint: 'npm run rebrand -- "Your Name"',
    capabilities: {
      ollama: "local Ollama models on this machine (recommended — 100% offline, model auto-picked)",
      openai: "any OpenAI-compatible endpoint (set baseUrl + apiKey)",
      heuristic: "built-in summaries, always available, zero config",
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const patch = body as Partial<LLMSettings> & { test?: boolean };

  // connection test: probe Ollama and report which model would be used
  if (patch.test) {
    const result = await ollamaProbe(patch.baseUrl || "http://localhost:11434", patch.model);
    return NextResponse.json(result);
  }

  if (patch.provider && !["heuristic", "ollama", "openai"].includes(patch.provider)) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }
  const { test: _test, ...savePatch } = patch;
  await saveLLMSettings(savePatch);
  const settings = await getLLMSettings();
  return NextResponse.json({ ok: true, settings });
}
