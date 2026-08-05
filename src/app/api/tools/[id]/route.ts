import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { HTTP_METHODS } from "@/lib/ai/custom-tools";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function validJsonObject(text: string): boolean {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

// The tool name is immutable after creation — it is the identity the policy
// row and past run steps reference.
const patchSchema = z.object({
  description: z.string().trim().min(1).max(300).optional(),
  inputSchema: z
    .string()
    .refine(validJsonObject, "Input schema must be a JSON object")
    .optional(),
  method: z.enum(HTTP_METHODS).optional(),
  url: z.string().trim().min(1).max(1000).optional(),
  headers: z
    .string()
    .refine(validJsonObject, "Headers must be a JSON object")
    .optional(),
  bodyTemplate: z.string().max(4000).optional(),
  // Empty string clears the stored secret; omit to keep it.
  secret: z.string().max(500).optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  requiresApproval: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const { id } = await params;
  const existing = await db.customTool.findUnique({ where: { id } });
  if (!existing) {
    return Response.json({ error: "Custom tool not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }
  const { riskLevel, requiresApproval, ...toolFields } = parsed.data;

  const [updated] = await db.$transaction([
    db.customTool.update({ where: { id }, data: toolFields }),
    db.toolPolicy.update({
      where: { toolName: existing.name },
      data: {
        ...(toolFields.description !== undefined
          ? { description: toolFields.description }
          : {}),
        ...(riskLevel !== undefined ? { riskLevel } : {}),
        ...(requiresApproval !== undefined ? { requiresApproval } : {}),
      },
    }),
  ]);

  const { secret, ...rest } = updated;
  return Response.json({ tool: { ...rest, secretSet: secret.length > 0 } });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const { id } = await params;
  const existing = await db.customTool.findUnique({ where: { id } });
  if (!existing) {
    return Response.json({ error: "Custom tool not found" }, { status: 404 });
  }

  await db.$transaction([
    db.toolPolicy.deleteMany({ where: { toolName: existing.name } }),
    db.customTool.delete({ where: { id } }),
  ]);
  return Response.json({ ok: true });
}
