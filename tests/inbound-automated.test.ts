import { describe, expect, it } from "vitest";
import { detectAutomatedMail, extractFailedRecipient } from "@/lib/inbound-email";

describe("detectAutomatedMail", () => {
  it("lets a real person through", () => {
    expect(
      detectAutomatedMail({
        from: "Dana Whitfield <dana@company.com>",
        subject: "Star on GitHub button is unreadable",
      }),
    ).toBeNull();
  });

  it("catches a Gmail bounce by its sender", () => {
    expect(
      detectAutomatedMail({
        from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        subject: "Delivery Status Notification (Failure)",
      }),
    ).toMatch(/mailer-daemon/);
  });

  it("catches a bounce whose sender looks ordinary, by subject", () => {
    expect(
      detectAutomatedMail({ from: "postmaster-relay@mail.example", subject: "Undeliverable: your message" }),
    ).toBe("Automated subject line");
  });

  it("honours RFC 3834 headers", () => {
    expect(
      detectAutomatedMail({
        from: "someone@company.com",
        subject: "Re: your request",
        headers: { "auto-submitted": "auto-replied" },
      }),
    ).toMatch(/auto-replied/);
    // "no" is the explicit marker of a human-sent message.
    expect(
      detectAutomatedMail({
        from: "someone@company.com",
        subject: "Re: your request",
        headers: { "auto-submitted": "no" },
      }),
    ).toBeNull();
  });

  it("treats an empty return path as a bounce", () => {
    expect(
      detectAutomatedMail({ from: "x@y.com", subject: "hello", headers: { "return-path": "<>" } }),
    ).toMatch(/return path/i);
  });

  it("catches out-of-office replies", () => {
    expect(
      detectAutomatedMail({ from: "colleague@company.com", subject: "Out of Office: Re: #1029" }),
    ).toBe("Automated subject line");
  });
});

describe("extractFailedRecipient", () => {
  it("reads the DSN Final-Recipient field", () => {
    const body = "Reporting-MTA: dns; googlemail.com\nFinal-Recipient: rfc822; tomas@northwind.example\n";
    expect(extractFailedRecipient(body)).toBe("tomas@northwind.example");
  });

  it("reads Gmail's prose form", () => {
    const body = "Your message wasn't delivered to tomas.berg@northwind.example because the domain…";
    expect(extractFailedRecipient(body)).toBe("tomas.berg@northwind.example");
  });

  it("returns empty when there is nothing to find", () => {
    expect(extractFailedRecipient("Out of office until Monday.")).toBe("");
  });
});
