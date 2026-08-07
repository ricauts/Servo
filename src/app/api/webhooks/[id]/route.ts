import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { sendTestPing, WEBHOOK_EVENTS } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  url: z.string().url().max(1000).optional(),
  events: z
    .array(z.enum(["*", ...WEBHOOK_EVENTS] as [string, ...string[]]))
    .min(1)
    .optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const { id } = await params;
  const existing = await db.webhook.findUnique({ where: { id } });
  if (!existing) {
    return Response.json({ error: "Webhook not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  const hook = await db.webhook.update({
    where: { id },
    data: {
      ...(parsed.data.url !== undefined ? { url: parsed.data.url } : {}),
      ...(parsed.data.events !== undefined
        ? { events: JSON.stringify(parsed.data.events) }
        : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
    },
  });
  return Response.json({
    webhook: { id: hook.id, url: hook.url, events: JSON.parse(hook.events), enabled: hook.enabled },
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const { id } = await params;
  const existing = await db.webhook.findUnique({ where: { id } });
  if (!existing) {
    return Response.json({ error: "Webhook not found" }, { status: 404 });
  }
  await db.webhook.delete({ where: { id } });
  return Response.json({ ok: true });
}

/** POST /api/webhooks/[id]/test is nicer REST-wise, but a query action keeps
 * the route count down for the POC: POST /api/webhooks/[id]?action=test */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const { id } = await params;
  if (req.nextUrl.searchParams.get("action") !== "test") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  const hook = await db.webhook.findUnique({ where: { id } });
  if (!hook) {
    return Response.json({ error: "Webhook not found" }, { status: 404 });
  }

  await sendTestPing(hook.id, user.name);
  const last = await db.webhookDelivery.findFirst({
    where: { webhookId: id },
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ delivery: last });
}
