import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { db } from "@/lib/db";

export const USER_COOKIE = "servo_user";

/**
 * POC auth: identity is a cookie holding a seeded user id, switchable from the
 * sidebar. Falls back to the seeded admin so the demo never needs a login.
 * Replace with real auth (OIDC/SSO) before any non-demo deployment.
 */
export async function getCurrentUser(): Promise<User> {
  const store = await cookies();
  const id = store.get(USER_COOKIE)?.value;
  let user = id ? await db.user.findUnique({ where: { id } }) : null;
  if (!user) {
    user = await db.user.findFirst({
      where: { role: "ADMIN" },
      orderBy: { createdAt: "asc" },
    });
  }
  if (!user) {
    throw new Error("No users found. Run `npm run setup` to seed the database.");
  }
  return user;
}
