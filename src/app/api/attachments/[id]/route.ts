import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/attachments/[id] — serve a ticket attachment (screenshots today). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const { id } = await params;

  const attachment = await db.attachment.findUnique({
    where: { id },
    include: { ticket: { select: { requesterId: true } } },
  });
  // Requesters only reach attachments on their own tickets (404, not 403 —
  // no existence oracle), mirroring ticket visibility.
  if (
    !attachment ||
    (user.role === "REQUESTER" && attachment.ticket.requesterId !== user.id)
  ) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(attachment.data), {
    headers: {
      "Content-Type": attachment.contentType,
      "Content-Disposition": `inline; filename="${attachment.name}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
