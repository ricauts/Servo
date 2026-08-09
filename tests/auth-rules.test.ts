import { describe, expect, it } from "vitest";
import { isEmailAllowed, parseList } from "@/lib/auth-rules";

describe("parseList", () => {
  it("trims, lowercases and drops empty entries", () => {
    expect(parseList(" ServoAI.org ,, EXAMPLE.com ")).toEqual(["servoai.org", "example.com"]);
    expect(parseList("")).toEqual([]);
  });
});

describe("isEmailAllowed", () => {
  const config = {
    adminEmails: ["consultant@gmail.com"],
    allowedDomains: ["servoai.org"],
  };

  it("allows anyone when no domains are configured", () => {
    expect(isEmailAllowed("random@stranger.com", { adminEmails: [], allowedDomains: [] })).toBe(
      true,
    );
  });

  it("allows accounts on an allowed domain, case-insensitively", () => {
    expect(isEmailAllowed("Sricaurte@ServoAI.org", config)).toBe(true);
  });

  it("rejects accounts outside the allowlist", () => {
    expect(isEmailAllowed("random@gmail.com", config)).toBe(false);
    expect(isEmailAllowed("spoof@servoai.org.evil.com", config)).toBe(false);
  });

  it("always lets explicit admin emails in", () => {
    expect(isEmailAllowed("Consultant@Gmail.com", config)).toBe(true);
  });
});
