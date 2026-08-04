import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { groupInclude } from "@/lib/groups";
import { CATEGORIES } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "group.view");
  if (denied) return denied;

  const groups = await db.group.findMany({
    include: groupInclude,
    orderBy: { createdAt: "asc" },
  });
  return Response.json({ groups });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(60),
  description: z.string().trim().max(300).default(""),
  categories: z.array(z.enum(CATEGORIES as [string, ...string[]])).default([]),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "group.manage");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  const existing = await db.group.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return Response.json(
      { error: `A group named "${parsed.data.name}" already exists.` },
      { status: 409 },
    );
  }

  const group = await db.group.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      categories: JSON.stringify(parsed.data.categories),
    },
    include: groupInclude,
  });
  return Response.json({ group }, { status: 201 });
}
