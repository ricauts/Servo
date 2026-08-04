// Pure parsing/validation for .md agent profiles (no database) — shared by
// the API, the engine and the seed. A profile document is Markdown with YAML
// frontmatter (name, description, categories, tools); the body becomes the
// specialization section of the resolver system prompt.

import matter from "gray-matter";
import { CATEGORIES } from "@/lib/types";

/** Tools every profile keeps regardless of its allowlist — the resolver
 * cannot communicate or close a ticket without them. */
export const CORE_TOOLS = ["post_comment", "resolve_ticket"];

export interface ParsedProfile {
  name: string;
  description: string;
  categories: string[];
  tools: string[];
  systemPrompt: string;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parse and validate a .md agent definition. Throws with a human-readable
 * message when the frontmatter is missing fields or references unknown
 * categories/tools. Tool names are validated only when `knownTools` is given
 * (the seed skips it to avoid importing the tool registry).
 */
export function parseProfileMarkdown(
  markdown: string,
  opts: { knownTools?: string[] } = {},
): ParsedProfile {
  const { data, content } = matter(markdown);

  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name) throw new Error("Frontmatter must include a non-empty `name`.");

  const description =
    typeof data.description === "string" ? data.description.trim() : "";

  const categories = Array.isArray(data.categories)
    ? data.categories.map(String)
    : [];
  for (const c of categories) {
    if (!CATEGORIES.includes(c as (typeof CATEGORIES)[number])) {
      throw new Error(
        `Unknown category "${c}". Valid: ${CATEGORIES.join(", ")}.`,
      );
    }
  }

  const tools = Array.isArray(data.tools) ? data.tools.map(String) : [];
  if (opts.knownTools) {
    for (const t of tools) {
      if (!opts.knownTools.includes(t)) {
        throw new Error(
          `Unknown tool "${t}". Valid: ${opts.knownTools.join(", ")}.`,
        );
      }
    }
  }

  const systemPrompt = content.trim();
  if (!systemPrompt) {
    throw new Error("The document body (system prompt) cannot be empty.");
  }

  return { name, description, categories, tools, systemPrompt };
}

/** Whether a run under this profile may use the tool (core tools always pass). */
export function profileAllowsTool(
  profile: { tools: string } | null,
  toolName: string,
): boolean {
  if (!profile) return true;
  if (CORE_TOOLS.includes(toolName)) return true;
  try {
    const allowed = JSON.parse(profile.tools) as string[];
    return allowed.length === 0 || allowed.includes(toolName);
  } catch {
    return true;
  }
}
