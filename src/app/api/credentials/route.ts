import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/** GET /api/credentials — the pool, keys redacted (admin only). */
export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const credentials = await db.aiCredential.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { profiles: true } } },
  });
  return Response.json({
    credentials: credentials.map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      model: c.model,
      baseUrl: c.baseUrl,
      inUse: c._count.profiles,
    })),
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(60),
  provider: z.enum(["anthropic", "zai", "openai"]),
  apiKey: z.string().min(1, "An API key is required").max(500),
  baseUrl: z.string().trim().max(500).default(""),
  model: z.string().trim().max(100).default(""),
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

  const existing = await db.aiCredential.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return Response.json(
      { error: `A credential named "${parsed.data.name}" already exists.` },
      { status: 409 },
    );
  }

  const credential = await db.aiCredential.create({ data: parsed.data });
  return Response.json(
    {
      credential: {
        id: credential.id,
        name: credential.name,
        provider: credential.provider,
        model: credential.model,
        baseUrl: credential.baseUrl,
        inUse: 0,
      },
    },
    { status: 201 },
  );
}
