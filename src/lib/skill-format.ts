// Pure parsing/validation and catalogue rendering for desk skills (no
// database) — shared by the API, the seed, the engine and the tools. A skill
// document is Markdown with YAML frontmatter (name, description, categories);
// the body is the procedure a resolver loads with read_skill.
//
// The shape is deliberately the same as an agent profile
// (src/lib/agent-profile-format.ts): a .md file in the repository is the
// source of truth, the database row is a cache of it, and the UI edits the
// same text. Skills differ in what they are FOR — a profile is who the agent
// is, a skill is what the desk has agreed to do about a class of problem.

import matter from "gray-matter";
import { CATEGORIES } from "@/lib/types";

export interface ParsedSkill {
  name: string;
  description: string;
  categories: string[];
  body: string;
}

/** One catalogue line: what the resolver picks from before reading a body. */
export interface SkillCatalogEntry {
  slug: string;
  name: string;
  description: string;
  categories: string[];
}

/**
 * How many skills are advertised in the resolver's system prompt. The
 * catalogue is name + description only, so this is generous, but it must be
 * bounded: an admin with 500 skills should not silently blow up every prompt.
 */
export const SKILL_CATALOG_LIMIT = 40;

/** Descriptions are catalogue lines, not documents — keep them scannable. */
const DESCRIPTION_LIMIT = 300;

/**
 * Parse and validate a SKILL.md document. Throws with a human-readable
 * message the API returns verbatim to the admin who typed the document.
 *
 * `description` is required, unlike on an agent profile: it is the only thing
 * the resolver sees before deciding whether to spend a tool call reading the
 * body, so a skill without one is invisible in practice.
 */
export function parseSkillMarkdown(markdown: string): ParsedSkill {
  const { data, content } = matter(markdown);

  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) throw new Error("Frontmatter must include a non-empty `name`.");

  const description =
    typeof data.description === "string" ? data.description.trim() : "";
  if (!description) {
    throw new Error(
      "Frontmatter must include a non-empty `description` — it is the catalogue line the agent reads before loading the skill.",
    );
  }
  if (description.length > DESCRIPTION_LIMIT) {
    throw new Error(
      `\`description\` must be at most ${DESCRIPTION_LIMIT} characters (it is a one-line catalogue entry); this one is ${description.length}.`,
    );
  }

  const categories = Array.isArray(data.categories)
    ? data.categories.map(String)
    : [];
  for (const c of categories) {
    if (!CATEGORIES.includes(c as (typeof CATEGORIES)[number])) {
      throw new Error(`Unknown category "${c}". Valid: ${CATEGORIES.join(", ")}.`);
    }
  }

  const body = content.trim();
  if (!body) {
    throw new Error("The document body (the procedure) cannot be empty.");
  }

  return { name, description, categories, body };
}

/**
 * Whether a skill applies to a ticket in `category`. An empty `categories`
 * list means "every ticket" — that is how desk-wide policy (escalation rules,
 * tone, what never to touch) is written.
 */
export function skillAppliesTo(
  skill: { categories: string[] },
  category: string,
): boolean {
  return skill.categories.length === 0 || skill.categories.includes(category);
}

/**
 * Split a catalogue into the skills that apply to this ticket and the rest.
 * Both are advertised — an agent may legitimately reach for a skill outside
 * the ticket's category — but the applicable ones lead, and the remainder is
 * what SKILL_CATALOG_LIMIT trims first.
 */
export function orderCatalogFor(
  skills: SkillCatalogEntry[],
  category: string,
): SkillCatalogEntry[] {
  const applicable = skills.filter((s) => skillAppliesTo(s, category));
  const rest = skills.filter((s) => !skillAppliesTo(s, category));
  return [...applicable, ...rest].slice(0, SKILL_CATALOG_LIMIT);
}

/**
 * The "Desk skills" section of the resolver system prompt: the catalogue plus
 * the rule that binds it. Returns "" when there is nothing to advertise, so
 * the prompt of an install with no skills is byte-for-byte what it was before.
 *
 * Progressive disclosure on purpose (the Claude Code skills pattern): names
 * and descriptions are always in context, bodies cost a tool call.
 */
export function skillCatalogSection(
  skills: SkillCatalogEntry[],
  category: string,
): string {
  const ordered = orderCatalogFor(skills, category);
  if (ordered.length === 0) return "";
  const lines = ordered
    .map((s) => {
      const scope = s.categories.length === 0 ? "every ticket" : s.categories.join(", ");
      return `- ${s.slug} (${scope}): ${s.description}`;
    })
    .join("\n");
  return `## Desk skills

Procedures this desk has agreed to follow. Read the relevant one with read_skill
BEFORE you act — the body contains the steps, the limits and the things never to
do. The slug is what read_skill takes.

${lines}

- If a skill covers this ticket, follow it.
- If you deliberately depart from a skill, say so and why in your comment to the
  requester; QA reviews the run against the skills that applied.
- A skill never overrides an approval gate: a tool that needs human approval
  still pauses for it, whatever the procedure says.`;
}

/**
 * The section QA reviews against: the applicable skills and whether the run
 * actually read them. Returns "" when no skill applied, so QA's judgement is
 * unchanged on installs and tickets where skills are not in play.
 */
export function skillReviewSection(
  skills: SkillCatalogEntry[],
  category: string,
  readSlugs: string[],
): string {
  const applicable = skills.filter((s) => skillAppliesTo(s, category));
  if (applicable.length === 0) return "";
  const read = new Set(readSlugs);
  const lines = applicable
    .map(
      (s) =>
        `- ${s.slug}: ${s.description} — ${read.has(s.slug) ? "READ by the run" : "NOT read by the run"}`,
    )
    .join("\n");
  return `Desk skills that applied to this ticket:
${lines}

A skill is this desk's agreed procedure. If one applied and the run neither
followed it nor explained why it departed, that is a FAIL. Not reading a skill
is only a problem when the run's actions actually contradict it — a trivial
ticket resolved correctly is still a PASS.`;
}
