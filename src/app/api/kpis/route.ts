import { getCurrentUser } from "@/lib/auth";
import { forbid } from "@/lib/permissions";
import { getKpis } from "@/lib/tickets";

export async function GET() {
  const user = await getCurrentUser();
  const denied = forbid(user, "kpi.view");
  if (denied) return denied;

  const kpis = await getKpis();
  return Response.json(kpis);
}
