import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { parseProfileMarkdown, slugify } from "@/lib/agent-profiles";
import { TOOLS } from "@/lib/ai/tools";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "agents.view");
  if (denied) return denied;

  const profiles = await db.agentProfile.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { runs: true } } },
  });
  return Response.json({ profiles });
}

const createSchema = z.object({
  markdown: z.string().min(1, "The agent definition (.md) is required"),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "agents.manage");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  let profile;
  try {
    profile = parseProfileMarkdown(parsed.data.markdown, {
      knownTools: Object.keys(TOOLS),
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid agent document." },
      { status: 400 },
    );
  }

  const slug = slugify(profile.name);
  const existing = await db.agentProfile.findUnique({ where: { slug } });
  if (existing) {
    return Response.json(
      { error: `An agent named "${profile.name}" already exists.` },
      { status: 409 },
    );
  }

  const created = await db.agentProfile.create({
    data: {
      slug,
      name: profile.name,
      description: profile.description,
      categories: JSON.stringify(profile.categories),
      tools: JSON.stringify(profile.tools),
      systemPrompt: profile.systemPrompt,
      markdown: parsed.data.markdown,
    },
  });
  return Response.json({ profile: created }, { status: 201 });
}
