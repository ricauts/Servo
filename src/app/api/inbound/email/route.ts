import type { NextRequest } from "next/server";
import { getInboundConfig, ingestEmail } from "@/lib/inbound-email";
import { getAiSettings } from "@/lib/ai/settings";
import { runTriage } from "@/lib/ai/engine";
import { notifyTicketCreated } from "@/lib/notify";
import { applySlaToTicket } from "@/lib/sla";

export const dynamic = "force-dynamic";

/**
 * Field names used by the common inbound-mail providers. SendGrid Inbound
 * Parse posts `from/subject/text`, Mailgun `sender/subject/body-plain`,
 * Postmark JSON `From/Subject/TextBody`.
 */
function pick(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "";
}

async function readPayload(req: NextRequest): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await req.json().catch(() => ({}))) as Record<string, unknown>;
  }
  // multipart/form-data and application/x-www-form-urlencoded
  const form = await req.formData().catch(() => null);
  if (!form) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/**
 * POST /api/inbound/email — ingest one inbound message.
 * Auth is a shared secret: `x-servo-token` header (preferred) or `?token=`
 * for providers that cannot set headers.
 */
export async function POST(req: NextRequest) {
  const config = await getInboundConfig();
  if (!config.enabled) {
    return Response.json({ error: "Inbound email is disabled." }, { status: 404 });
  }
  if (!config.secret) {
    return Response.json(
      { error: "Inbound email has no shared secret configured." },
      { status: 503 },
    );
  }
  const provided =
    req.headers.get("x-servo-token") ?? req.nextUrl.searchParams.get("token") ?? "";
  if (provided !== config.secret) {
    return Response.json({ error: "Invalid inbound token." }, { status: 401 });
  }

  const payload = await readPayload(req);
  const from = pick(payload, ["from", "sender", "From"]);
  const subject = pick(payload, ["subject", "Subject"]);
  const text = pick(payload, ["text", "body-plain", "TextBody", "stripped-text"]);
  if (!from) {
    return Response.json({ error: "Missing sender address." }, { status: 400 });
  }

  const result = await ingestEmail({ from, subject, text });
  if (result.action === "ignored") {
    return Response.json({ ok: true, ...result });
  }

  if (result.action === "created") {
    await applySlaToTicket(result.ticketId);
    void notifyTicketCreated(result.ticketId);
    const { autoTriage } = await getAiSettings();
    if (autoTriage) {
      try {
        await runTriage(result.ticketId);
      } catch (err) {
        // Triage failure must never reject the delivery — the provider would
        // retry and duplicate the ticket.
        console.error(`Auto-triage failed for inbound ticket ${result.ticketId}:`, err);
      }
    }
  }

  return Response.json({ ok: true, ...result }, { status: 201 });
}
