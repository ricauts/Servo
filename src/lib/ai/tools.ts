// The resolver's tool registry. Names must match the seeded ToolPolicy rows
// exactly. Tools never throw for expected failures — they return descriptive
// strings so the model (real or mock) can read the error and adapt; the engine
// still catches unexpected exceptions and converts them to error tool_results.

import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { opsDb, opsExecute, opsSelect } from "@/lib/opsdb";
import { createRepo, getGithubConfig, openPr } from "@/lib/integrations/github";
import { azureConfigured, getAzureConfig, listResources } from "@/lib/integrations/azure";
import { notifyTicketResolved } from "@/lib/notify";
import { emitTicketEvent } from "@/lib/webhooks";
import { jsonSafe } from "@/lib/utils";

export interface ToolContext {
  ticketId: string;
  runId: string;
  agentUser: User;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

const RESULT_LIMIT = 4000;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Returns the statement if it is exactly one SQL statement, else null. */
function singleStatement(sql: string): string | null {
  const trimmed = sql.trim();
  if (!trimmed) return null;
  const body = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
  // Ignore semicolons inside quoted literals; only structural ones between
  // statements should reject.
  const stripped = body.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "");
  if (stripped.includes(";")) return null;
  return trimmed;
}

// Courtesy pre-check for the read-only tool so the model gets an actionable
// error message. Real enforcement is the query_only connection in opsdb.ts.
const MUTATING_KEYWORD =
  /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/i;

function looksMutating(sql: string): boolean {
  const withoutLiterals = sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"/g, "");
  return MUTATING_KEYWORD.test(withoutLiterals);
}

export const TOOLS: Record<string, ToolDef> = {
  query_ops_database: {
    name: "query_ops_database",
    description:
      "Run read-only SQL (a single SELECT or WITH statement) against the connected ops database (tables: devices, employees, employees_backup, software_licenses, campaign_tracking).",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single read-only SELECT (or WITH) statement." },
      },
      required: ["sql"],
    },
    async execute(input) {
      const sql = singleStatement(str(input.sql));
      if (!sql) return "Error: expected exactly one SQL statement.";
      if (!/^\s*(select|with)\b/i.test(sql) || looksMutating(sql)) {
        return "Error: only read-only SELECT/WITH queries are allowed here. Use execute_ops_sql for mutations.";
      }
      try {
        const rows = await opsSelect(sql);
        const out = jsonSafe(rows);
        return out.length > RESULT_LIMIT ? `${out.slice(0, RESULT_LIMIT)}… (truncated)` : out;
      } catch (err) {
        return errorMessage(err);
      }
    },
  },

  execute_ops_sql: {
    name: "execute_ops_sql",
    description:
      "Run a single mutating SQL statement (CREATE/ALTER/INSERT/UPDATE/DELETE/DROP) against the connected ops database.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single mutating SQL statement." },
      },
      required: ["sql"],
    },
    async execute(input) {
      const sql = singleStatement(str(input.sql));
      if (!sql) return "Error: expected exactly one SQL statement.";
      try {
        const affected = await opsExecute(sql);
        return `Statement executed. ${affected} rows affected.`;
      } catch (err) {
        return `SQL error: ${errorMessage(err)}`;
      }
    },
  },

  get_device_info: {
    name: "get_device_info",
    description: "Look up a device in the asset inventory by its asset tag (e.g. LT-2043).",
    inputSchema: {
      type: "object",
      properties: {
        assetTag: { type: "string", description: "The asset tag, e.g. LT-2043." },
      },
      required: ["assetTag"],
    },
    async execute(input) {
      const assetTag = str(input.assetTag).trim();
      if (!assetTag) return "Error: assetTag is required.";
      try {
        const rows = (await opsDb.$queryRawUnsafe(
          "SELECT * FROM devices WHERE asset_tag = ?",
          assetTag,
        )) as unknown[];
        if (rows.length === 0) return `No device found with asset tag ${assetTag}.`;
        return jsonSafe(rows[0]);
      } catch (err) {
        return errorMessage(err);
      }
    },
  },

  reset_password: {
    name: "reset_password",
    description:
      "Reset a user's password in the identity provider and send them a recovery link (simulated).",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "The account email to reset." },
      },
      required: ["email"],
    },
    async execute(input) {
      const email = str(input.email).trim();
      if (!email) return "Error: email is required.";
      return `Password reset for ${email}. Recovery link sent to the recovery address on file (expires in 60 minutes).`;
    },
  },

  github_create_repo: {
    name: "github_create_repo",
    description:
      "Create a new GitHub repository (real API when a token is configured in Settings; simulated otherwise).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Repository name (kebab-case)." },
        description: { type: "string", description: "Optional repository description." },
        private: { type: "boolean", description: "Whether the repository is private." },
      },
      required: ["name"],
    },
    async execute(input) {
      const name = str(input.name).trim();
      if (!name) return "Error: name is required.";
      const config = await getGithubConfig();
      if (!config.token) {
        return `[simulated — no GitHub token configured] Repository acme/${name} created with default branch protection and CI template.`;
      }
      try {
        return await createRepo(config, {
          name,
          description: str(input.description),
          private: input.private !== false,
        });
      } catch (err) {
        return `GitHub request failed: ${errorMessage(err)}`;
      }
    },
  },

  github_open_pr: {
    name: "github_open_pr",
    description:
      "Open a pull request with proposed changes (real API when a token is configured in Settings; simulated otherwise).",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "Repository name under the configured owner." },
        title: { type: "string", description: "Pull request title." },
        description: { type: "string", description: "Optional pull request body." },
        head: { type: "string", description: "Source branch (default servo/proposed-changes)." },
        base: { type: "string", description: "Target branch (default main)." },
      },
      required: ["repo", "title"],
    },
    async execute(input) {
      const repo = str(input.repo).trim();
      const title = str(input.title).trim();
      if (!repo || !title) return "Error: repo and title are required.";
      const config = await getGithubConfig();
      if (!config.token) {
        return `[simulated — no GitHub token configured] Pull request opened: https://github.com/acme/${repo}/pull/42 — "${title}".`;
      }
      try {
        return await openPr(config, {
          repo,
          title,
          description: str(input.description),
          head: str(input.head) || undefined,
          base: str(input.base) || undefined,
        });
      } catch (err) {
        return `GitHub request failed: ${errorMessage(err)}`;
      }
    },
  },

  azure_list_resources: {
    name: "azure_list_resources",
    description:
      "List Azure resources in the configured subscription, optionally scoped to a resource group (read-only; real API when Azure credentials are configured, simulated otherwise).",
    inputSchema: {
      type: "object",
      properties: {
        resourceGroup: {
          type: "string",
          description: "Optional resource group name to scope the listing.",
        },
      },
    },
    async execute(input) {
      const resourceGroup = str(input.resourceGroup).trim();
      const config = await getAzureConfig();
      if (!azureConfigured(config)) {
        return [
          "[simulated — no Azure credentials configured]",
          `3 resource(s)${resourceGroup ? ` in ${resourceGroup}` : ""}:`,
          "- statuspage-prod (Microsoft.App/containerApps) in eastus",
          "- servo-sql-prod (Microsoft.Sql/servers) in eastus",
          "- servo-kv-prod (Microsoft.KeyVault/vaults) in eastus",
        ].join("\n");
      }
      try {
        return await listResources(config, resourceGroup || undefined);
      } catch (err) {
        return `Azure request failed: ${errorMessage(err)}`;
      }
    },
  },

  cloud_plan_deployment: {
    name: "cloud_plan_deployment",
    description: "Generate an IaC deployment plan for a cloud service (Azure/AWS/GCP, simulated).",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Cloud provider: azure, aws or gcp." },
        service: { type: "string", description: "The service or workload to deploy." },
        description: { type: "string", description: "What the deployment should change." },
      },
      required: ["provider", "service", "description"],
    },
    async execute(input) {
      const provider = str(input.provider).trim() || "azure";
      const service = str(input.service).trim() || "service";
      const description = str(input.description).trim() || "apply requested changes";
      const slugged = service.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const planId = `plan-${slugged || "deploy"}-${Date.now().toString(36)}`;
      return [
        `Plan: ${planId}`,
        `  provider: ${provider}`,
        `  service: ${service}`,
        `  ~ ${description}`,
        "  ~ roll replicas gradually, max_unavailable=1",
        "  no changes to secrets, networking or scaling rules",
        `Apply with cloud_apply_deployment {"planId": "${planId}"}.`,
      ].join("\n");
    },
  },

  cloud_apply_deployment: {
    name: "cloud_apply_deployment",
    description: "Apply a previously generated deployment plan to the target environment (simulated).",
    inputSchema: {
      type: "object",
      properties: {
        planId: { type: "string", description: "The plan id returned by cloud_plan_deployment." },
        provider: { type: "string", description: "Optional cloud provider override." },
      },
      required: ["planId"],
    },
    async execute(input) {
      const planId = str(input.planId).trim();
      if (!planId) return "Error: planId is required.";
      const provider = str(input.provider).trim();
      return `Deployment plan ${planId} applied${provider ? ` on ${provider}` : ""}. Rollout completed: replicas healthy, health checks passing.`;
    },
  },

  post_comment: {
    name: "post_comment",
    description: "Post a public comment on the ticket to keep the requester informed.",
    inputSchema: {
      type: "object",
      properties: {
        body: { type: "string", description: "The comment text shown to the requester." },
      },
      required: ["body"],
    },
    async execute(input, ctx) {
      const body = str(input.body).trim();
      if (!body) return "Error: body is required.";
      await db.comment.create({
        data: { ticketId: ctx.ticketId, authorId: ctx.agentUser.id, body, kind: "COMMENT" },
      });
      const ticket = await db.ticket.findUnique({ where: { id: ctx.ticketId } });
      if (ticket && !ticket.firstResponseAt) {
        await db.ticket.update({
          where: { id: ctx.ticketId },
          data: { firstResponseAt: new Date() },
        });
      }
      return "Comment posted.";
    },
  },

  resolve_ticket: {
    name: "resolve_ticket",
    description: "Mark the ticket as resolved with a short resolution note. Call this last.",
    inputSchema: {
      type: "object",
      properties: {
        resolution: { type: "string", description: "A concise resolution note." },
      },
      required: ["resolution"],
    },
    async execute(input, ctx) {
      const resolution = str(input.resolution).trim() || "Resolved by AI agent.";
      await db.ticket.update({
        where: { id: ctx.ticketId },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      await db.comment.create({
        data: {
          ticketId: ctx.ticketId,
          authorId: ctx.agentUser.id,
          kind: "SYSTEM",
          body: `Resolved by ${ctx.agentUser.name}: ${resolution}`,
        },
      });
      void notifyTicketResolved(ctx.ticketId);
      void emitTicketEvent("ticket.resolved", ctx.ticketId);
      return "Ticket marked as resolved.";
    },
  },
};
