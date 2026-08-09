// Admin-defined HTTP tools ("integrations"): stored in CustomTool rows and
// merged with the built-in registry at loop-context build time. The executor
// makes the HTTP request with {input.field}/{secret} templating and returns
// the response as the tool result string (never throws for expected
// failures, matching the built-in tools' contract).

import type { CustomTool } from "@prisma/client";
import { db } from "@/lib/db";
import { open } from "@/lib/secret-store";
import { DEFAULT_TOOL_POLICIES } from "./tool-policies";
import { TOOLS, type ToolDef } from "./tools";

const RESPONSE_LIMIT = 2000;
const REQUEST_TIMEOUT_MS = 10_000;

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Replace {input.field} and {secret} placeholders. */
function fill(
  template: string,
  input: Record<string, unknown>,
  secret: string,
  opts: { urlEncode?: boolean } = {},
): string {
  return template
    .replace(/\{input\.([a-zA-Z0-9_]+)\}/g, (_, field: string) => {
      const value = input[field];
      const text =
        value === undefined || value === null
          ? ""
          : typeof value === "string"
            ? value
            : JSON.stringify(value);
      return opts.urlEncode ? encodeURIComponent(text) : text;
    })
    .replace(/\{secret\}/g, secret);
}

export function customToolToDef(tool: CustomTool): ToolDef {
  let inputSchema: Record<string, unknown>;
  try {
    inputSchema = JSON.parse(tool.inputSchema) as Record<string, unknown>;
  } catch {
    inputSchema = { type: "object", properties: {} };
  }
  return {
    name: tool.name,
    description: tool.description,
    inputSchema,
    async execute(input) {
      // Stored encrypted at rest; opened only here, at substitution time.
      const secret = open(tool.secret);
      const url = fill(tool.url, input, secret, { urlEncode: true });
      let headers: Record<string, string> = {};
      try {
        const parsed = JSON.parse(tool.headers) as Record<string, string>;
        for (const [k, v] of Object.entries(parsed)) {
          headers[k] = fill(String(v), input, secret);
        }
      } catch {
        headers = {};
      }

      const hasBody = tool.method !== "GET" && tool.method !== "DELETE";
      let body: string | undefined;
      if (hasBody) {
        body = tool.bodyTemplate
          ? fill(tool.bodyTemplate, input, secret)
          : JSON.stringify(input);
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
      }

      try {
        const res = await fetch(url, {
          method: tool.method,
          headers,
          ...(body !== undefined ? { body } : {}),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const text = (await res.text()).slice(0, RESPONSE_LIMIT);
        return `HTTP ${res.status} ${res.statusText}\n${text}`;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Integration request failed: ${message}`;
      }
    },
  };
}

/**
 * Built-in tools plus every admin-defined custom tool. Built-ins win name
 * collisions (creation validates against them anyway). Availability is still
 * governed by the ToolPolicy rows the engine filters on.
 */
/**
 * Backfill policy rows for built-in tools that have none — a tool added by an
 * upgrade would otherwise stay invisible until a destructive reseed. Existing
 * rows (including admin edits) are never touched.
 */
export async function ensureToolPolicies(): Promise<void> {
  const existing = await db.toolPolicy.findMany({ select: { toolName: true } });
  const known = new Set(existing.map((p) => p.toolName));
  const missing = DEFAULT_TOOL_POLICIES.filter((p) => !known.has(p.toolName));
  if (missing.length === 0) return;
  await db.toolPolicy.createMany({ data: missing });
}

export async function getToolRegistry(): Promise<Record<string, ToolDef>> {
  const custom = await db.customTool.findMany();
  const registry: Record<string, ToolDef> = {};
  for (const tool of custom) registry[tool.name] = customToolToDef(tool);
  return { ...registry, ...TOOLS };
}
