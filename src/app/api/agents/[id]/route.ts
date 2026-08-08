import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { parseProfileMarkdown, setProfileTools, slugify } from "@/lib/agent-profiles";
import { getToolRegistry } from "@/lib/ai/custom-tools";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  markdown: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  // Visual tool picker: replaces the profile's allowlist without hand-editing
  // the YAML. Empty array = every enabled tool (the profile's default).
  tools: z.array(z.string()).optional(),
  // Pool credential this agent runs on; null reverts to the default config.
  credentialId: z.string().nullable().optional(),
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
        knownTools: Object.keys(await getToolRegistry()),
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

  // Visual tool picker: rewrite the allowlist (and the .md frontmatter that
  // mirrors it) when the caller didn't already send a full markdown replace.
  if (parsed.data.tools !== undefined && parsed.data.markdown === undefined) {
    const known = Object.keys(await getToolRegistry());
    const unknown = parsed.data.tools.filter((t) => !known.includes(t));
    if (unknown.length > 0) {
      return Response.json(
        { error: `Unknown tool(s): ${unknown.join(", ")}.` },
        { status: 400 },
      );
    }
    data.tools = JSON.stringify(parsed.data.tools);
    data.markdown = setProfileTools(existing.markdown, parsed.data.tools);
  }

  if (parsed.data.credentialId !== undefined) {
    if (parsed.data.credentialId !== null) {
      const credential = await db.aiCredential.findUnique({
        where: { id: parsed.data.credentialId },
      });
      if (!credential) {
        return Response.json({ error: "Credential not found." }, { status: 400 });
      }
    }
    data.credentialId = parsed.data.credentialId;
  }

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
