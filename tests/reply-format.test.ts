import { describe, expect, it } from "vitest";
import { replySubject } from "@/lib/reply-format";
import { extractTicketNumber, stripQuotedReply } from "@/lib/inbound-email";

describe("replySubject", () => {
  it("keeps the threading round trip with the inbound parser", () => {
    const subject = replySubject(1052, "VPN access broken since yesterday");
    // The requester replies with "Re: " prepended — the ticket number must
    // still be extracted so the answer lands on the same ticket.
    expect(extractTicketNumber(`Re: ${subject}`)).toBe(1052);
  });

  it("clips very long titles but never the ticket tag", () => {
    const subject = replySubject(1053, "x".repeat(300));
    expect(subject).toContain("#1053");
    expect(subject.length).toBeLessThan(120);
  });

  it("collapses whitespace from mail-mangled titles", () => {
    expect(replySubject(7, "hello\n  world")).toBe("Re: [Servo] #7 hello world");
  });
});

describe("reply e2e contract", () => {
  it("a Gmail-style reply to our subject strips quotes and threads back", () => {
    const subject = replySubject(1052, "VPN access");
    const replyBody =
      "Ya funciona, ¡gracias!\n\nEl vie, 8 ago 2026 a las 23:00, Servo Support escribió:\n> We're checking the network side now.";
    expect(extractTicketNumber(subject)).toBe(1052);
    expect(stripQuotedReply(replyBody)).toBe("Ya funciona, ¡gracias!");
  });
});
