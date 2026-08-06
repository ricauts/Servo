import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import {
  azureConfigured,
  getAzureConfig,
  getAzureToken,
  listResources,
} from "@/lib/integrations/azure";

export const dynamic = "force-dynamic";

const testSchema = z.object({
  // Optional overrides so the form can test unsaved values.
  tenantId: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  subscriptionId: z.string().optional(),
});

/**
 * POST /api/settings/test-azure — acquire a token and run one read-only
 * resource listing, so a saved config is proven end to end.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = testSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "Invalid test payload." }, { status: 400 });
  }

  const stored = await getAzureConfig();
  const config = {
    ...stored,
    tenantId: parsed.data.tenantId || stored.tenantId,
    clientId: parsed.data.clientId || stored.clientId,
    clientSecret: parsed.data.clientSecret || stored.clientSecret,
    subscriptionId: parsed.data.subscriptionId || stored.subscriptionId,
  };
  if (!azureConfigured(config)) {
    return Response.json(
      {
        error:
          "Azure needs tenant id, client id, client secret and subscription id (env or Settings).",
      },
      { status: 400 },
    );
  }

  const started = Date.now();
  try {
    await getAzureToken(config);
    const listing = await listResources(config);
    const resourceCount = listing.startsWith("No resources")
      ? 0
      : Number(listing.match(/^(\d+) resource/)?.[1] ?? 0);
    return Response.json({
      ok: true,
      latencyMs: Date.now() - started,
      resourceCount,
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
