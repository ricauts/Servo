// AI settings resolution. Values live in the Setting table; the Anthropic API
// key can also come from the environment, which always wins over the DB copy.
// When the anthropic provider is selected but no key exists anywhere we fall
// back to the deterministic mock provider so the demo works offline.

import { db } from "@/lib/db";
import { SETTING_KEYS } from "@/lib/types";

export interface AiSettings {
  provider: "anthropic" | "mock";
  apiKey: string;
  baseUrl?: string;
  model: string;
  autoTriage: boolean;
  qaEnabled: boolean;
  keySource: "env" | "db" | "none";
}

export const DEFAULT_MODEL = "claude-opus-5";

export async function getAiSettings(): Promise<AiSettings> {
  const rows = await db.setting.findMany();
  const map = new Map(rows.map((row) => [row.key, row.value]));

  const envKey = process.env.ANTHROPIC_API_KEY ?? "";
  const dbKey = map.get(SETTING_KEYS.apiKey) ?? "";
  const apiKey = envKey || dbKey;
  const keySource: AiSettings["keySource"] = envKey ? "env" : dbKey ? "db" : "none";

  let provider: AiSettings["provider"] =
    map.get(SETTING_KEYS.provider) === "anthropic" ? "anthropic" : "mock";
  // BYOK: without a key the anthropic provider cannot work — use the mock.
  if (provider === "anthropic" && !apiKey) provider = "mock";

  return {
    provider,
    apiKey,
    baseUrl: map.get(SETTING_KEYS.baseUrl) || undefined,
    model: map.get(SETTING_KEYS.model) || DEFAULT_MODEL,
    autoTriage: (map.get(SETTING_KEYS.autoTriage) ?? "true") === "true",
    qaEnabled: (map.get(SETTING_KEYS.qaEnabled) ?? "true") === "true",
    keySource,
  };
}
