// SLA persistence and the breach scan. Pure rules live in sla-rules.ts.

import { db } from "@/lib/db";
import { nextLevel, pickGroupAssignee } from "@/lib/escalation";
import { DEFAULT_SLA_POLICIES } from "@/lib/sla-rules";
import type { Priority } from "@/lib/types";

export {
  DEFAULT_SLA_POLICIES,
  evaluateSla,
  slaLabel,
  type SlaState,
  type SlaTarget,
  type SlaView,
} from "@/lib/sla-rules";

/**
 * Backfill missing policy rows so a fresh install (or an upgrade) always has
 * targets. Mirrors ensureToolPolicies(); admin edits are never overwritten.
 */
export async function ensureSlaPolicies(): Promise<void> {
  const existing = await db.slaPolicy.findMany({ select: { priority: true } });
  const known = new Set(existing.map((p) => p.priority));
  const missing = DEFAULT_SLA_POLICIES.filter((p) => !known.has(p.priority));
  if (missing.length > 0) await db.slaPolicy.createMany({ data: missing });
}

/** Deadlines for a ticket created at `from` with the given priority. */
export async function computeDueDates(
  priority: Priority | string,
  from: Date,
): Promise<{ responseDueAt: Date; resolutionDueAt: Date } | null> {
  await ensureSlaPolicies();
  const policy = await db.slaPolicy.findUnique({ where: { priority } });
  if (!policy) return null;
  return {
    responseDueAt: new Date(from.getTime() + policy.responseMinutes * 60_000),
    resolutionDueAt: new Date(from.getTime() + policy.resolutionMinutes * 60_000),
  };
}

/**
 * Apply the current policy to a ticket. Deadlines always count from creation,
 * so changing a priority re-baselines the clock rather than extending it.
 */
export async function applySlaToTicket(ticketId: string): Promise<void> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { priority: true, createdAt: true },
  });
  if (!ticket) return;
  const due = await computeDueDates(ticket.priority, ticket.createdAt);
  if (!due) return;
  await db.ticket.update({ where: { id: ticketId }, data: due });
}

export interface SlaScanResult {
  scanned: number;
  breached: number;
  escalated: { ticketId: string; number: number; from: string; to: string }[];
}

/**
 * Find open tickets past a deadline and escalate them one tier when their
 * policy says so. Idempotent: slaEscalatedAt stops a ticket escalating twice,
 * and reaching SENIOR simply stops (there is nowhere higher to go).
 */
export async function runSlaScan(now: Date = new Date()): Promise<SlaScanResult> {
  await ensureSlaPolicies();
  const policies = await db.slaPolicy.findMany();
  const escalateFor = new Map(policies.map((p) => [p.priority, p.escalateOnBreach]));

  const open = await db.ticket.findMany({
    where: {
      status: { notIn: ["RESOLVED", "CLOSED"] },
      slaEscalatedAt: null,
    },
    include: { group: true },
  });

  const result: SlaScanResult = { scanned: open.length, breached: 0, escalated: [] };

  for (const ticket of open) {
    // The live deadline: response until the first reply, then resolution.
    const due =
      ticket.firstResponseAt === null ? ticket.responseDueAt : ticket.resolutionDueAt;
    if (!due || now <= due) continue;
    result.breached++;

    if (!escalateFor.get(ticket.priority)) continue;
    const next = nextLevel(ticket.escalationLevel);
    if (!next || !ticket.groupId) continue;

    const assignee = await pickGroupAssignee(ticket.groupId, next);
    await db.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id: ticket.id },
        data: {
          escalationLevel: next,
          slaEscalatedAt: now,
          ...(assignee ? { assigneeId: assignee.id } : {}),
        },
      });
      const aiUser = await tx.user.findFirst({ where: { role: "AI_AGENT" } });
      await tx.comment.create({
        data: {
          ticketId: ticket.id,
          authorId: aiUser?.id ?? ticket.requesterId,
          kind: "SYSTEM",
          body: `SLA breached — auto-escalated from ${ticket.escalationLevel} to ${next} tier in ${
            ticket.group?.name ?? "the group"
          }${assignee ? ` and assigned to ${assignee.name}` : " (no eligible member available)"}.`,
        },
      });
    });

    result.escalated.push({
      ticketId: ticket.id,
      number: ticket.number,
      from: ticket.escalationLevel,
      to: next,
    });
  }

  return result;
}
