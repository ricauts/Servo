// Servo as an MCP server: exposes the tool registry (minus the ticket-bound
// core tools and anything gated on human approval) plus the Servo-native tools
// over the Model Context Protocol, so external MCP clients — Claude Code/
// Desktop, other agents — can operate the service desk. Transport is
// Streamable HTTP in stateless JSON mode.
//
// Auth follows the integration pattern: env MCP_TOKEN wins over the token
// stored in Settings; without any token the endpoint refuses to serve.

import { db } from "@/lib/db";
import { ensureToolPolicies, getToolRegistry } from "@/lib/ai/custom-tools";
import { CORE_TOOLS } from "@/lib/agent-profiles";
import { getAiSettings } from "@/lib/ai/settings";
import { applySlaToTicket } from "@/lib/sla";
import { emitTicketEvent } from "@/lib/webhooks";
import { notifyTicketCreated } from "@/lib/notify";
import { runTriage } from "@/lib/ai/engine";
import { nextTicketNumber } from "@/lib/tickets";
import type { ToolContext, ToolDef } from "@/lib/ai/tools";

export const MCP_SETTING_KEYS = {
  token: "integration.mcp.token", // never returned by the API
} as const;

export interface McpConfig {
  token: string;
  tokenSource: "env" | "db" | "none";
}

export async function getMcpConfig(): Promise<McpConfig> {
  const row = await db.setting.findUnique({ where: { key: MCP_SETTING_KEYS.token } });
  const envToken = process.env.MCP_TOKEN ?? "";
  const dbToken = row?.value ?? "";
  return {
    token: envToken || dbToken,
    tokenSource: envToken ? "env" : dbToken ? "db" : "none",
  };
}

/**
 * Servo-native MCP tools — the ones with no counterpart in the resolver's own
 * registry. Searching and reading tickets are registry tools (search_tickets,
 * read_ticket, requester_history) and are served from there, so an MCP client
 * gets the same ranked, redaction-aware results the agents get.
 */
const NATIVE_TOOLS: Record<string, ToolDef> = {
  create_ticket: {
    name: "create_ticket",
    description:
      "Create a ticket in the Servo service desk. It is triaged automatically (category, priority, routing).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short ticket title." },
        description: { type: "string", description: "What happened / what is needed." },
      },
      required: ["title", "description"],
    },
    async execute(input) {
      const title = String(input.title ?? "").trim();
      const description = String(input.description ?? "").trim();
      if (!title || !description) return "Error: title and description are required.";
      const requester = await db.user.findFirst({
        where: { role: "ADMIN" },
        orderBy: { createdAt: "asc" },
      });
      if (!requester) return "Error: no users exist yet — run the setup first.";
      const ticket = await db.ticket.create({
        data: {
          number: await nextTicketNumber(),
          title: title.slice(0, 200),
          description,
          status: "OPEN",
          priority: "MEDIUM",
          category: "OTHER",
          requesterId: requester.id,
        },
      });
      await applySlaToTicket(ticket.id);
      void notifyTicketCreated(ticket.id);
      void emitTicketEvent("ticket.created", ticket.id);
      const { autoTriage } = await getAiSettings();
      if (autoTriage) {
        try {
          await runTriage(ticket.id);
        } catch {
          /* triage failure must not fail creation */
        }
      }
      const fresh = await db.ticket.findUnique({ where: { id: ticket.id } });
      return `Ticket #${ticket.number} created (status ${fresh?.status ?? "OPEN"}, priority ${fresh?.priority ?? "MEDIUM"}, category ${fresh?.category ?? "OTHER"}).`;
    },
  },

};

/**
 * Tools served over MCP: registry minus the run-bound core tools, plus the
 * Servo-native ones. A registry tool is served only if its policy row exists,
 * is enabled, and does not require approval — MCP has no human in the loop, so
 * an approval-gated tool must never be reachable here. Deny-by-default on a
 * missing policy row mirrors the agent loop, which treats it as unavailable.
 */
export async function getMcpTools(): Promise<Record<string, ToolDef>> {
  await ensureToolPolicies(); // backfill built-ins added by an upgrade
  const [registry, policies] = await Promise.all([
    getToolRegistry(),
    db.toolPolicy.findMany({
      select: { toolName: true, enabled: true, requiresApproval: true },
    }),
  ]);
  const byName = new Map(policies.map((p) => [p.toolName, p]));
  const served: Record<string, ToolDef> = {};
  for (const [name, tool] of Object.entries(registry)) {
    if (CORE_TOOLS.includes(name)) continue;
    const policy = byName.get(name);
    if (!policy || !policy.enabled || policy.requiresApproval) continue;
    served[name] = tool;
  }
  return { ...served, ...NATIVE_TOOLS };
}

/**
 * Why a tool the caller asked for exists in Servo but is withheld from MCP,
 * or null when the name is genuinely unknown. Follows the tool contract:
 * a descriptive string the calling agent can read and adapt to.
 */
export async function mcpToolWithholdReason(name: string): Promise<string | null> {
  const registry = await getToolRegistry();
  if (!registry[name]) return null;
  if (CORE_TOOLS.includes(name)) {
    return `Error: "${name}" only runs inside a ticket's agent run and is not available over MCP.`;
  }
  const policy = await db.toolPolicy.findUnique({ where: { toolName: name } });
  if (!policy) return `Error: "${name}" has no tool policy, so it is not available over MCP.`;
  if (!policy.enabled) return `Error: "${name}" is disabled by policy.`;
  if (policy.requiresApproval) {
    return `Error: "${name}" requires human approval, which an MCP caller cannot obtain. File a ticket with create_ticket and let a Servo agent run it under the approval gate.`;
  }
  return null;
}

/** Context for MCP-invoked executions. Only the (excluded) core tools read
 * the ticket/run fields; the agent identity is the system resolver. */
export async function mcpToolContext(): Promise<ToolContext | null> {
  const agentUser = await db.user.findFirst({
    where: { role: "AI_AGENT", aiKind: "RESOLVER" },
  });
  if (!agentUser) return null;
  return { ticketId: "mcp-external", runId: "mcp-external", agentUser };
}
