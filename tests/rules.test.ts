import { describe, expect, it } from "vitest";
import {
  memberEligibleFor,
  minSeniorityFor,
  nextLevel,
} from "@/lib/escalation-rules";
import { evaluateSla } from "@/lib/sla-rules";

describe("escalation rules", () => {
  it("maps priority to the minimum tier", () => {
    expect(minSeniorityFor("LOW")).toBe("JUNIOR");
    expect(minSeniorityFor("MEDIUM")).toBe("JUNIOR");
    expect(minSeniorityFor("HIGH")).toBe("MID");
    expect(minSeniorityFor("URGENT")).toBe("SENIOR");
  });

  it("walks the ladder and stops at SENIOR", () => {
    expect(nextLevel("JUNIOR")).toBe("MID");
    expect(nextLevel("MID")).toBe("SENIOR");
    expect(nextLevel("SENIOR")).toBeNull();
  });

  it("treats STANDALONE members as eligible for any tier", () => {
    expect(memberEligibleFor("STANDALONE", "SENIOR")).toBe(true);
    expect(memberEligibleFor("JUNIOR", "SENIOR")).toBe(false);
    expect(memberEligibleFor("SENIOR", "JUNIOR")).toBe(true);
  });
});

describe("evaluateSla", () => {
  const base = {
    status: "OPEN",
    createdAt: "2026-08-06T10:00:00Z",
    firstResponseAt: null as string | null,
    resolvedAt: null as string | null,
    responseDueAt: "2026-08-06T11:00:00Z",
    resolutionDueAt: "2026-08-06T18:00:00Z",
  };

  it("tracks the response clock until the first reply", () => {
    const view = evaluateSla(base, new Date("2026-08-06T10:30:00Z"));
    expect(view.kind).toBe("response");
    expect(view.state).toBe("ok");
  });

  it("flags at_risk near the deadline and breached past it", () => {
    expect(evaluateSla(base, new Date("2026-08-06T10:55:00Z")).state).toBe("at_risk");
    expect(evaluateSla(base, new Date("2026-08-06T11:05:00Z")).state).toBe("breached");
  });

  it("switches to the resolution clock after the first reply", () => {
    const replied = { ...base, firstResponseAt: "2026-08-06T10:20:00Z" };
    const view = evaluateSla(replied, new Date("2026-08-06T12:00:00Z"));
    expect(view.kind).toBe("resolution");
    expect(view.state).toBe("ok");
  });

  it("reports met or breached for resolved tickets", () => {
    const resolved = {
      ...base,
      status: "RESOLVED",
      resolvedAt: "2026-08-06T15:00:00Z",
    };
    expect(evaluateSla(resolved, new Date("2026-08-07T00:00:00Z")).state).toBe("met");
    const late = { ...resolved, resolvedAt: "2026-08-06T20:00:00Z" };
    expect(evaluateSla(late, new Date("2026-08-07T00:00:00Z")).state).toBe("breached");
  });
});
