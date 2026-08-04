import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

/** GET /api/runs/[id] — one agent run with its steps and approvals. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await getCurrentUser();

  const run = await db.agentRun.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { index: "asc" } },
      approvals: { orderBy: { requestedAt: "asc" } },
    },
  });
  if (!run) {
    return Response.json({ error: "Run not found" }, { status: 404 });
  }
  return Response.json({ run });
}
