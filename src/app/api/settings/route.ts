import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAiSettings } from "@/lib/ai/settings";
import { getSmtpConfig } from "@/lib/notify";
import { getGithubConfig, GITHUB_SETTING_KEYS } from "@/lib/integrations/github";
import { azureConfigured, getAzureConfig, AZURE_SETTING_KEYS } from "@/lib/integrations/azure";
import { getInboundConfig, INBOUND_SETTING_KEYS } from "@/lib/inbound-email";
import { AUTH_SETTING_KEYS } from "@/lib/authjs";
import { forbid } from "@/lib/permissions";
import { SETTING_KEYS } from "@/lib/types";

/** Shared GET/PUT response. Stored secrets (API key, SMTP URL) are NEVER returned. */
async function settingsPayload() {
  const rows = await db.setting.findMany();
  const settings: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === SETTING_KEYS.apiKey) continue; // never leak the key
    if (row.key === SETTING_KEYS.smtpUrl) continue; // may embed credentials
    if (row.key === GITHUB_SETTING_KEYS.token) continue; // never leak the token
    if (row.key === AZURE_SETTING_KEYS.clientSecret) continue; // never leak the secret
    if (row.key === INBOUND_SETTING_KEYS.secret) continue; // never leak the secret
    if (row.key === AUTH_SETTING_KEYS.clientSecret) continue; // never leak the secret
    settings[row.key] = row.value;
  }
  const [ai, smtp, github, azure, inbound] = await Promise.all([
    getAiSettings(),
    getSmtpConfig(),
    getGithubConfig(),
    getAzureConfig(),
    getInboundConfig(),
  ]);
  const toolPolicies = await db.toolPolicy.findMany({ orderBy: { toolName: "asc" } });
  return {
    settings,
    apiKeySet: ai.apiKey.length > 0,
    keySource: ai.keySource,
    smtpUrlSet: smtp.url.length > 0,
    smtpUrlSource: smtp.urlSource,
    githubTokenSet: github.token.length > 0,
    githubTokenSource: github.tokenSource,
    azureConfigured: azureConfigured(azure),
    azureSecretSource: azure.secretSource,
    inboundSecretSet: inbound.secret.length > 0,
    inboundSecretSource: inbound.secretSource,
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
  provider: z.enum(["anthropic", "zai", "openai", "mock"]).optional(),
  apiKey: z.string().optional(), // empty string clears the stored key
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  autoTriage: z.boolean().optional(),
  qaEnabled: z.boolean().optional(),
  smtpEnabled: z.boolean().optional(),
  smtpUrl: z.string().optional(), // empty string clears the stored URL
  smtpFrom: z.string().optional(),
  githubToken: z.string().optional(), // empty string clears the stored token
  githubOwner: z.string().optional(),
  githubApiUrl: z.string().optional(),
  azureTenantId: z.string().optional(),
  azureClientId: z.string().optional(),
  azureClientSecret: z.string().optional(), // empty string clears the stored secret
  azureSubscriptionId: z.string().optional(),
  inboundEnabled: z.boolean().optional(),
  inboundSecret: z.string().optional(), // empty string clears the stored secret
  authIssuer: z.string().optional(),
  authClientId: z.string().optional(),
  authClientSecret: z.string().optional(), // empty string disables SSO
  authProviderName: z.string().optional(),
  authAdminEmails: z.string().optional(),
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
  if (data.smtpEnabled !== undefined) {
    updates.push({ key: SETTING_KEYS.smtpEnabled, value: String(data.smtpEnabled) });
  }
  if (data.smtpUrl !== undefined) updates.push({ key: SETTING_KEYS.smtpUrl, value: data.smtpUrl });
  if (data.smtpFrom !== undefined) updates.push({ key: SETTING_KEYS.smtpFrom, value: data.smtpFrom });
  if (data.githubToken !== undefined) {
    updates.push({ key: GITHUB_SETTING_KEYS.token, value: data.githubToken });
  }
  if (data.githubOwner !== undefined) {
    updates.push({ key: GITHUB_SETTING_KEYS.owner, value: data.githubOwner });
  }
  if (data.githubApiUrl !== undefined) {
    updates.push({ key: GITHUB_SETTING_KEYS.apiUrl, value: data.githubApiUrl });
  }
  if (data.azureTenantId !== undefined) {
    updates.push({ key: AZURE_SETTING_KEYS.tenantId, value: data.azureTenantId });
  }
  if (data.azureClientId !== undefined) {
    updates.push({ key: AZURE_SETTING_KEYS.clientId, value: data.azureClientId });
  }
  if (data.azureClientSecret !== undefined) {
    updates.push({ key: AZURE_SETTING_KEYS.clientSecret, value: data.azureClientSecret });
  }
  if (data.azureSubscriptionId !== undefined) {
    updates.push({ key: AZURE_SETTING_KEYS.subscriptionId, value: data.azureSubscriptionId });
  }
  if (data.inboundEnabled !== undefined) {
    updates.push({ key: INBOUND_SETTING_KEYS.enabled, value: String(data.inboundEnabled) });
  }
  if (data.inboundSecret !== undefined) {
    updates.push({ key: INBOUND_SETTING_KEYS.secret, value: data.inboundSecret });
  }
  if (data.authIssuer !== undefined) updates.push({ key: AUTH_SETTING_KEYS.issuer, value: data.authIssuer });
  if (data.authClientId !== undefined) updates.push({ key: AUTH_SETTING_KEYS.clientId, value: data.authClientId });
  if (data.authClientSecret !== undefined) updates.push({ key: AUTH_SETTING_KEYS.clientSecret, value: data.authClientSecret });
  if (data.authProviderName !== undefined) updates.push({ key: AUTH_SETTING_KEYS.providerName, value: data.authProviderName });
  if (data.authAdminEmails !== undefined) updates.push({ key: AUTH_SETTING_KEYS.adminEmails, value: data.authAdminEmails });

  for (const update of updates) {
    await db.setting.upsert({
      where: { key: update.key },
      create: update,
      update: { value: update.value },
    });
  }

  return Response.json(await settingsPayload());
}
