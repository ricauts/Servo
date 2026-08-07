import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getAuthConfig } from "@/lib/authjs";
import { USER_COOKIE } from "@/lib/auth";

export async function POST(req: NextRequest) {
  // The demo switcher is a demo-mode-only device; with real SSO it is gone.
  if ((await getAuthConfig()).mode === "oidc") {
    return Response.json({ error: "Not available with SSO enabled." }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { userId?: string } | null;
  if (!body?.userId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }
  const user = await db.user.findUnique({ where: { id: body.userId } });
  if (!user || user.role === "AI_AGENT") {
    return Response.json({ error: "Invalid user" }, { status: 400 });
  }
  const store = await cookies();
  store.set(USER_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return Response.json({ ok: true });
}
