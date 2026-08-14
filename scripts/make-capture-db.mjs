// Builds prisma/capture.db — a throwaway copy of the working database, safe to
// screenshot, film and mutate. The real dev.db is opened read-only and never
// written to; `npm run demo` is deliberately NOT used because it wipes in place.
//
//   node --experimental-sqlite scripts/make-capture-db.mjs
//
// Run it before every take: a recording clicks Approve & send and starts runs,
// so the second take of a scene would otherwise start from a used-up fixture.
//
// What it guarantees, per MEDIA-GUIDE.md §B.9:
//   - no real person, address or domain anywhere on screen
//   - no real credential, and no path to a paid model call
//   - English only (the working database has Spanish ticket titles)
//   - ticket #1061 staged mid-flight: workable, with its reply draft pending
import { copyFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const SRC = "C:/Desarrollos/servo/prisma/dev.db";
const DST = "C:/Desarrollos/servo/prisma/capture.db";

copyFileSync(SRC, DST);
const db = new DatabaseSync(DST);

// 1. demo auth — the OIDC tenant would bounce a headless browser to the IdP
for (const key of ["auth.oidc.issuer", "auth.oidc.clientId", "auth.oidc.clientSecret"]) {
  db.prepare("update Setting set value='' where key=?").run(key);
}

// 2. real accounts -> invented ones on acme.dev. Dana Whitfield and Tomas Berg
//    are already fictional (@northwind.example) and stay: #1061 is the page's
//    proof story and its screenshots already ship in the README.
const people = [
  ["sricaurte@servoai.org", "Marta Oliveira", "marta@acme.dev"],
  ["pancakesiscool@gmail.com", "Nils Ericsson", "nils@acme.dev"],
  ["support@servoai.org", "Acme Support", "support@acme.dev"],
  ["mail-noreply@google.com", "Mail Team", "mail@acme.dev"],
  ["no-reply@accounts.google.com", "Accounts", "accounts@acme.dev"],
  ["workspace-noreply@google.com", "Workspace Team", "workspace@acme.dev"],
];
for (const [email, name, next] of people) {
  db.prepare("update User set name=?, email=? where email=?").run(name, next, email);
}

// 3. settings that render as text on /integrations
const settings = [
  ["integration.smtp.from", "Acme Support <support@acme.dev>"],
  ["auth.adminEmails", "admin@acme.dev"],
  ["auth.allowedDomains", "acme.dev"],
];
for (const [key, value] of settings) db.prepare("update Setting set value=? where key=?").run(value, key);

// 4. English only — three of these were legible in the phone frame
const titles = [
  [1051, "Start the dark mode feature: branch in the Servo repo"],
  [1050, "Repo for the public marketing site"],
  [1049, "New table to track software licences"],
  [1048, "Feature request: dark mode toggle in the portal"],
  [1047, "Account locked - I cannot sign in"],
  [1045, "MCP e2e: test guest VPN access"],
  [1042, "Duplicate rows in the licences table"],
  [1039, "The weekly sales report did not arrive"],
  [1038, "Onboarding: new starter needs workspace access"],
  [1037, "The printer on floor 4 will not power on"],
];
for (const [number, title] of titles) db.prepare("update Ticket set title=? where number=?").run(title, number);

// 5. no paid calls. The global provider is already `mock`, but a per-agent
//    credential overrides it, so both have to go.
db.prepare("update AgentProfile set credentialId=null").run();
db.prepare("delete from AiCredential").run();
db.prepare("update Setting set value='mock' where key='ai.provider'").run();

// 6. stage #1061 mid-flight. RESOLVED refuses new runs ("Cannot start an agent
//    run on a resolved or closed ticket"), which put a red error in take one.
db.prepare("update Ticket set status='IN_PROGRESS' where number=1061").run();
db.prepare(`
  update ReplyDraft set status='PENDING', decidedAt=null, deciderId=null, emailed=0, edited=0
  where ticketId=(select id from Ticket where number=1061)
`).run();

const t = db.prepare("select id,number,status from Ticket where number=1061").get();
const d = db.prepare("select status from ReplyDraft where ticketId=?").get(t.id);
console.log(`capture.db ready — #${t.number} ${t.status}, draft ${d?.status ?? "none"}, id ${t.id}`);
