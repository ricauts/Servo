import { describe, expect, it } from "vitest";
import {
  formatSearchHit,
  formatTicketDetail,
  lastPublicReply,
  mayRevealRequester,
  outcomeOf,
  rankTickets,
  requesterLabel,
  resolutionNote,
  scoreTicket,
  searchTerms,
  stem,
  truncate,
  type HistoryTicket,
} from "@/lib/ai/ticket-history";

function ticket(overrides: Partial<HistoryTicket> = {}): HistoryTicket {
  return {
    number: 1001,
    title: "VPN drops every few minutes",
    description: "The VPN client disconnects roughly every five minutes on home wifi.",
    status: "RESOLVED",
    priority: "HIGH",
    category: "NETWORK",
    createdAt: new Date("2026-01-10T09:00:00Z"),
    resolvedAt: new Date("2026-01-10T11:00:00Z"),
    requesterId: "user-dana",
    requester: { name: "Dana Whitfield", email: "dana@company.com" },
    comments: [],
    ...overrides,
  };
}

describe("stem", () => {
  it("trims common suffixes so related words match", () => {
    expect(stem("connecting")).toBe("connect");
    expect(stem("passwords")).toBe("password");
    expect(stem("crashed")).toBe("crash");
  });

  it("undoes the consonant English doubles before -ing/-ed", () => {
    expect(stem("resetting")).toBe("reset");
    expect(stem("stopped")).toBe("stop");
    // -s/-es never introduce a doubling, so "pass" must survive intact.
    expect(stem("passes")).toBe("pass");
  });

  it("never shortens a word below four characters", () => {
    expect(stem("vpns")).toBe("vpns");
    expect(stem("sso")).toBe("sso");
    expect(stem("ping")).toBe("ping");
  });
});

describe("searchTerms", () => {
  it("keeps the signal words and drops the noise", () => {
    expect(searchTerms("Please help, the VPN keeps disconnecting")).toEqual([
      "vpn",
      "keep",
      "disconnect",
    ]);
  });

  it("deduplicates terms that share a stem", () => {
    expect(searchTerms("password reset — resetting my password")).toEqual(["password", "reset"]);
  });

  it("returns nothing for a query with no searchable words", () => {
    expect(searchTerms("please help me with this")).toEqual([]);
    expect(searchTerms("???")).toEqual([]);
  });

  it("caps the term list so one rambling ticket cannot blow up the query", () => {
    const long = "alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo";
    expect(searchTerms(long)).toHaveLength(8);
  });
});

describe("resolutionNote", () => {
  it("reads the note an agent recorded when it resolved the ticket", () => {
    expect(
      resolutionNote([
        { body: "Looking into it.", kind: "COMMENT" },
        { body: "Resolved by Servo Resolver: Rotated the VPN profile and reissued the cert.", kind: "SYSTEM" },
      ]),
    ).toBe("Rotated the VPN profile and reissued the cert.");
  });

  it("takes the last note when a ticket was resolved more than once", () => {
    expect(
      resolutionNote([
        { body: "Resolved by A: first attempt", kind: "SYSTEM" },
        { body: "Resolved by B: the fix that stuck", kind: "SYSTEM" },
      ]),
    ).toBe("the fix that stuck");
  });

  it("ignores a public comment that merely looks like a note", () => {
    expect(resolutionNote([{ body: "Resolved by magic: nope", kind: "COMMENT" }])).toBeNull();
  });

  it("is null when no note was recorded", () => {
    expect(resolutionNote([{ body: "Escalated to Priya by Servo", kind: "SYSTEM" }])).toBeNull();
  });
});

describe("lastPublicReply / outcomeOf", () => {
  it("falls back to the last reply for a ticket a human closed", () => {
    const humanClosed = ticket({
      comments: [
        { body: "First reply", kind: "COMMENT" },
        { body: "Swapped the dock, working now.", kind: "COMMENT" },
        { body: "Escalated to Priya", kind: "SYSTEM" },
      ],
    });
    expect(lastPublicReply(humanClosed.comments)).toBe("Swapped the dock, working now.");
    expect(outcomeOf(humanClosed)).toBe("Swapped the dock, working now.");
  });

  it("prefers the recorded note over the last reply", () => {
    const withNote = ticket({
      comments: [
        { body: "Swapped the dock, working now.", kind: "COMMENT" },
        { body: "Resolved by Servo Resolver: Dock replaced under warranty.", kind: "SYSTEM" },
      ],
    });
    expect(outcomeOf(withNote)).toBe("Dock replaced under warranty.");
  });

  it("reports nothing for a ticket with no replies at all", () => {
    expect(outcomeOf(ticket({ comments: [] }))).toBeNull();
  });
});

describe("scoreTicket", () => {
  it("scores nothing when no term matches", () => {
    expect(scoreTicket(ticket(), searchTerms("printer toner"))).toBe(0);
  });

  it("scores nothing for an empty term list", () => {
    expect(scoreTicket(ticket(), [])).toBe(0);
  });

  it("weighs a title hit above a description-only hit", () => {
    const terms = ["vpn"];
    const inTitle = ticket({ status: "OPEN" });
    const inDescription = ticket({
      status: "OPEN",
      title: "Cannot reach the intranet",
      description: "Only fails when the vpn is up.",
    });
    expect(scoreTicket(inTitle, terms)).toBeGreaterThan(scoreTicket(inDescription, terms));
  });

  it("rewards a ticket that actually reached an outcome", () => {
    const terms = ["vpn"];
    const open = ticket({ status: "OPEN" });
    const resolved = ticket({ status: "RESOLVED" });
    expect(scoreTicket(resolved, terms)).toBe(scoreTicket(open, terms) + 2);
  });

  it("counts a term once per field, so repetition cannot outrank a title", () => {
    const spammy = ticket({
      status: "OPEN",
      title: "Intranet unreachable",
      description: "vpn vpn vpn vpn vpn vpn vpn",
    });
    expect(scoreTicket(spammy, ["vpn"])).toBe(1);
  });
});

describe("rankTickets", () => {
  const terms = searchTerms("vpn disconnects");

  it("drops non-matches, orders by relevance and honours the limit", () => {
    const strong = ticket({ number: 1, title: "VPN disconnects constantly" });
    const weak = ticket({ number: 2, title: "Laptop slow", description: "maybe the vpn" });
    const miss = ticket({ number: 3, title: "New monitor", description: "24 inch please" });

    const ranked = rankTickets([miss, weak, strong], terms, 5);
    expect(ranked.map((r) => r.ticket.number)).toEqual([1, 2]);

    expect(rankTickets([miss, weak, strong], terms, 1).map((r) => r.ticket.number)).toEqual([1]);
  });

  it("breaks a relevance tie with the more recent ticket", () => {
    const older = ticket({ number: 10, resolvedAt: new Date("2025-01-01T00:00:00Z") });
    const newer = ticket({ number: 11, resolvedAt: new Date("2026-06-01T00:00:00Z") });
    expect(rankTickets([older, newer], terms, 5).map((r) => r.ticket.number)).toEqual([11, 10]);
  });

  it("returns nothing when the query had no searchable terms", () => {
    expect(rankTickets([ticket()], [], 5)).toEqual([]);
  });
});

describe("requester redaction", () => {
  it("reveals the requester only when it is the same person", () => {
    expect(mayRevealRequester({ requesterId: "user-dana" }, "user-dana")).toBe(true);
    expect(mayRevealRequester({ requesterId: "user-ravi" }, "user-dana")).toBe(false);
  });

  it("withholds identity when there is no ticket in context (MCP callers)", () => {
    expect(mayRevealRequester({ requesterId: "user-dana" }, null)).toBe(false);
    expect(requesterLabel(ticket(), null)).toBe("another requester (withheld)");
  });

  it("never leaks another requester's name or email into a formatted hit", () => {
    const hit = formatSearchHit(ticket(), "user-ravi");
    expect(hit).not.toContain("Dana");
    expect(hit).not.toContain("dana@company.com");
    expect(hit).toContain("another requester (withheld)");
  });

  it("shows the identity back to the requester's own agent run", () => {
    expect(formatSearchHit(ticket(), "user-dana")).toContain("Dana Whitfield <dana@company.com>");
  });
});

describe("formatSearchHit", () => {
  it("leads with the number, state and title, and reports the outcome", () => {
    const hit = formatSearchHit(
      ticket({
        comments: [{ body: "Resolved by Servo Resolver: Reissued the VPN cert.", kind: "SYSTEM" }],
      }),
      "user-dana",
    );
    expect(hit).toContain("#1001 [RESOLVED/HIGH/NETWORK] VPN drops every few minutes");
    expect(hit).toContain("opened 2026-01-10, resolved 2026-01-10");
    expect(hit).toContain("outcome: Reissued the VPN cert.");
  });

  it("says so plainly when nothing was recorded", () => {
    expect(formatSearchHit(ticket({ status: "OPEN", resolvedAt: null }), null)).toContain(
      "outcome: none recorded yet",
    );
  });
});

describe("formatTicketDetail", () => {
  const detailed = ticket({
    comments: [
      { body: "Checking your VPN profile now.", kind: "COMMENT" },
      { body: "Reissued the certificate — try again.", kind: "COMMENT" },
      { body: "Resolved by Servo Resolver: Reissued the VPN certificate.", kind: "SYSTEM" },
    ],
  });

  it("includes the request, the replies, the tools used and the resolution", () => {
    const detail = formatTicketDetail(detailed, "user-dana", ["query_ops_database", "post_comment"]);
    expect(detail).toContain("#1001: VPN drops every few minutes");
    expect(detail).toContain("## Request");
    expect(detail).toContain("Reissued the certificate — try again.");
    expect(detail).toContain("query_ops_database, post_comment");
    expect(detail).toContain("## Resolution\nReissued the VPN certificate.");
  });

  it("omits the tools section when the ticket had no agent runs", () => {
    expect(formatTicketDetail(detailed, "user-dana", [])).not.toContain("## Tools");
  });

  it("says the ticket is unresolved rather than inventing a resolution", () => {
    const open = ticket({ status: "OPEN", resolvedAt: null, comments: [] });
    expect(formatTicketDetail(open, "user-dana", [])).toContain("## Resolution\nNot resolved yet.");
  });
});

describe("truncate", () => {
  it("collapses whitespace and marks the cut", () => {
    expect(truncate("a\n\n  b   c", 40)).toBe("a b c");
    expect(truncate("abcdefghij", 4)).toBe("abcd…");
  });
});
