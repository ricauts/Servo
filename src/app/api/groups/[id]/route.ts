import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { groupInclude } from "@/lib/groups";
import { CATEGORIES, SENIORITIES } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(300).optional(),
  categories: z.array(z.enum(CATEGORIES as [string, ...string[]])).optional(),
  // When present, replaces the full membership set.
  members: z
    .array(
      z.object({
        userId: z.string().min(1),
        seniority: z.enum(SENIORITIES as [string, ...string[]]),
      }),
    )
    .optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "group.manage");
  if (denied) return denied;

  const { id } = await params;
  const group = await db.group.findUnique({ where: { id } });
  if (!group) {
    return Response.json({ error: "Group not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }
  const { name, description, categories, members } = parsed.data;

  if (members) {
    // Memberships describe humans working the queue; AI agents run via runs.
    const users = await db.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, role: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const m of members) {
      const u = byId.get(m.userId);
      if (!u) {
        return Response.json(
          { error: `User ${m.userId} not found.` },
          { status: 400 },
        );
      }
      if (u.role === "AI_AGENT" || u.role === "REQUESTER") {
        return Response.json(
          { error: "Only ADMIN and AGENT users can join groups." },
          { status: 400 },
        );
      }
    }
  }

  const updated = await db.$transaction(async (tx) => {
    if (members) {
      await tx.groupMember.deleteMany({ where: { groupId: id } });
      await tx.groupMember.createMany({
        data: members.map((m) => ({
          groupId: id,
          userId: m.userId,
          seniority: m.seniority,
        })),
      });
    }
    return tx.group.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(categories !== undefined
          ? { categories: JSON.stringify(categories) }
          : {}),
      },
      include: groupInclude,
    });
  });

  return Response.json({ group: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "group.manage");
  if (denied) return denied;

  const { id } = await params;
  const group = await db.group.findUnique({ where: { id } });
  if (!group) {
    return Response.json({ error: "Group not found" }, { status: 404 });
  }

  await db.$transaction([
    db.ticket.updateMany({ where: { groupId: id }, data: { groupId: null } }),
    db.group.delete({ where: { id } }),
  ]);
  return Response.json({ ok: true });
}
