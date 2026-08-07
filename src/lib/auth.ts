import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";
import { auth, getAuthConfig, needsSetup } from "@/lib/authjs";

export const USER_COOKIE = "servo_user";

/**
 * Resolve the acting user.
 *
 * - **Fresh install** (no human users): everything redirects to /setup so
 *   the self-hosting admin can bootstrap the environment.
 * - **oidc mode** (tenant configured via env or Settings): the Auth.js
 *   session is the identity; no session redirects to /login. Users are
 *   provisioned at sign-in by the authjs signIn callback.
 * - **demo mode**: the sidebar user-switcher cookie picks a seeded user,
 *   falling back to the seeded admin so the offline demo never needs login.
 */
export async function getCurrentUser(): Promise<User> {
  const user = await getCurrentUserOrNull();
  if (user) return user;
  // Fresh install → first-run setup; configured OIDC without a session → login.
  if (await needsSetup()) redirect("/setup");
  redirect("/login");
}

/** Like getCurrentUser but never redirects — for chrome (sidebar) that must
 * also render on /setup and /login. */
export async function getCurrentUserOrNull(): Promise<User | null> {
  const config = await getAuthConfig();

  if (config.mode === "oidc") {
    const session = await auth();
    const email = session?.user?.email?.toLowerCase();
    if (!email) return null;
    return db.user.findUnique({ where: { email } });
  }

  const store = await cookies();
  const id = store.get(USER_COOKIE)?.value;
  const picked = id ? await db.user.findUnique({ where: { id } }) : null;
  if (picked) return picked;
  return db.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
  });
}
