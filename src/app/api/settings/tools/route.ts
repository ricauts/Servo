import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";

const putSchema = z.object({
  toolName: z.string(),
  enabled: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
});

/** PUT /api/settings/tools — update one tool policy (admin only). */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  const forbidden = forbid(user, "settings.manage");
  if (forbidden) return forbidden;

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid body: expected { toolName, enabled?, requiresApproval?, riskLevel? }." },
      { status: 400 },
    );
  }
  const { toolName, enabled, requiresApproval, riskLevel } = parsed.data;

  const policy = await db.toolPolicy.findUnique({ where: { toolName } });
  if (!policy) {
    return Response.json({ error: "Tool policy not found" }, { status: 404 });
  }

  await db.toolPolicy.update({
    where: { toolName },
    data: {
      ...(enabled !== undefined ? { enabled } : {}),
      ...(requiresApproval !== undefined ? { requiresApproval } : {}),
      ...(riskLevel !== undefined ? { riskLevel } : {}),
    },
  });

  const toolPolicies = await db.toolPolicy.findMany({ orderBy: { toolName: "asc" } });
  return Response.json({ toolPolicies });
}
