// Server component: unified chronological story of a ticket — description,
// human/AI comments and agent-run steps merged into one stream.
// shadcn Cards render the bodies; the gutter markers and step tints use the
// semantic status tone utilities (good/warn/critical/violet).

import type {
  AgentRun,
  AgentStep,
  Approval,
  Comment,
  Ticket,
  User,
} from "@prisma/client";
import {
  AlertTriangle,
  ClipboardCheck,
  Info,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import Avatar from "@/components/legacy/Avatar";
import Badge from "@/components/legacy/Badge";
import JsonBlock from "@/components/tickets/JsonBlock";
import RelativeTime from "@/components/tickets/RelativeTime";
import {
  APPROVAL_STATUS_TONE,
  RISK_LABEL,
  RISK_TONE,
} from "@/lib/labels";
import type { ApprovalStatus, RiskLevel } from "@/lib/types";

type CommentWithAuthor = Comment & { author: User };
type ApprovalWithDecider = Approval & { decider: User | null };
type RunWithSteps = AgentRun & {
  steps: AgentStep[];
  approvals: ApprovalWithDecider[];
};

type TimelineItem =
  | { key: string; at: Date; kind: "description" }
  | { key: string; at: Date; kind: "comment"; comment: CommentWithAuthor }
  | { key: string; at: Date; kind: "step"; step: AgentStep; run: RunWithSteps };

function When({ at }: { at: Date }) {
  return (
    <RelativeTime value={at} className="text-xs text-muted-foreground/80" />
  );
}

/** Inline mono chip for tool names. */
function ToolName({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

export default function Timeline({
  ticket,
  comments,
  runs,
  agents,
}: {
  ticket: Ticket & { requester: User };
  comments: CommentWithAuthor[];
  runs: RunWithSteps[];
  agents: Record<string, User>;
}) {
  const items: TimelineItem[] = [
    { key: "description", at: ticket.createdAt, kind: "description" },
    ...comments.map(
      (comment): TimelineItem => ({
        key: `comment-${comment.id}`,
        at: comment.createdAt,
        kind: "comment",
        comment,
      }),
    ),
    ...runs.flatMap((run) =>
      run.steps.map(
        (step): TimelineItem => ({
          key: `step-${step.id}`,
          at: step.createdAt,
          kind: "step",
          step,
          run,
        }),
      ),
    ),
  ];
  // Stable sort keeps step order intact when timestamps collide.
  items.sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="relative">
      <div
        className="absolute bottom-2 left-[13px] top-2 w-px bg-border"
        aria-hidden
      />
      <ol className="space-y-7">
        {items.map((item) => (
          <li key={item.key} className="relative pl-10">
            <span className="absolute left-0 top-0">
              <Marker item={item} ticket={ticket} agents={agents} />
            </span>
            <ItemBody item={item} ticket={ticket} agents={agents} />
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

function IconDot({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <span
      className={`flex h-7 w-7 items-center justify-center rounded-md border ${className}`}
    >
      {children}
    </span>
  );
}

function Marker({
  item,
  ticket,
  agents,
}: {
  item: TimelineItem;
  ticket: Ticket & { requester: User };
  agents: Record<string, User>;
}) {
  if (item.kind === "description") {
    return (
      <Avatar
        name={ticket.requester.name}
        color={ticket.requester.color}
        size={28}
      />
    );
  }
  if (item.kind === "comment") {
    const { author } = item.comment;
    if (item.comment.kind === "SYSTEM") {
      return (
        <IconDot className="border-border bg-muted text-muted-foreground">
          <Info size={14} strokeWidth={1.8} />
        </IconDot>
      );
    }
    return (
      <Avatar
        name={author.name}
        color={author.color}
        size={28}
        isAi={author.role === "AI_AGENT"}
      />
    );
  }

  const { step, run } = item;
  switch (step.type) {
    case "TEXT": {
      const agent = agents[run.agentUserId];
      return agent ? (
        <Avatar name={agent.name} color={agent.color} size={28} isAi />
      ) : (
        <IconDot className="border-border bg-muted text-muted-foreground">
          <Terminal size={14} strokeWidth={1.8} />
        </IconDot>
      );
    }
    case "APPROVAL_REQUEST":
      return (
        <IconDot className="border-warn/50 bg-warn-soft text-warn">
          <ShieldAlert size={14} strokeWidth={1.8} />
        </IconDot>
      );
    case "QA_REVIEW":
      return (
        <IconDot className="border-violet/40 bg-violet-soft text-violet">
          <ClipboardCheck size={14} strokeWidth={1.8} />
        </IconDot>
      );
    case "ERROR":
      return (
        <IconDot className="border-critical/40 bg-critical-soft text-critical">
          <AlertTriangle size={14} strokeWidth={1.8} />
        </IconDot>
      );
    default:
      return (
        <IconDot className="border-border bg-muted text-muted-foreground">
          <Terminal size={14} strokeWidth={1.8} />
        </IconDot>
      );
  }
}

// ---------------------------------------------------------------------------
// Item bodies
// ---------------------------------------------------------------------------

function ItemBody({
  item,
  ticket,
  agents,
}: {
  item: TimelineItem;
  ticket: Ticket & { requester: User };
  agents: Record<string, User>;
}) {
  if (item.kind === "description") {
    return (
      <div>
        <div className="flex items-center gap-2 font-sans">
          <span className="text-sm font-medium">{ticket.requester.name}</span>
          <span className="text-xs text-muted-foreground/80">
            opened this ticket · <When at={ticket.createdAt} />
          </span>
        </div>
        <Card size="sm" className="mt-2">
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {ticket.description}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (item.kind === "comment") {
    const { comment } = item;
    if (comment.kind === "SYSTEM") {
      return (
        <div className="pt-1 font-sans">
          <span className="text-xs text-muted-foreground">
            {comment.body}{" "}
            <span className="whitespace-nowrap">
              · <When at={comment.createdAt} />
            </span>
          </span>
        </div>
      );
    }
    const isAi = comment.author.role === "AI_AGENT";
    return (
      <div>
        <div className="flex items-center gap-2 font-sans">
          <span className="text-sm font-medium">{comment.author.name}</span>
          {isAi && <Badge tone="brand">AI</Badge>}
          <span className="text-xs text-muted-foreground/80">
            commented · <When at={comment.createdAt} />
          </span>
        </div>
        <Card size="sm" className="mt-2">
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {comment.body}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <StepBody step={item.step} run={item.run} agents={agents} />;
}

function StepBody({
  step,
  run,
  agents,
}: {
  step: AgentStep;
  run: RunWithSteps;
  agents: Record<string, User>;
}) {
  const agentName = agents[run.agentUserId]?.name ?? "AI agent";
  const risk = step.riskLevel as RiskLevel | null;
  const when = <When at={step.createdAt} />;

  switch (step.type) {
    case "TEXT":
      return (
        <div className="font-sans">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{agentName}</span>
            <Badge tone="brand">AI</Badge>
            <span className="text-xs text-muted-foreground/80">· {when}</span>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {step.content}
          </p>
        </div>
      );

    case "TOOL_CALL":
      return (
        <div className="font-sans">
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground/80">
              {agentName} called
            </span>
            <ToolName>{step.toolName ?? "tool"}</ToolName>
            {risk && <Badge tone={RISK_TONE[risk]}>{RISK_LABEL[risk]}</Badge>}
            <span className="text-xs text-muted-foreground/80">· {when}</span>
          </div>
          <JsonBlock raw={step.content} className="mt-2 max-h-48" />
        </div>
      );

    case "TOOL_RESULT":
      return (
        <div className="font-sans">
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <ToolName>{step.toolName ?? "tool"}</ToolName>
            <span className="text-xs text-muted-foreground/80">
              returned · {when}
            </span>
          </div>
          <JsonBlock raw={step.content} className="mt-2 max-h-40" />
        </div>
      );

    case "APPROVAL_REQUEST": {
      // Best-effort match: latest approval on this run for the same tool.
      const approval = [...run.approvals]
        .reverse()
        .find((a) => a.toolName === step.toolName);
      return (
        <div className="rounded-md border border-warn/50 bg-warn-soft/40 p-4 font-sans">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Approval requested</span>
            <ToolName>{step.toolName ?? "tool"}</ToolName>
            {risk && <Badge tone={RISK_TONE[risk]}>{RISK_LABEL[risk]}</Badge>}
            {approval && (
              <Badge
                tone={APPROVAL_STATUS_TONE[approval.status as ApprovalStatus]}
              >
                {approval.status}
              </Badge>
            )}
            <span className="ml-auto text-xs text-muted-foreground/80">
              {when}
            </span>
          </div>
          <JsonBlock raw={step.content} className="mt-2 max-h-40" />
          {approval && approval.status !== "PENDING" && (
            <p className="mt-2 text-xs text-muted-foreground">
              {approval.status === "APPROVED" ? "Approved" : "Rejected"}
              {approval.decider ? ` by ${approval.decider.name}` : ""}
              {approval.reason ? ` — “${approval.reason}”` : ""}
            </p>
          )}
        </div>
      );
    }

    case "QA_REVIEW": {
      const verdict = run.qaVerdict;
      return (
        <Card
          size="sm"
          className={
            verdict
              ? verdict === "PASS"
                ? "ring-good/40"
                : "ring-critical/40"
              : undefined
          }
        >
          <CardContent className="font-sans">
            <div className="flex items-center gap-2">
              <span className="font-heading text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                QA review
              </span>
              {verdict && (
                <Badge tone={verdict === "PASS" ? "good" : "critical"}>
                  {verdict}
                </Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground/80">
                {when}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {run.qaNotes ?? step.content}
            </p>
          </CardContent>
        </Card>
      );
    }

    case "ERROR":
      return (
        <div className="rounded-md border border-critical/40 bg-critical-soft/40 p-3 font-sans">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-critical">
              Run error
            </span>
            <span className="ml-auto text-xs text-muted-foreground/80">
              {when}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-critical">
            {step.content}
          </p>
        </div>
      );

    default:
      return (
        <p className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">
          {step.content}
        </p>
      );
  }
}
