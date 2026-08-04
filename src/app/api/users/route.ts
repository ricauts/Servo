import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  await getCurrentUser();
  // Only the fields the UI consumes — keeps email (and any future sensitive
  // field) out of the lowest-privilege role's reach.
  const users = await db.user.findMany({
    select: { id: true, name: true, role: true, aiKind: true, color: true },
    orderBy: { createdAt: "asc" },
  });
  return Response.json({ users });
}
