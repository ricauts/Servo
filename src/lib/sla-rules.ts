// Pure SLA rules (no database) — shared by the server, the seed and client
// components that render due-date state.

import type { Priority } from "@/lib/types";

export interface SlaTarget {
  priority: Priority;
  responseMinutes: number;
  resolutionMinutes: number;
  escalateOnBreach: boolean;
}

/** Starting targets: tighter as priority rises. Editable in Settings. */
export const DEFAULT_SLA_POLICIES: SlaTarget[] = [
  { priority: "URGENT", responseMinutes: 15, resolutionMinutes: 4 * 60, escalateOnBreach: true },
  { priority: "HIGH", responseMinutes: 60, resolutionMinutes: 8 * 60, escalateOnBreach: true },
  { priority: "MEDIUM", responseMinutes: 4 * 60, resolutionMinutes: 24 * 60, escalateOnBreach: true },
  { priority: "LOW", responseMinutes: 8 * 60, resolutionMinutes: 72 * 60, escalateOnBreach: false },
];

/** Below this fraction of the window remaining, a ticket counts as at risk. */
const AT_RISK_FRACTION = 0.2;

export type SlaState = "met" | "ok" | "at_risk" | "breached" | "none";

export interface SlaView {
  state: SlaState;
  /** The deadline that drives the state, when one applies. */
  dueAt: string | null;
  /** What the deadline is for, for labelling. */
  kind: "response" | "resolution" | null;
}

/**
 * Which deadline matters right now and how it is doing.
 * Response is tracked until the first reply; then resolution takes over.
 * Resolved/closed tickets report whether they landed inside the window.
 */
export function evaluateSla(ticket: {
  status: string;
  createdAt: string | Date;
  firstResponseAt: string | Date | null;
  resolvedAt: string | Date | null;
  responseDueAt: string | Date | null;
  resolutionDueAt: string | Date | null;
}, now: Date = new Date()): SlaView {
  const iso = (value: string | Date | null) =>
    value === null ? null : new Date(value).toISOString();
  const ms = (value: string | Date | null) =>
    value === null ? null : new Date(value).getTime();

  const createdAt = new Date(ticket.createdAt).getTime();
  const responded = ms(ticket.firstResponseAt);
  const resolved = ms(ticket.resolvedAt);
  const responseDue = ms(ticket.responseDueAt);
  const resolutionDue = ms(ticket.resolutionDueAt);

  if (ticket.status === "RESOLVED" || ticket.status === "CLOSED") {
    if (resolved === null || resolutionDue === null) {
      return { state: "none", dueAt: null, kind: null };
    }
    return {
      state: resolved <= resolutionDue ? "met" : "breached",
      dueAt: iso(ticket.resolutionDueAt),
      kind: "resolution",
    };
  }

  // Still waiting on a first reply: the response clock is what counts.
  if (responded === null && responseDue !== null) {
    return {
      state: classify(createdAt, responseDue, now.getTime()),
      dueAt: iso(ticket.responseDueAt),
      kind: "response",
    };
  }
  if (resolutionDue !== null) {
    return {
      state: classify(createdAt, resolutionDue, now.getTime()),
      dueAt: iso(ticket.resolutionDueAt),
      kind: "resolution",
    };
  }
  return { state: "none", dueAt: null, kind: null };
}

function classify(startMs: number, dueMs: number, nowMs: number): SlaState {
  if (nowMs > dueMs) return "breached";
  const window = dueMs - startMs;
  if (window > 0 && (dueMs - nowMs) / window <= AT_RISK_FRACTION) return "at_risk";
  return "ok";
}

/** Compact human label for a deadline, e.g. "2h left" / "3h over". */
export function slaLabel(view: SlaView, now: Date = new Date()): string {
  if (view.state === "none" || view.dueAt === null) return "—";
  if (view.state === "met") return "Met";
  const deltaMin = Math.round(
    (new Date(view.dueAt).getTime() - now.getTime()) / 60_000,
  );
  const magnitude = Math.abs(deltaMin);
  const amount =
    magnitude >= 1440
      ? `${Math.round(magnitude / 1440)}d`
      : magnitude >= 60
        ? `${Math.round(magnitude / 60)}h`
        : `${magnitude}m`;
  return deltaMin >= 0 ? `${amount} left` : `${amount} over`;
}
