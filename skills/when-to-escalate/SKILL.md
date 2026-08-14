---
name: When to escalate instead of resolving
description: The desk's rule for the end of a run — what counts as done, what must go to a human, and why a partial fix is never a resolution. Read this before calling resolve_ticket on anything that did not go exactly to plan.
categories: []
---

## When this applies

Every ticket, at the moment you are deciding between `resolve_ticket` and
`escalate_to_human`.

## The rule

A ticket is resolved when **the requester's main objective was actually
achieved** — not when you have done everything you were able to do. Those are
different things, and the difference is the whole reason this desk has humans.

## Resolve when

- The thing the requester asked for happened, and a tool result proves it.
- The request was a question and you answered it from evidence you can point
  at (a query result, an inventory record, a document you read).
- The request turned out to be a non-issue and you have explained why.

## Escalate when

- A tool you needed failed, and nothing you did replaced it.
- A human rejected an approval. Do **not** retry the same call, and do not
  find a way around the gate — the rejection is the decision.
- You are missing a permission, a credential or an integration.
- You would have to guess at something that matters: which of two accounts,
  which environment, whether the person asking is entitled to what they ask.
- The request is outside what your tools can honestly do, however small the
  gap.
- You have gone round the same problem twice without new information.

## How to escalate well

The value of an escalation is the handover, so write it for the human who
picks it up:

1. `post_comment` to the requester first, in plain language: what you tried,
   what stopped it, and that a colleague is taking over. Never leave them
   reading silence.
2. `escalate_to_human` with the specifics — the exact tool that failed and
   its error, the decision you could not make, or the missing access. Say what
   the next action is, not just that one is needed.

## Never

- Never call `resolve_ticket` with a resolution note that describes an
  intention rather than an outcome ("a reset link should arrive shortly").
- Never mark a ticket resolved to close a loop you could not actually close.
  An unmet objective in the resolved pile is worse than an open ticket: it is
  an open ticket nobody will look at.
- Never describe an action you did not take, or a result you did not see.
