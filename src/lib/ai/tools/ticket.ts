// Ticket lifecycle tools — the CORE_TOOLS every agent profile keeps: without
// them the resolver cannot communicate or close its work. They are the only
// tools that need the run's ToolContext.

import { db } from "@/lib/db";
import { notifyTicketResolved } from "@/lib/notify";
import { emitTicketEvent } from "@/lib/webhooks";
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
