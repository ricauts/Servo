// AI reply drafts with human approval — the everyday support loop: a request
// arrives (usually by email), the AI writes the answer, a human reviews and
// approves it (editing if needed), and Servo posts it as a public comment and
// emails it to the requester. The subject carries the #number tag so the
// requester's answer threads back onto the same ticket.
//
// Concurrency: every status transition is an atomic claim (updateMany guarded
// by the current status) so concurrent approve/reject/regenerate calls cannot
// double-send a reply or corrupt the audit record. Draft generation itself is
// additionally serialized per ticket, mirroring the resolver-run guard.

import type { ReplyDraft, User } from "@prisma/client";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/notify";
import { replySubject } from "@/lib/reply-format";
import { emitEvent } from "@/lib/webhooks";
import { pickAgentProfile } from "@/lib/agent-profiles";
import { settingsForProfile, withUsage } from "./credentials";
import { draftSystem, draftUser } from "./prompts";
import { getProvider } from "./provider";

const CONVERSATION_LIMIT = 12; // most recent public comments fed to the model

// In-process guard: one draft generation per ticket at a time (same pattern
// as the resolver's activeResolverTickets set).
const activeDraftTickets = new Set<string>();

/**
 * Generate (or regenerate) the pending reply draft for a ticket. One pending
 * draft per ticket: regenerating replaces its body instead of stacking a
 * queue nobody asked for.
 */
export async function draftReply(ticketId: string): Promise<ReplyDraft> {
  if (activeDraftTickets.has(ticketId)) {
    throw new Error("A draft is already being generated for this ticket.");
  }
  activeDraftTickets.add(ticketId);
  try {
    return await draftReplyInner(ticketId);
  } finally {
    activeDraftTickets.delete(ticketId);
  }
}

async function draftReplyInner(ticketId: string): Promise<ReplyDraft> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { requester: true },
  });
  if (!ticket) throw new Error("Ticket not found.");
  if (ticket.status === "CLOSED") throw new Error("The ticket is closed.");

  const comments = await db.comment.findMany({
    where: { ticketId, kind: "COMMENT" },
    include: { author: true },
    orderBy: { createdAt: "desc" },
    take: CONVERSATION_LIMIT,
  });
  const conversation = comments
    .reverse()
    .map((c) => ({ author: c.author.name, body: c.body }));

  // The specialist that owns this category drafts the reply on its own
  // credential; without one the default BYOK config (or mock) does.
  const profile = await pickAgentProfile(ticket.category);
  const { settings, credentialName } = await settingsForProfile(profile);
  const agentName = profile?.name ?? "Servo Drafter";
  const provider = withUsage(getProvider(settings, { ticket, kind: "DRAFT" }), {
    kind: "DRAFT",
    agentName,
    credentialName: settings.provider === "mock" ? "mock" : credentialName,
    provider: settings.provider,
    model: settings.model,
  });

  const turn = await provider.complete({
    system: draftSystem,
    messages: [{ role: "user", content: [{ type: "text", text: draftUser(ticket, conversation) }] }],
    tools: [],
  });
  const body = turn.text.trim();
  if (!body) throw new Error("The model returned an empty draft.");

  const pending = await db.replyDraft.findFirst({
    where: { ticketId, status: "PENDING" },
  });
  if (pending) {
    // Guarded update: if the draft was approved/rejected while the model was
    // writing, leave the decided row untouched and store a fresh one instead.
    const { count } = await db.replyDraft.updateMany({
      where: { id: pending.id, status: "PENDING" },
      data: { body, agentName, createdAt: new Date() },
    });
    if (count === 1) {
      return db.replyDraft.findUniqueOrThrow({ where: { id: pending.id } });
    }
  }
  return db.replyDraft.create({ data: { ticketId, body, agentName } });
}

/**
 * Approve a pending draft (optionally with an edited body): claims the draft
 * atomically, posts the reply as a public comment by the approving human,
 * emails it to the requester, and starts the first-response SLA clock. Email
 * is best-effort — a broken SMTP setup never blocks the comment. The draft
 * row keeps the exact body that was sent.
 */
export async function approveDraft(
  draftId: string,
  decider: User,
  finalBody?: string,
): Promise<ReplyDraft> {
  const draft = await db.replyDraft.findUnique({
    where: { id: draftId },
    include: { ticket: { include: { requester: true } } },
  });
  if (!draft) throw new Error("Draft not found.");
  if (draft.status !== "PENDING") throw new Error("Draft was already decided.");
  if (draft.ticket.status === "CLOSED") {
    throw new Error("The ticket is closed — replies cannot be sent on it.");
  }

  const body = (finalBody ?? "").trim() || draft.body;

  // Atomic claim: only one concurrent decision wins; the rest see 0 rows and
  // never send anything. The row records the body that actually went out.
  const { count } = await db.replyDraft.updateMany({
    where: { id: draftId, status: "PENDING" },
    data: { status: "SENT", body, decidedAt: new Date(), deciderId: decider.id },
  });
  if (count === 0) throw new Error("Draft was already decided.");

  await db.comment.create({
    data: { ticketId: draft.ticketId, authorId: decider.id, body, kind: "COMMENT" },
  });
  // Guarded so a concurrent first reply's earlier timestamp is never overwritten.
  await db.ticket.updateMany({
    where: { id: draft.ticketId, firstResponseAt: null },
    data: { firstResponseAt: new Date() },
  });

  const emailed = await sendMail(
    [draft.ticket.requester.email],
    replySubject(draft.ticket.number, draft.ticket.title),
    `${body}\n\n--\nTicket #${draft.ticket.number} · reply to this email to continue the conversation.\n`,
  );

  const updated = await db.replyDraft.update({
    where: { id: draftId },
    data: { emailed },
  });
  void emitEvent("reply.sent", {
    ticketId: draft.ticketId,
    ticketNumber: draft.ticket.number,
    draftId,
    emailed,
    decidedBy: decider.name,
  });
  return updated;
}

/** Reject a pending draft. The ticket is untouched; nothing is sent. */
export async function rejectDraft(draftId: string, decider: User): Promise<ReplyDraft> {
  const { count } = await db.replyDraft.updateMany({
    where: { id: draftId, status: "PENDING" },
    data: { status: "REJECTED", decidedAt: new Date(), deciderId: decider.id },
  });
  if (count === 0) {
    const exists = await db.replyDraft.findUnique({ where: { id: draftId } });
    throw new Error(exists ? "Draft was already decided." : "Draft not found.");
  }
  return db.replyDraft.findUniqueOrThrow({ where: { id: draftId } });
}
