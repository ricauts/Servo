import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { runSlaScan } from "@/lib/sla";

export const dynamic = "force-dynamic";

/**
 * POST /api/sla/scan — escalate tickets that missed their SLA target.
 * Meant to be called on a schedule (cron, a container sidecar, or a hosted
 * scheduler). Admins can also trigger it from Settings. Unattended callers
 * authenticate with the inbound shared secret instead of a session.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.SLA_SCAN_SECRET ?? "";
  const provided = req.headers.get("x-servo-token") ?? "";
  const machineAuthorized = secret !== "" && provided === secret;

  if (!machineAuthorized) {
    const user = await getCurrentUser();
    if (!can(user, "settings.manage")) {
      return Response.json(
        { error: "Only admins (or a caller with SLA_SCAN_SECRET) can run the SLA scan." },
        { status: 403 },
      );
    }
  }

  const result = await runSlaScan();
  return Response.json(result);
}
