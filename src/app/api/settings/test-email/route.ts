import type { NextRequest } from "next/server";
import { z } from "zod";
import nodemailer from "nodemailer";
import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { getSmtpConfig } from "@/lib/notify";

export const dynamic = "force-dynamic";

const testSchema = z.object({
  // Optional overrides so the form can test unsaved values; the stored/env
  // config fills anything omitted. `to` defaults to the current user.
  url: z.string().optional(),
  from: z.string().optional(),
  to: z.string().email().optional(),
});

/** POST /api/settings/test-email — send a real test email, loudly. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  const denied = forbid(user, "settings.manage");
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const parsed = testSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return Response.json({ error: "Invalid test payload." }, { status: 400 });
  }

  const stored = await getSmtpConfig();
  const url = parsed.data.url || stored.url;
  const from = parsed.data.from || stored.from;
  const to = parsed.data.to || user.email;
  if (!url) {
    return Response.json(
      { error: "No SMTP URL configured. Set SMTP_URL or save one in Settings." },
      { status: 400 },
    );
  }

  const started = Date.now();
  try {
    const transport = nodemailer.createTransport(url);
    await transport.sendMail({
      from,
      to,
      subject: "[Servo] SMTP test",
      text: "This is Servo's SMTP connectivity test. If you are reading this, notifications work.",
    });
    return Response.json({ ok: true, latencyMs: Date.now() - started, to });
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message.slice(0, 400) : "Send failed.",
        latencyMs: Date.now() - started,
      },
      { status: 502 },
    );
  }
}
