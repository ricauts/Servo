// Pure escalation rules (no database) — safe to import from client components.
// The hierarchy is per-group; priority sets the minimum tier a ticket lands on.

import { SENIORITIES } from "@/lib/types";
import type { Priority, Seniority } from "@/lib/types";

/** Minimum seniority allowed to work a ticket of the given priority. */
export function minSeniorityFor(priority: Priority | string): Seniority {
  if (priority === "URGENT") return "SENIOR";
  if (priority === "HIGH") return "MID";
  return "JUNIOR";
}

export function seniorityRank(s: Seniority | string): number {
  const i = SENIORITIES.indexOf(s as Seniority);
  return i === -1 ? 0 : i;
}

export function canHandle(
  seniority: Seniority | string,
  priority: Priority | string,
): boolean {
  return seniorityRank(seniority) >= seniorityRank(minSeniorityFor(priority));
}

/** The tier above the given one, or null when already at SENIOR. */
export function nextLevel(level: Seniority | string): Seniority | null {
  const i = seniorityRank(level);
  return i >= SENIORITIES.length - 1 ? null : SENIORITIES[i + 1];
}
