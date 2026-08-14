// Skill tools — the desk's agreed procedures, loaded on demand.
//
// The resolver's system prompt carries only the catalogue (slug + description);
// the body costs one call to read_skill. That is the whole point: a desk can
// hold fifty procedures without fifty procedures sitting in every prompt.
//
// Read-only by design. A skill tells an agent what to do; it never does it, so
// there is nothing here to gate. The gate still applies to whatever the
// procedure tells the agent to call.

import { db } from "@/lib/db";
import { enabledSkillCatalog, parseCategories } from "@/lib/skills";
import { RESULT_LIMIT, str, type ToolDef } from "./types";

/** Slugs an agent could have asked for instead, for the not-found message. */
async function availableSlugs(): Promise<string> {
  const catalog = await enabledSkillCatalog();
  if (catalog.length === 0) return "This desk has no skills yet.";
  return `Available skills: ${catalog.map((s) => s.slug).join(", ")}.`;
}

export const skillTools: Record<string, ToolDef> = {
  read_skill: {
    name: "read_skill",
    description:
      "Load the full text of one of this desk's skills — the procedure the desk has agreed to follow for a class of request. The slugs are listed in your system prompt under 'Desk skills'. Read the relevant skill before acting on a ticket it covers.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description: "The skill's slug, exactly as listed under 'Desk skills'.",
        },
      },
      required: ["slug"],
    },
    async execute(input) {
      const slug = str(input.slug).trim().toLowerCase();
      if (!slug) return `Error: slug is required. ${await availableSlugs()}`;

      const skill = await db.skill.findUnique({ where: { slug } });
      if (!skill) return `Error: no skill named "${slug}". ${await availableSlugs()}`;
      // A disabled skill is one the desk has retracted; reading it would mean
      // following a procedure the desk no longer stands behind.
      if (!skill.enabled) {
        return `Error: the skill "${slug}" is disabled and must not be followed. ${await availableSlugs()}`;
      }

      const categories = parseCategories(skill.categories);
      const scope =
        categories.length === 0 ? "every ticket" : categories.join(", ");
      const header = `# ${skill.name}\n\nApplies to: ${scope}\n\n`;
      const body = skill.body.slice(0, Math.max(0, RESULT_LIMIT - header.length));
      const truncated = body.length < skill.body.length ? "\n\n…(truncated)" : "";
      return `${header}${body}${truncated}`;
    },
  },
};
