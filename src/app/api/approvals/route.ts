import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { forbid } from "@/lib/permissions";

const STATUSES = ["PENDING", "APPROVED", "REJECTED", "ALL"] as const;
type StatusFilter = (typeof STATUSES)[number];

/** GET /api/approvals?status=PENDING|APPROVED|REJECTED|ALL — approvals inbox. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  const forbidden = forbid(user, "approval.view");
  if (forbidden) return forbidden;

  const raw = req.nextUrl.searchParams.get("status") ?? "PENDING";
  if (!STATUSES.includes(raw as StatusFilter)) {
    return Response.json(
      { error: `Invalid status filter. Use one of: ${STATUSES.join(", ")}.` },
      { status: 400 },
    );
  }
  const status = raw as StatusFilter;

  const approvals = await db.approval.findMany({
    where: status === "ALL" ? {} : { status },
    include: { ticket: true, run: true, decider: true },
    orderBy: { requestedAt: "desc" },
  });
  return Response.json({ approvals });
}
