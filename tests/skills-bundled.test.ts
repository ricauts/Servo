// The bundled skills/<slug>/SKILL.md documents, and the mock provider's use
// of the catalogue.
//
// syncSkills() skips a malformed bundled document on purpose — a typo must not
// block `npm run setup` — which means a broken one would ship silently. These
// tests are what makes that safe.

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseSkillMarkdown, skillCatalogSection } from "@/lib/skill-format";
import { slugify } from "@/lib/agent-profile-format";
import { MockProvider } from "@/lib/ai/mock";
import type { ToolSpec } from "@/lib/ai/provider";
import type { ConversationMessage } from "@/lib/types";

const SKILLS_DIR = path.join(process.cwd(), "skills");

function bundledSlugs(): string[] {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

describe("bundled skills", () => {
  it("ships at least one", () => {
    expect(bundledSlugs().length).toBeGreaterThan(0);
  });

  it.each(bundledSlugs())("skills/%s/SKILL.md parses and seeds", (slug) => {
    const file = path.join(SKILLS_DIR, slug, "SKILL.md");
    expect(fs.existsSync(file)).toBe(true);
    const parsed = parseSkillMarkdown(fs.readFileSync(file, "utf8"));
    expect(parsed.name).not.toBe("");
    expect(parsed.body.length).toBeGreaterThan(50);
    // The directory name becomes the slug read_skill takes, so it has to
    // survive slugify() unchanged or the handle would not match the folder.
    expect(slugify(slug)).toBe(slug);
  });

  it("covers the approval-gated tools with a written procedure", () => {
    const bodies = bundledSlugs().map((slug) =>
      fs.readFileSync(path.join(SKILLS_DIR, slug, "SKILL.md"), "utf8"),
    );
    const all = bodies.join("\n");
    for (const gated of ["execute_ops_sql", "github_merge_pr"]) {
      expect(all).toContain(gated);
    }
  });
});

describe("MockProvider and the desk catalogue", () => {
  const ticket = {
    id: "t1",
    number: 1,
    title: "I am locked out of my account",
    description: "I forgot my password and cannot sign in.",
    category: "ACCESS",
    requester: { name: "Dana Reed", email: "dana@example.com" },
  } as never;

  const catalog = [
    { slug: "locked-out-account", name: "Lockouts", description: "Reset rules.", categories: ["ACCESS"] },
  ];
  const system = `You are Servo Resolver.\n\n${skillCatalogSection(catalog, "ACCESS")}`;
  const withSkillTool: ToolSpec[] = [
    { name: "read_skill", description: "", inputSchema: {} },
    { name: "reset_password", description: "", inputSchema: {} },
  ];

  async function firstCall(sys: string, tools: ToolSpec[]) {
    const provider = new MockProvider({ ticket, kind: "RESOLVE" });
    const turn = await provider.complete({ system: sys, messages: [], tools });
    return turn.toolCalls[0];
  }

  it("consults the procedure before acting when the tool is granted", async () => {
    const call = await firstCall(system, withSkillTool);
    expect(call?.name).toBe("read_skill");
    expect(call?.input).toEqual({ slug: "locked-out-account" });
  });

  it("moves on to the real work once the skill has been read", async () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "1", name: "read_skill", input: { slug: "locked-out-account" } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "# Lockouts" }] },
    ];
    const provider = new MockProvider({ ticket, kind: "RESOLVE" });
    const turn = await provider.complete({ system, messages, tools: withSkillTool });
    expect(turn.toolCalls[0]?.name).toBe("reset_password");
  });

  it("does not reach for a tool it was not given", async () => {
    const call = await firstCall(system, [
      { name: "reset_password", description: "", inputSchema: {} },
    ]);
    expect(call?.name).toBe("reset_password");
  });

  it("runs the unchanged script on a desk with no skills", async () => {
    const call = await firstCall("You are Servo Resolver.", withSkillTool);
    expect(call?.name).toBe("reset_password");
  });
});
