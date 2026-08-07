import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { newWebhookSecret, WEBHOOK_EVENTS } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

/** Webhook payload with the secret redacted; deliveries newest-first. */
const webhookInclude = {
  deliveries: { orderBy: { createdAt: "desc" as const }, take: 5 },
} as const;

function view(hook: {
  id: string;
  url: string;
  events: string;
  enabled: boolean;
  createdAt: Date;
  deliveries: {
    id: string;
    event: string;
    ok: boolean;
    statusCode: number | null;
    error: string | null;
    durationMs: number;
    createdAt: Date;
  }[];
}) {
  return {
    id: hook.id,
    url: hook.url,
    events: JSON.parse(hook.events) as string[],
    enabled: hook.enabled,
    createdAt: hook.createdAt,
    deliveries: hook.deliveries,
  };
}

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const hooks = await db.webhook.findMany({
    include: webhookInclude,
    orderBy: { createdAt: "asc" },
  });
  return Response.json({ webhooks: hooks.map(view) });
}

const createSchema = z.object({
  url: z.string().url("A valid URL is required").max(1000),
  events: z
    .array(z.enum(["*", ...WEBHOOK_EVENTS] as [string, ...string[]]))
    .min(1, "Subscribe to at least one event")
    .default(["*"]),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  const secret = newWebhookSecret();
  const hook = await db.webhook.create({
    data: {
      url: parsed.data.url,
      events: JSON.stringify(parsed.data.events),
      secret,
    },
    include: webhookInclude,
  });
  // The secret is shown exactly once, at creation, so the admin can store it.
  return Response.json({ webhook: view(hook), secret }, { status: 201 });
}
