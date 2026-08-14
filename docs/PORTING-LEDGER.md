# Porting ledger

A running record of capabilities brought into Servo from other projects —
mainly [Paperclip](https://github.com/paperclipai/paperclip) (MIT) and the
Claude Code ecosystem — so no run repeats work already done, and so every
rejection stays rejected for a stated reason.

**Rules this ledger enforces**

- Read this file and `gh pr list --state all` before starting. Never redo an
  item recorded here, and never restart work an open PR already covers.
- One high-value item per run, shipped end to end (code + tests + docs).
- Copied code keeps its copyright notice and is recorded in `THIRD-PARTY.md`
  with the upstream path. Reimplementing an observed *design* needs no
  attribution — but say so here.
- Nothing lands that assumes Paperclip's pnpm monorepo, its Node+React split
  or its database. Servo is one Next.js app on Prisma + SQLite.
- No new mandatory environment variables. Anything configurable is
  configurable from the existing Settings/Integrations UI, with defaults that
  work on a fresh install, and documented in `docs/USER-GUIDE.md`.

## Shipped

### 2026-08-14 — Desk memory: `search_tickets`, `read_ticket`, `requester_history`

**What.** Three read-only tools (`src/lib/ai/tools/history.ts`) that let a
resolver consult the tickets this desk has already handled before it invents
an answer, plus the pure ranking/redaction core in
`src/lib/ai/ticket-history.ts`.

**Where the idea came from.** Paperclip's MCP server and its
`packages/skills-catalog` progressive-disclosure pattern — a cheap catalogue
you search first, with the expensive full read behind a second call. Servo's
version is the same shape: `search_tickets` returns ranked one-liners with the
recorded outcome, `read_ticket` loads one in full. Claude Code's own
search-then-read tool pairing is the other half of the influence.

**Attribution.** None required — no upstream code was copied. Both the
ranking (term stemming, per-field weighting, settled-ticket bonus) and the
redaction rule are Servo's own, written against Servo's schema.

**Why this and not something else.** The resolver had no memory: every ticket
started from zero even when the same fault had been solved last month. This
is the ROADMAP's "knowledge for agents" goal at a fraction of the cost — no
embedding model, no vector store, no new dependency, and it works offline on
the SQLite that ships with the app.

**Design decisions worth keeping.**

- *Ranking in memory, not SQL.* SQLite has no relevance scoring and Servo
  ships without an FTS extension so self-hosting stays a one-liner. The tools
  fetch a bounded candidate window (60 rows) and score it in TypeScript, which
  also makes the ranking unit-testable.
- *Requester redaction.* Precedent is useful; other people's identities are
  not. `mayRevealRequester()` reveals a name/email only when the past ticket
  belongs to the same requester as the one being worked. With no ticket in
  context (an MCP caller) everything is withheld.
- *The MCP server lost its naive `search_tickets`.* `src/lib/mcp.ts` had its
  own unranked title/description LIKE search. It was deleted so the registry
  tool is served instead — external clients now get the same ranked,
  redaction-aware results the agents get.
- *Upgrades stay non-destructive.* `ensureToolPolicies()` backfills the three
  LOW-risk policy rows, so the default resolver gains the tools on upgrade.
  Specialists that an admin has edited are never rewritten, so their tool
  allowlists must be extended from **Agents → Tools** — documented in the user
  guide. The bundled `agents/*.md` were updated for fresh installs.
- *The mock provider exercises it.* `MockProvider` reads the tool list it is
  handed and opens its script with `search_tickets` when the tool is granted,
  so the offline demo shows precedent-checking without an API key.

**Validated.** `npm ci`, `npm run setup` (fresh + re-run on a populated
database: 21 policies backfilled, 0 profiles overwritten), `npm run typecheck`,
`npm test` (93 passing: 41 pre-existing + 52 new). End to end against a real
SQLite database through the deterministic mock provider: a resolved VPN ticket
from Ravi, a new one from Dana — the resolver called `search_tickets`, found
the precedent and its resolution note, and Ravi's name and email did not
appear in the result. The MCP surface was listed to confirm all three tools
are served.

### 2026-08-14 — Web reading behind an egress guard: `fetch_url`

**From:** Claude Code's `WebFetch` tool (fetch a URL, hand the model readable
text rather than markup) and the same search-then-read shape Paperclip uses in
`packages/mcp-server`. **Reimplemented, no code copied** — the HTML flattener,
the address classifier and the allowlist grammar are written against Servo's
own settings and tool contract, so `THIRD-PARTY.md` gains no entry.

- `src/lib/ai/tools/web.ts` — `fetch_url` (LOW, no approval; it reads and
  never writes) returns status, title and the page as text.
- `src/lib/html-text.ts` — HTML → text keeping headings, list items and link
  targets; dependency-free.
- `src/lib/egress.ts` — the guard: http(s) only, no embedded credentials,
  DNS resolution with private/loopback/CGNAT/link-local/multicast refusal,
  per-hop redirect re-checking, and an optional admin allowlist where a
  *literal* entry is the deliberate opt-in for an internal host.
- The guard also covers `take_screenshot` and admin-defined HTTP
  integrations, which previously called `fetch()` on any host the model
  produced — a real SSRF path, since ticket text arrives by email.
- Configured at Integrations → **Outbound web access**; empty by default
  (any public host), no new env vars.

Closes the ROADMAP item "Egress allowlist for custom HTTP tools".

## Rejected

- **Paperclip `packages/adapters/*`** (claude-local, codex-local,
  cursor-cloud, gemini-local, hermes…). These adapt coding-agent CLIs and
  gateways, and assume Paperclip's mutable server+UI dual registry and its
  agent-hire model. Servo's BYOK layer (`src/lib/ai/provider.ts`) already
  covers Anthropic-compatible and OpenAI-compatible endpoints from Settings,
  which is the part that pays. Revisit only if a provider needs a genuinely
  different wire protocol.
- **Paperclip `packages/plugins/*` sandbox/worker plugin system.** Worker
  isolation, a manifest format and a plugin SDK are a large surface whose
  value in Servo is already served by custom HTTP tools plus the MCP server.
  Infrastructure, not breadth.
- **Paperclip `packages/db`.** Its own schema and migration story; Servo is
  Prisma + SQLite with string unions in `src/lib/types.ts` as the source of
  truth.
- **Paperclip's pnpm monorepo, its Node+React split and its `PAPERCLIP_*`
  env-var contract.** Servo is one Next.js app configured from its own UI.
- **A headless-browser "browse" tool** (navigate, click, fill) on top of
  `fetch_url` — an agent driving a real browser session is a mutation path
  with no meaningful risk level to declare, and the approval card cannot show
  a reviewer what a click will do. If it lands, it lands as HIGH with
  approval, not as an extension of a read-only reader.

## Candidates for a future run

- **Agent skills as versionable files** — `skills/<slug>/SKILL.md` with
  frontmatter, seeded like `agents/*.md`, listed by name+description in the
  resolver prompt and loaded on demand by a `read_skill` tool. This is the
  natural companion to desk memory: memory is what the desk *did*, a skill is
  what the desk *decided to always do*. Paperclip `skills/` and
  `packages/skills-catalog` are the reference shape.
- **Knowledge-gap mining on top of desk memory** — cluster the tickets where
  `search_tickets` found nothing into "write this runbook" suggestions.
- **`search_web`** behind the same guard, once a provider that does not need
  a new mandatory key can be configured from Settings (BYO search endpoint,
  the way BYOK works today).
- **Attachment reading** — `read_attachment` so an agent can use the log file
  or screenshot a requester attached, reusing the text-extraction path.
- **Egress audit** — record blocked outbound attempts on the run timeline so
  an admin can see what the desk tried to reach and decide whether to
  allowlist it.
- **Per-agent egress scope** — an allowlist per specialist rather than one
  per desk, so the frontend agent's reach differs from the security agent's.
