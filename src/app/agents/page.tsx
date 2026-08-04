import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import PageHeader from "@/components/shell/PageHeader";
import EmptyState from "@/components/legacy/EmptyState";
import AgentsManager, {
  type AgentProfileView,
} from "@/components/agents/AgentsManager";

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

  const profiles = await db.agentProfile.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { runs: true } } },
  });

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

  return (
    <>
      <PageHeader
        title="Agents"
        description="Specialized resolver personas defined in Markdown (frontmatter: name, categories, tools; body: system prompt). The resolver picks the enabled specialist covering the ticket's category."
      />
      <div className="p-4 md:p-8">
        <AgentsManager profiles={views} canManage={can(user, "agents.manage")} />
      </div>
    </>
  );
}
