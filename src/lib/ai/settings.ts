// AI settings resolution. Values live in the Setting table; API keys can also
// come from the environment (ANTHROPIC_API_KEY / OPENAI_API_KEY depending on
// the provider kind), which always wins over the DB copy. When the selected
// provider cannot work (no key, and no base URL for keyless local endpoints)
// we fall back to the deterministic mock provider so the demo never breaks.

import { db } from "@/lib/db";
import { SETTING_KEYS } from "@/lib/types";

/**
 * - `anthropic` — the Anthropic API or any Anthropic-compatible endpoint
 *   via the base URL.
 * - `zai` — Z.AI's GLM models as a first-class provider (own key env var
 *   and default endpoint; no base URL needed).
 * - `openai` — any OpenAI-compatible Chat Completions endpoint: OpenAI,
 *   Azure OpenAI, Ollama, vLLM, …
 * - `mock` — deterministic offline provider (the default).
 */
export type AiProviderKind = "anthropic" | "zai" | "openai" | "mock";

/** Z.AI's native endpoint, used when the zai provider has no base URL. */
export const ZAI_DEFAULT_BASE_URL = "https://api.z.ai/api/anthropic";
export const ZAI_DEFAULT_MODEL = "glm-5.2";

export interface AiSettings {
  /** Effective provider after the no-credentials fallback to mock. */
  provider: AiProviderKind;
  /** Provider as configured in Settings (before any fallback). */
  configuredProvider: AiProviderKind;
  apiKey: string;
  baseUrl?: string;
  model: string;
  autoTriage: boolean;
  qaEnabled: boolean;
  keySource: "env" | "db" | "none";
}

export const DEFAULT_MODEL = "claude-opus-5";

/** The env var consulted for each provider kind. */
export function envKeyNameFor(provider: AiProviderKind): string | null {
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  if (provider === "zai") return "ZAI_API_KEY";
  if (provider === "openai") return "OPENAI_API_KEY";
  return null;
}

function isProviderKind(v: string | undefined): v is AiProviderKind {
  return v === "anthropic" || v === "zai" || v === "openai" || v === "mock";
}

/**
 * Whether a non-mock provider has enough configuration to run: a key, or a
 * base URL alone for keyless local endpoints (e.g. Ollama on localhost).
 */
export function providerUsable(p: {
  provider: AiProviderKind;
  apiKey: string;
  baseUrl?: string;
}): boolean {
  if (p.provider === "mock") return true;
  if (p.apiKey) return true; // zai/anthropic always need a key
  return p.provider === "openai" && Boolean(p.baseUrl);
}

export async function getAiSettings(): Promise<AiSettings> {
  const rows = await db.setting.findMany();
  const map = new Map(rows.map((row) => [row.key, row.value]));

  const stored = map.get(SETTING_KEYS.provider);
  const configuredProvider: AiProviderKind = isProviderKind(stored)
    ? stored
    : "mock";

  const envName = envKeyNameFor(configuredProvider);
  const envKey = (envName && process.env[envName]) || "";
  const dbKey = map.get(SETTING_KEYS.apiKey) ?? "";
  const apiKey = envKey || dbKey;
  const keySource: AiSettings["keySource"] = envKey ? "env" : dbKey ? "db" : "none";

  const baseUrl = map.get(SETTING_KEYS.baseUrl) || undefined;
  const provider = providerUsable({ provider: configuredProvider, apiKey, baseUrl })
    ? configuredProvider
    : "mock";

  return {
    provider,
    configuredProvider,
    apiKey,
    baseUrl,
    model: map.get(SETTING_KEYS.model) || DEFAULT_MODEL,
    autoTriage: (map.get(SETTING_KEYS.autoTriage) ?? "true") === "true",
    qaEnabled: (map.get(SETTING_KEYS.qaEnabled) ?? "true") === "true",
    keySource,
  };
}
