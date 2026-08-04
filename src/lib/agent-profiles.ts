// Database helpers for specialized agent profiles. Pure parsing/validation
// lives in agent-profile-format.ts.

import type { AgentProfile } from "@prisma/client";
import { db } from "@/lib/db";

export {
  CORE_TOOLS,
  parseProfileMarkdown,
  profileAllowsTool,
  slugify,
  type ParsedProfile,
} from "@/lib/agent-profile-format";

/** The enabled profile covering the ticket's category, or null. */
export async function pickAgentProfile(
  category: string,
): Promise<AgentProfile | null> {
  const profiles = await db.agentProfile.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
  });
  return (
    profiles.find((p) => {
      try {
        return (JSON.parse(p.categories) as string[]).includes(category);
      } catch {
        return false;
      }
    }) ?? null
  );
}
