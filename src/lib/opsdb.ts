import { PrismaClient } from "@prisma/client";
import path from "path";

// The "ops" database is a sandboxed SQLite file that AI agents operate on via
// the sql tools. It is intentionally separate from Servo's own database so an
// agent can run DDL/DML without touching ticket data. In a real deployment
// this adapter would point at the customer's actual database.
const opsUrl =
  process.env.OPS_DATABASE_URL ??
  "file:" + path.join(process.cwd(), "prisma", "ops.db").replace(/\\/g, "/");

const globalForOps = globalThis as unknown as {
  opsDb?: PrismaClient;
  opsDbRead?: PrismaClient;
  opsDbReadReady?: Promise<unknown>;
};

export const opsDb =
  globalForOps.opsDb ?? new PrismaClient({ datasourceUrl: opsUrl });

if (process.env.NODE_ENV !== "production") globalForOps.opsDb = opsDb;

// Dedicated single-connection client for reads, pinned to query-only mode at
// the SQLite level so a smuggled mutation (e.g. "WITH x AS (...) DELETE ...")
// fails at the driver with "attempt to write a readonly database" no matter
// how the statement is spelled. Keyword checks in tools.ts are only a
// first-line courtesy error; this is the actual enforcement.
const opsDbRead =
  globalForOps.opsDbRead ??
  new PrismaClient({ datasourceUrl: `${opsUrl}?connection_limit=1` });
const opsDbReadReady =
  globalForOps.opsDbReadReady ??
  opsDbRead.$executeRawUnsafe("PRAGMA query_only = ON;");

if (process.env.NODE_ENV !== "production") {
  globalForOps.opsDbRead = opsDbRead;
  globalForOps.opsDbReadReady = opsDbReadReady;
}

/** Run a read-only query against the ops database (enforced via query_only). */
export async function opsSelect(sql: string): Promise<unknown[]> {
  await opsDbReadReady;
  const rows = (await opsDbRead.$queryRawUnsafe(sql)) as unknown[];
  return rows;
}

/** Run a mutating statement against the ops database. Returns affected rows. */
export async function opsExecute(sql: string): Promise<number> {
  return opsDb.$executeRawUnsafe(sql);
}
