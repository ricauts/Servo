// Email notifications (SMTP). Best-effort by design: a broken mail setup must
// never break ticket flows, so every public function catches and logs.
// Config follows the BYOK pattern: env SMTP_URL wins over the Settings copy,
// and the URL (which may embed credentials) is never returned by any API.

import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { SETTING_KEYS } from "@/lib/types";

export interface SmtpConfig {
  enabled: boolean;
  url: string;
  from: string;
  urlSource: "env" | "db" | "none";
}

export async function getSmtpConfig(): Promise<SmtpConfig> {
  const rows = await db.setting.findMany({
    where: {
      key: {
        in: [SETTING_KEYS.smtpEnabled, SETTING_KEYS.smtpUrl, SETTING_KEYS.smtpFrom],
      },
    },
  });
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const envUrl = process.env.SMTP_URL ?? "";
  const dbUrl = map.get(SETTING_KEYS.smtpUrl) ?? "";
  const url = envUrl || dbUrl;
  return {
    enabled: (map.get(SETTING_KEYS.smtpEnabled) ?? "false") === "true",
    url,
    from: map.get(SETTING_KEYS.smtpFrom) || "Servo <servo@localhost>",
    urlSource: envUrl ? "env" : dbUrl ? "db" : "none",
  };
}

/**
 * Send a notification email. Returns true when actually sent. Never throws —
 * disabled/unconfigured SMTP or transport errors resolve to false.
 */
export async function sendMail(
  to: string[],
  subject: string,
  text: string,
): Promise<boolean> {
  try {
    const config = await getSmtpConfig();
    if (!config.enabled || !config.url || to.length === 0) return false;
    const transport = nodemailer.createTransport(config.url);
    await transport.sendMail({ from: config.from, to: to.join(", "), subject, text });
    return true;
  } catch (err) {
    console.warn("[notify] email send failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

function ticketUrl(ticketId: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/tickets/${ticketId}`;
}

/** New ticket confirmation to the requester. */
export async function notifyTicketCreated(ticketId: string): Promise<void> {
  try {
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      include: { requester: true },
    });
    if (!ticket) return;
    await sendMail(
      [ticket.requester.email],
      `[Servo] Ticket #${ticket.number} received: ${ticket.title}`,
      `Hi ${ticket.requester.name},\n\nYour ticket has been received and queued for triage.\n\n#${ticket.number} — ${ticket.title}\n${ticket.description}\n\nFollow it here: ${ticketUrl(ticket.id)}\n`,
    );
  } catch {
    /* best-effort */
  }
}

/** Resolution notice to the requester. */
export async function notifyTicketResolved(ticketId: string): Promise<void> {
  try {
    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      include: { requester: true, assignee: true },
    });
    if (!ticket) return;
    await sendMail(
      [ticket.requester.email],
      `[Servo] Ticket #${ticket.number} resolved: ${ticket.title}`,
      `Hi ${ticket.requester.name},\n\nYour ticket was resolved${ticket.assignee ? ` by ${ticket.assignee.name}` : ""}.\n\n#${ticket.number} — ${ticket.title}\n\nReview it here: ${ticketUrl(ticket.id)}\n`,
    );
  } catch {
    /* best-effort */
  }
}

/** Pending-approval alert to every admin. */
export async function notifyApprovalPending(approvalId: string): Promise<void> {
  try {
    const approval = await db.approval.findUnique({
      where: { id: approvalId },
      include: { ticket: true },
    });
    if (!approval) return;
    const admins = await db.user.findMany({ where: { role: "ADMIN" } });
    await sendMail(
      admins.map((a) => a.email),
      `[Servo] Approval needed: ${approval.toolName} on #${approval.ticket.number}`,
      `An AI agent is paused waiting for a human decision.\n\nTicket #${approval.ticket.number} — ${approval.ticket.title}\nTool: ${approval.toolName} (${approval.riskLevel} risk)\nInput: ${approval.toolInput}\n\nDecide here: ${process.env.APP_URL ?? "http://localhost:3000"}/approvals\n`,
    );
  } catch {
    /* best-effort */
  }
}
