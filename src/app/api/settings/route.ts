import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAiSettings } from "@/lib/ai/settings";
import { forbid } from "@/lib/permissions";
import { SETTING_KEYS } from "@/lib/types";

/** Shared GET/PUT response. The stored API key is NEVER returned. */
async function settingsPayload() {
  const rows = await db.setting.findMany();
  const settings: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === SETTING_KEYS.apiKey) continue; // never leak the key
    settings[row.key] = row.value;
  }
  const ai = await getAiSettings();
  const toolPolicies = await db.toolPolicy.findMany({ orderBy: { toolName: "asc" } });
  return {
    settings,
    apiKeySet: ai.apiKey.length > 0,
    keySource: ai.keySource,
    toolPolicies,
  };
}

/** GET /api/settings — AI settings + tool policies (admin only). */
export async function GET() {
  const user = await getCurrentUser();
  const forbidden = forbid(user, "settings.manage");
  if (forbidden) return forbidden;
  return Response.json(await settingsPayload());
}

const putSchema = z.object({
  provider: z.enum(["anthropic", "mock"]).optional(),
  apiKey: z.string().optional(), // empty string clears the stored key
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  autoTriage: z.boolean().optional(),
  qaEnabled: z.boolean().optional(),
});

/** PUT /api/settings — upsert any subset of the AI settings (admin only). */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  const forbidden = forbid(user, "settings.manage");
  if (forbidden) return forbidden;

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid settings payload." }, { status: 400 });
  }
  const data = parsed.data;

  const updates: { key: string; value: string }[] = [];
  if (data.provider !== undefined) updates.push({ key: SETTING_KEYS.provider, value: data.provider });
  if (data.apiKey !== undefined) updates.push({ key: SETTING_KEYS.apiKey, value: data.apiKey });
  if (data.baseUrl !== undefined) updates.push({ key: SETTING_KEYS.baseUrl, value: data.baseUrl });
  if (data.model !== undefined) updates.push({ key: SETTING_KEYS.model, value: data.model });
  if (data.autoTriage !== undefined) {
    updates.push({ key: SETTING_KEYS.autoTriage, value: String(data.autoTriage) });
  }
  if (data.qaEnabled !== undefined) {
    updates.push({ key: SETTING_KEYS.qaEnabled, value: String(data.qaEnabled) });
  }

  for (const update of updates) {
    await db.setting.upsert({
      where: { key: update.key },
      create: update,
      update: { value: update.value },
    });
  }

  return Response.json(await settingsPayload());
}
