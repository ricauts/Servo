import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { ticketDetailInclude } from "@/lib/tickets";
import type { Prisma } from "@prisma/client";
import { runResolver } from "@/lib/ai/engine";
import { notifyTicketResolved } from "@/lib/notify";
import { applySlaToTicket } from "@/lib/sla";
import { emitTicketEvent } from "@/lib/webhooks";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const { id } = await params;

  const ticket = await db.ticket.findUnique({
    where: { id },
    include: ticketDetailInclude,
  });
  // Requesters only ever see their own tickets (404, not 403 — no oracle).
  if (!ticket || (user.role === "REQUESTER" && ticket.requesterId !== user.id)) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }
  return Response.json({ ticket });
}

const patchSchema = z.object({
  status: z
    .enum(["OPEN", "TRIAGED", "IN_PROGRESS", "WAITING_APPROVAL", "RESOLVED", "CLOSED"])
    .optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  category: z
    .enum(["ACCESS", "HARDWARE", "SOFTWARE", "DATABASE", "DEVOPS", "NETWORK", "OTHER"])
    .optional(),
  assigneeId: z.union([z.string().min(1), z.null()]).optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "ticket.update");
  if (denied) return denied;

  const { id } = await params;
  const ticket = await db.ticket.findUnique({ where: { id } });
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }
  const patch = parsed.data;

  const data: Prisma.TicketUncheckedUpdateInput = {};

  if (patch.status !== undefined) {
    data.status = patch.status;
    if (patch.status === "RESOLVED") {
      // Keep the original resolution time if the ticket was already resolved.
      data.resolvedAt = ticket.resolvedAt ?? new Date();
    } else if (patch.status !== "CLOSED") {
      // Reopening clears the resolution timestamp.
      data.resolvedAt = null;
    }
    if (ticket.firstResponseAt === null && patch.status !== "OPEN") {
      data.firstResponseAt = new Date();
    }
  }
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.category !== undefined) data.category = patch.category;

  let assignedUser: { role: string; aiKind: string | null } | null = null;
  if (patch.assigneeId !== undefined) {
    if (patch.assigneeId === null) {
      data.assigneeId = null;
    } else {
      const candidate = await db.user.findUnique({
        where: { id: patch.assigneeId },
        select: { id: true, role: true, aiKind: true },
      });
      if (!candidate) {
        return Response.json({ error: "Assignee not found" }, { status: 400 });
      }
      data.assigneeId = candidate.id;
      assignedUser = candidate;
    }
  }

  const updated = await db.ticket.update({ where: { id }, data });

  // Closing invalidates any reply draft still awaiting review — sending a
  // "reply to continue" email on a closed thread would dead-end (inbound
  // refuses to comment on CLOSED tickets).
  if (patch.status === "CLOSED" && ticket.status !== "CLOSED") {
    await db.replyDraft.updateMany({
      where: { ticketId: id, status: "PENDING" },
      data: { status: "REJECTED", decidedAt: new Date() },
    });
  }

  if (patch.priority !== undefined && patch.priority !== ticket.priority) {
    await applySlaToTicket(id);
  }

  if (patch.status === "RESOLVED" && ticket.status !== "RESOLVED") {
    void notifyTicketResolved(id);
    void emitTicketEvent("ticket.resolved", id);
  }

  // Side effect: assigning to the RESOLVER AI agent starts a resolver run.
  if (
    assignedUser?.role === "AI_AGENT" &&
    assignedUser.aiKind === "RESOLVER" &&
    updated.status !== "RESOLVED" &&
    updated.status !== "CLOSED"
  ) {
    try {
      await runResolver(id);
    } catch (err) {
      console.error(`Resolver run failed for ticket ${id}:`, err);
    }
  }

  const fresh = await db.ticket.findUnique({
    where: { id },
    include: ticketDetailInclude,
  });
  return Response.json({ ticket: fresh });
}
