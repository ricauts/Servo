// fetch_url and take_screenshot against a stubbed network and a stubbed
// Setting table. The load-bearing assertions are the ones about what is NOT
// reached: an internal URL must never produce a request, and a blocked
// screenshot must never launch a browser.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingFindUnique = vi.fn<() => Promise<{ key: string; value: string } | null>>();
const captureMock = vi.fn<() => Promise<Buffer>>();
const attachmentCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    setting: { findUnique: () => settingFindUnique() },
    attachment: { create: (args: unknown) => attachmentCreate(args) },
  },
}));

vi.mock("@/lib/screenshot", () => ({ capture: () => captureMock() }));

// The real DNS resolver would answer for the public hosts these tests use, so
// pin it: the suite must not depend on the sandbox having a network.
vi.mock("dns/promises", () => ({
  lookup: async (host: string) => {
    const map: Record<string, string> = {
      "status.example.com": "93.184.216.34",
      "docs.example.com": "93.184.216.34",
      "internal.example.com": "10.0.0.5",
      intranet: "10.0.0.5",
      localhost: "127.0.0.1",
      "169.254.169.254": "169.254.169.254",
    };
    const address = map[host.toLowerCase()];
    if (!address) throw new Error(`ENOTFOUND ${host}`);
    return [{ address, family: address.includes(":") ? 6 : 4 }];
  },
}));

const { TOOLS } = await import("@/lib/ai/tools");
const fetchUrl = TOOLS.fetch_url;
const takeScreenshot = TOOLS.take_screenshot;

const ctx = {
  ticketId: "ticket_1",
  runId: "run_1",
  agentUser: { id: "user_1" },
} as unknown as Parameters<typeof fetchUrl.execute>[1];

/** No allowlist row = the default posture: any public host. */
function allowlist(value: string | null) {
  settingFindUnique.mockResolvedValue(
    value === null ? null : { key: "integration.egress.allowlist", value },
  );
}

function htmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  allowlist(null);
});

afterEach(() => vi.unstubAllGlobals());

describe("fetch_url", () => {
  it("is registered, LOW risk and reads rather than writes", () => {
    expect(fetchUrl).toBeDefined();
    expect(fetchUrl.name).toBe("fetch_url");
    expect(fetchUrl.description).toMatch(/read/i);
  });

  it("returns the page as readable text with its status and title", async () => {
    vi.stubGlobal("fetch", async () =>
      htmlResponse(
        "<html><head><title>Acme Status</title><style>b{}</style></head><body><h1>All systems operational</h1><p>No incidents in the last 24 hours.</p><script>track()</script></body></html>",
      ),
    );
    const result = await fetchUrl.execute({ url: "https://status.example.com/" }, ctx);
    expect(result).toContain("HTTP 200");
    expect(result).toContain("Title: Acme Status");
    expect(result).toContain("# All systems operational");
    expect(result).toContain("No incidents in the last 24 hours.");
    expect(result).not.toContain("track()");
  });

  it("blocks an internal host and never makes the request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchUrl.execute({ url: "https://internal.example.com/admin" }, ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toContain("private or link-local");
  });

  it("blocks the cloud metadata endpoint", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchUrl.execute(
      { url: "http://169.254.169.254/latest/meta-data/iam/security-credentials/" },
      ctx,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatch(/private or link-local/);
  });

  it("honours a configured allowlist and points at the setting that fixes it", async () => {
    allowlist("status.example.com");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchUrl.execute({ url: "https://docs.example.com/" }, ctx);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toContain("not listed");
    expect(result).toContain("Outbound web access");
  });

  it("reaches an internal host once an admin names it exactly", async () => {
    allowlist("intranet");
    vi.stubGlobal("fetch", async () => htmlResponse("<p>Runbook</p>"));
    const result = await fetchUrl.execute({ url: "http://intranet/runbook" }, ctx);
    expect(result).toContain("HTTP 200");
    expect(result).toContain("Runbook");
  });

  it("returns non-HTML text as it is", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response('{"status":"ok"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await fetchUrl.execute({ url: "https://status.example.com/api" }, ctx);
    expect(result).toContain('{"status":"ok"}');
  });

  it("describes a binary document instead of dumping it", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response("%PDF-1.7 binary", {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );
    const result = await fetchUrl.execute({ url: "https://status.example.com/report.pdf" }, ctx);
    expect(result).toContain("Not a text document");
    expect(result).not.toContain("%PDF");
  });

  it("refuses an oversized body on its declared length, before reading it", async () => {
    const bodySpy = vi.fn(() => "x".repeat(100));
    vi.stubGlobal("fetch", async () => ({
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/html", "content-length": "99000000" }),
      text: async () => bodySpy(),
    }));
    const result = await fetchUrl.execute({ url: "https://status.example.com/huge" }, ctx);
    expect(result).toContain("exceeds");
    expect(bodySpy).not.toHaveBeenCalled();
  });

  it("truncates a long page and says so", async () => {
    vi.stubGlobal("fetch", async () => htmlResponse(`<p>${"word ".repeat(4000)}</p>`));
    const result = await fetchUrl.execute({ url: "https://status.example.com/long" }, ctx);
    expect(result).toContain("[Truncated: showing the first");
    expect(result.length).toBeLessThan(6000);
  });

  it("reports an HTTP error status as a normal result the agent can react to", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response("<h1>Not Found</h1>", {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "text/html" },
      }),
    );
    const result = await fetchUrl.execute({ url: "https://status.example.com/missing" }, ctx);
    expect(result).toContain("HTTP 404");
  });

  it("returns a network failure as text instead of throwing", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("socket hang up");
    });
    await expect(
      fetchUrl.execute({ url: "https://status.example.com/" }, ctx),
    ).resolves.toContain("socket hang up");
  });

  it("requires a url", async () => {
    expect(await fetchUrl.execute({}, ctx)).toBe("Error: url is required.");
  });

  it("refuses a non-http scheme", async () => {
    expect(await fetchUrl.execute({ url: "file:///etc/passwd" }, ctx)).toContain(
      "only http and https",
    );
  });
});

describe("take_screenshot", () => {
  it("refuses a blocked URL without launching a browser", async () => {
    const result = await takeScreenshot.execute({ url: "http://localhost:3000/admin" }, ctx);
    expect(captureMock).not.toHaveBeenCalled();
    expect(attachmentCreate).not.toHaveBeenCalled();
    expect(result).toContain("private or link-local");
  });

  it("still captures an allowed public page", async () => {
    captureMock.mockResolvedValue(Buffer.from("png-bytes"));
    attachmentCreate.mockResolvedValue({ id: "att_1" });
    const result = await takeScreenshot.execute({ url: "https://docs.example.com/" }, ctx);
    expect(captureMock).toHaveBeenCalled();
    expect(result).toContain("/api/attachments/att_1");
  });
});
