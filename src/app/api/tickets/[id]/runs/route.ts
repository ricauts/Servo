import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runResolver } from "@/lib/ai/engine";
import { forbid } from "@/lib/permissions";

/** POST /api/tickets/[id]/runs — start the AI resolver on a ticket. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  const forbidden = forbid(user, "agent.run");
  if (forbidden) return forbidden;

  const ticket = await db.ticket.findUnique({ where: { id } });
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }
  if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
    return Response.json(
      { error: "Cannot start an agent run on a resolved or closed ticket. Reopen it first." },
      { status: 409 },
    );
  }

  const active = await db.agentRun.findFirst({
    where: { ticketId: id, status: { in: ["RUNNING", "WAITING_APPROVAL"] } },
  });
  if (active) {
    return Response.json(
      { error: "An agent run is already running or waiting for approval on this ticket." },
      { status: 409 },
    );
  }

  try {
    if (!ticket.assigneeId) {
      const resolver = await db.user.findFirst({
        where: { role: "AI_AGENT", aiKind: "RESOLVER" },
      });
      if (resolver) {
        await db.ticket.update({ where: { id }, data: { assigneeId: resolver.id } });
      }
    }
    const run = await runResolver(id);
    return Response.json({ run });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start the agent run.";
    return Response.json({ error: message }, { status: 500 });
  }
}
