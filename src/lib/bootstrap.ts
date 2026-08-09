// Idempotent bootstrap shared by the first-run /setup wizard, the core seed
// and the Docker entrypoint: everything a FRESH install needs to work — and
// nothing else. No demo users, no fake tickets, no sample rows. The optional
// showcase dataset lives in prisma/seed-demo.ts.

// Relative imports on purpose: prisma/seed-core.ts runs this through tsx,
// outside Next's "@/" alias resolution.
import fs from "fs";
import path from "path";
import { db } from "./db";
import { opsDb } from "./opsdb";
import { parseProfileMarkdown, slugify } from "./agent-profile-format";

/** The three system AI users the engine looks up by aiKind. */
export async function ensureAiAgents(): Promise<void> {
  const agents = [
    { name: "Servo Triage", email: "triage@servo.ai", aiKind: "TRIAGE", color: "#0A6E66" },
    { name: "Servo Resolver", email: "resolver@servo.ai", aiKind: "RESOLVER", color: "#14625D" },
    { name: "Servo QA", email: "qa@servo.ai", aiKind: "QA", color: "#52514E" },
  ];
  for (const agent of agents) {
    await db.user.upsert({
      where: { email: agent.email },
      create: { ...agent, role: "AI_AGENT" },
      update: {},
    });
  }
}

/**
 * Create any agents/*.md specialist that is not in the database yet. Existing
 * rows are left untouched — admins may have edited prompts, tools or API-key
 * assignments from the UI, and a redeploy must never overwrite that.
 */
export async function syncAgentProfiles(): Promise<number> {
  const agentsDir = path.join(process.cwd(), "agents");
  if (!fs.existsSync(agentsDir)) return 0;
  let created = 0;
  for (const file of fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md"))
    .sort()) {
    const markdown = fs.readFileSync(path.join(agentsDir, file), "utf8");
    let parsed;
    try {
      parsed = parseProfileMarkdown(markdown);
    } catch {
      continue; // a malformed bundled profile must not block setup
    }
    const slug = slugify(parsed.name);
    const existing = await db.agentProfile.findUnique({ where: { slug } });
    if (existing) continue;
    await db.agentProfile.create({
      data: {
        slug,
        name: parsed.name,
        description: parsed.description,
        categories: JSON.stringify(parsed.categories),
        tools: JSON.stringify(parsed.tools),
        systemPrompt: parsed.systemPrompt,
        markdown,
      },
    });
    created++;
  }
  return created;
}

/**
 * The sandbox "ops" database schema the database tools operate on. Fresh
 * installs get empty tables (the tools work, queries return no rows) —
 * `npm run demo` fills them with the showcase inventory.
 */
export async function ensureOpsSchema(): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS devices (
      asset_tag TEXT PRIMARY KEY, model TEXT NOT NULL, type TEXT NOT NULL,
      assigned_to TEXT, status TEXT NOT NULL, os TEXT,
      purchased_at TEXT, warranty_until TEXT
    );`,
    `CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL,
      department TEXT NOT NULL, title TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS software_licenses (
      id INTEGER PRIMARY KEY, product TEXT NOT NULL, seats INTEGER NOT NULL,
      seats_used INTEGER NOT NULL, renewal_date TEXT NOT NULL, owner_email TEXT
    );`,
  ];
  for (const sql of statements) {
    await opsDb.$executeRawUnsafe(sql);
  }
}
