import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { draftReply } from "@/lib/ai/draft";

export const dynamic = "force-dynamic";

/** POST /api/tickets/[id]/draft — generate or regenerate the AI reply draft. */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  const forbidden = forbid(user, "ticket.update");
  if (forbidden) return forbidden;

  const { id } = await params;
  const ticket = await db.ticket.findUnique({ where: { id } });
  if (!ticket) return Response.json({ error: "Ticket not found." }, { status: 404 });
  if (ticket.status === "CLOSED") {
    return Response.json({ error: "The ticket is closed." }, { status: 409 });
  }

  try {
    const draft = await draftReply(id);
    return Response.json({ draft }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Draft generation failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
