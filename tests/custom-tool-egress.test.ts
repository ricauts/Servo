// Admin-defined HTTP integrations go through the same egress guard as the
// agents' web tools. The URL template is admin-authored, but a {input.…}
// placeholder in the host position hands the destination to the model — and
// therefore to whoever wrote the ticket.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomTool } from "@prisma/client";

const settingFindUnique = vi.fn<() => Promise<{ key: string; value: string } | null>>();

vi.mock("@/lib/db", () => ({
  db: { setting: { findUnique: () => settingFindUnique() } },
}));

vi.mock("dns/promises", () => ({
  lookup: async (host: string) => {
    const map: Record<string, string> = {
      "api.example.com": "93.184.216.34",
      "hooks.example.com": "93.184.216.34",
      "169.254.169.254": "169.254.169.254",
      "billing.internal": "10.0.0.9",
    };
    const address = map[host.toLowerCase()];
    if (!address) throw new Error(`ENOTFOUND ${host}`);
    return [{ address, family: 4 }];
  },
}));

const { customToolToDef } = await import("@/lib/ai/custom-tools");

const ctx = {} as Parameters<ReturnType<typeof customToolToDef>["execute"]>[1];

function tool(overrides: Partial<CustomTool> = {}): CustomTool {
  return {
    id: "tool_1",
    name: "lookup_account",
    description: "Look an account up.",
    url: "https://api.example.com/accounts/{input.id}",
    method: "GET",
    headers: "{}",
    bodyTemplate: null,
    secret: "",
    inputSchema: '{"type":"object","properties":{"id":{"type":"string"}}}',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as CustomTool;
}

function allowlist(value: string | null) {
  settingFindUnique.mockResolvedValue(
    value === null ? null : { key: "integration.egress.allowlist", value },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  allowlist(null);
});

afterEach(() => vi.unstubAllGlobals());

describe("custom HTTP integrations", () => {
  it("still calls an ordinary public endpoint", async () => {
    const seen: string[] = [];
    const fetchSpy = vi.fn(async (url: string) => {
      seen.push(String(url));
      return new Response("{}", { status: 200, statusText: "OK" });
    });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await customToolToDef(tool()).execute({ id: "42" }, ctx);
    expect(seen).toEqual(["https://api.example.com/accounts/42"]);
    expect(result).toContain("HTTP 200");
  });

  it("refuses a templated host pointed at the metadata endpoint", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const templated = tool({ url: "https://{input.host}/accounts" });
    const result = await customToolToDef(templated).execute({ host: "169.254.169.254" }, ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toContain("private or link-local");
  });

  it("refuses an integration host the allowlist does not cover", async () => {
    allowlist("hooks.example.com");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await customToolToDef(tool()).execute({ id: "42" }, ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toContain("not listed");
  });

  it("reaches an internal endpoint the admin named exactly", async () => {
    allowlist("billing.internal");
    vi.stubGlobal("fetch", async () => new Response("ok", { status: 200, statusText: "OK" }));
    const result = await customToolToDef(
      tool({ url: "https://billing.internal/accounts/{input.id}" }),
    ).execute({ id: "42" }, ctx);
    expect(result).toContain("HTTP 200");
  });
});
