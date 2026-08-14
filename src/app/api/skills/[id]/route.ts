import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { parseSkillMarkdown } from "@/lib/skills";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  markdown: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

/**
 * Edit a skill's document or retract it (`enabled: false`).
 *
 * The slug is deliberately immutable: it is the handle read_skill takes and
 * the key syncSkills() matches a bundled skills/<slug>/SKILL.md on. Letting a
 * rename move it would make the next upgrade re-create the original document
 * alongside the renamed one. Rename freely inside the frontmatter — the
 * display name changes, the handle does not.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "skills.manage");
  if (denied) return denied;

  const { id } = await params;
  const existing = await db.skill.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "Skill not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.markdown !== undefined) {
    let skill;
    try {
      skill = parseSkillMarkdown(parsed.data.markdown);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Invalid skill document." },
        { status: 400 },
      );
    }
    data.name = skill.name;
    data.description = skill.description;
    data.categories = JSON.stringify(skill.categories);
    data.body = skill.body;
    data.markdown = parsed.data.markdown;
  }
  if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;

  const updated = await db.skill.update({ where: { id }, data });
  return Response.json({ skill: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "skills.manage");
  if (denied) return denied;

  const { id } = await params;
  const existing = await db.skill.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "Skill not found" }, { status: 404 });

  await db.skill.delete({ where: { id } });
  return Response.json({ ok: true });
}
