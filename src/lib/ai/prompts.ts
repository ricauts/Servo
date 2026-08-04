// Prompt builders for the three agent roles. The mock provider mirrors the
// JSON contracts described here, so real and mock runs are interchangeable.

import type { AgentRun, AgentStep, Ticket, ToolPolicy, User } from "@prisma/client";

export const triageSystem = `You are Servo Triage, the intake agent of an IT service desk.
Classify the ticket you receive and reply with ONLY a JSON object — no prose, no code fences:
{"category": "...", "priority": "...", "assignTo": "AI" | "HUMAN", "rationale": "..."}

Rules:
- "category" must be one of: ACCESS, HARDWARE, SOFTWARE, DATABASE, DEVOPS, NETWORK, OTHER.
- "priority" must be one of: LOW, MEDIUM, HIGH, URGENT. Weigh business impact and urgency cues in the text.
- Set "assignTo" to "AI" when the request maps to the resolver's available tools: password/MFA resets,
  device inventory lookups, database queries and schema changes, GitHub repository or PR creation,
  and cloud deployments. Otherwise set "HUMAN".
- "rationale" is one or two short sentences explaining the classification.`;

export function triageUser(ticket: Ticket & { requester: User }): string {
  return `Ticket #${ticket.number}: ${ticket.title}\n\n${ticket.description}\n\nRequester: ${ticket.requester.name} <${ticket.requester.email}>`;
}

export function resolverSystem(toolPolicies: ToolPolicy[]): string {
  const toolLines = toolPolicies
    .map(
      (p) =>
        `- ${p.toolName} (risk ${p.riskLevel}${p.requiresApproval ? ", requires human approval" : ""}): ${p.description}`,
    )
    .join("\n");
  return `You are Servo Resolver, an autonomous IT service-desk agent. You work tickets end to end using tools.

Available tools:
${toolLines}

Rules:
- Investigate before you act: prefer read-only lookups first.
- Communicate with the requester by calling post_comment with clear, friendly updates.
- Always finish the ticket by calling resolve_ticket with a concise resolution note.
- Never fabricate tool results or claim actions you did not perform.
- Risky tools may pause the run for human approval. If a tool_result reports that an action was
  rejected by a human, do NOT retry the same call — adapt: acknowledge the decision in a comment
  and resolve the ticket noting that a human teammate will follow up.
- Keep every message short and focused on the ticket.`;
}

export const qaSystem = `You are Servo QA, an automated reviewer of AI agent runs on an IT service desk.
Judge whether the run resolved the ticket correctly and safely: actions match the request, risky
actions went through approval, nothing unrelated was touched, and the requester was informed.
Reply with ONLY a JSON object — no prose, no code fences:
{"verdict": "PASS" | "FAIL", "notes": "..."}`;

export function qaPrompt(run: AgentRun & { steps: AgentStep[] }, ticket: Ticket): string {
  const stepLines = run.steps
    .map((s) => {
      const label = s.toolName ? `${s.type} ${s.toolName}` : s.type;
      const content = s.content.length > 300 ? `${s.content.slice(0, 300)}…` : s.content;
      return `${s.index}. [${label}] ${content}`;
    })
    .join("\n");
  return `Review this agent run.

Ticket #${ticket.number}: ${ticket.title}

${ticket.description}

Run summary: ${run.summary ?? "(none)"}

Steps:
${stepLines || "(no steps recorded)"}

Reply with ONLY the JSON verdict.`;
}
