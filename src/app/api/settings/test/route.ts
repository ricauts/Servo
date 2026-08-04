import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { getRealProvider } from "@/lib/ai/provider";
import {
  envKeyNameFor,
  getAiSettings,
  type AiProviderKind,
} from "@/lib/ai/settings";

export const dynamic = "force-dynamic";

const testSchema = z.object({
  provider: z.enum(["anthropic", "openai", "mock"]),
  // Optional overrides so the form can test unsaved values. When apiKey is
  // omitted, the stored/env key is used.
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
});

/**
 * POST /api/settings/test — fire a minimal real completion with the given
 * provider config (unsaved form values allowed) and report latency. Never
 * falls back to the mock: a broken config must fail loudly here.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = testSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid test payload." }, { status: 400 });
  }
  const input = parsed.data;

  if (input.provider === "mock") {
    return Response.json({
      ok: true,
      latencyMs: 0,
      note: "Mock provider is deterministic and always available.",
    });
  }

  const stored = await getAiSettings();
  const provider = input.provider as AiProviderKind;
  const envName = envKeyNameFor(provider);
  const envKey = (envName && process.env[envName]) || "";
  const apiKey =
    input.apiKey !== undefined && input.apiKey !== ""
      ? input.apiKey
      : envKey || (stored.keySource === "db" ? stored.apiKey : "");

  const candidate = {
    ...stored,
    provider,
    configuredProvider: provider,
    apiKey,
    baseUrl: input.baseUrl || undefined,
    model: input.model || stored.model,
  };

  const client = getRealProvider(candidate);
  if (!client) {
    return Response.json(
      {
        error:
          provider === "openai"
            ? "Provide an API key, or a base URL for keyless local endpoints (e.g. Ollama)."
            : "Provide an API key for the Anthropic-compatible provider.",
      },
      { status: 400 },
    );
  }

  const started = Date.now();
  try {
    const turn = await client.complete({
      system:
        "You are a connectivity test. Reply with the single word: pong. No punctuation.",
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      tools: [],
      maxTokens: 32,
    });
    return Response.json({
      ok: true,
      latencyMs: Date.now() - started,
      model: candidate.model,
      reply: (turn.text || "").trim().slice(0, 120),
    });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message.slice(0, 400) : "Connection failed.",
        latencyMs: Date.now() - started,
      },
      { status: 502 },
    );
  }
}
