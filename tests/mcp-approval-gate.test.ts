// The MCP surface has no human in the loop, so a tool whose policy says
// requiresApproval must be unreachable there: absent from tools/list and never
// executed by tools/call. These tests spy on the real tool implementations, so
// they fail loudly if the gate is ever bypassed again.

import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TOOL_POLICIES } from "@/lib/ai/tool-policies";

interface PolicyRow {
  toolName: string;
  enabled: boolean;
  requiresApproval: boolean;
}

const state = vi.hoisted(() => ({
  policies: [] as PolicyRow[],
  customTools: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: async () => null },
    toolPolicy: {
      findMany: async () => state.policies.map((p) => ({ ...p })),
      findUnique: async ({ where }: { where: { toolName: string } }) =>
        state.policies.find((p) => p.toolName === where.toolName) ?? null,
      createMany: async ({ data }: { data: { toolName: string; requiresApproval: boolean }[] }) => {
        for (const row of data) {
          state.policies.push({
            toolName: row.toolName,
            enabled: true,
            requiresApproval: row.requiresApproval,
          });
        }
        return { count: data.length };
      },
    },
    customTool: { findMany: async () => state.customTools },
    user: {
      findFirst: async () => ({ id: "agent-1", role: "AI_AGENT", aiKind: "RESOLVER" }),
    },
  },
}));

const { POST } = await import("@/app/api/mcp/route");
const { TOOLS } = await import("@/lib/ai/tools");

const TOKEN = "test-mcp-token";

/** A custom HTTP integration: created from the UI with approval on by default. */
const APPROVAL_CUSTOM_TOOL = {
  name: "wire_transfer",
  description: "Move money (admin-defined integration).",
  inputSchema: '{"type":"object","properties":{}}',
  method: "POST",
  url: "https://bank.example/transfer",
  headers: "{}",
  bodyTemplate: "",
  secret: "",
};

async function rpc(method: string, params?: Record<string, unknown>) {
  const req = new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }) as unknown as NextRequest;
  const res = await POST(req);
  return (await res.json()) as {
    result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean };
    error?: { code: number; message: string };
  };
}

describe("MCP approval gate", () => {
  let executeSql: ReturnType<typeof vi.spyOn>;
  let querySql: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.MCP_TOKEN = TOKEN;
    state.policies = DEFAULT_TOOL_POLICIES.map((p) => ({
      toolName: p.toolName,
      enabled: true,
      requiresApproval: p.requiresApproval,
    }));
    state.policies.push({ toolName: "wire_transfer", enabled: true, requiresApproval: true });
    state.customTools = [APPROVAL_CUSTOM_TOOL];
    // Stand in for the real implementations: reaching them at all is the bug.
    executeSql = vi.spyOn(TOOLS.execute_ops_sql, "execute").mockResolvedValue("EXECUTED");
    querySql = vi.spyOn(TOOLS.query_ops_database, "execute").mockResolvedValue("0 rows.");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MCP_TOKEN;
  });

  it("never lists a tool that requires approval", async () => {
    const { result } = await rpc("tools/list");
    const names = (result?.tools ?? []).map((t) => t.name);

    for (const gated of [
      "execute_ops_sql",
      "cloud_apply_deployment",
      "github_edit_file",
      "github_merge_pr",
      "wire_transfer", // admin-defined integrations are gated the same way
    ]) {
      expect(names).not.toContain(gated);
    }
    // The unguarded surface is still served, so this is not a blanket refusal.
    expect(names).toContain("query_ops_database");
    expect(names).toContain("create_ticket");
  });

  it("refuses to execute a tool that requires approval", async () => {
    const { result } = await rpc("tools/call", {
      name: "execute_ops_sql",
      arguments: { sql: "DROP TABLE Ticket" },
    });

    expect(executeSql).not.toHaveBeenCalled();
    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toMatch(/requires human approval/i);
  });

  it("refuses an approval-gated custom integration too", async () => {
    const { result } = await rpc("tools/call", { name: "wire_transfer", arguments: {} });

    expect(result?.isError).toBe(true);
    expect(result?.content?.[0]?.text).toMatch(/requires human approval/i);
  });

  it("still runs a tool that needs no approval", async () => {
    const { result } = await rpc("tools/call", {
      name: "query_ops_database",
      arguments: { sql: "SELECT 1" },
    });

    expect(querySql).toHaveBeenCalledTimes(1);
    expect(result?.isError).toBe(false);
    expect(result?.content?.[0]?.text).toBe("0 rows.");
  });

  it("keeps reporting a genuinely unknown tool as a protocol error", async () => {
    const { error } = await rpc("tools/call", { name: "not_a_tool", arguments: {} });
    expect(error?.code).toBe(-32602);
  });
});
