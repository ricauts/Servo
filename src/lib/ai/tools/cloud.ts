// Cloud tools. azure_list_resources hits the real Resource Manager when
// credentials are configured; the deploy plan/apply pair stays simulated —
// the HIGH-risk approval gate on apply is the pattern being demonstrated.

import { azureConfigured, getAzureConfig, listResources } from "@/lib/integrations/azure";
import { errorMessage, str, type ToolDef } from "./types";

export const cloudTools: Record<string, ToolDef> = {
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
};
