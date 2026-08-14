// Database helpers for desk skills. Pure parsing/validation and catalogue
// rendering live in skill-format.ts.

import { db } from "@/lib/db";
import type { SkillCatalogEntry } from "@/lib/skill-format";

export {
  orderCatalogFor,
  parseSkillMarkdown,
  skillAppliesTo,
  skillCatalogSection,
  skillReviewSection,
  SKILL_CATALOG_LIMIT,
  type ParsedSkill,
  type SkillCatalogEntry,
} from "@/lib/skill-format";

/**
 * Every enabled skill, as catalogue entries (name + description + scope, never
 * the body). Cheap enough to read on each run: a desk has tens of skills, not
 * thousands, and the row bodies are left in the database.
 */
export async function enabledSkillCatalog(): Promise<SkillCatalogEntry[]> {
  const rows = await db.skill.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
    select: { slug: true, name: true, description: true, categories: true },
  });
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    description: row.description,
    categories: parseCategories(row.categories),
  }));
}

/** Tolerate a hand-edited categories column rather than failing a whole run. */
export function parseCategories(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
