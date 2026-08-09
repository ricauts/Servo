// Ticket lifecycle tools — the CORE_TOOLS every agent profile keeps: without
// them the resolver cannot communicate or close its work. They are the only
// tools that need the run's ToolContext.

import { db } from "@/lib/db";
import { notifyTicketResolved } from "@/lib/notify";
import { emitTicketEvent } from "@/lib/webhooks";
import { pickGroupAssignee } from "@/lib/escalation";
import { str, type ToolDef } from "./types";

export const ticketTools: Record<string, ToolDef> = {
  post_comment: {
    name: "post_comment",
    description: "Post a public comment on the ticket to keep the requester informed.",
    inputSchema: {
      type: "object",
      properties: {
        body: { type: "string", description: "The comment text shown to the requester." },
      },
      required: ["body"],
    },
    async execute(input, ctx) {
      const body = str(input.body).trim();
      if (!body) return "Error: body is required.";
      await db.comment.create({
        data: { ticketId: ctx.ticketId, authorId: ctx.agentUser.id, body, kind: "COMMENT" },
      });
      const ticket = await db.ticket.findUnique({ where: { id: ctx.ticketId } });
      if (ticket && !ticket.firstResponseAt) {
        await db.ticket.update({
          where: { id: ctx.ticketId },
          data: { firstResponseAt: new Date() },
        });
      }
      return "Comment posted.";
    },
  },

  escalate_to_human: {
    name: "escalate_to_human",
    description:
      "Hand the ticket to a human teammate because the main objective could NOT be completed (a tool failed, permissions were missing, or an approval was rejected). Never resolve a ticket whose objective was not met — escalate it with this instead.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "What was attempted, what blocked it, and what the human needs to do.",
        },
      },
      required: ["reason"],
    },
    async execute(input, ctx) {
      const reason = str(input.reason).trim();
      if (!reason) return "Error: reason is required.";
      const ticket = await db.ticket.findUnique({ where: { id: ctx.ticketId } });
      if (!ticket) return "Error: ticket not found.";
      // Prefer a member of the ticket's group at its current tier; any human
      // agent keeps the ticket from dead-ending when there is no group.
      const groupPick = ticket.groupId
        ? await pickGroupAssignee(ticket.groupId, ticket.escalationLevel)
        : null;
      const human =
        groupPick ??
        (await db.user.findFirst({ where: { role: "AGENT" }, orderBy: { createdAt: "asc" } }));
      await db.ticket.update({
        where: { id: ctx.ticketId },
        data: {
          status: human ? "IN_PROGRESS" : "TRIAGED",
          resolvedAt: null,
          ...(human ? { assigneeId: human.id } : {}),
        },
      });
      await db.comment.create({
        data: {
          ticketId: ctx.ticketId,
          authorId: ctx.agentUser.id,
          kind: "SYSTEM",
          body: `Escalated to ${human ? human.name : "the human queue"} by ${ctx.agentUser.name}: ${reason}`,
        },
      });
      void emitTicketEvent("ticket.escalated", ctx.ticketId, { reason, by: ctx.agentUser.name });
      return human
        ? `Ticket escalated to ${human.name}. Post a comment for the requester if you have not already, then stop — do NOT resolve the ticket.`
        : "Ticket returned to the human queue. Post a comment for the requester if you have not already, then stop — do NOT resolve the ticket.";
    },
  },

  resolve_ticket: {
    name: "resolve_ticket",
    description: "Mark the ticket as resolved with a short resolution note. Call this last.",
    inputSchema: {
      type: "object",
      properties: {
        resolution: { type: "string", description: "A concise resolution note." },
      },
      required: ["resolution"],
    },
    async execute(input, ctx) {
      const resolution = str(input.resolution).trim() || "Resolved by AI agent.";
      await db.ticket.update({
        where: { id: ctx.ticketId },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      await db.comment.create({
        data: {
          ticketId: ctx.ticketId,
          authorId: ctx.agentUser.id,
          kind: "SYSTEM",
          body: `Resolved by ${ctx.agentUser.name}: ${resolution}`,
        },
      });
      void notifyTicketResolved(ctx.ticketId);
      void emitTicketEvent("ticket.resolved", ctx.ticketId);
      return "Ticket marked as resolved.";
    },
  },
};
