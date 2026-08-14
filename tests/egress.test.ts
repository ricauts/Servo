import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EgressBlockedError,
  checkEgress,
  entryMatches,
  isPrivateAddress,
  matchAllowlist,
  parseAllowlist,
  safeFetch,
  type Resolver,
} from "@/lib/egress";

/** Deterministic stand-in for DNS: every host maps to what the test says. */
function resolverFor(map: Record<string, string[]>): Resolver {
  return async (host) => {
    const addresses = map[host];
    if (!addresses) throw new Error(`no such host: ${host}`);
    return addresses;
  };
}

const PUBLIC = resolverFor({
  "example.com": ["93.184.216.34"],
  "status.example.com": ["93.184.216.34"],
  "docs.example.com": ["93.184.216.34"],
  "evil.test": ["93.184.216.34"],
});

describe("parseAllowlist", () => {
  it("splits on newlines, commas and spaces, and lowercases", () => {
    expect(parseAllowlist("Status.Example.com\n*.docs.example.com, intranet:8080")).toEqual([
      "status.example.com",
      "*.docs.example.com",
      "intranet:8080",
    ]);
  });

  it("drops blanks, duplicates and trailing slashes", () => {
    expect(parseAllowlist("  a.com/ \n\n a.com \n , b.com ")).toEqual(["a.com", "b.com"]);
  });

  it("treats an empty setting as an empty list", () => {
    expect(parseAllowlist("")).toEqual([]);
    expect(parseAllowlist("   \n  ")).toEqual([]);
  });
});

describe("entryMatches", () => {
  it("matches an exact host on any port when no port is given", () => {
    expect(entryMatches("example.com", "example.com", 443)).toBe(true);
    expect(entryMatches("example.com", "example.com", 8080)).toBe(true);
    expect(entryMatches("example.com", "www.example.com", 443)).toBe(false);
  });

  it("matches the domain and its subdomains under a wildcard", () => {
    expect(entryMatches("*.example.com", "example.com", 443)).toBe(true);
    expect(entryMatches("*.example.com", "docs.example.com", 443)).toBe(true);
    expect(entryMatches("*.example.com", "a.b.example.com", 443)).toBe(true);
    // The suffix must be a label boundary, not just a string ending.
    expect(entryMatches("*.example.com", "notexample.com", 443)).toBe(false);
    expect(entryMatches("*.example.com", "example.com.evil.test", 443)).toBe(false);
  });

  it("restricts to a port when one is given", () => {
    expect(entryMatches("intranet:8080", "intranet", 8080)).toBe(true);
    expect(entryMatches("intranet:8080", "intranet", 443)).toBe(false);
  });

  it("does not mistake an IPv6 literal's groups for a port", () => {
    expect(entryMatches("::1", "::1", 80)).toBe(true);
    expect(entryMatches("[::1]:8080", "::1", 8080)).toBe(true);
    expect(entryMatches("[::1]:8080", "::1", 80)).toBe(false);
  });
});

describe("matchAllowlist", () => {
  it("allows anything when the list is empty, without marking it explicit", () => {
    expect(matchAllowlist("example.com", 443, [])).toEqual({ allowed: true, explicit: false });
  });

  it("refuses a host the list does not cover", () => {
    expect(matchAllowlist("evil.test", 443, ["example.com"])).toEqual({
      allowed: false,
      explicit: false,
    });
  });

  it("marks a literal entry explicit and a wildcard not", () => {
    expect(matchAllowlist("intranet", 443, ["intranet"])).toEqual({
      allowed: true,
      explicit: true,
    });
    expect(matchAllowlist("a.intranet", 443, ["*.intranet"])).toEqual({
      allowed: true,
      explicit: false,
    });
  });

  it("takes the explicit grant when both a wildcard and a literal match", () => {
    expect(matchAllowlist("a.intranet", 443, ["*.intranet", "a.intranet"])).toEqual({
      allowed: true,
      explicit: true,
    });
  });
});

describe("isPrivateAddress", () => {
  it("refuses loopback, private, CGNAT and link-local IPv4", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "169.254.169.254", // AWS/GCP/Azure instance metadata
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows ordinary public IPv4", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "1.1.1.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("refuses loopback, unique-local, link-local and multicast IPv6", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("classifies an IPv4-mapped or NAT64 address by the address actually reached", () => {
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("64:ff9b::10.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:93.184.216.34")).toBe(false);
  });

  it("allows public IPv6", () => {
    expect(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });

  it("refuses anything it cannot parse rather than guessing", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("checkEgress", () => {
  it("allows a public host when no allowlist is configured", async () => {
    const decision = await checkEgress("https://example.com/status", { allowlist: [] }, PUBLIC);
    expect(decision.ok).toBe(true);
  });

  it("refuses a non-http scheme", async () => {
    const decision = await checkEgress("file:///etc/passwd", { allowlist: [] }, PUBLIC);
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain("only http and https");
  });

  it("refuses credentials embedded in the URL", async () => {
    const decision = await checkEgress("https://user:pw@example.com/", { allowlist: [] }, PUBLIC);
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain("embedded credentials");
  });

  it("refuses a URL that is not a URL at all", async () => {
    const decision = await checkEgress("what is my ip", { allowlist: [] }, PUBLIC);
    expect(decision.ok).toBe(false);
  });

  it("refuses the cloud metadata endpoint even with no allowlist", async () => {
    const resolver = resolverFor({ "169.254.169.254": ["169.254.169.254"] });
    const decision = await checkEgress(
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      { allowlist: [] },
      resolver,
    );
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain("private or link-local");
  });

  it("refuses a public name that resolves to an internal address", async () => {
    const resolver = resolverFor({ "internal.example.com": ["10.0.0.5"] });
    const decision = await checkEgress("https://internal.example.com/", { allowlist: [] }, resolver);
    expect(decision.ok).toBe(false);
  });

  it("refuses when any of several answers is internal", async () => {
    const resolver = resolverFor({ "split.example.com": ["93.184.216.34", "127.0.0.1"] });
    const decision = await checkEgress("https://split.example.com/", { allowlist: [] }, resolver);
    expect(decision.ok).toBe(false);
  });

  it("refuses a host the allowlist does not cover, and names the fix", async () => {
    const decision = await checkEgress(
      "https://evil.test/",
      { allowlist: ["status.example.com"] },
      PUBLIC,
    );
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) {
      expect(decision.reason).toContain("not listed");
      expect(decision.reason).toContain("Outbound web access");
    }
  });

  it("allows an internal host named literally — the deliberate opt-in", async () => {
    const resolver = resolverFor({ intranet: ["10.0.0.5"] });
    const decision = await checkEgress("http://intranet/wiki", { allowlist: ["intranet"] }, resolver);
    expect(decision.ok).toBe(true);
  });

  it("does not let a wildcard unlock the private ranges", async () => {
    const resolver = resolverFor({ "a.intranet": ["10.0.0.5"] });
    const decision = await checkEgress("http://a.intranet/", { allowlist: ["*.intranet"] }, resolver);
    expect(decision.ok).toBe(false);
  });

  it("refuses a host that does not resolve", async () => {
    const decision = await checkEgress("https://nowhere.example/", { allowlist: [] }, PUBLIC);
    expect(decision).toMatchObject({ ok: false });
    if (!decision.ok) expect(decision.reason).toContain("could not be resolved");
  });
});

describe("safeFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("re-checks every redirect hop and blocks one aimed at metadata", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      });
    });
    const resolver = resolverFor({
      "example.com": ["93.184.216.34"],
      "169.254.169.254": ["169.254.169.254"],
    });
    await expect(
      safeFetch("https://example.com/redirect", {}, { allowlist: [] }, resolver),
    ).rejects.toBeInstanceOf(EgressBlockedError);
    // The first hop was made; the redirect target never was.
    expect(calls).toEqual(["https://example.com/redirect"]);
  });

  it("follows a redirect that stays public and returns the final response", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).endsWith("/moved")
        ? new Response(null, { status: 301, headers: { location: "https://docs.example.com/here" } })
        : new Response("arrived", { status: 200 }),
    );
    const res = await safeFetch("https://example.com/moved", {}, { allowlist: [] }, PUBLIC);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("arrived");
  });

  it("resolves a relative Location against the current hop", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(String(url));
      return String(url).endsWith("/a")
        ? new Response(null, { status: 302, headers: { location: "/b" } })
        : new Response("ok", { status: 200 });
    });
    await safeFetch("https://example.com/a", {}, { allowlist: [] }, PUBLIC);
    expect(seen).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("gives up rather than looping forever on a redirect cycle", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(null, { status: 302, headers: { location: "https://example.com/loop" } }),
    );
    await expect(
      safeFetch("https://example.com/loop", {}, { allowlist: [] }, PUBLIC),
    ).rejects.toThrow(/more than \d+ redirects/);
  });

  it("blocks before making any request when the first URL is refused", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      safeFetch("http://127.0.0.1:8080/", {}, { allowlist: [] }, resolverFor({ "127.0.0.1": ["127.0.0.1"] })),
    ).rejects.toBeInstanceOf(EgressBlockedError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
