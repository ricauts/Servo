# Servo — 5-minute demo script

A guided tour using the showcase dataset. Prerequisites: `npm install`,
`npm run demo` (loads the fictional demo data — wipes the database),
`npm run dev`, then open http://localhost:3000. Everything below works
offline in the default **mock** provider mode — no API key needed.

Use the **user switcher** in the sidebar to change who you are at each step.

## 1. Dashboard tour (1 min) — as Ana (ADMIN)

Switch to **Ana Rodríguez** and open **Dashboard**.

- Stat tiles: open tickets, resolved in the last 30 days, average first
  response, average resolution time, **AI resolution rate**, and pending
  approvals (there are 2 waiting for you).
- Charts: ticket volume over the last 30 days, open tickets by category and
  priority, the AI-vs-human resolution split, and top requesters.

Talking point: every number here comes from ~28 seeded tickets, several of
which were resolved end-to-end by the AI resolver with full run traces.

## 2. Approvals inbox: approve the DROP TABLE (1.5 min) — as Ana

Open **Approvals**. Two HIGH-risk requests are pending:

- `execute_ops_sql` — `DROP TABLE employees_backup;` (ticket
  *"Drop the obsolete employees_backup table"*)
- `cloud_apply_deployment` — a production hotfix deployment

Open the DROP TABLE one. Show the mono JSON tool input and the HIGH risk
badge, then click through to the ticket to show the paused run: the agent
queried the table first, explained why dropping it is destructive, and
requested approval before touching anything.

**Approve it** (optionally with a reason). The run resumes from its persisted
conversation: the SQL executes, the agent posts a summary comment, and the
ticket flips to **Resolved** — all visible on the ticket timeline.

Talking point: HIGH-risk approvals are admin-only. Switch to **Bruno**
(AGENT) first if you want to show the 403 — he can decide LOW/MEDIUM risk
but not HIGH.

## 3. Create a ticket and watch auto-triage (1 min) — as Carla (REQUESTER)

Switch to **Carla Méndez**, go to **Tickets → New ticket**, and file:

> **Title:** I forgot my password
>
> **Description:** I can't sign in to my laptop since this morning; I think
> my password expired. Please reset it.

Submit. Because **auto-triage** is on, the triage agent classifies it
immediately: category **Access**, a priority, a system comment with the
rationale — and, since password resets map to an available tool, the ticket
is **assigned to Servo Resolver** automatically.

## 4. Run the resolver (1 min) — as Ana or Bruno

Switch back to **Ana** (or Bruno), open the new ticket, and click
**Run AI resolver**.

Watch the run trace appear on the timeline: the agent plans, calls
`reset_password` for carla@acme.dev, posts a comment explaining what it did,
and calls `resolve_ticket`. The ticket is resolved in seconds. Because
`reset_password` is MEDIUM risk and QA is enabled, the run also gets a QA
verdict.

## 5. Flip a tool to requires-approval (30 s) — as Ana

Open **Settings** and find the **tool policy table**. Toggle
`reset_password` to **requires approval**.

Now repeat step 3–4 with another password ticket (e.g. *"Locked out after
MFA reset"*): this time the resolver **pauses** at `reset_password`, the
ticket goes to **Waiting approval**, and a new request appears in the
Approvals inbox. Approve it and watch the run resume — or reject it and
watch the agent acknowledge the rejection and hand off to a human instead of
retrying.

Talking point: risk levels and approval gates are runtime policy, not code —
the same mechanism that guards `DROP TABLE` can guard any tool.

While in Settings, also point out the **BYOK card**: provider, API key,
model, and the auto-triage/QA toggles. Everything you just demoed ran on the
offline mock provider; pasting an Anthropic key switches the same engine to
a real model.
