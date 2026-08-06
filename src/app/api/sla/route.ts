import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { ensureSlaPolicies } from "@/lib/sla";
import { PRIORITIES } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  await ensureSlaPolicies();
  const policies = await db.slaPolicy.findMany();
  // Return in priority order rather than alphabetical.
  const byPriority = new Map(policies.map((p) => [p.priority, p]));
  return Response.json({
    policies: PRIORITIES.map((priority) => byPriority.get(priority)).filter(Boolean),
  });
}

const putSchema = z.object({
  priority: z.enum(PRIORITIES as [string, ...string[]]),
  responseMinutes: z.number().int().min(1).max(60 * 24 * 30),
  resolutionMinutes: z.number().int().min(1).max(60 * 24 * 90),
  escalateOnBreach: z.boolean(),
});

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }
  const { priority, ...data } = parsed.data;
  if (data.responseMinutes > data.resolutionMinutes) {
    return Response.json(
      { error: "The response target must not exceed the resolution target." },
      { status: 400 },
    );
  }

  const policy = await db.slaPolicy.upsert({
    where: { priority },
    create: { priority, ...data },
    update: data,
  });
  return Response.json({ policy });
}
