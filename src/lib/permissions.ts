import type { User } from "@prisma/client";
import type { RiskLevel, Role } from "@/lib/types";

export type Action =
  | "ticket.create"
  | "ticket.update"
  | "ticket.assign"
  | "ticket.comment"
  | "agent.run"
  | "approval.view"
  | "approval.decide"
  | "settings.manage"
  | "kpi.view";

const MATRIX: Record<Action, Role[]> = {
  "ticket.create": ["ADMIN", "AGENT", "REQUESTER"],
  "ticket.update": ["ADMIN", "AGENT"],
  "ticket.assign": ["ADMIN", "AGENT"],
  "ticket.comment": ["ADMIN", "AGENT", "REQUESTER"],
  "agent.run": ["ADMIN", "AGENT"],
  "approval.view": ["ADMIN", "AGENT"],
  "approval.decide": ["ADMIN", "AGENT"],
  "settings.manage": ["ADMIN"],
  "kpi.view": ["ADMIN", "AGENT"],
};

export function can(user: Pick<User, "role">, action: Action): boolean {
  return MATRIX[action].includes(user.role as Role);
}

/** HIGH-risk approvals are admin-only; agents may decide LOW/MEDIUM. */
export function canDecideApproval(
  user: Pick<User, "role">,
  riskLevel: RiskLevel | string,
): boolean {
  if (user.role === "ADMIN") return true;
  return user.role === "AGENT" && riskLevel !== "HIGH";
}

/** Helper for API routes: returns a Response when the check fails, else null. */
export function forbid(user: Pick<User, "role">, action: Action): Response | null {
  if (can(user, action)) return null;
  return Response.json(
    { error: `Your role (${user.role}) is not allowed to perform ${action}.` },
    { status: 403 },
  );
}
