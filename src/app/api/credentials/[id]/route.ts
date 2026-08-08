import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/credentials/[id] — agents using it fall back to the default. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const { id } = await params;
  const existing = await db.aiCredential.findUnique({ where: { id } });
  if (!existing) {
    return Response.json({ error: "Credential not found" }, { status: 404 });
  }

  await db.$transaction([
    db.agentProfile.updateMany({
      where: { credentialId: id },
      data: { credentialId: null },
    }),
    db.aiCredential.delete({ where: { id } }),
  ]);
  return Response.json({ ok: true });
}
