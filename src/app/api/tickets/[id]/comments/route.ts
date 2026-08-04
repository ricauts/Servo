import type { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";

type Params = { params: Promise<{ id: string }> };

const commentSchema = z.object({
  body: z.string().min(1, "Comment body is required"),
});

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser();
  const denied = forbid(user, "ticket.comment");
  if (denied) return denied;

  const { id } = await params;
  const ticket = await db.ticket.findUnique({ where: { id } });
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = commentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  const comment = await db.comment.create({
    data: {
      ticketId: id,
      authorId: user.id,
      body: parsed.data.body,
      kind: "COMMENT",
    },
    include: { author: true },
  });

  // First response = first comment by someone other than the requester.
  if (ticket.firstResponseAt === null && user.id !== ticket.requesterId) {
    await db.ticket.update({
      where: { id },
      data: { firstResponseAt: new Date() },
    });
  }

  return Response.json({ comment }, { status: 201 });
}
