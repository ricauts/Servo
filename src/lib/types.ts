// Shared enum-like unions and API payload shapes. SQLite has no enums, so
// these unions are the single source of truth for the string values stored in
// the database. Keep prisma/seed.ts and all agents consistent with them.

export type Role = "ADMIN" | "AGENT" | "REQUESTER" | "AI_AGENT";
export type AiKind = "TRIAGE" | "RESOLVER" | "QA";

export type TicketStatus =
  | "OPEN"
  | "TRIAGED"
  | "IN_PROGRESS"
  | "WAITING_APPROVAL"
  | "RESOLVED"
  | "CLOSED";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export type Category =
  | "ACCESS"
  | "HARDWARE"
  | "SOFTWARE"
  | "DATABASE"
  | "DEVOPS"
  | "NETWORK"
  | "OTHER";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** Escalation tiers within a group, lowest to highest. */
export type Seniority = "JUNIOR" | "MID" | "SENIOR";
export const SENIORITIES: Seniority[] = ["JUNIOR", "MID", "SENIOR"];

/**
 * A membership is either on the JUNIOR→MID→SENIOR ladder or STANDALONE — a
 * specialist outside the hierarchy who can take tickets at any tier but is
 * never the target of tier escalation preference.
 */
export type MemberTier = Seniority | "STANDALONE";
export const MEMBER_TIERS: MemberTier[] = [...SENIORITIES, "STANDALONE"];

export type RunStatus = "RUNNING" | "WAITING_APPROVAL" | "COMPLETED" | "FAILED";
export type RunKind = "TRIAGE" | "RESOLVE";
export type StepType =
  | "TEXT"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "APPROVAL_REQUEST"
  | "QA_REVIEW"
  | "ERROR";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export const TICKET_STATUSES: TicketStatus[] = [
  "OPEN",
  "TRIAGED",
  "IN_PROGRESS",
  "WAITING_APPROVAL",
  "RESOLVED",
  "CLOSED",
];
export const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
export const CATEGORIES: Category[] = [
  "ACCESS",
  "HARDWARE",
  "SOFTWARE",
  "DATABASE",
  "DEVOPS",
  "NETWORK",
  "OTHER",
];

// ---------------------------------------------------------------------------
// Provider conversation format (persisted on AgentRun.conversation as JSON).
// Mirrors the Anthropic Messages API shape so real and mock providers share it.
// ---------------------------------------------------------------------------

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ConversationMessage {
  role: "user" | "assistant";
  content: ContentBlock[];
}

// ---------------------------------------------------------------------------
// Settings keys (Setting table). Values are strings; booleans are "true"/"false".
// ---------------------------------------------------------------------------

export const SETTING_KEYS = {
  provider: "ai.provider", // "anthropic" | "mock"
  apiKey: "ai.apiKey", // stored key; env ANTHROPIC_API_KEY takes precedence
  baseUrl: "ai.baseUrl", // optional Anthropic-compatible endpoint
  model: "ai.model", // default "claude-opus-5"
  autoTriage: "ai.autoTriage", // "true" | "false"
  qaEnabled: "ai.qaEnabled", // "true" | "false"
} as const;

// ---------------------------------------------------------------------------
// KPI endpoint response (GET /api/kpis)
// ---------------------------------------------------------------------------

export interface KpiResponse {
  totals: {
    open: number; // tickets not RESOLVED/CLOSED
    resolvedLast30d: number;
    avgFirstResponseMinutes: number | null;
    avgResolutionHours: number | null;
    aiResolutionRate: number; // 0..1 over resolved tickets last 30d
    pendingApprovals: number;
  };
  createdByDay: { date: string; created: number; resolved: number }[]; // last 30 days, date = "YYYY-MM-DD"
  byCategory: { category: Category; count: number }[]; // open + in-flight tickets
  byPriority: { priority: Priority; count: number }[];
  aiVsHuman: { resolver: "AI" | "HUMAN"; count: number }[]; // resolved last 30d
  approvalStats: { approved: number; rejected: number; pending: number };
  topRequesters: { name: string; count: number }[]; // last 30d, top 5
}
