import { describe, expect, it } from "vitest";
import { CallContextSchema } from "../../src/schema/call-context.js";

const validCallContext = {
  rootRunId: "run-001",
  parentRunId: null,
  callChain: ["spec-a", "spec-b"],
  remainingDepth: 3,
  remainingCallBudget: 10,
  remainingTokenBudget: 50_000,
  remainingTimeBudget: 60_000,
};

describe("CallContextSchema", () => {
  it("accepts a valid call context", () => {
    expect(CallContextSchema.safeParse(validCallContext).success).toBe(true);
  });

  it("rejects a negative remainingDepth", () => {
    const candidate = { ...validCallContext, remainingDepth: -1 };
    expect(CallContextSchema.safeParse(candidate).success).toBe(false);
  });

  it("requires non-empty run identifiers and a non-empty spec call chain", () => {
    for (const candidate of [
      { ...validCallContext, rootRunId: "" },
      { ...validCallContext, parentRunId: "" },
      { ...validCallContext, callChain: [] },
    ]) {
      expect(CallContextSchema.safeParse(candidate).success).toBe(false);
    }
  });
});
