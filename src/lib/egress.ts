// Outbound web access guard.
//
// Servo's tickets arrive by email, so any URL an agent decides to open may
// have been chosen by whoever wrote the email. Left unguarded, "please check
// http://169.254.169.254/latest/meta-data/" turns a helpful resolver into a
// confused deputy standing inside the network perimeter.
//
// Every outbound request an agent can steer goes through checkEgress():
//
//   1. http/https only, no credentials embedded in the URL;
//   2. the hostname is resolved and every address it answers with must be a
//      public one — loopback, private, link-local, CGNAT, multicast and the
//      cloud metadata endpoints are refused;
//   3. an admin allowlist (Settings → Integrations → Outbound web access)
//      narrows this further, and a *literal* entry in it is also the way to
//      permit an internal host on purpose;
//   4. redirects are followed one hop at a time and re-checked, so a public
//      URL cannot bounce the request onto an internal one.
//
// Residual risk worth naming: the address is checked before the request and
// the request is then made by hostname, so a DNS entry that changes between
// the two (rebinding) is not caught. Closing that needs connecting by pinned
// IP with the Host/SNI preserved, which undici does not expose today.

import { lookup } from "dns/promises";
import { db } from "@/lib/db";

export const EGRESS_SETTING_KEYS = {
  allowlist: "integration.egress.allowlist", // newline/comma separated host patterns
} as const;

/** Requests are given up on well before a tool call would look stuck. */
export const EGRESS_TIMEOUT_MS = 10_000;

/** Redirect hops followed before giving up; each one is re-checked. */
const MAX_REDIRECTS = 5;

export interface EgressConfig {
  /** Host patterns; empty = every public host is allowed. */
  allowlist: string[];
}

/** Blocked by policy, not by the network — callers turn this into a tool result. */
export class EgressBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressBlockedError";
  }
}

/**
 * Accepts newlines, commas or spaces so pasting from anywhere works. Entries
 * are lowercased; order is preserved and duplicates dropped.
 */
export function parseAllowlist(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,]+/)) {
    const entry = part.trim().toLowerCase().replace(/\/+$/, "");
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

export async function getEgressConfig(): Promise<EgressConfig> {
  const row = await db.setting.findUnique({ where: { key: EGRESS_SETTING_KEYS.allowlist } });
  return { allowlist: parseAllowlist(row?.value ?? "") };
}

/**
 * A pattern is `host`, `*.host` (the domain and any subdomain) or either with
 * `:port` appended. Without a port an entry matches every port.
 */
export function entryMatches(entry: string, host: string, port: number): boolean {
  let pattern = entry;
  // Split on the LAST colon so a bracketed IPv6 literal keeps its address.
  const colon = pattern.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(pattern.slice(colon + 1))) {
    const head = pattern.slice(0, colon);
    // A head still ending in ":" means we cut inside an address like "::1",
    // which is a host, not a port.
    if (head && !head.endsWith(":")) {
      if (Number(pattern.slice(colon + 1)) !== port) return false;
      pattern = head;
    }
  }

  pattern = pattern.replace(/^\[|\]$/g, "");
  const target = host.replace(/^\[|\]$/g, "");
  if (pattern.startsWith("*.")) {
    const domain = pattern.slice(2);
    return target === domain || target.endsWith(`.${domain}`);
  }
  return target === pattern;
}

export interface AllowlistMatch {
  allowed: boolean;
  /** Matched by a literal entry — the admin named this exact host on purpose. */
  explicit: boolean;
}

export function matchAllowlist(host: string, port: number, allowlist: string[]): AllowlistMatch {
  if (allowlist.length === 0) return { allowed: true, explicit: false };
  let explicit = false;
  let allowed = false;
  for (const entry of allowlist) {
    if (!entryMatches(entry, host, port)) continue;
    allowed = true;
    if (!entry.includes("*")) explicit = true;
  }
  return { allowed, explicit };
}

// -- address classification ---------------------------------------------------

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isPrivateIpv4(o: number[]): boolean {
  const [a, b] = o;
  if (a === 0) return true; // "this network" / 0.0.0.0
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local — cloud metadata lives here
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && o[1] === 0 && (o[2] === 0 || o[2] === 2)) return true; // IETF protocol / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && o[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && o[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** Expand an IPv6 literal to its eight 16-bit groups, or null if malformed. */
function parseIpv6(value: string): number[] | null {
  let text = value.replace(/^\[|\]$/g, "").split("%")[0];
  if (!text.includes(":")) return null;

  // A trailing dotted quad (::ffff:1.2.3.4) becomes two groups.
  const dotted = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    const v4 = parseIpv4(dotted[1]);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, dotted.index)}${hi}:${lo}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const chunk of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(chunk)) return null;
      groups.push(parseInt(chunk, 16));
    }
    return groups;
  };
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...new Array(fill).fill(0), ...tail];
}

function isPrivateIpv6(g: number[]): boolean {
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) carry a v4
  // address — classify the address that will actually be reached.
  const embedded = () => [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
  const isMapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  const isNat64 = g[0] === 0x0064 && g[1] === 0xff9b;
  if (isMapped || isNat64) return isPrivateIpv4(embedded());

  if (g.every((x) => x === 0)) return true; // unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // loopback
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** True for anything that is not a routable public address. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) return isPrivateIpv4(v4);
  const v6 = parseIpv6(ip);
  if (v6) return isPrivateIpv6(v6);
  return true; // unparseable: refuse rather than guess
}

// -- the check ----------------------------------------------------------------

export type EgressDecision =
  | { ok: true; url: URL; addresses: string[] }
  | { ok: false; reason: string };

/** Injected in tests; production resolves through the system resolver. */
export type Resolver = (host: string) => Promise<string[]>;

const systemResolver: Resolver = async (host) => {
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
};

function portOf(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

export async function checkEgress(
  rawUrl: string,
  config: EgressConfig,
  resolver: Resolver = systemResolver,
): Promise<EgressDecision> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: `Not a valid URL: ${rawUrl}` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      reason: `Blocked: only http and https URLs may be opened (got ${url.protocol.replace(":", "")}).`,
    };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Blocked: URLs with embedded credentials are not opened." };
  }

  const host = url.hostname.toLowerCase();
  const port = portOf(url);
  const match = matchAllowlist(host, port, config.allowlist);
  if (!match.allowed) {
    return {
      ok: false,
      reason: `Blocked by the outbound allowlist: ${host} is not listed. An admin can add it under Settings → Integrations → Outbound web access.`,
    };
  }

  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    return { ok: false, reason: `Blocked: ${host} could not be resolved.` };
  }
  if (addresses.length === 0) {
    return { ok: false, reason: `Blocked: ${host} resolved to no addresses.` };
  }

  // An explicit literal entry is the admin saying "this internal host, on
  // purpose"; a wildcard is not specific enough to unlock the private ranges.
  if (!match.explicit) {
    const priv = addresses.find((address) => isPrivateAddress(address));
    if (priv) {
      return {
        ok: false,
        reason: `Blocked: ${host} resolves to ${priv}, which is a private or link-local address. Internal hosts must be named exactly in Settings → Integrations → Outbound web access.`,
      };
    }
  }
  return { ok: true, url, addresses };
}

/**
 * fetch() with the guard applied to the URL and to every redirect hop.
 * Throws EgressBlockedError when policy refuses; network errors surface as
 * whatever fetch threw.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit,
  config: EgressConfig,
  resolver: Resolver = systemResolver,
): Promise<Response> {
  let target = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const decision = await checkEgress(target, config, resolver);
    if (!decision.ok) {
      throw new EgressBlockedError(
        hop === 0 ? decision.reason : `${decision.reason} (after ${hop} redirect${hop === 1 ? "" : "s"})`,
      );
    }
    const res = await fetch(decision.url.toString(), { ...init, redirect: "manual" });
    if (res.status < 300 || res.status > 399) return res;
    const location = res.headers.get("location");
    if (!location) return res;
    target = new URL(location, decision.url).toString();
  }
  throw new EgressBlockedError(`Blocked: more than ${MAX_REDIRECTS} redirects.`);
}
