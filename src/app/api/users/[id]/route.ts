import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  role: z.enum(["ADMIN", "AGENT", "REQUESTER"]),
});

/** PATCH /api/users/[id] — change a human user's role (admin only). */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const { id } = await params;
  if (id === user.id) {
    return Response.json(
      { error: "You cannot change your own role." },
      { status: 400 },
    );
  }
  const target = await db.user.findUnique({ where: { id } });
  if (!target) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }
  if (target.role === "AI_AGENT") {
    return Response.json(
      { error: "System AI agents cannot change role." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid role." }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id },
    data: { role: parsed.data.role },
    select: { id: true, name: true, role: true },
  });
  return Response.json({ user: updated });
}
