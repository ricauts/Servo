/* eslint-disable no-console */
// Core seed: everything a FRESH self-hosted install needs — system AI agents,
// default tool/SLA policies, the bundled specialist profiles and the empty
// ops-sandbox schema. Idempotent and non-destructive: safe to re-run on a
// live database at every upgrade.
//
// It creates NO human users, NO tickets and NO sample data. The first admin
// is created by the /setup wizard on first visit; the optional showcase
// dataset lives in seed-demo.ts (`npm run demo`).

import { db } from "../src/lib/db";
import {
  ensureAiAgents,
  ensureOpsSchema,
  syncAgentProfiles,
} from "../src/lib/bootstrap";
import { DEFAULT_TOOL_POLICIES } from "../src/lib/ai/tool-policies";
import { DEFAULT_SLA_POLICIES } from "../src/lib/sla-rules";

async function main() {
  console.log("Bootstrapping Servo (core, no demo data)…");

  await ensureAiAgents();

  for (const policy of DEFAULT_TOOL_POLICIES) {
    await db.toolPolicy.upsert({
      where: { toolName: policy.toolName },
      create: policy,
      update: {}, // admin edits win over defaults
    });
  }
  for (const policy of DEFAULT_SLA_POLICIES) {
    await db.slaPolicy.upsert({
      where: { priority: policy.priority },
      create: policy,
      update: {},
    });
  }

  const created = await syncAgentProfiles();
  await ensureOpsSchema();

  console.log(
    `Done. AI agents ready, ${DEFAULT_TOOL_POLICIES.length} tool policies, ` +
      `${DEFAULT_SLA_POLICIES.length} SLA policies, ${created} new agent profile(s).`,
  );
  console.log("Open the app — the /setup wizard creates your admin account.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
