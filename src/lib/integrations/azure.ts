// Azure integration: read-only Resource Manager queries via a service
// principal (client-credentials flow). Deliberately read-only — mutating
// cloud actions stay simulated behind the approval gate in this POC.
// Config follows the BYOK pattern: env wins over Settings, and the client
// secret is never returned by any API.

import { db } from "@/lib/db";

export const AZURE_SETTING_KEYS = {
  tenantId: "integration.azure.tenantId",
  clientId: "integration.azure.clientId",
  clientSecret: "integration.azure.clientSecret", // never returned by the API
  subscriptionId: "integration.azure.subscriptionId",
} as const;

export interface AzureConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  subscriptionId: string;
  secretSource: "env" | "db" | "none";
}

/** True when every field needed for a token request is present. */
export function azureConfigured(config: AzureConfig): boolean {
  return Boolean(
    config.tenantId && config.clientId && config.clientSecret && config.subscriptionId,
  );
}

export async function getAzureConfig(): Promise<AzureConfig> {
  const rows = await db.setting.findMany({
    where: { key: { in: Object.values(AZURE_SETTING_KEYS) } },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const envSecret = process.env.AZURE_CLIENT_SECRET ?? "";
  const dbSecret = map.get(AZURE_SETTING_KEYS.clientSecret) ?? "";
  return {
    tenantId: process.env.AZURE_TENANT_ID || map.get(AZURE_SETTING_KEYS.tenantId) || "",
    clientId: process.env.AZURE_CLIENT_ID || map.get(AZURE_SETTING_KEYS.clientId) || "",
    clientSecret: envSecret || dbSecret,
    subscriptionId:
      process.env.AZURE_SUBSCRIPTION_ID || map.get(AZURE_SETTING_KEYS.subscriptionId) || "",
    secretSource: envSecret ? "env" : dbSecret ? "db" : "none",
  };
}

/** Base URLs are overridable so tests can point at a local fake. */
const LOGIN_URL = process.env.AZURE_LOGIN_URL ?? "https://login.microsoftonline.com";
const ARM_URL = process.env.AZURE_ARM_URL ?? "https://management.azure.com";

/** Client-credentials token for the ARM scope. Throws with the AAD error. */
export async function getAzureToken(config: AzureConfig): Promise<string> {
  const res = await fetch(`${LOGIN_URL}/${config.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: `${ARM_URL}/.default`,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Azure auth failed (${res.status}): ${data.error_description ?? data.error ?? "no token returned"}`,
    );
  }
  return data.access_token;
}

interface ArmResource {
  name?: string;
  type?: string;
  location?: string;
  id?: string;
}

/**
 * List resources in the subscription, optionally scoped to a resource group.
 * Read-only: ARM GET only, no mutations anywhere in this module.
 */
export async function listResources(
  config: AzureConfig,
  resourceGroup?: string,
): Promise<string> {
  const token = await getAzureToken(config);
  const scope = resourceGroup
    ? `/subscriptions/${config.subscriptionId}/resourceGroups/${resourceGroup}/resources`
    : `/subscriptions/${config.subscriptionId}/resources`;
  const res = await fetch(`${ARM_URL}${scope}?api-version=2021-04-01&$top=50`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    value?: ArmResource[];
    error?: { message?: string };
  };
  if (!res.ok) {
    return `Azure error ${res.status}: ${data.error?.message ?? "request failed"}`;
  }
  const resources = data.value ?? [];
  if (resources.length === 0) {
    return resourceGroup
      ? `No resources found in resource group ${resourceGroup}.`
      : "No resources found in the subscription.";
  }
  const lines = resources
    .slice(0, 50)
    .map((r) => `- ${r.name ?? "?"} (${r.type ?? "?"}) in ${r.location ?? "?"}`);
  return [
    `${resources.length} resource(s)${resourceGroup ? ` in ${resourceGroup}` : ""}:`,
    ...lines,
  ].join("\n");
}
