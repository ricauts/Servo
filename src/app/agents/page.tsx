import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getToolRegistry } from "@/lib/ai/custom-tools";
import { CORE_TOOLS } from "@/lib/agent-profiles";
import PageHeader from "@/components/shell/PageHeader";
import EmptyState from "@/components/legacy/EmptyState";
import AgentsManager, {
  type AgentProfileView,
  type ToolCatalogItem,
} from "@/components/agents/AgentsManager";
import type { RiskLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const user = await getCurrentUser();
  if (!can(user, "agents.view")) {
    return (
      <>
        <PageHeader
          title="Agents"
          description="Specialized resolver agents defined as .md documents."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Agent access required"
            hint="Only admins and agents can see the specialized agents. Switch users from the sidebar."
          />
        </div>
      </>
    );
  }

  const [profiles, registry, policies] = await Promise.all([
    db.agentProfile.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { runs: true } } },
    }),
    getToolRegistry(),
    db.toolPolicy.findMany(),
  ]);

  const views: AgentProfileView[] = profiles.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    categories: JSON.parse(p.categories) as string[],
    tools: JSON.parse(p.tools) as string[],
    markdown: p.markdown,
    enabled: p.enabled,
    runCount: p._count.runs,
  }));

  // The tool catalog the picker offers: every enabled tool with its effective
  // risk/approval policy, core tools flagged (always granted, never toggled).
  const policyByName = new Map(policies.map((p) => [p.toolName, p]));
  const toolCatalog: ToolCatalogItem[] = Object.values(registry)
    .filter((t) => policyByName.get(t.name)?.enabled !== false)
    .map((t) => {
      const policy = policyByName.get(t.name);
      return {
        name: t.name,
        description: t.description,
        riskLevel: (policy?.riskLevel ?? "LOW") as RiskLevel,
        requiresApproval: policy?.requiresApproval ?? false,
        core: CORE_TOOLS.includes(t.name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Agents"
        description="Specialized resolver personas defined in Markdown (frontmatter: name, categories, tools; body: system prompt). The resolver picks the enabled specialist covering the ticket's category."
      />
      <div className="p-4 md:p-8">
        <AgentsManager
          profiles={views}
          toolCatalog={toolCatalog}
          canManage={can(user, "agents.manage")}
        />
      </div>
    </>
  );
}
