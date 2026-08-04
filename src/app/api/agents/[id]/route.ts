import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { parseProfileMarkdown, slugify } from "@/lib/agent-profiles";
import { TOOLS } from "@/lib/ai/tools";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  markdown: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "agents.manage");
  if (denied) return denied;

  const { id } = await params;
  const existing = await db.agentProfile.findUnique({ where: { id } });
  if (!existing) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  let data: Record<string, unknown> = {};
  if (parsed.data.markdown !== undefined) {
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
    if (slug !== existing.slug) {
      const clash = await db.agentProfile.findUnique({ where: { slug } });
      if (clash) {
        return Response.json(
          { error: `An agent named "${profile.name}" already exists.` },
          { status: 409 },
        );
      }
    }
    data = {
      slug,
      name: profile.name,
      description: profile.description,
      categories: JSON.stringify(profile.categories),
      tools: JSON.stringify(profile.tools),
      systemPrompt: profile.systemPrompt,
      markdown: parsed.data.markdown,
    };
  }
  if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;

  const updated = await db.agentProfile.update({ where: { id }, data });
  return Response.json({ profile: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "agents.manage");
  if (denied) return denied;

  const { id } = await params;
  const existing = await db.agentProfile.findUnique({ where: { id } });
  if (!existing) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  await db.$transaction([
    // Past runs keep their trace; they just lose the profile reference.
    db.agentRun.updateMany({ where: { profileId: id }, data: { profileId: null } }),
    db.agentProfile.delete({ where: { id } }),
  ]);
  return Response.json({ ok: true });
}
