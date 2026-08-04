import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import {
  minSeniorityFor,
  nextLevel,
  pickGroupAssignee,
} from "@/lib/escalation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const escalateSchema = z.object({
  // Present = move the ticket to another group; absent = raise the tier
  // within the current group.
  toGroupId: z.string().min(1).optional(),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "ticket.escalate");
  if (denied) return denied;

  const { id } = await params;
  const ticket = await db.ticket.findUnique({
    where: { id },
    include: { group: true },
  });
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }
  if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
    return Response.json(
      { error: `Cannot escalate a ${ticket.status.toLowerCase()} ticket.` },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = escalateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }
  const { toGroupId, reason } = parsed.data;

  let summary: string;
  let data: {
    groupId?: string;
    escalationLevel: string;
    assigneeId: string | null;
  };

  if (toGroupId && toGroupId !== ticket.groupId) {
    const target = await db.group.findUnique({ where: { id: toGroupId } });
    if (!target) {
      return Response.json({ error: "Target group not found" }, { status: 404 });
    }
    const level = minSeniorityFor(ticket.priority);
    const assignee = await pickGroupAssignee(target.id, level);
    data = {
      groupId: target.id,
      escalationLevel: level,
      assigneeId: assignee?.id ?? null,
    };
    summary = `Escalated to the ${target.name} group at ${level} tier${
      assignee ? ` — assigned to ${assignee.name}` : " — no eligible member, left unassigned"
    }`;
  } else {
    if (!ticket.groupId) {
      return Response.json(
        { error: "Assign the ticket to a group before escalating a tier." },
        { status: 400 },
      );
    }
    const next = nextLevel(ticket.escalationLevel);
    if (!next) {
      return Response.json(
        {
          error:
            "Already at SENIOR tier — escalate to another group instead.",
        },
        { status: 400 },
      );
    }
    const assignee = await pickGroupAssignee(ticket.groupId, next);
    data = {
      escalationLevel: next,
      assigneeId: assignee?.id ?? null,
    };
    summary = `Escalated from ${ticket.escalationLevel} to ${next} tier in ${
      ticket.group?.name ?? "the group"
    }${
      assignee ? ` — assigned to ${assignee.name}` : " — no eligible member, left unassigned"
    }`;
  }

  const updated = await db.$transaction(async (tx) => {
    const t = await tx.ticket.update({
      where: { id },
      data,
      include: { group: true, assignee: true },
    });
    await tx.comment.create({
      data: {
        ticketId: id,
        authorId: user.id,
        kind: "SYSTEM",
        body: `${summary}${reason ? `. Reason: ${reason}` : "."}`,
      },
    });
    return t;
  });

  return Response.json({ ticket: updated });
}
