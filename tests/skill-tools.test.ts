// The read_skill tool, the catalogue it is paired with, and the prompt wiring
// that connects them. The database is mocked, so these run offline.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface SkillRow {
  slug: string;
  name: string;
  description: string;
  categories: string;
  body: string;
  enabled: boolean;
}

const state = vi.hoisted(() => ({ skills: [] as SkillRow[] }));

vi.mock("@/lib/db", () => ({
  db: {
    skill: {
      findUnique: async ({ where }: { where: { slug: string } }) =>
        state.skills.find((s) => s.slug === where.slug) ?? null,
      findMany: async ({ where }: { where?: { enabled?: boolean } } = {}) =>
        state.skills.filter((s) => (where?.enabled === undefined ? true : s.enabled === where.enabled)),
    },
  },
}));

const { TOOLS } = await import("@/lib/ai/tools");
const { enabledSkillCatalog, parseCategories } = await import("@/lib/skills");
const { resolverSystem } = await import("@/lib/ai/prompts");
const { skillCatalogSection } = await import("@/lib/skill-format");
const { DEFAULT_TOOL_POLICIES } = await import("@/lib/ai/tool-policies");
const { CORE_TOOLS } = await import("@/lib/agent-profile-format");

function skill(over: Partial<SkillRow> = {}): SkillRow {
  return {
    slug: "locked-out-account",
    name: "Account lockouts",
    description: "What to establish before resetting anything.",
    categories: JSON.stringify(["ACCESS"]),
    body: "## Steps\n\n1. Confirm the requester owns the account.",
    enabled: true,
    ...over,
  };
}

const CTX = { ticketId: "t1", runId: "r1", agentUser: { id: "u1" } } as never;

beforeEach(() => {
  state.skills = [skill()];
});

describe("read_skill", () => {
  it("is registered and declares a policy", () => {
    expect(TOOLS.read_skill).toBeDefined();
    const policy = DEFAULT_TOOL_POLICIES.find((p) => p.toolName === "read_skill");
    expect(policy).toBeDefined();
    // Reading a procedure changes nothing, so it neither pauses nor escalates.
    expect(policy?.riskLevel).toBe("LOW");
    expect(policy?.requiresApproval).toBe(false);
  });

  it("stays out of CORE_TOOLS, so the MCP surface can serve it", () => {
    expect(CORE_TOOLS).not.toContain("read_skill");
  });

  it("returns the procedure with its scope", async () => {
    const out = await TOOLS.read_skill.execute({ slug: "locked-out-account" }, CTX);
    expect(out).toContain("# Account lockouts");
    expect(out).toContain("Applies to: ACCESS");
    expect(out).toContain("Confirm the requester owns the account.");
  });

  it("says 'every ticket' for a desk-wide skill", async () => {
    state.skills = [skill({ slug: "escalation", categories: "[]" })];
    const out = await TOOLS.read_skill.execute({ slug: "escalation" }, CTX);
    expect(out).toContain("Applies to: every ticket");
  });

  it("accepts the slug case-insensitively and trimmed", async () => {
    const out = await TOOLS.read_skill.execute({ slug: "  Locked-Out-Account " }, CTX);
    expect(out).toContain("# Account lockouts");
  });

  it("names the alternatives when the slug is unknown", async () => {
    const out = await TOOLS.read_skill.execute({ slug: "no-such-skill" }, CTX);
    expect(out).toMatch(/^Error: no skill named "no-such-skill"/);
    expect(out).toContain("locked-out-account");
  });

  it("refuses a disabled skill instead of quietly serving it", async () => {
    state.skills = [skill({ enabled: false })];
    const out = await TOOLS.read_skill.execute({ slug: "locked-out-account" }, CTX);
    expect(out).toMatch(/disabled and must not be followed/);
    expect(out).not.toContain("Confirm the requester owns the account.");
  });

  it("requires a slug", async () => {
    const out = await TOOLS.read_skill.execute({ slug: "  " }, CTX);
    expect(out).toMatch(/^Error: slug is required/);
  });

  it("truncates a body that would blow up the conversation", async () => {
    state.skills = [skill({ body: "x".repeat(9000) })];
    const out = await TOOLS.read_skill.execute({ slug: "locked-out-account" }, CTX);
    expect(out.length).toBeLessThanOrEqual(4100);
    expect(out).toContain("…(truncated)");
  });

  it("never returns a tool error by throwing — the contract is a string", async () => {
    await expect(
      TOOLS.read_skill.execute({ slug: 42 as unknown as string }, CTX),
    ).resolves.toMatch(/^Error: slug is required/);
  });
});

describe("enabledSkillCatalog", () => {
  it("returns catalogue entries for enabled skills only, without bodies", async () => {
    state.skills = [skill(), skill({ slug: "retired", enabled: false })];
    const catalog = await enabledSkillCatalog();
    expect(catalog.map((s) => s.slug)).toEqual(["locked-out-account"]);
    expect(catalog[0]).not.toHaveProperty("body");
    expect(catalog[0].categories).toEqual(["ACCESS"]);
  });

  it("survives a hand-edited categories column rather than failing the run", () => {
    expect(parseCategories("not json")).toEqual([]);
    expect(parseCategories('"ACCESS"')).toEqual([]);
    expect(parseCategories('["ACCESS"]')).toEqual(["ACCESS"]);
  });
});

describe("resolverSystem", () => {
  const policies = [
    {
      toolName: "reset_password",
      description: "Reset a password.",
      riskLevel: "MEDIUM",
      requiresApproval: false,
    },
  ] as never;

  it("carries the catalogue but never a skill body", async () => {
    const section = skillCatalogSection(await enabledSkillCatalog(), "ACCESS");
    const system = resolverSystem(policies, section);
    expect(system).toContain("## Desk skills");
    expect(system).toContain("- locked-out-account (ACCESS):");
    expect(system).not.toContain("Confirm the requester owns the account.");
  });

  it("is byte-for-byte the old prompt when there is no catalogue", () => {
    expect(resolverSystem(policies, "")).toBe(resolverSystem(policies));
    expect(resolverSystem(policies)).not.toContain("Desk skills");
  });
});
