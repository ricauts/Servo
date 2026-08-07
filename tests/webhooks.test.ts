import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import { newWebhookSecret, signPayload, subscribes } from "@/lib/webhooks";

describe("signPayload", () => {
  it("produces a verifiable HMAC-SHA256 hex digest", () => {
    const body = JSON.stringify({ event: "ticket.created", data: { number: 1001 } });
    const signature = signPayload("whsec_test", body);
    const expected = createHmac("sha256", "whsec_test").update(body, "utf8").digest("hex");
    expect(signature).toBe(expected);
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the body changes (tamper detection)", () => {
    expect(signPayload("s", "a")).not.toBe(signPayload("s", "b"));
  });

  it("changes when the secret changes", () => {
    expect(signPayload("s1", "body")).not.toBe(signPayload("s2", "body"));
  });
});

describe("subscribes", () => {
  it("matches an explicit subscription", () => {
    expect(subscribes('["ticket.created"]', "ticket.created")).toBe(true);
    expect(subscribes('["ticket.created"]', "ticket.resolved")).toBe(false);
  });

  it("matches everything with the wildcard", () => {
    expect(subscribes('["*"]', "approval.decided")).toBe(true);
  });

  it("rejects malformed subscription JSON instead of throwing", () => {
    expect(subscribes("not-json", "ticket.created")).toBe(false);
  });
});

describe("newWebhookSecret", () => {
  it("is prefixed, long, and unique per call", () => {
    const a = newWebhookSecret();
    const b = newWebhookSecret();
    expect(a).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(a).not.toBe(b);
  });
});
