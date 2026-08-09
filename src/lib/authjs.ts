// Real authentication (Auth.js / NextAuth v5) with a generic OIDC provider —
// Entra ID, Google, Okta, Keycloak, Auth0, or any spec-compliant IdP.
//
// Self-host friendly: the tenant can be configured by an admin from the UI
// (stored in Settings) or via env vars, env winning — the same precedence
// pattern as every other integration. With no OIDC config Servo stays in the
// offline demo mode (cookie user switcher).

import NextAuth from "next-auth";
import { db } from "@/lib/db";
import { isEmailAllowed, parseList } from "@/lib/auth-rules";

export const AUTH_SETTING_KEYS = {
  issuer: "auth.oidc.issuer",
  clientId: "auth.oidc.clientId",
  clientSecret: "auth.oidc.clientSecret", // never returned by the API
  providerName: "auth.oidc.providerName",
  adminEmails: "auth.adminEmails", // comma-separated; auto-ADMIN at sign-in
  allowedDomains: "auth.allowedDomains", // comma-separated; empty = any domain
} as const;

export interface AuthConfig {
  mode: "oidc" | "demo";
  issuer: string;
  clientId: string;
  clientSecret: string;
  providerName: string;
  adminEmails: string[];
  allowedDomains: string[];
  secretSource: "env" | "db" | "none";
}

export async function getAuthConfig(): Promise<AuthConfig> {
  const rows = await db.setting.findMany({
    where: { key: { in: Object.values(AUTH_SETTING_KEYS) } },
  });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const envSecret = process.env.OIDC_CLIENT_SECRET ?? "";
  const dbSecret = map.get(AUTH_SETTING_KEYS.clientSecret) ?? "";
  const issuer = process.env.OIDC_ISSUER || map.get(AUTH_SETTING_KEYS.issuer) || "";
  const clientId = process.env.OIDC_CLIENT_ID || map.get(AUTH_SETTING_KEYS.clientId) || "";
  const clientSecret = envSecret || dbSecret;
  return {
    mode: issuer && clientId && clientSecret ? "oidc" : "demo",
    issuer,
    clientId,
    clientSecret,
    providerName:
      process.env.OIDC_PROVIDER_NAME || map.get(AUTH_SETTING_KEYS.providerName) || "SSO",
    adminEmails: parseList(
      process.env.AUTH_ADMIN_EMAILS || map.get(AUTH_SETTING_KEYS.adminEmails) || "",
    ),
    allowedDomains: parseList(
      process.env.AUTH_ALLOWED_DOMAINS || map.get(AUTH_SETTING_KEYS.allowedDomains) || "",
    ),
    secretSource: envSecret ? "env" : dbSecret ? "db" : "none",
  };
}

const USER_COLORS = ["#4A3AA7", "#1C5CAB", "#B4491F", "#8F6400", "#0A6E66", "#7A2E8D"];

// Request-time config so an admin can change the tenant without a restart.
export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const config = await getAuthConfig();
  return {
    session: { strategy: "jwt" },
    trustHost: true,
    // Production deployments must set AUTH_SECRET (see .env.example); the
    // fallback keeps offline demo installs booting.
    secret: process.env.AUTH_SECRET ?? "servo-insecure-dev-secret-set-AUTH_SECRET",
    pages: { signIn: "/login", error: "/login" },
    providers:
      config.mode === "oidc"
        ? [
            {
              id: "oidc",
              name: config.providerName,
              type: "oidc",
              issuer: config.issuer,
              clientId: config.clientId,
              clientSecret: config.clientSecret,
            },
          ]
        : [],
    callbacks: {
      /** First sign-in provisions the user; admins come from adminEmails. */
      async signIn({ profile, user }) {
        const email = (profile?.email ?? user?.email)?.toLowerCase();
        if (!email) return false;
        if (!isEmailAllowed(email, config)) return false;
        const existing = await db.user.findUnique({ where: { email } });
        const shouldBeAdmin = config.adminEmails.includes(email);
        if (!existing) {
          const count = await db.user.count();
          await db.user.create({
            data: {
              email,
              name:
                (profile?.name as string | undefined) ??
                (user?.name as string | undefined) ??
                email.split("@")[0],
              role: shouldBeAdmin ? "ADMIN" : "REQUESTER",
              color: USER_COLORS[count % USER_COLORS.length],
            },
          });
        } else if (shouldBeAdmin && existing.role !== "ADMIN") {
          await db.user.update({ where: { email }, data: { role: "ADMIN" } });
        }
        return true;
      },
    },
  };
});

/** True while the install has no human users — first-run setup required. */
export async function needsSetup(): Promise<boolean> {
  const humans = await db.user.count({ where: { role: { not: "AI_AGENT" } } });
  return humans === 0;
}
