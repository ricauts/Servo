// Escalation helpers that need the database. The pure tier rules live in
// escalation-rules.ts so client components can share them.

import { db } from "@/lib/db";
import type { Category, Seniority } from "@/lib/types";
import { memberEligibleFor, seniorityRank } from "@/lib/escalation-rules";

export {
  canHandle,
  memberEligibleFor,
  minSeniorityFor,
  nextLevel,
  seniorityRank,
} from "@/lib/escalation-rules";

/** First group whose routed categories include the given category. */
export async function groupForCategory(category: Category | string) {
  const groups = await db.group.findMany({ orderBy: { createdAt: "asc" } });
  return (
    groups.find((g) => {
      try {
        return (JSON.parse(g.categories) as string[]).includes(category);
      } catch {
        return false;
      }
    }) ?? null
  );
}

/**
 * Least-loaded human member of the group eligible for the given tier
 * (ladder members at/above it, plus STANDALONE specialists). Ties break
 * toward the lowest sufficient ladder tier so seniors stay free for the
 * tickets only they can take; standalone members come after the ladder.
 */
export async function pickGroupAssignee(
  groupId: string,
  level: Seniority | string,
): Promise<{ id: string; name: string } | null> {
  const members = await db.groupMember.findMany({
    where: { groupId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          role: true,
          _count: {
            select: {
              assignedTickets: {
                where: { status: { notIn: ["RESOLVED", "CLOSED"] } },
              },
            },
          },
        },
      },
    },
  });
  const tieRank = (tier: string) =>
    tier === "STANDALONE" ? Number.MAX_SAFE_INTEGER : seniorityRank(tier);
  const eligible = members
    .filter(
      (m) => m.user.role !== "AI_AGENT" && memberEligibleFor(m.seniority, level),
    )
    .sort((a, b) => {
      const load = a.user._count.assignedTickets - b.user._count.assignedTickets;
      return load !== 0 ? load : tieRank(a.seniority) - tieRank(b.seniority);
    });
  const user = eligible[0]?.user;
  return user ? { id: user.id, name: user.name } : null;
}
