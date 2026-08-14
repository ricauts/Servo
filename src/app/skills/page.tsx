import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseCategories } from "@/lib/skills";
import PageHeader from "@/components/shell/PageHeader";
import EmptyState from "@/components/legacy/EmptyState";
import SkillsManager, { type SkillView } from "@/components/skills/SkillsManager";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const user = await getCurrentUser();
  if (!can(user, "skills.view")) {
    return (
      <>
        <PageHeader
          title="Skills"
          description="Procedures the desk has agreed to follow, defined as .md documents."
        />
        <div className="p-4 md:p-8">
          <EmptyState
            icon={Lock}
            title="Agent access required"
            hint="Only admins and agents can see the desk's skills. Switch users from the sidebar."
          />
        </div>
      </>
    );
  }

  const rows = await db.skill.findMany({ orderBy: { createdAt: "asc" } });
  const skills: SkillView[] = rows.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    categories: parseCategories(s.categories),
    markdown: s.markdown,
    enabled: s.enabled,
  }));

  return (
    <>
      <PageHeader
        title="Skills"
        description="What the desk has decided to always do. Each skill is Markdown with frontmatter (name, description, categories); resolvers see only the name and description, and load the body with read_skill when a ticket calls for it. QA reviews the run against the skills that applied."
      />
      <div className="space-y-4 p-4 md:p-8">
        <SkillsManager skills={skills} canManage={can(user, "skills.manage")} />
      </div>
    </>
  );
}
