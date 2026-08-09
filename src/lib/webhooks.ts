// Outbound webhooks. emitEvent() is fire-and-forget from the ticket flows:
// every enabled endpoint subscribed to the event gets a signed POST, and each
// attempt lands in a short rolling delivery log. A dead endpoint never blocks
// a ticket — the same best-effort contract as email notifications.

import { createHmac, randomBytes } from "crypto";
import { db } from "@/lib/db";

/** Event names a webhook can subscribe to ("*" = all). */
export const WEBHOOK_EVENTS = [
  "ticket.created",
  "ticket.resolved",
  "ticket.escalated",
  "approval.pending",
  "approval.decided",
  "reply.sent",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const DELIVERY_LOG_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 10_000;

export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

/** Hex HMAC-SHA256 of the raw body — the value inside x-servo-signature. */
export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** Whether a subscription list covers the event. */
export function subscribes(eventsJson: string, event: string): boolean {
  try {
    const events = JSON.parse(eventsJson) as string[];
    return events.includes("*") || events.includes(event);
  } catch {
    return false;
  }
}

async function deliver(
  webhook: { id: string; url: string; secret: string },
  event: string,
  body: string,
): Promise<void> {
  const started = Date.now();
  let ok = false;
  let statusCode: number | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-servo-event": event,
        "x-servo-signature": `sha256=${signPayload(webhook.secret, body)}`,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    statusCode = res.status;
    ok = res.ok;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message.slice(0, 300) : "delivery failed";
  }

  try {
    await db.webhookDelivery.create({
      data: {
        webhookId: webhook.id,
        event,
        ok,
        statusCode,
        error,
        durationMs: Date.now() - started,
      },
    });
    // Rolling log: keep only the most recent entries per webhook.
    const stale = await db.webhookDelivery.findMany({
      where: { webhookId: webhook.id },
      orderBy: { createdAt: "desc" },
      skip: DELIVERY_LOG_LIMIT,
      select: { id: true },
    });
    if (stale.length > 0) {
      await db.webhookDelivery.deleteMany({
        where: { id: { in: stale.map((d) => d.id) } },
      });
    }
  } catch {
    /* the log is best-effort too */
  }
}

/**
 * Send `event` to every enabled, subscribed webhook. Never throws; callers
 * use `void emitEvent(...)` exactly like the notify helpers.
 */
export async function emitEvent(
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const hooks = await db.webhook.findMany({ where: { enabled: true } });
    const targets = hooks.filter((h) => subscribes(h.events, event));
    if (targets.length === 0) return;
    const body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      data,
    });
    await Promise.allSettled(targets.map((h) => deliver(h, event, body)));
  } catch (err) {
    console.warn("[webhooks] emit failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Deliver a ping to ONE webhook (even a disabled one — that is how an admin
 * verifies an endpoint before switching it on). Returns the logged delivery.
 */
export async function sendTestPing(
  webhookId: string,
  triggeredBy: string,
): Promise<void> {
  const hook = await db.webhook.findUnique({ where: { id: webhookId } });
  if (!hook) return;
  const body = JSON.stringify({
    event: "ping",
    timestamp: new Date().toISOString(),
    data: { message: "Servo webhook test", triggeredBy },
  });
  await deliver(hook, "ping", body);
}

/** Compact ticket payload shared by the ticket.* events. */
export async function ticketPayload(
  ticketId: string,
): Promise<Record<string, unknown> | null> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: {
      requester: { select: { name: true, email: true } },
      assignee: { select: { name: true } },
      group: { select: { name: true } },
    },
  });
  if (!ticket) return null;
  return {
    id: ticket.id,
    number: ticket.number,
    title: ticket.title,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    escalationLevel: ticket.escalationLevel,
    group: ticket.group?.name ?? null,
    requester: ticket.requester.name,
    assignee: ticket.assignee?.name ?? null,
    createdAt: ticket.createdAt.toISOString(),
  };
}

/** Emit a ticket.* event with the standard payload (fire-and-forget). */
export async function emitTicketEvent(
  event: Extract<WebhookEvent, `ticket.${string}`>,
  ticketId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const payload = await ticketPayload(ticketId);
  if (!payload) return;
  await emitEvent(event, { ticket: payload, ...extra });
}
