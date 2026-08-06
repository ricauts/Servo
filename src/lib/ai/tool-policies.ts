// Default policy (risk level + approval requirement) for every built-in tool.
// Single source of truth shared by the seed and by ensureToolPolicies(), which
// backfills rows at runtime — so adding a built-in tool makes it available on
// upgrade without a destructive reseed. Admin edits are never overwritten.
//
// Dependency-free on purpose: prisma/seed.ts imports it directly.

export interface DefaultToolPolicy {
  toolName: string;
  description: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  requiresApproval: boolean;
}

export const DEFAULT_TOOL_POLICIES: DefaultToolPolicy[] = [
  {
    toolName: "query_ops_database",
    description: "Run read-only SQL (SELECT) against the connected database.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "execute_ops_sql",
    description:
      "Run mutating SQL (CREATE/ALTER/INSERT/UPDATE/DELETE/DROP) against the connected database.",
    riskLevel: "HIGH",
    requiresApproval: true,
  },
  {
    toolName: "get_device_info",
    description: "Look up a device in the asset inventory by asset tag.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "reset_password",
    description: "Reset a user's password and send a recovery link (simulated).",
    riskLevel: "MEDIUM",
    requiresApproval: false,
  },
  {
    toolName: "github_create_repo",
    description: "Create a new GitHub repository (real API when a token is configured).",
    riskLevel: "MEDIUM",
    requiresApproval: false,
  },
  {
    toolName: "github_open_pr",
    description: "Open a pull request with proposed changes (real API when a token is configured).",
    riskLevel: "MEDIUM",
    requiresApproval: false,
  },
  {
    toolName: "azure_list_resources",
    description:
      "List Azure resources in the configured subscription (read-only; real API when credentials are configured).",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "cloud_plan_deployment",
    description: "Generate an IaC deployment plan (Azure/AWS/GCP, simulated).",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "cloud_apply_deployment",
    description: "Apply a previously generated deployment plan (simulated).",
    riskLevel: "HIGH",
    requiresApproval: true,
  },
  {
    toolName: "post_comment",
    description: "Post a public comment on the ticket.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
  {
    toolName: "resolve_ticket",
    description: "Mark the ticket as resolved with a resolution note.",
    riskLevel: "LOW",
    requiresApproval: false,
  },
];
